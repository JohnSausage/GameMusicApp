import { barTicks, TICKS_PER_QUARTER } from './edit'
import { barCount, beatQuarters, notePitch, tempoAt, timeSignatureAt, type Song } from './song'

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

/** Seconds per quarter note at a bar (the first bar's by default). */
export function secondsPerQuarter(song: Pick<Song, 'tempo' | 'changes'>, bar = 0): number {
  return 60 / tempoAt(song, bar)
}

/** Length of a bar in seconds, by its tempo and time signature (the first bar's by default). */
export function barSeconds(song: Pick<Song, 'tempo' | 'timeSignature' | 'changes'>, bar = 0): number {
  const [beats, unit] = timeSignatureAt(song, bar)
  return secondsPerQuarter(song, bar) * 4 * (beats / unit)
}

/** Where bars 0…count start in seconds (count + 1 entries: the last is where bar `count` would start). */
export function barStartSeconds(song: Pick<Song, 'tempo' | 'timeSignature' | 'changes'>, count: number): number[] {
  const starts = [0]
  for (let bar = 0; bar < count; bar++) starts.push(starts[bar] + barSeconds(song, bar))
  return starts
}

/** Where a bar starts in seconds; bar `barCount` is where the song ends. */
export const barTime = (song: Pick<Song, 'tempo' | 'timeSignature' | 'changes'>, bar: number): number => barStartSeconds(song, Math.max(0, bar))[Math.max(0, bar)]

/** The song's length in seconds, by its bars. */
export const songSeconds = (song: Song): number => barTime(song, barCount(song))

/** The bar playing at a time in seconds (bars after the last one go on at its tempo and time signature). */
export function barAtTime(song: Pick<Song, 'tempo' | 'timeSignature' | 'changes'>, seconds: number): number {
  let bar = 0
  for (let start = 0; ; bar++) {
    const next = start + barSeconds(song, bar)
    if (seconds < next - 1e-9) return bar
    start = next
  }
}

/** The position at a time in seconds in bars, e.g. 2.5 halfway through the third bar. */
export function barPosition(song: Pick<Song, 'tempo' | 'timeSignature' | 'changes'>, seconds: number): number {
  const bar = barAtTime(song, seconds)
  return bar + (seconds - barTime(song, bar)) / barSeconds(song, bar)
}

/** Ticks from the song's start at a time in seconds, following tempo and time-signature changes. */
export function tickAtTime(song: Pick<Song, 'tempo' | 'timeSignature' | 'changes'>, seconds: number): number {
  let ticks = 0
  let start = 0
  for (let bar = 0; ; bar++) {
    const length = barSeconds(song, bar)
    if (seconds < start + length - 1e-9) return ticks + ((seconds - start) / secondsPerQuarter(song, bar)) * TICKS_PER_QUARTER
    ticks += barTicks(song, bar)
    start += length
  }
}

/** A metronome click, at a time in seconds from the song's start; the first of a bar is accented. */
export interface Click {
  time: number
  accent: boolean
}

/**
 * The metronome's clicks up to `end` seconds: one per beat unit of the time
 * signature at each bar (a quarter in 4/4, an eighth in 6/8), at its tempo.
 */
export function metronomeClicks(song: Pick<Song, 'tempo' | 'timeSignature' | 'changes'>, end: number): Click[] {
  const clicks: Click[] = []
  for (let bar = 0, start = 0; start < end - 1e-9; bar++) {
    const [beats, unit] = timeSignatureAt(song, bar)
    const step = secondsPerQuarter(song, bar) * (4 / unit)
    for (let i = 0; i < beats && start + i * step < end - 1e-9; i++) clicks.push({ time: start + i * step, accent: i === 0 })
    start += beats * step
  }
  return clicks
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
  // Every bar starts where its time signature and tempo put it, also after a bar of the wrong length.
  const barStarts = barStartSeconds(song, Math.max(0, ...song.tracks.map((t) => t.bars.length)))
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
      const spq = secondsPerQuarter(song, barIndex)
      time = barStarts[barIndex]
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
