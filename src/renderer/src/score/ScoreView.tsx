import * as alphaTab from '@coderline/alphatab'
import bravuraWoff from '@coderline/alphatab/font/Bravura.woff?url'
import bravuraWoff2 from '@coderline/alphatab/font/Bravura.woff2?url'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { selectedRanges, type Cursor, type Selection } from '../model/edit'
import type { Song } from '../model/song'
import { beatAt, buildTimeline } from '../model/timing'
import type { StaveMode } from '../project/layout'
import { useTheme, type Theme } from '../theme'
import { layOutPages, PAGE_MARGIN_X, PAGE_WIDTH, pageMetrics, pageNumber, pageTop, toSurface, toView, type PageLayout } from './pages'
import { songToAlphaTab, type BeatRef, type ConvertedScore } from './toAlphaTab'

/** What was clicked: the beat, and the tab string if the click was on the tab staff. */
export interface ScoreTarget extends BeatRef {
  string: number | null
}

interface Props {
  song: Song
  /** `song` is one from swapVoices(), edited in its second voice (EDIT-15): see songToAlphaTab. */
  secondVoice?: boolean
  staveMode: StaveMode
  /** The tracks shown, by index (all by default). */
  tracks?: number[]
  /** Score zoom, 1 = 100 % (VIEW-10). */
  zoom?: number
  /** The score on A4 pages (black on white, as printed) instead of one sheet as wide as the view. */
  pageView?: boolean
  /** Playback position in seconds, or null when stopped. Read every animation frame. */
  positionRef?: RefObject<number | null>
  /** Editing cursor: highlights the beat and the string on the tab. */
  editCursor?: Cursor | null
  /** Selected beats, highlighted per bar. */
  selection?: Selection | null
  /** Bars too short or too long for the time signature (EDIT-07), marked. */
  wrongBars?: { track: number; bar: number }[]
  /** `extend` is true for Shift+click (extend the selection). */
  onScoreClick?: (target: ScoreTarget, extend: boolean) => void
  /** Called after dragging a rectangle over the score, with the beats inside it. */
  onSelectArea?: (selection: Selection) => void
  /** Shown right after the last bar, e.g. "+ Bar" buttons. */
  endActions?: React.ReactNode
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

export function createApi(element: HTMLElement): alphaTab.AlphaTabApi {
  return new alphaTab.AlphaTabApi(element, {
    core: {
      useWorkers: false,
      fontDirectory: null,
      smuflFontSources: new Map([
        [alphaTab.FontFileFormat.Woff2, bravuraWoff2],
        [alphaTab.FontFileFormat.Woff, bravuraWoff]
      ])
    },
    display: { staveProfile: alphaTab.StaveProfile.ScoreTab },
    notation: {
      rhythmMode: alphaTab.TabRhythmMode.ShowWithBars,
      // Dynamics aren't part of our model yet (hides alphaTab's default "f").
      elements: new Map([[alphaTab.NotationElement.EffectDynamics, false]])
    },
    player: { enablePlayer: false }
  })
}

type ScoreColor = 'staffLineColor' | 'barSeparatorColor' | 'barNumberColor' | 'mainGlyphColor' | 'secondaryGlyphColor' | 'scoreInfoColor'

/** Ink of the score per theme as [r, g, b, alpha 0–255]; the paper is --score-bg. Light is alphaTab's default look. */
const SCORE_COLORS: Record<Theme, Record<ScoreColor, [number, number, number, number]>> = {
  light: {
    staffLineColor: [165, 165, 165, 255],
    barSeparatorColor: [34, 34, 17, 255],
    barNumberColor: [200, 0, 0, 255],
    mainGlyphColor: [0, 0, 0, 255],
    secondaryGlyphColor: [0, 0, 0, 102],
    scoreInfoColor: [0, 0, 0, 255]
  },
  dark: {
    staffLineColor: [120, 113, 108, 255],
    barSeparatorColor: [184, 178, 173, 255],
    barNumberColor: [248, 113, 113, 255],
    mainGlyphColor: [236, 233, 230, 255],
    secondaryGlyphColor: [236, 233, 230, 115],
    scoreInfoColor: [236, 233, 230, 255]
  }
}

export function setScoreColors(settings: alphaTab.Settings, theme: Theme): void {
  for (const [name, [r, g, b, a]] of Object.entries(SCORE_COLORS[theme])) {
    settings.display.resources[name as ScoreColor] = new alphaTab.model.Color(r, g, b, a)
  }
}

/** Distance between tab lines in pixels. */
function tabLineSpacing(api: alphaTab.AlphaTabApi): number {
  return api.settings.display.resources.engravingSettings.tabLineSpacing * api.settings.display.scale
}

/** The tab staff of a track in a given bar (the last staff rendered for that track). */
function tabStaff(api: alphaTab.AlphaTabApi, barIndex: number, trackIndex: number): Box | null {
  const masterBar = api.boundsLookup?.findMasterBarByIndex(barIndex)
  const bars = masterBar?.bars.filter((b) => b.bar.staff.track.index === trackIndex) ?? []
  return bars.at(-1)?.realBounds ?? null
}

/** SMuFL rest symbols (alphaTab's Bravura font), by alphaTab duration value. */
const REST_GLYPHS: Record<number, string> = { 1: '\uE4E3', 2: '\uE4E4', 4: '\uE4E5', 8: '\uE4E6', 16: '\uE4E7', 32: '\uE4E8', 64: '\uE4E9' }
const AUGMENTATION_DOT = '\uE1E7'

/** Where something on alphaTab's long sheet is shown (moved onto pages in the page view). */
type MapY = (y: number) => number
const sameY: MapY = (y) => y

/**
 * alphaTab only draws rests on the tab staff when no notation is shown. With
 * notation, we draw them on the tab ourselves so rests can be seen and clicked there.
 */
export function drawTabRests(container: HTMLElement, api: alphaTab.AlphaTabApi, converted: ConvertedScore, song: Song, mapY: MapY = sameY): void {
  container.replaceChildren()
  const spacing = tabLineSpacing(api)
  converted.beats.forEach((trackBeats, trackIndex) => {
    if (song.tracks[trackIndex]?.kind !== undefined) return // only fretted tracks have a tab; other staves draw their own rests
    const strings = song.tracks[trackIndex]?.tuning.length ?? 6
    trackBeats.forEach((barBeats, barIndex) => {
      const staff = tabStaff(api, barIndex, trackIndex)
      if (!staff) return
      for (const beat of barBeats) {
        if (beat.notes.length > 0) continue
        const bounds = api.boundsLookup?.findBeat(beat)
        if (!bounds) continue
        const rest = document.createElement('span')
        rest.className = 'tab-rest'
        rest.textContent = (REST_GLYPHS[beat.duration] ?? REST_GLYPHS[4]) + (beat.dots > 0 ? AUGMENTATION_DOT : '')
        rest.style.left = `${bounds.visualBounds.x + bounds.visualBounds.w / 2}px`
        rest.style.top = `${mapY(staff.y + ((strings - 1) * spacing) / 2)}px`
        rest.style.fontSize = `${26 * api.settings.display.scale}px`
        container.appendChild(rest)
      }
    })
  })
}

/**
 * The beat under a point, in the staff under the point. alphaTab's own
 * getBeatAtPos() only uses y to find the line of music and then takes the
 * nearest beat of *any* track, so clicks on a second track landed on the first.
 * Only beats of the voice edited count (those in `refs`).
 */
function beatAtPoint(api: alphaTab.AlphaTabApi, refs: ConvertedScore['refs'], x: number, y: number): alphaTab.model.Beat | null {
  const system = api.boundsLookup?.staffSystems.find((s) => y >= s.realBounds.y && y <= s.realBounds.y + s.realBounds.h)
  const masterBar = system?.findBarAtPos(x)
  if (!masterBar) return null
  let staff: (typeof masterBar.bars)[number] | null = null
  let nearest = Infinity
  for (const bar of masterBar.bars) {
    const top = bar.realBounds.y
    const bottom = top + bar.realBounds.h
    const distance = y < top ? top - y : y > bottom ? y - bottom : 0
    if (distance < nearest) {
      nearest = distance
      staff = bar
    }
  }
  // As alphaTab's findBeatAtPos(): the last beat starting left of x, else the first.
  let beat: alphaTab.model.Beat | null = null
  for (const bounds of staff?.beats ?? []) {
    if (!refs.has(bounds.beat)) continue
    if (beat && bounds.realBounds.x >= x) break
    beat = bounds.beat
  }
  return beat
}

/** Top and bottom of a track's staves (notation and/or tab) in a bar. */
function trackStavesY(api: alphaTab.AlphaTabApi, barIndex: number, trackIndex: number): { top: number; bottom: number } | null {
  const bars = api.boundsLookup?.findMasterBarByIndex(barIndex)?.bars.filter((b) => b.bar.staff.track.index === trackIndex) ?? []
  if (bars.length === 0) return null
  return { top: Math.min(...bars.map((b) => b.realBounds.y)), bottom: Math.max(...bars.map((b) => b.realBounds.y + b.realBounds.h)) }
}

/** One highlight box per bar of the selection. */
function drawSelection(container: HTMLElement, api: alphaTab.AlphaTabApi, converted: ConvertedScore, song: Song, selection: Selection | null | undefined, mapY: MapY): void {
  container.replaceChildren()
  if (!selection) return
  for (const { bar, from, to } of selectedRanges(song, selection)) {
    const beats = converted.beats[selection.track]?.[bar]
    const first = beats?.[from] && api.boundsLookup?.findBeat(beats[from])
    const last = beats?.[to] && api.boundsLookup?.findBeat(beats[to])
    const staves = trackStavesY(api, bar, selection.track)
    if (!first || !last || !staves) continue
    const box = document.createElement('div')
    box.className = 'score-selection-box'
    place(box, {
      x: first.visualBounds.x - 5,
      y: mapY(staves.top) - 4,
      w: last.visualBounds.x + last.visualBounds.w - first.visualBounds.x + 10,
      h: staves.bottom - staves.top + 8
    })
    container.appendChild(box)
  }
}

/** A box over each bar of the wrong length, in the tracks shown. */
function drawWrongBars(container: HTMLElement, api: alphaTab.AlphaTabApi, wrongBars: { track: number; bar: number }[], mapY: MapY): void {
  for (const { track, bar } of wrongBars) {
    const bounds = api.boundsLookup?.findMasterBarByIndex(bar)?.bars.filter((b) => b.bar.staff.track.index === track).map((b) => b.realBounds) ?? []
    const staves = trackStavesY(api, bar, track)
    if (bounds.length === 0 || !staves) continue
    const x = Math.min(...bounds.map((b) => b.x))
    const box = document.createElement('div')
    box.className = 'score-wrong-bar'
    place(box, { x, y: mapY(staves.top) - 4, w: Math.max(...bounds.map((b) => b.x + b.w)) - x, h: staves.bottom - staves.top + 8 })
    container.appendChild(box)
  }
}

function place(element: HTMLElement, box: Box | null): void {
  if (!box) {
    element.style.display = 'none'
    return
  }
  element.style.display = 'block'
  element.style.left = `${box.x}px`
  element.style.top = `${box.y}px`
  element.style.width = `${box.w}px`
  element.style.height = `${box.h}px`
}

/** Column over the whole staff system at a beat. */
function beatColumn(api: alphaTab.AlphaTabApi, beat: alphaTab.model.Beat | undefined): Box | null {
  const bounds = beat ? api.boundsLookup?.findBeat(beat) : null
  if (!bounds) return null
  const system = bounds.barBounds.masterBarBounds.realBounds
  return { x: bounds.visualBounds.x - 3, y: system.y, w: Math.max(6, bounds.visualBounds.w + 6), h: system.h }
}

/** Small box on the cursor's tab string. */
function stringBox(api: alphaTab.AlphaTabApi, converted: ConvertedScore, cursor: Cursor): Box | null {
  const beat = converted.beats[cursor.track]?.[cursor.bar]?.[cursor.beat]
  const bounds = beat ? api.boundsLookup?.findBeat(beat) : null
  const staff = tabStaff(api, cursor.bar, cursor.track)
  if (!bounds || !staff) return null
  const spacing = tabLineSpacing(api)
  const w = Math.max(18, bounds.visualBounds.w + 8)
  return { x: bounds.visualBounds.x + bounds.visualBounds.w / 2 - w / 2, y: staff.y + (cursor.string - 1) * spacing - spacing / 2, w, h: spacing }
}

export function ScoreView(props: Props): React.JSX.Element {
  const { song, secondVoice = false, staveMode, tracks, zoom = 1, pageView = false, positionRef, editCursor, selection, wrongBars, onScoreClick, onSelectArea, endActions } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const pagesLayerRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const playCursorRef = useRef<HTMLDivElement>(null)
  const editColumnRef = useRef<HTMLDivElement>(null)
  const editStringRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const restsRef = useRef<HTMLDivElement>(null)
  const selectionLayerRef = useRef<HTMLDivElement>(null)
  const marqueeRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; active: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const renderVersionRef = useRef(0)
  const drawnSelectionRef = useRef('')
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null)
  const convertedRef = useRef<ConvertedScore | null>(null)
  const renderStartRef = useRef(0)
  const scrolledToRef = useRef('')
  const songRef = useRef(song)
  songRef.current = song
  const staveModeRef = useRef(staveMode)
  staveModeRef.current = staveMode
  const pageViewRef = useRef(pageView)
  pageViewRef.current = pageView
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  /** Where alphaTab's blocks went on the pages; null when the score is one sheet. */
  const pagesRef = useRef<PageLayout | null>(null)
  /** alphaTab's padding around the sheet, for the view without pages. */
  const sheetPaddingRef = useRef<number[]>([])
  const theme = useTheme()
  // Pages are paper: black on white, as printed.
  const colors: Theme = pageView ? 'light' : theme
  /** The theme whose colors alphaTab has. */
  const colorsRef = useRef<Theme | null>(null)

