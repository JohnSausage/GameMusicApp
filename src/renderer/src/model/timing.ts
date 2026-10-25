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

export interface SongTimeline {
  notes: NoteEvent[]
  beats: BeatSpan[]
  /** End of the last beat in seconds. */
  duration: number
}

export function secondsPerQuarter(song: Song): number {
  return 60 / song.tempo
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
