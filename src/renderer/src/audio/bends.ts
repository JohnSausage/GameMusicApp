// Hammer-ons, pull-offs and slides on SoundFont tracks: the channel's pitch
// wheel moves the sounding note to the next pitches (PLAY-11). The wheel bends
// the whole channel, so this is meant for single-note lines.
import type { NoteEvent } from '../model/timing'

/** Pitch wheel range set on SoundFont channels, in semitones (MIDI's default is only 2). */
export const BEND_RANGE = 24
export const WHEEL_CENTER = 8192
/** Slides are played as small pitch wheel steps this far apart. */
const STEP_SECONDS = 0.01

/** Pitch wheel value (0–16383) for a bend of `semitones`. */
export function wheelValue(semitones: number): number {
  return Math.max(0, Math.min(16383, Math.round(WHEEL_CENTER + (semitones / BEND_RANGE) * WHEEL_CENTER)))
}

/**
 * The pitch wheel moves for a note's pitch changes, in song seconds, ending
 * back at the center when the note ends (`end`). Empty for notes without changes.
 */
export function pitchWheelSteps(note: NoteEvent, end: number): { time: number; value: number }[] {
  if (!note.bends?.length) return []
  const steps: { time: number; value: number }[] = []
  let pitch = note.pitch
  for (const bend of note.bends) {
    const count = bend.glide > 0 ? Math.max(1, Math.ceil(bend.glide / STEP_SECONDS)) : 1
    for (let i = 1; i <= count; i++) {
      const progress = i / count
      steps.push({ time: bend.time + bend.glide * progress, value: wheelValue(pitch + (bend.pitch - pitch) * progress - note.pitch) })
    }
    pitch = bend.pitch
  }
  steps.push({ time: end, value: WHEEL_CENTER })
  return steps
}
