// How the editor is laid out: the score, the arrangement or the sound effects, which staves and
// tracks show, the zoom, pages or not, and the minimized panels. It is saved in the project file, so a song opens the way it was left;
// the layout used last is kept per computer as the start for new projects.
import type { Song } from '../model/song'
import { readPref, writePref } from '../prefs'

/** Notation above the tab, or only the tab (drums as a rhythm line, keys still in notation). */
export type StaveMode = 'notation+tab' | 'tab'

/** The main area: the score, the arrangement's section grid, or the sound effects. */
export type MainView = 'score' | 'arrangement' | 'effects'

export const MAIN_VIEWS: MainView[] = ['score', 'arrangement', 'effects']

export interface Layout {
  view: MainView
  staves: StaveMode
  /** Score zoom, 1 = 100 % (VIEW-10). */
  zoom: number
  /** The score on A4 pages, as it is printed, instead of as wide as the window. */
  pageView: boolean
  drumGridMinimized: boolean
  pianoRollMinimized: boolean
  /** Tracks left out of the score, by id. They still play. */
  hiddenTracks: string[]
}

/** Zoom levels of the score. */
export const ZOOM_STEPS = [0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

export const DEFAULT_LAYOUT: Layout = { view: 'score', staves: 'notation+tab', zoom: 1, pageView: false, drumGridMinimized: false, pianoRollMinimized: false, hiddenTracks: [] }

const LAST_LAYOUT_KEY = 'editorLayout'

/** A layout from a file or the preferences; missing or invalid settings get the defaults. */
export function checkLayout(value: unknown): Layout {
  const layout = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof Layout, unknown>>
  const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
  return {
    view: MAIN_VIEWS.includes(layout.view as MainView) ? (layout.view as MainView) : DEFAULT_LAYOUT.view,
    staves: layout.staves === 'tab' || layout.staves === 'notation+tab' ? layout.staves : DEFAULT_LAYOUT.staves,
    zoom: typeof layout.zoom === 'number' && Number.isFinite(layout.zoom) ? Math.min(ZOOM_STEPS.at(-1)!, Math.max(ZOOM_STEPS[0], layout.zoom)) : DEFAULT_LAYOUT.zoom,
    pageView: flag(layout.pageView, DEFAULT_LAYOUT.pageView),
    drumGridMinimized: flag(layout.drumGridMinimized, DEFAULT_LAYOUT.drumGridMinimized),
    pianoRollMinimized: flag(layout.pianoRollMinimized, DEFAULT_LAYOUT.pianoRollMinimized),
    hiddenTracks: Array.isArray(layout.hiddenTracks) ? [...new Set(layout.hiddenTracks.filter((id): id is string => typeof id === 'string'))] : []
  }
}

export function sameLayout(a: Layout, b: Layout): boolean {
  return (
    a.view === b.view &&
    a.staves === b.staves &&
    a.zoom === b.zoom &&
    a.pageView === b.pageView &&
    a.drumGridMinimized === b.drumGridMinimized &&
    a.pianoRollMinimized === b.pianoRollMinimized &&
    a.hiddenTracks.length === b.hiddenTracks.length &&
    a.hiddenTracks.every((id, i) => id === b.hiddenTracks[i])
  )
}

/** The tracks shown in the score, by index; all of them if every one is hidden. */
export function shownTracks(song: Song, layout: Layout): number[] {
  const shown = song.tracks.flatMap((track, i) => (layout.hiddenTracks.includes(track.id) ? [] : [i]))
  return shown.length > 0 ? shown : song.tracks.map((_, i) => i)
}

/** Shows a track in the score, or leaves it out (never the last one shown). */
export function showTrack(song: Song, layout: Layout, trackId: string, show: boolean): Partial<Layout> {
  const hidden = layout.hiddenTracks.filter((id) => id !== trackId && song.tracks.some((t) => t.id === id))
  if (show) return { hiddenTracks: hidden }
  const next = [...hidden, trackId]
  return song.tracks.every((t) => next.includes(t.id)) ? {} : { hiddenTracks: next }
}

/** The layout used last on this computer: new projects and older project files start with it. */
export function lastLayout(): Layout {
  return checkLayout(readPref(LAST_LAYOUT_KEY, null))
}

export function rememberLayout(layout: Layout): void {
  // Track ids belong to one song.
  writePref(LAST_LAYOUT_KEY, { ...layout, hiddenTracks: [] })
}
