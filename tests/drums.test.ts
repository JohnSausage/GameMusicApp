import { Midi } from '@tonejs/midi'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { songToMidi } from '../src/renderer/src/audio/midiExport'
import { channelForTrack } from '../src/renderer/src/audio/soundfont'
import { applyPattern, barToSteps, DRUM_PATTERNS, gridFits, gridFor, gridLabel, hitsOnGrid, pieceRow, repeatBar, stepsInBar, toggleHit, VELOCITY } from '../src/renderer/src/model/drums'
import { addTrack, barTicks, beatTicks, createSong, isRetro, makeRetro, restoreSounds, type Cursor } from '../src/renderer/src/model/edit'
import { barCount, DRUM_TUNING, type Song } from '../src/renderer/src/model/song'
import { eightBitKit } from '../src/renderer/src/model/synth'
import { buildTimeline } from '../src/renderer/src/model/timing'
import { parseProject, serializeProject } from '../src/renderer/src/project/projectFile'

const cursor: Cursor = { track: 0, bar: 0, beat: 0, string: 1 }
const SNARE = pieceRow(38)
const KICK = pieceRow(36)

function drumSong(timeSignature: [number, number] = [4, 4], bars = 2): Song {
  return createSong({ title: 'Beat', tempo: 120, timeSignature, firstTrack: 'drums', bars })
}

/** Rows hit per 16th step of a bar, as "row:velocity" strings. */
function hits(song: Song, bar = 0, stepsPerQuarter = 4): string[][] {
  const count = stepsInBar(song, stepsPerQuarter)
  return barToSteps(song.tracks[0].bars[bar], count, barTicks(song) / count).map((s) => s.map((n) => `${n.string}:${n.velocity}`))
}

const isFull = (song: Song): boolean => song.tracks.every((t) => t.bars.every((b) => b.beats.reduce((sum, beat) => sum + beatTicks(beat), 0) === barTicks(song)))

