import { barStartTicks, barTicks, TICKS_PER_QUARTER } from './edit'
import { playedBars } from './repeats'
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
/** A bend goes up in the first part of its note (at most this long), a release comes down from halfway. */
const MAX_BEND_SECONDS = 0.15
/** Palm-muted notes ring at most this long and a little softer; dead notes are a short, soft click (PLAY-11). */
const PALM_MUTE_SECONDS = 0.18
const PALM_MUTE_VELOCITY = 0.8
const DEAD_SECONDS = 0.04
const DEAD_VELOCITY = 0.6

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

/**
 * How an exported file ends: 'loop' exactly at the end with the notes still
 * ringing there mixed back onto the start (EXP-10), 'cut' exactly at the end
 * (loopable, ringing notes cut off), or 'tail' to let notes ring out.
 */
export type ExportEnding = 'loop' | 'cut' | 'tail'

export const EXPORT_TAIL_SECONDS = 1.5

/** How long after a loop's end notes are rendered, to mix them back onto its start (the longest synth release is 4 s). */
export const LOOP_TAIL_SECONDS = 5

/** Whether files with this ending loop: exactly as long as the music. */
export const loops = (ending: ExportEnding): boolean => ending !== 'tail'

/**
 * Mixes what rings on after `frames` back onto the start, wrapping round as
 * often as needed (a loop shorter than the tail): the end of each round flows
 * into the start of the next without a gap. Returns channels `frames` long.
 */
export function foldLoop(channels: Float32Array[], frames: number): Float32Array<ArrayBuffer>[] {
  return channels.map((channel) => {
    const out = new Float32Array(frames)
    out.set(channel.subarray(0, frames))
    for (let i = frames; i < channel.length; i++) out[i % frames] += channel[i]
    return out
  })
}

/** Samples per channel of an exported range; a loop or cut export is exactly as long as the range. */
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

/** Where bars 0…count start in seconds as written, one after the other (count + 1 entries: the last is where bar `count` would start). */
export function barStartSeconds(song: Pick<Song, 'tempo' | 'timeSignature' | 'changes'>, count: number): number[] {
  const starts = [0]
  for (let bar = 0; bar < count; bar++) starts.push(starts[bar] + barSeconds(song, bar))
  return starts
}

type Timed = Pick<Song, 'tempo' | 'timeSignature' | 'changes' | 'repeats'>

/** A bar as it plays: which bar, and where it starts, in seconds and in ticks from the song's start. */
export interface BarPass {
  bar: number
  start: number
  ticks: number
}

/**
 * The bars as they play, in order, with repeats and endings (EDIT-14): a
 * repeated bar comes more than once. After the song's end, bar after bar for ever.
 */
export function* barPasses(song: Timed): Generator<BarPass> {
  let start = 0
  let ticks = 0
  for (const bar of playedBars(song.repeats)) {
    yield { bar, start, ticks }
    start += barSeconds(song, bar)
    ticks += barTicks(song, bar)
  }
}

/** The bars as they play up to the song's end (its `count` bars). */
export function songPasses(song: Timed, count: number): BarPass[] {
  const passes: BarPass[] = []
  for (const pass of barPasses(song)) {
    if (pass.bar >= count) break
    passes.push(pass)
  }
  return passes
}

/** The bar playing at a time in seconds, and where it started (bars after the last one go on at its tempo and time signature). */
export function passAt(song: Timed, seconds: number): BarPass {
  for (const pass of barPasses(song)) if (seconds < pass.start + barSeconds(song, pass.bar) - 1e-9) return pass
  throw new Error('unreachable')
}

/** Where a bar starts in seconds, the first time it plays; bar `barCount` is where the song ends. */
export function barTime(song: Timed, bar: number): number {
  for (const pass of barPasses(song)) if (pass.bar >= bar) return pass.start
  throw new Error('unreachable')
}

/** The song's length in seconds, by its bars as they play. */
export const songSeconds = (song: Song): number => barTime(song, barCount(song))

/** The bar playing at a time in seconds (bars after the last one go on at its tempo and time signature). */
export const barAtTime = (song: Timed, seconds: number): number => passAt(song, seconds).bar

/** The position at a time in seconds in bars, e.g. 2.5 halfway through the third bar. */
export function barPosition(song: Timed, seconds: number): number {
  const pass = passAt(song, seconds)
  return pass.bar + (seconds - pass.start) / barSeconds(song, pass.bar)
}

/** Ticks of music played up to a time in seconds, following tempo and time-signature changes and repeats. */
export function tickAtTime(song: Timed, seconds: number): number {
  const pass = passAt(song, seconds)
  return pass.ticks + ((seconds - pass.start) / secondsPerQuarter(song, pass.bar)) * TICKS_PER_QUARTER
}

