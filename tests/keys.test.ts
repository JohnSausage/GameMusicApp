import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import { songToMidi } from '../src/renderer/src/audio/midiExport'
import { pieceRow } from '../src/renderer/src/model/drums'
import { addTrack, barTicks, beatTicks, createSong, makeRetro, type Cursor } from '../src/renderer/src/model/edit'
import { addRollNote, quantizeNotes, removeRollNote, rollNotes, rollToBars, writeRoll, type RollNote } from '../src/renderer/src/model/keys'
import { importMidi } from '../src/renderer/src/model/midiImport'
import { keyRow, rowPitch, type Song } from '../src/renderer/src/model/song'
import { fretFor, stepAdvance, stepEnter } from '../src/renderer/src/model/stepEntry'
import { buildTimeline } from '../src/renderer/src/model/timing'
import { parseProject, serializeProject } from '../src/renderer/src/project/projectFile'

const Q = 960 // ticks per quarter; 4/4 bars have 3840
const quarter = { value: 4 as const, dotted: false }

/** A 4/4 song at 120 BPM with an empty keys track as track 1 (track 0 is a guitar). */
function keysSong(bars = 2): { song: Song; cursor: Cursor } {
  const song = createSong({ title: 't', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars })
  return addTrack(song, { track: 0, bar: 0, beat: 0, string: 1 }, 'keys')
}

const note = (pitch: number, start: number, length: number, velocity = 96): RollNote => ({ row: keyRow(pitch), start, length, velocity })
const isFull = (song: Song): boolean => song.tracks.every((t) => t.bars.every((b) => b.beats.reduce((sum, beat) => sum + beatTicks(beat), 0) === barTicks(song)))

