import { Midi } from '@tonejs/midi'
import type { Song } from '../model/song'
import { buildTimeline, secondsPerQuarter } from '../model/timing'
import { channelForTrack } from './soundfont'

/** General MIDI "Lead 1 (square)", used for synth tracks in exported MIDI files. */
const GM_SQUARE_LEAD = 80

/** Type 1 MIDI file, one MIDI track per song track (REQUIREMENTS.md EXP-07). */
export function songToMidi(song: Song): Uint8Array {
  const midi = new Midi()
  midi.header.setTempo(song.tempo)
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [...song.timeSignature] })
  midi.header.name = song.title

  const ppq = midi.header.ppq
  const toTicks = (seconds: number): number => Math.round((seconds / secondsPerQuarter(song)) * ppq)
  const timeline = buildTimeline(song)

  song.tracks.forEach((track, trackIndex) => {
    const out = midi.addTrack()
    out.name = track.name
    out.channel = channelForTrack(trackIndex)
    out.instrument.number = track.instrument.kind === 'soundfont' ? track.instrument.program : GM_SQUARE_LEAD
    for (const note of timeline.notes) {
      if (note.trackIndex !== trackIndex) continue
      out.addNote({ midi: note.pitch, ticks: toTicks(note.start), durationTicks: toTicks(note.duration), velocity: note.velocity / 127 })
    }
  })
  return midi.toArray()
}
