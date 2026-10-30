import { Midi } from '@tonejs/midi'
import { keyTonic, songKey } from '../model/keySignature'
import { barStartTicks, TICKS_PER_QUARTER } from '../model/edit'
import { barCount, type Song } from '../model/song'
import { buildTimeline, tickAtTime } from '../model/timing'
import { channelForTrack } from './soundfont'

/** General MIDI "Lead 1 (square)", used for synth tracks in exported MIDI files. */
const GM_SQUARE_LEAD = 80

/** Type 1 MIDI file, one MIDI track per song track (REQUIREMENTS.md EXP-07). */
export function songToMidi(song: Song): Uint8Array {
  const midi = new Midi()
  const ppq = midi.header.ppq
  // Tempo and time-signature changes (PRJ-04) where their bars start.
  const barStarts = barStartTicks(song, barCount(song)).map((t) => Math.round((t / TICKS_PER_QUARTER) * ppq))
  midi.header.tempos.push({ ticks: 0, bpm: song.tempo })
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [...song.timeSignature] })
  for (const change of song.changes ?? []) {
    if (change.bar >= barCount(song)) continue
    if (change.tempo !== undefined) midi.header.tempos.push({ ticks: barStarts[change.bar], bpm: change.tempo })
    if (change.timeSignature) midi.header.timeSignatures.push({ ticks: barStarts[change.bar], timeSignature: [...change.timeSignature] })
  }
  midi.header.update()
  // A MIDI key signature names the major key with the same sharps or flats, plus the scale.
  const key = songKey(song)
  midi.header.keySignatures.push({ ticks: 0, key: keyTonic({ fifths: key.fifths, minor: false }), scale: key.minor ? 'minor' : 'major' })
  midi.header.name = song.title

  const toTicks = (seconds: number): number => Math.round((tickAtTime(song, seconds) / TICKS_PER_QUARTER) * ppq)
  const timeline = buildTimeline(song, { legato: false })

  song.tracks.forEach((track, trackIndex) => {
    const out = midi.addTrack()
    out.name = track.name
    out.channel = channelForTrack(song, trackIndex)
    // Drums keep their General MIDI drum notes on channel 9; a synth kit exports as the standard kit.
    out.instrument.number = track.kind === 'drums' ? 0 : track.instrument.kind === 'soundfont' ? track.instrument.program : GM_SQUARE_LEAD
    for (const note of timeline.notes) {
      if (note.trackIndex !== trackIndex) continue
      const ticks = toTicks(note.start)
      out.addNote({ midi: note.pitch, ticks, durationTicks: toTicks(note.start + note.duration) - ticks, velocity: note.velocity / 127 })
    }
  })
  return withKeySignature(midi.toArray(), key.fifths)
}

/**
 * Sets the sharps (+) or flats (−) of the key signature event in the first
 * track. @tonejs/midi 2.0.28 writes the wrong number there (its index + 7, so
 * C major comes out as 14), which other programs misread.
 */
function withKeySignature(data: Uint8Array, fifths: number): Uint8Array {
  // Header chunk (14 bytes), then the first track chunk: "MTrk", its length, its events.
  const start = 14 + 8
  const end = start + new DataView(data.buffer, data.byteOffset).getUint32(14 + 4)
  for (let i = start; i + 3 < end; i++) {
    // Meta event 0x59 (key signature), 2 bytes: sharps or flats, then major (0) or minor (1).
    if (data[i] === 0xff && data[i + 1] === 0x59 && data[i + 2] === 0x02) {
      data[i + 3] = fifths & 0xff
      break
    }
  }
  return data
}
