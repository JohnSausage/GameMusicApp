import { beatQuarters, notePitch, type Song } from './song'

export interface NoteEvent {
  trackIndex: number
  pitch: number
  velocity: number
  /** Seconds from the start of the song. */
  start: number
  duration: number
}

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
  return notes.filter((n) => n.start >= start - EPSILON && n.start < end - EPSILON).map((n) => ({ ...n, start: Math.max(0, n.start - start) }))
}

/** Converts the bar/beat structure into absolute note and beat times. */
export function buildTimeline(song: Song): SongTimeline {
  const spq = secondsPerQuarter(song)
  const notes: NoteEvent[] = []
  const beats: BeatSpan[] = []
  let duration = 0

  song.tracks.forEach((track, trackIndex) => {
    let time = 0
    track.bars.forEach((bar, barIndex) => {
      bar.beats.forEach((beat, beatIndex) => {
        const length = beatQuarters(beat) * spq
        beats.push({ trackIndex, barIndex, beatIndex, start: time, end: time + length })
        for (const note of beat.notes) {
          notes.push({ trackIndex, pitch: notePitch(track, note), velocity: note.velocity, start: time, duration: length })
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