  const timeline = useMemo(() => buildTimeline(song), [song])
  // The same tracks as a stable value, so the score is only drawn again when they change.
  const shownKey = (tracks ?? song.tracks.map((_, i) => i)).join(',')
  const shown = useMemo(() => shownKey.split(',').map(Number), [shownKey])

  useEffect(() => {
    const api = createApi(hostRef.current!)
    apiRef.current = api
    sheetPaddingRef.current = [...api.settings.display.padding]
    api.renderFinished.on(() => {
      scrollRef.current!.dataset.renderMs = (performance.now() - renderStartRef.current).toFixed(0)
    })
    api.postRenderFinished.on(() => {
      renderVersionRef.current++
      layOutPageView()
      const converted = convertedRef.current
      if (!converted || !restsRef.current) return
      if (staveModeRef.current === 'tab') restsRef.current.replaceChildren()
      else drawTabRests(restsRef.current, api, converted, songRef.current, viewY)
    })
    api.error.on((error) => console.error('alphaTab error', error))
    return () => {
      api.destroy()
      apiRef.current = null
    }
  }, [])

  /** In the page view: alphaTab's blocks onto pages, with the pages and their numbers behind them. */
  const layOutPageView = (): void => {
    const surface = hostRef.current?.querySelector<HTMLElement>('.at-surface')
    const layer = pagesLayerRef.current
    layer?.replaceChildren()
    pagesRef.current = null
    if (!pageViewRef.current || !surface || !layer) return
    const layout = layOutPages(surface, pageMetrics(zoomRef.current))
    pagesRef.current = layout
    for (let page = 0; page < layout.pageCount; page++) {
      const sheet = document.createElement('div')
      sheet.className = 'score-page'
      sheet.style.top = `${pageTop(layout, page)}px`
      sheet.style.height = `${layout.metrics.pageHeight}px`
      const number = pageNumber(layout, page)
      if (number) {
        const label = document.createElement('span')
        label.className = 'score-page-number'
        label.textContent = number
        label.style.bottom = `${layout.metrics.marginBottom / 2}px`
        sheet.appendChild(label)
      }
      layer.appendChild(sheet)
    }
  }

