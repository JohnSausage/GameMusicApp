// How the editor is laid out: which staves show, the zoom and the minimized
// panels. It is saved in the project file, so a song opens the way it was left;
// the layout used last is kept per computer as the start for new projects.
import { readPref, writePref } from '../prefs'

/** Notation above the tab, or only the tab (drums as a rhythm line, keys still in notation). */
export type StaveMode = 'notation+tab' | 'tab'

export interface Layout {
  staves: StaveMode
  /** Score zoom, 1 = 100 % (VIEW-10). */
  zoom: number
  drumGridMinimized: boolean
  pianoRollMinimized: boolean
}

/** Zoom levels of the score. */
export const ZOOM_STEPS = [0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

export const DEFAULT_LAYOUT: Layout = { staves: 'notation+tab', zoom: 1, drumGridMinimized: false, pianoRollMinimized: false }

const LAST_LAYOUT_KEY = 'editorLayout'

/** A layout from a file or the preferences; missing or invalid settings get the defaults. */
export function checkLayout(value: unknown): Layout {
  const layout = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof Layout, unknown>>
  const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
  return {
    staves: layout.staves === 'tab' || layout.staves === 'notation+tab' ? layout.staves : DEFAULT_LAYOUT.staves,
    zoom: typeof layout.zoom === 'number' && Number.isFinite(layout.zoom) ? Math.min(ZOOM_STEPS.at(-1)!, Math.max(ZOOM_STEPS[0], layout.zoom)) : DEFAULT_LAYOUT.zoom,
    drumGridMinimized: flag(layout.drumGridMinimized, DEFAULT_LAYOUT.drumGridMinimized),
    pianoRollMinimized: flag(layout.pianoRollMinimized, DEFAULT_LAYOUT.pianoRollMinimized)
  }
}

export function sameLayout(a: Layout, b: Layout): boolean {
  return a.staves === b.staves && a.zoom === b.zoom && a.drumGridMinimized === b.drumGridMinimized && a.pianoRollMinimized === b.pianoRollMinimized
}

/** The layout used last on this computer: new projects and older project files start with it. */
export function lastLayout(): Layout {
  return checkLayout(readPref(LAST_LAYOUT_KEY, null))
}

export function rememberLayout(layout: Layout): void {
  writePref(LAST_LAYOUT_KEY, layout)
}
