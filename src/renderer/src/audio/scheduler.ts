// Which notes and metronome clicks to hand to the audio thread, and when.
// Kept free of Web Audio so the timing (including loops) can be unit-tested.
import type { NoteEvent, SongTimeline, TimeRange } from '../model/timing'

/** Tolerance for comparing note times with loop boundaries. */
const EPSILON = 1e-6

export interface ScheduleState {
  timeline: Pick<SongTimeline, 'notes' | 'duration'>
  loop: TimeRange | null
  /** The pass being scheduled: context time `passStart` plays song time `passFrom` (both move on at each loop). */
  passFrom: number
  passStart: number
  nextNote: number
  /** Index of the next metronome click; click 0 is at song time 0. */
  nextClick: number
  secondsPerClick: number
  clicksPerBar: number
  /** Playback speed (PLAY-08): 0.5 plays a song second in two seconds. */
  speed: number
}

export interface DueEvents {
  notes: { note: NoteEvent; when: number }[]
  /** Metronome clicks; `accent` on the first beat of a bar. */
  clicks: { when: number; accent: boolean }[]
}

/** Index of the first note that starts at or after `time`. */
function firstNoteFrom(notes: NoteEvent[], time: number): number {
  const index = notes.findIndex((n) => n.start >= time - EPSILON)
  return index < 0 ? notes.length : index
}

const firstClickFrom = (time: number, secondsPerClick: number): number => Math.ceil(time / secondsPerClick - EPSILON)

/** A loop must be at least this long to count. */
export function validLoop(loop: TimeRange | null | undefined): TimeRange | null {
  return loop && loop.end - loop.start > 0.01 ? loop : null
}

/** Where playback really starts: inside the loop if there is one. */
export function startPosition(from: number, loop: TimeRange | null): number {
  return loop && (from < loop.start - EPSILON || from >= loop.end - EPSILON) ? loop.start : from
}

export function startSchedule(
  timeline: ScheduleState['timeline'],
  from: number,
  startTime: number,
  loop: TimeRange | null,
  secondsPerClick: number,
  clicksPerBar: number,
  speed = 1
): ScheduleState {
  return {
    timeline,
    loop,
    passFrom: from,
    passStart: startTime,
    nextNote: firstNoteFrom(timeline.notes, from),
    nextClick: firstClickFrom(from, secondsPerClick),
    secondsPerClick,
    clicksPerBar,
    speed
  }
}

/**
 * Takes the notes and clicks that are due by context time `horizon`, skipping
 * ones that are already past (before `now`). When a loop's end is due, the next
 * pass continues at the loop's start.
 */
export function takeDue(s: ScheduleState, now: number, horizon: number): DueEvents {
  const due: DueEvents = { notes: [], clicks: [] }
  const notes = s.timeline.notes
  for (;;) {
    const passEnd = s.loop ? s.loop.end - EPSILON : Infinity
    const at = (songTime: number): number => s.passStart + (songTime - s.passFrom) / s.speed
    while (s.nextNote < notes.length && notes[s.nextNote].start < passEnd) {
      const note = notes[s.nextNote]
      if (at(note.start) > horizon) break
      if (at(note.start) >= now - 0.01) due.notes.push({ note, when: at(note.start) })
      s.nextNote++
    }
    const clicksEnd = Math.min(passEnd, s.timeline.duration - EPSILON)
    while (s.nextClick * s.secondsPerClick < clicksEnd) {
      const when = at(s.nextClick * s.secondsPerClick)
      if (when > horizon) break
      if (when >= now - 0.01) due.clicks.push({ when, accent: s.nextClick % s.clicksPerBar === 0 })
      s.nextClick++
    }
    if (!s.loop || at(s.loop.end) > horizon) return due
    s.passStart = at(s.loop.end)
    s.passFrom = s.loop.start
    s.nextNote = firstNoteFrom(notes, s.loop.start)
    s.nextClick = firstClickFrom(s.loop.start, s.secondsPerClick)
  }
}

/** Song position `elapsed` seconds after playback started at `from`, wrapped into the loop. */
export function songPosition(from: number, elapsed: number, loop: TimeRange | null): number {
  const position = from + Math.max(0, elapsed)
  if (!loop || position < loop.end) return position
  return loop.start + ((position - loop.end) % (loop.end - loop.start))
}