describe('keys tracks', () => {
  it('have one row per piano key, starting near middle C', () => {
    const { song, cursor } = keysSong()
    const keys = song.tracks[1]
    expect(keys).toMatchObject({ name: 'Keys', kind: 'keys', instrument: { kind: 'soundfont', program: 0 } })
    expect(keys.tuning).toHaveLength(88)
    expect([keys.tuning[0], keys.tuning[87]]).toEqual([108, 21])
    expect(rowPitch(keyRow(60))).toBe(60)
    expect(cursor).toMatchObject({ track: 1, string: keyRow(60) })
  })

  it('turn piano-roll notes into beats with held notes, also across the bar line', () => {
    // A C-E-G chord held for a half note, under it D5 for a quarter, then E5 from beat 4 into the next bar.
    const notes = [note(60, 0, 2 * Q), note(64, 0, 2 * Q), note(67, 0, 2 * Q), note(74, Q, Q), note(76, 3 * Q, 2 * Q)]
    const bars = rollToBars(notes, 2, 4 * Q)
    expect(bars[0].beats.map((b) => [b.value, b.notes.map((n) => `${rowPitch(n.string)}${n.tie ? '~' : ''}`)])).toEqual([
      [4, ['67', '64', '60']],
      [4, ['74', '67~', '64~', '60~']],
      [4, []],
      [4, ['76']]
    ])
    expect(bars[1].beats[0].notes.map((n) => [rowPitch(n.string), n.tie])).toEqual([[76, true]])
    expect(rollNotes({ ...keysSong().song, tracks: [keysSong().song.tracks[0], { ...keysSong().song.tracks[1], bars }] }, 1, 0, 2)).toEqual(
      [...notes].sort((a, b) => a.start - b.start || a.row - b.row)
    )
  })

  it('play held notes once, for their whole length', () => {
    let { song, cursor } = keysSong()
    song = writeRoll(song, cursor, 1, 0, 1, [note(48, 0, 4 * Q), note(64, 0, Q), note(65, Q, Q), note(67, 2 * Q, 2 * Q)])!.song
    expect(isFull(song)).toBe(true)
    expect(buildTimeline(song).notes.map((n) => [n.pitch, n.start, n.duration])).toEqual([
      [64, 0, 0.5],
      [48, 0, 2],
      [65, 0.5, 0.5],
      [67, 1, 1]
    ])
  })

  it('add notes in the roll, shortening a note of the same key it overlaps, and remove them', () => {
    let { song, cursor } = keysSong()
    song = addRollNote(song, cursor, 1, 0, 2, note(60, 0, 4 * Q))!.song
    const added = addRollNote(song, cursor, 1, 0, 2, note(60, 2 * Q, Q))!
    song = added.song
    expect(rollNotes(song, 1, 0, 2).map((n) => [rowPitch(n.row), n.start, n.length])).toEqual([
      [60, 0, 2 * Q],
      [60, 2 * Q, Q]
    ])
    expect(added.cursor).toMatchObject({ bar: 0, string: keyRow(60) })
    expect(song.tracks[1].bars[0].beats[added.cursor.beat].notes.map((n) => n.string)).toContain(keyRow(60)) // the cursor is on the new note
    // Cut at the end of the shown bars.
    song = addRollNote(song, cursor, 1, 0, 2, note(72, 7 * Q, 4 * Q))!.song
    expect(rollNotes(song, 1, 0, 2).find((n) => rowPitch(n.row) === 72)?.length).toBe(Q)
    song = removeRollNote(song, cursor, 1, 0, 2, keyRow(60), 2 * Q + 10)!.song
    expect(rollNotes(song, 1, 0, 2).map((n) => rowPitch(n.row))).toEqual([60, 72])
    expect(removeRollNote(song, cursor, 1, 0, 2, keyRow(61), 0)).toBeNull()
    expect(isFull(song)).toBe(true)
  })

  it('snap recorded notes to the grid', () => {
    const secondsPerTick = 0.5 / Q // 120 BPM
    const played = [
      { pitch: 60, start: 0.02, end: 0.4, velocity: 100 }, // slightly late, a bit short of an eighth
      { pitch: 60, start: 0.49, end: 0.6, velocity: 90 }, // overlaps nothing after snapping
      { pitch: 64, start: 0.98, end: 1.01, velocity: 80 }, // very short: at least one step
      { pitch: 10, start: 0, end: 1, velocity: 80 } // below the piano
    ]
    expect(quantizeNotes(played, secondsPerTick, 240).map((n) => [rowPitch(n.row), n.start, n.length, n.velocity])).toEqual([
      [60, 0, 720, 100],
      [60, 960, 240, 90],
      [64, 1920, 240, 80]
    ])
  })

  it('are saved, get a retro sound and export to MIDI', () => {
    let { song, cursor } = keysSong()
    song = writeRoll(song, cursor, 1, 0, 1, [note(72, 0, Q), note(76, 0, Q)])!.song
    expect(parseProject(serializeProject(song)).song).toEqual(song)
    const retro = makeRetro(song, cursor).song.tracks[1].instrument
    expect(retro.kind === 'synth' && retro.patch.name).toBe('PWM lead')
    const midi = new Midi(songToMidi(song))
    expect(midi.tracks[1].notes.map((n) => n.midi).sort()).toEqual([72, 76])
    expect(midi.tracks[1].instrument.number).toBe(0)
  })
})