describe('drum tracks', () => {
  it('are created with one row per kit piece and the General MIDI kit', () => {
    const song = addTrack(createSong({ title: 'x', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar' }), cursor, 'drums')
    const drums = song.song.tracks[1]
    expect(drums).toMatchObject({ name: 'Drums', kind: 'drums', tuning: DRUM_TUNING, instrument: { kind: 'soundfont', program: 0 } })
    expect(song.cursor.track).toBe(1)
  })

  it('toggles hits on the grid and keeps the bar full', () => {
    let song = drumSong()
    const added = toggleHit(song, cursor, 0, 0, 2, SNARE, 'normal', 4)!
    song = added.song
    expect(hits(song)[2]).toEqual([`${SNARE}:${VELOCITY.normal}`])
    expect(hits(song).filter((s) => s.length > 0)).toHaveLength(1)
    expect(isFull(song)).toBe(true)
    // The cursor lands on the beat of the hit.
    expect(song.tracks[0].bars[0].beats[added.cursor.beat].notes).toHaveLength(1)

    song = toggleHit(song, cursor, 0, 0, 2, KICK, 'normal', 4)!.song
    expect(hits(song)[2]).toEqual([`${SNARE}:${VELOCITY.normal}`, `${KICK}:${VELOCITY.normal}`])

    // Same strength again removes it; another strength changes it.
    song = toggleHit(song, cursor, 0, 0, 2, SNARE, 'normal', 4)!.song
    song = toggleHit(song, cursor, 0, 0, 2, KICK, 'accent', 4)!.song
    expect(hits(song)[2]).toEqual([`${KICK}:${VELOCITY.accent}`])
    song = toggleHit(song, cursor, 0, 0, 2, KICK, 'accent', 4)!.song
    expect(song.tracks[0].bars[0].beats.every((b) => b.notes.length === 0)).toBe(true)
    expect(isFull(song)).toBe(true)
  })

  it('writes readable notation: each hit lasts until the next one', () => {
    let song = drumSong()
    for (const step of [0, 4, 8, 12]) song = toggleHit(song, cursor, 0, 0, step, KICK, 'normal', 4)!.song
    expect(song.tracks[0].bars[0].beats.map((b) => [b.value, b.notes.length])).toEqual([
      [4, 1],
      [4, 1],
      [4, 1],
      [4, 1]
    ])
  })

  it('works on finer and coarser grids', () => {
    let song = drumSong()
    expect([2, 4, 8].map((spq) => stepsInBar(song, spq))).toEqual([8, 16, 32])
    expect(stepsInBar(drumSong([3, 4]), 4)).toBe(12)
    song = toggleHit(song, cursor, 0, 0, 3, SNARE, 'ghost', 8)!.song // the 4th 32nd
    expect(hits(song, 0, 8)[3]).toEqual([`${SNARE}:${VELOCITY.ghost}`])
    expect(hits(song)[1]).toEqual([`${SNARE}:${VELOCITY.ghost}`]) // shown on the 16th before it
    expect(isFull(song)).toBe(true)
    expect(toggleHit(song, cursor, 0, 0, 16, SNARE, 'normal', 4)).toBeNull()
  })

  it('has triplet grids that write whole triplet groups', () => {
    const shape = (song: Song): string[] =>
      song.tracks[0].bars[0].beats.map((b) => `${b.triplet ? 'T' : ''}${b.value}${b.dotted ? '.' : ''}${b.notes.length ? '' : 'r'}`)
    const at = (steps: number[], stepsPerQuarter: number): Song => steps.reduce((song, step) => toggleHit(song, cursor, 0, 0, step, KICK, 'normal', stepsPerQuarter)!.song, drumSong())
    expect([3, 6].map((spq) => stepsInBar(drumSong(), spq))).toEqual([12, 24])
    expect([2, 3, 4, 6, 8].map(gridLabel)).toEqual(['1/8', '1/8T', '1/16', '1/16T', '1/32'])

    // A triplet of eighths, then rests: three triplet eighths are a quarter.
    expect(shape(at([0, 1, 2], 3))).toEqual(['T8', 'T8', 'T8', '2.r'])
    // Two steps: a triplet quarter; a hit on the second step comes after a triplet eighth rest.
    expect(shape(at([0, 2], 3))).toEqual(['T4', 'T8', '2.r'])
    expect(shape(at([1], 3))).toEqual(['T8r', 'T4', '2.r'])
    // On the grid of triplet sixteenths, three steps are a straight eighth.
    expect(shape(at([0, 3, 4, 5], 6))).toEqual(['8', 'T16', 'T16', 'T16', '2.r'])
    const song = at([1, 4], 3)
    expect(isFull(song)).toBe(true)
    // The hit on the second triplet eighth sounds a third of a beat in (120 BPM).
    expect(buildTimeline(song).notes.map((n) => n.start.toFixed(3))).toEqual(['0.167', '0.667'])
    expect(hits(song, 0, 3)[4]).toEqual([`${KICK}:96`])
  })

  it('shows a bar in a grid its hits are on', () => {
    const triplets = toggleHit(drumSong(), cursor, 0, 0, 1, KICK, 'normal', 3)!.song
    const sixteenths = toggleHit(drumSong(), cursor, 0, 0, 3, KICK, 'normal', 4)!.song
    expect(hitsOnGrid(triplets.tracks[0].bars[0], 4)).toBe(false)
    expect(gridFor(triplets, triplets.tracks[0].bars[0], 4)).toBe(3)
    expect(gridFor(sixteenths, sixteenths.tracks[0].bars[0], 3)).toBe(4)
    expect(gridFor(sixteenths, sixteenths.tracks[0].bars[0], 8)).toBe(8)
    // An empty bar keeps the grid picked.
    expect(gridFor(triplets, triplets.tracks[0].bars[1], 6)).toBe(6)
    // Triplet eighths don't fill a bar of 3/8; triplet sixteenths do, and both fill 6/8.
    expect(gridFits(drumSong([3, 8]), 3)).toBe(false)
    expect(gridFits(drumSong([3, 8]), 6)).toBe(true)
    expect(gridFits(drumSong([6, 8]), 3)).toBe(true)
    // Picked for 4/4, the triplet eighths become eighths in 3/8.
    const threeEight = drumSong([3, 8])
    expect(gridFor(threeEight, threeEight.tracks[0].bars[0], 3)).toBe(2)
  })

  it('repeats a bar, adding bars to every track when needed', () => {
    let song = addTrack(drumSong(), cursor, 'bass').song
    song = toggleHit(song, cursor, 0, 0, 0, KICK, 'normal', 4)!.song
    song = repeatBar(song, cursor, 0, 0, 3)!.song
    expect(barCount(song)).toBe(4)
    expect(song.tracks[1].bars).toHaveLength(4)
    for (let bar = 1; bar < 4; bar++) expect(song.tracks[0].bars[bar]).toEqual(song.tracks[0].bars[0])
    expect(isFull(song)).toBe(true)
    expect(repeatBar(song, cursor, 0, 0, 0)).toBeNull()
  })

  it('applies starter patterns in 4/4 only', () => {
    const rock = DRUM_PATTERNS.find((p) => p.name === 'Rock beat')!
    const song = applyPattern(drumSong(), cursor, 0, 1, rock)!.song
    const steps = hits(song, 1)
    const hat = pieceRow(42)
    expect(steps[0]).toEqual([`${hat}:96`, `${KICK}:96`])
    expect(steps[4]).toEqual([`${hat}:96`, `${SNARE}:${VELOCITY.accent}`])
    expect(steps[1]).toEqual([])
    expect(isFull(song)).toBe(true)
    for (const pattern of DRUM_PATTERNS) {
      for (const row of Object.values(pattern.rows)) expect(row).toMatch(/^[xXg.]{16}$/)
      for (const note of Object.keys(pattern.rows)) expect(pieceRow(Number(note))).toBeGreaterThan(0)
    }
    expect(applyPattern(drumSong([3, 4]), cursor, 0, 0, rock)).toBeNull()
  })
})

describe('drum sound and export', () => {
  it('plays drums on the General MIDI drum channel and skips it for other tracks', () => {
    let song = createSong({ title: 'x', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar' })
    song = addTrack(song, cursor, 'drums').song
    song = addTrack(song, cursor, 'bass').song
    expect(song.tracks.map((_, i) => channelForTrack(song, i))).toEqual([0, 9, 1])
    for (let i = 0; i < 9; i++) song = addTrack(song, cursor, 'guitar').song
    expect(channelForTrack(song, song.tracks.length - 1)).toBe(11) // the 11th melodic track: channels 0–8, 10, 11
  })

  it('plays and exports hits as General MIDI drum notes on channel 10', () => {
    let song = drumSong()
    song = toggleHit(song, cursor, 0, 0, 0, KICK, 'normal', 4)!.song
    song = toggleHit(song, cursor, 0, 0, 4, SNARE, 'accent', 4)!.song
    expect(buildTimeline(song).notes.map((n) => [n.pitch, n.velocity])).toEqual([
      [36, 96],
      [38, 120]
    ])
    const midi = new Midi(songToMidi(makeRetro(song, cursor).song))
    expect(midi.tracks[0].channel).toBe(9)
    expect(midi.tracks[0].instrument.percussion).toBe(true)
    expect(midi.tracks[0].notes.map((n) => n.midi)).toEqual([36, 38])
  })

  it('gets the 8-bit kit from "Make it retro" and switches back', () => {
    let song = addTrack(createSong({ title: 'x', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar' }), cursor, 'drums').song
    song = makeRetro(song, cursor).song
    expect(song.tracks[1].instrument).toEqual({ kind: 'synthkit', pieces: eightBitKit() })
    expect(isRetro(song)).toBe(true)
    song = restoreSounds(song, cursor).song
    expect(song.tracks[1].instrument).toEqual({ kind: 'soundfont', program: 0 })
  })

  it('has an 8-bit sound for every kit piece', () => {
    expect(eightBitKit().map((p) => p.note).sort()).toEqual([...DRUM_TUNING].sort())
  })

  it('saves and loads drum tracks with an edited synth kit', () => {
    let song = makeRetro(drumSong(), cursor).song
    const kit = song.tracks[0].instrument
    if (kit.kind !== 'synthkit') throw new Error('expected a synth kit')
    kit.pieces[0] = { ...kit.pieces[0], pitch: 70, patch: { ...kit.pieces[0].patch, decay: 0.5 } }
    song = applyPattern(song, cursor, 0, 0, DRUM_PATTERNS[0])!.song
    expect(parseProject(serializeProject(song)).song).toEqual(song)

    const json = (patch: object): Uint8Array =>
      zipSync({ 'song.json': strToU8(JSON.stringify({ app: 'GameMusicApp', formatVersion: 3, song: { ...song, tracks: [{ ...song.tracks[0], ...patch }] } })) })
    expect(() => parseProject(json({ kind: 'harp' }))).toThrow('unknown kind')
    expect(() => parseProject(json({ instrument: { kind: 'synthkit', pieces: [{ note: 'kick' }] } }))).toThrow('invalid drum sound')
  })
})