  /** A point of alphaTab's sheet as shown (on its page in the page view). */
  const viewY: MapY = (y) => (pagesRef.current ? toView(pagesRef.current, y) : y)
  const viewBox = (box: Box | null): Box | null => (box ? { ...box, y: viewY(box.y) } : null)
  /** A point as shown, on alphaTab's sheet; null in a page margin or between pages. */
  const sheetY = (y: number, snap?: 'down' | 'up'): number | null => (pagesRef.current ? toSurface(pagesRef.current, y, snap) : y)

  useEffect(() => {
    const api = apiRef.current!
    if (api.settings.display.scale !== zoom || colorsRef.current !== colors || api.settings.core.enableLazyLoading === pageView) {
      api.settings.display.scale = zoom
      setScoreColors(api.settings, colors)
      colorsRef.current = colors
      // Pages: the side margins are alphaTab's padding (it divides it by the zoom), the pages have their own top and bottom.
      api.settings.display.padding = pageView ? [PAGE_MARGIN_X * zoom, 0] : sheetPaddingRef.current
      // All of the score is drawn at once, also what's off screen, as the blocks are moved onto pages.
      api.settings.core.enableLazyLoading = !pageView
      api.updateSettings()
    }
    // The stave profile stays ScoreTab; which staves show is set per staff (tab only = tab, and a rhythm line for drums).
    renderStartRef.current = performance.now()
    const converted = songToAlphaTab(song, api.settings, staveMode === 'tab', secondVoice)
    convertedRef.current = converted
    api.renderScore(converted.score, shown)
  }, [song, secondVoice, staveMode, zoom, colors, shown, pageView])

