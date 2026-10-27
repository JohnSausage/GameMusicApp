import { beatQuarters, notePitch, type Song } from './song'

/** A change of a sounding note's pitch, for hammer-ons, pull-offs and slides. */
export interface PitchChange {
  /** Seconds from the start of the song when the change starts. */
  time: number
  /** The pitch to go to (MIDI note number). */
  pitch: number
  /** How long the change takes in seconds: 0 jumps (hammer-on/pull-off), more slides. */
  glide: number
}

export interface NoteEvent {
  trackIndex: number
  pitch: number
  velocity: number
  /** Seconds from the start of the song. */
  start: number
  duration: number
  /** Later pitches of a note that isn't played again: hammer-ons, pull-offs and slides into the next notes. */
  bends?: PitchChange[]
}

/** A slide takes the end of the note it starts from: half of it, at most this long. */
const MAX_SLIDE_SECONDS = 0.25

export interface BeatSpan {
  trackIndex: number
  barIndex: number
  beatIndex: number
  start: number
  end: number
}

/** A stretch of the song in seconds, e.g. a loop or an export range. */
export interface TimeRange {
  start: number
  end: number
}

/** How an exported WAV ends: 'cut' exactly at the end (loopable), or 'tail' to let notes ring out. */
export type ExportEnding = 'cut' | 'tail'

export const EXPORT_TAIL_SECONDS = 1.5

/** Samples per channel of an exported range; a cut export is exactly as long as the range. */
export function exportFrameCount(range: TimeRange, sampleRate: number, ending: ExportEnding): number {
  return Math.round((range.end - range.start + (ending === 'tail' ? EXPORT_TAIL_SECONDS : 0)) * sampleRate)
}

export interface SongTimeline {
  notes: NoteEvent[]
  beats: BeatSpan[]
  /** End of the last beat in seconds. */
  duration: number
}

export function secondsPerQuarter(song: Song): number {
  return 60 / song.tempo
}

/** Length of one bar in seconds (all bars share the song's time signature). */
export function barSeconds(song: Song): number {
  return secondsPerQuarter(song) * 4 * (song.timeSignature[0] / song.timeSignature[1])
}

/**
 * The notes that start from `start` up to (not including) `end` seconds, moved so
 * that `start` is 0; e.g. to export a bar range. A tiny tolerance keeps notes
 * exactly on the boundary from slipping out through rounding.
 */
export function notesBetween(notes: NoteEvent[], start: number, end: number): NoteEvent[] {
  const EPSILON = 1e-6
  return notes
    .filter((n) => n.start >= start - EPSILON && n.start < end - EPSILON)
    .map((n) => ({ ...n, start: Math.max(0, n.start - start), ...(n.bends && { bends: n.bends.map((b) => ({ ...b, time: b.time - start })) }) }))
}

/** A note that may still go on in the next beat, per string. */
interface Sounding {
  event: NoteEvent
  /** Where the last beat it covers ends, its pitch there, and that beat's length. */
  end: number
  pitch: number
  length: number
  /** How it goes on into the next note on its string, if it does. */
  legato?: 'hammer' | 'slide'
}

/**
 * Converts the bar/beat structure into absolute note and beat times. Held
 * (tied) notes become one longer note. Hammer-ons, pull-offs and slides become
 * pitch changes of the note they start from, unless `legato` is false (MIDI
 * export, where the notes stay separate).
 */
export function buildTimeline(song: Song, { legato = true }: { legato?: boolean } = {}): SongTimeline {
  const spq = secondsPerQuarter(song)
  const notes: NoteEvent[] = []
  const beats: BeatSpan[] = []
  let duration = 0

  song.tracks.forEach((track, trackIndex) => {
    const techniques = track.kind !== 'drums'
    // Hammer-ons and slides are for fretted tracks; keys tracks only hold (tie) notes.
    const legatoHere = legato && track.kind === undefined
    const sounding = new Map<number, Sounding>()
    let time = 0
    track.bars.forEach((bar, barIndex) => {
      bar.beats.forEach((beat, beatIndex) => {
        const length = beatQuarters(beat) * spq
        beats.push({ trackIndex, barIndex, beatIndex, start: time, end: time + length })
        for (const note of beat.notes) {
          const pitch = notePitch(track, note)
          const before = techniques ? sounding.get(note.string) : undefined
          // Only a note in the beat right before continues into this one.
          const continues = before !== undefined && Math.abs(before.end - time) < 1e-6
          const next = { end: time + length, pitch, length, legato: note.hammer ? ('hammer' as const) : note.slide ? ('slide' as const) : undefined }
          if (continues && note.tie && before.pitch === pitch) {
            before.event.duration += length
            Object.assign(before, next)
          } else if (continues && legatoHere && before.legato && before.pitch !== pitch) {
            const glide = before.legato === 'slide' ? Math.min(MAX_SLIDE_SECONDS, before.length / 2) : 0
            ;(before.event.bends ??= []).push({ time: time - glide, pitch, glide })
            before.event.duration += length
            Object.assign(before, next)
          } else {
            const event: NoteEvent = { trackIndex, pitch, velocity: note.velocity, start: time, duration: length }
            notes.push(event)
            if (techniques) sounding.set(note.string, { event, ...next })
          }
        }
        time += length
      })
    })
    duration = Math.max(duration, time)
  })

  notes.sort((a, b) => a.start - b.start)
  return { notes, beats, duration }
}

/** The beat of the given track that is sounding at `time`, if any. */
export function beatAt(timeline: SongTimeline, trackIndex: number, time: number): BeatSpan | undefined {
  return timeline.beats.find((b) => b.trackIndex === trackIndex && time >= b.start && time < b.end)
}
