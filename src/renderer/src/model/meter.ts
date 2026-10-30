// Tempo and time-signature changes within a song (REQUIREMENTS.md PRJ-04).
// The song's own tempo and time signature hold from the first bar; a change at
// a later bar holds from there until the next one (see Song.changes).
import { fitBars } from './barCheck'
import { clampCursor, type Cursor, type EditResult } from './edit'
import { barCount, tempoAt, timeSignatureAt, type MeterChange, type Song } from './song'

export interface Meter {
  tempo: number
  timeSignature: [number, number]
}

/** The tempo and time signature at a bar. */
export const meterAt = (song: Song, bar: number): Meter => ({ tempo: tempoAt(song, bar), timeSignature: timeSignatureAt(song, bar) })

const sameSignature = (a: [number, number] | undefined, b: [number, number] | undefined): boolean => a?.[0] === b?.[0] && a?.[1] === b?.[1]

export interface MeterEdit {
  result: EditResult
  /** Bars that got another length and were fitted to it (see model/barCheck.ts). */
  fitted: number
  removed: number
  shortened: number
}

/**
 * Sets the tempo and time signature from `bar` (1 or later) on, until the next
 * change. Only what differs from the bar before is a change; with nothing
 * different the bar has no change any more. Bars that get another time
 * signature keep their notes from their start: longer, they end with rests;
 * shorter, they lose what no longer fits. Null if nothing changes.
 */
export function setMeter(song: Song, cursor: Cursor, bar: number, meter: Meter): MeterEdit | null {
  if (bar < 1 || bar >= barCount(song)) return null
  const before = meterAt(song, bar - 1)
  const change: MeterChange = { bar }
  if (meter.tempo !== before.tempo) change.tempo = meter.tempo
  if (!sameSignature(meter.timeSignature, before.timeSignature)) change.timeSignature = [meter.timeSignature[0], meter.timeSignature[1]]
  const old = song.changes?.find((c) => c.bar === bar)
  if (old?.tempo === change.tempo && sameSignature(old?.timeSignature, change.timeSignature)) return null

  const draft = structuredClone(song)
  const changes = (draft.changes ?? []).filter((c) => c.bar !== bar)
  if (change.tempo !== undefined || change.timeSignature) changes.push(change)
  changes.sort((a, b) => a.bar - b.bar)
  if (changes.length > 0) draft.changes = changes
  else delete draft.changes

  // The bars up to the next time-signature change may have another length now.
  const next = changes.find((c) => c.bar > bar && c.timeSignature)?.bar ?? Infinity
  const fitted = fitBars(draft, cursor, (w) => w.bar >= bar && w.bar < next)
  return fitted ?? { result: { song: draft, cursor: clampCursor(draft, cursor) }, fitted: 0, removed: 0, shortened: 0 }
}

/** The change at a bar, if there is one. */
export const changeAt = (song: Song, bar: number): MeterChange | undefined => song.changes?.find((c) => c.bar === bar)