/** Where in the written bars a time in seconds is, in ticks from the first bar: in a repeat, the same place each time. */
export function scoreTickAtTime(song: Timed, seconds: number): number {
  const pass = passAt(song, seconds)
  return barStartTicks(song, pass.bar)[pass.bar] + ((seconds - pass.start) / secondsPerQuarter(song, pass.bar)) * TICKS_PER_QUARTER
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
export function metronomeClicks(song: Timed, end: number): Click[] {
  const clicks: Click[] = []
  for (const { bar, start } of barPasses(song)) {
    if (start >= end - 1e-9) break
    const [beats, unit] = timeSignatureAt(song, bar)
    const step = secondsPerQuarter(song, bar) * (4 / unit)
    for (let i = 0; i < beats && start + i * step < end - 1e-9; i++) clicks.push({ time: start + i * step, accent: i === 0 })
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
  // Every bar starts where its time signature and tempo put it, also after a bar of the wrong length;
  // repeated bars play again (EDIT-14).
  const passes = songPasses(song, Math.max(0, ...song.tracks.map((t) => t.bars.length)))
  const notes: NoteEvent[] = []
  const beats: BeatSpan[] = []
  const muted = new Set<NoteEvent>()
  let duration = 0

  song.tracks.forEach((track, trackIndex) => {
    const techniques = track.kind !== 'drums'
    // Hammer-ons and slides are for fretted tracks; keys tracks only hold (tie) notes.
    const legatoHere = legato && track.kind === undefined
    const sounding = new Map<number, Sounding>()
    let time = 0
    for (const { bar: barIndex, start } of passes) {
      const bar = track.bars[barIndex]
      if (!bar) continue
      const spq = secondsPerQuarter(song, barIndex)
      time = start
      bar.beats.forEach((beat, beatIndex) => {
        const length = beatQuarters(beat) * spq
        beats.push({ trackIndex, barIndex, beatIndex, start: time, end: time + length })
        for (const note of beat.notes) {
          const pitch = notePitch(track, note)
          const before = techniques ? sounding.get(note.string) : undefined
          // Only a note in the beat right before continues into this one.
          const continues = before !== undefined && Math.abs(before.end - time) < 1e-6
          const next = { end: time + length, pitch, length, legato: note.hammer ? ('hammer' as const) : note.slide ? ('slide' as const) : undefined }
          if (note.dead && techniques) {
            // A click: it holds nothing, and nothing goes on from it.
            notes.push({ trackIndex, pitch, velocity: Math.round(note.velocity * DEAD_VELOCITY), start: time, duration: Math.min(length, DEAD_SECONDS) })
            sounding.delete(note.string)
          } else if (continues && note.tie && before.pitch === pitch) {
            before.event.duration += length
            Object.assign(before, next)
          } else if (continues && legatoHere && before.legato && before.pitch !== pitch) {
            const glide = before.legato === 'slide' ? Math.min(MAX_SLIDE_SECONDS, before.length / 2) : 0
            ;(before.event.bends ??= []).push({ time: time - glide, pitch, glide })
            before.event.duration += length
            Object.assign(before, next)
          } else {
            const event: NoteEvent = { trackIndex, pitch, velocity: note.velocity, start: time, duration: length }
            if (note.bend && legatoHere) {
              const up = Math.min(MAX_BEND_SECONDS, length / 3)
              event.bends = [{ time, pitch: pitch + note.bend, glide: up }]
              if (note.bendRelease) event.bends.push({ time: time + length / 2, pitch, glide: Math.min(MAX_BEND_SECONDS, length / 3) })
            }
            if (note.palmMute && techniques) muted.add(event)
            notes.push(event)
            if (techniques) sounding.set(note.string, { event, ...next })
          }
        }
        time += length
      })
    }
    duration = Math.max(duration, time)
  })

  // Palm mutes cut a note short, held notes too.
  for (const event of muted) {
    event.duration = Math.min(event.duration, PALM_MUTE_SECONDS)
    event.velocity = Math.round(event.velocity * PALM_MUTE_VELOCITY)
    if (event.bends) event.bends = event.bends.filter((b) => b.time < event.start + event.duration)
  }
  notes.sort((a, b) => a.start - b.start)
  return { notes, beats, duration }
}

/** The beat of the given track that is sounding at `time`, if any. */
export function beatAt(timeline: SongTimeline, trackIndex: number, time: number): BeatSpan | undefined {
  return timeline.beats.find((b) => b.trackIndex === trackIndex && time >= b.start && time < b.end)
}