  // Overlays are positioned every frame from alphaTab's layout, so they follow re-renders.
  useEffect(() => {
    let frame = 0
    const tick = (): void => {
      // The score went away (its elements are detached before this loop is cancelled).
      if (!hostRef.current) return
      const api = apiRef.current
      const converted = convertedRef.current
      if (api?.boundsLookup && converted) {
        const position = positionRef?.current ?? null
        // The playhead spans the system at a beat of the first track shown.
        const span = position === null ? undefined : beatAt(timeline, shown[0], position)
        place(playCursorRef.current!, span ? viewBox(beatColumn(api, converted.beats[shown[0]]?.[span.barIndex]?.[span.beatIndex])) : null)

        const editBeat = editCursor ? converted.beats[editCursor.track]?.[editCursor.bar]?.[editCursor.beat] : undefined
        place(editColumnRef.current!, editCursor ? viewBox(beatColumn(api, editBeat)) : null)
        // Drum and keys tracks have no tab, so there is no string to box; the drum grid or piano roll shows the row.
        const drums = editCursor ? song.tracks[editCursor.track]?.kind !== undefined : false
        const box = editCursor && !drums ? stringBox(api, converted, editCursor) : null
        place(editStringRef.current!, viewBox(box))
        const staves = drums && editCursor ? trackStavesY(api, editCursor.bar, editCursor.track) : null
        const visible = box ?? (staves ? { x: 0, y: staves.top, w: 0, h: staves.bottom - staves.top } : null)
        if (visible && editCursor) keepVisible(viewBox(visible)!, `${editCursor.track}/${editCursor.bar}/${editCursor.beat}`)

        const selectionKey = `${renderVersionRef.current}|${JSON.stringify(selection ?? null)}|${JSON.stringify(wrongBars ?? [])}`
        if (selectionKey !== drawnSelectionRef.current) {
          drawnSelectionRef.current = selectionKey
          drawSelection(selectionLayerRef.current!, api, converted, song, selection, viewY)
          drawWrongBars(selectionLayerRef.current!, api, wrongBars ?? [], viewY)
        }

        const lastBar = api.boundsLookup.staffSystems.at(-1)?.bars.at(-1)?.realBounds
        const end = endRef.current
        if (end && lastBar) {
          const maxX = hostRef.current!.clientWidth - end.offsetWidth - 8
          end.style.display = 'flex'
          end.style.left = `${Math.min(lastBar.x + lastBar.w + 14, maxX)}px`
          end.style.top = `${viewY(lastBar.y) + lastBar.h / 2 - end.offsetHeight / 2}px`
        }
      }
      frame = requestAnimationFrame(tick)
    }

    // Scrolls the score so the edit cursor stays visible, once per cursor move.
    const keepVisible = (box: Box, key: string): void => {
      if (scrolledToRef.current === key) return
      scrolledToRef.current = key
      const scroll = scrollRef.current!
      const margin = 40
      // The score may not start at the top of the scrolled area (pages have space around them).
      const y = box.y + wrapperRef.current!.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop
      if (y < scroll.scrollTop + margin) scroll.scrollTop = y - margin
      else if (y + box.h > scroll.scrollTop + scroll.clientHeight - margin) scroll.scrollTop = y + box.h - scroll.clientHeight + margin
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [timeline, positionRef, editCursor, selection, wrongBars, song, shown])

  // Dragging a rectangle selects the beats under it (in the track where the drag started).
  const relative = (event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !onSelectArea || (event.target as HTMLElement).closest('.score-end-actions')) return
    dragRef.current = { ...relative(event), active: false }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    const { x, y } = relative(event)
    if (!drag.active && Math.hypot(x - drag.x, y - drag.y) < 6) return
    if (!drag.active) {
      drag.active = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    place(marqueeRef.current!, { x: Math.min(x, drag.x), y: Math.min(y, drag.y), w: Math.abs(x - drag.x), h: Math.abs(y - drag.y) })
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag?.active) return
    suppressClickRef.current = true
    place(marqueeRef.current!, null)
    const { x, y } = relative(event)
    selectArea({ x: Math.min(x, drag.x), y: Math.min(y, drag.y), w: Math.abs(x - drag.x), h: Math.abs(y - drag.y) }, drag, { x, y })
  }

  const selectArea = (area: Box, from: { x: number; y: number }, to: { x: number; y: number }): void => {
    const api = apiRef.current
    const converted = convertedRef.current
    if (!api?.boundsLookup || !converted || !onSelectArea) return
    const beatAt = (point: { x: number; y: number }): alphaTab.model.Beat | null => {
      const y = sheetY(point.y)
      return y === null ? null : beatAtPoint(api, converted.refs, point.x, y)
    }
    const startBeat = beatAt(from) ?? beatAt(to)
    const track = startBeat ? converted.refs.get(startBeat)?.trackIndex : undefined
    if (track === undefined) return
    // The rectangle on alphaTab's sheet; on pages, its ends move into the music.
    const top = sheetY(area.y, 'down')
    const bottom = sheetY(area.y + area.h, 'up')
    if (top === null || bottom === null || bottom < top) return
    let first: { bar: number; beat: number } | null = null
    let last: { bar: number; beat: number } | null = null
    converted.beats[track].forEach((beats, bar) => {
      const staves = trackStavesY(api, bar, track)
      if (!staves || staves.bottom < top || staves.top > bottom) return
      beats.forEach((beat, index) => {
        const bounds = api.boundsLookup?.findBeat(beat)?.visualBounds
        if (!bounds || bounds.x + bounds.w < area.x || bounds.x > area.x + area.w) return
        first ??= { bar, beat: index }
        last = { bar, beat: index }
      })
    })
    if (first && last) onSelectArea({ track, start: first, end: last })
  }

  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const api = apiRef.current
    const converted = convertedRef.current
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (!api?.boundsLookup || !converted || !onScoreClick) return
    if ((event.target as HTMLElement).closest('.score-end-actions')) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = sheetY(event.clientY - rect.top)
    if (y === null) return
    const beat = beatAtPoint(api, converted.refs, x, y)
    const ref = beat ? converted.refs.get(beat) : undefined
    if (!ref) return

    let string: number | null = null
    const staff = tabStaff(api, ref.barIndex, ref.trackIndex)
    const strings = song.tracks[ref.trackIndex].tuning.length
    const spacing = tabLineSpacing(api)
    if (staff && song.tracks[ref.trackIndex].kind === undefined && y >= staff.y - spacing && y <= staff.y + (strings - 1) * spacing + spacing) {
      string = Math.max(1, Math.min(strings, Math.round((y - staff.y) / spacing) + 1))
    }
    onScoreClick({ ...ref, string }, event.shiftKey)
  }

  return (
    <div ref={scrollRef} className={`score-scroll ${pageView ? 'page-view' : ''}`}>
      <div
        ref={wrapperRef}
        className="score-host-wrapper"
        // A page wide: the width alphaTab lays the score out for.
        style={pageView ? { width: PAGE_WIDTH * zoom } : undefined}
        onClick={handleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div ref={pagesLayerRef} className="score-pages" />
        <div ref={hostRef} className="score-host" />
        <div ref={selectionLayerRef} className="score-selection-layer" />
        <div ref={restsRef} className="score-tab-rests" />
        <div ref={editColumnRef} className="score-edit-column" />
        <div ref={editStringRef} className="score-edit-string" />
        <div ref={playCursorRef} className="score-cursor" />
        <div ref={marqueeRef} className="score-marquee" />
        {endActions && (
          <div ref={endRef} className="score-end-actions">
            {endActions}
          </div>
        )}
      </div>
    </div>
  )
}