describe('MIDI keyboard step entry', () => {
  it('enters a chord in one beat, then moves on (adding a bar at the end)', () => {
    let { song, cursor } = keysSong(1)
    for (const pitch of [60, 64, 67]) {
      const result = stepEnter(song, cursor, pitch, 80, quarter)!
      song = result.song
    }
    expect(song.tracks[1].bars[0].beats[0].notes.map((n) => [rowPitch(n.string), n.velocity])).toEqual([
      [67, 80],
      [64, 80],
      [60, 80]
    ])
    expect(song.tracks[1].bars[0].beats[0].value).toBe(4)
    song = stepEnter(song, { ...cursor, beat: 1 }, 62, 80, { value: 2, dotted: true })!.song // fills the bar
    const advanced = stepAdvance(song, { ...cursor, beat: 1 })
    expect(advanced.song.tracks[0].bars).toHaveLength(2)
    expect(advanced.cursor).toMatchObject({ bar: 1, beat: 0 })
  })

  it('chooses string and fret on guitar near the last fret, and maps drum notes', () => {
    const guitar = keysSong().song.tracks[0]
    expect(fretFor(guitar, 64, new Set(), 3, 1)).toEqual({ string: 1, fret: 0 }) // open high E
    expect(fretFor(guitar, 67, new Set(), 3, 1)).toEqual({ string: 1, fret: 3 })
    expect(fretFor(guitar, 67, new Set([1]), 3, 1)).toEqual({ string: 2, fret: 8 }) // string 1 is taken in the chord
    expect(fretFor(guitar, 30, new Set(), 3, 1)).toBeNull() // below the low E

    let song = createSong({ title: 't', tempo: 120, timeSignature: [4, 4], firstTrack: 'drums' })
    song = stepEnter(song, { track: 0, bar: 0, beat: 0, string: 1 }, 35, 100, quarter)!.song // acoustic bass drum → kick
    expect(song.tracks[0].bars[0].beats[0].notes).toEqual([{ string: pieceRow(36), fret: 0, velocity: 100 }])
    expect(stepEnter(song, { track: 0, bar: 0, beat: 0, string: 1 }, 81, 100, quarter)).toBeNull() // no drum there
  })
})

describe('MIDI file import', () => {
  it('adds a keys track per instrument and a drum track for channel 10', () => {
    const file = new Midi()
    file.header.setTempo(140)
    const piano = file.addTrack()
    piano.name = 'Lead'
    piano.instrument.number = 80
    piano.addNote({ midi: 60, ticks: 0, durationTicks: file.header.ppq })
    piano.addNote({ midi: 64, ticks: file.header.ppq * 7, durationTicks: file.header.ppq * 2 }) // across the bar line
    piano.addNote({ midi: 5, ticks: 0, durationTicks: 10 }) // below the piano
    const drums = file.addTrack()
    drums.channel = 9
    drums.addNote({ midi: 36, ticks: 0, durationTicks: 10 })
    drums.addNote({ midi: 42, ticks: file.header.ppq / 2 + 3, durationTicks: 10 }) // a little late
    const song = createSong({ title: 't', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: 1 })

    const imported = importMidi(song, { track: 0, bar: 0, beat: 0, string: 1 }, file.toArray())!
    expect(imported).toMatchObject({ tracks: 2, notes: 4, skipped: 1 })
    expect(imported.fileTempo).toBeCloseTo(140)
    const result = imported.result.song
    expect(result.tracks.map((t) => [t.name, t.kind])).toEqual([
      ['Guitar', undefined],
      ['Lead', 'keys'],
      ['Drums', 'drums']
    ])
    expect(result.tracks[1].instrument).toEqual({ kind: 'soundfont', program: 80 })
    expect(result.tracks.every((t) => t.bars.length === 3)).toBe(true) // the held E4 ends in bar 3
    expect(isFull(result)).toBe(true)
    expect(buildTimeline(result).notes.filter((n) => n.trackIndex > 0).map((n) => [n.trackIndex, n.pitch, n.start, n.duration])).toEqual([
      [1, 60, 0, 0.5],
      [2, 36, 0, 0.25],
      [2, 42, 0.25, 1.5], // a drum hit lasts until the next one (here: a dotted half, then a rest to the end of the bar)
      [1, 64, 3.5, 1]
    ])
    expect(imported.result.cursor.track).toBe(1)
    expect(() => importMidi(song, { track: 0, bar: 0, beat: 0, string: 1 }, new Uint8Array([1, 2, 3]))).toThrow()
  })
})
