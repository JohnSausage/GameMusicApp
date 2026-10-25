import * as alphaTab from '@coderline/alphatab'
import bravuraWoff from '@coderline/alphatab/font/Bravura.woff?url'
import bravuraWoff2 from '@coderline/alphatab/font/Bravura.woff2?url'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { selectedRanges, type Cursor, type Selection } from '../model/edit'
import type { Song } from '../model/song'
import { beatAt, buildTimeline } from '../model/timing'
import { songToAlphaTab, type BeatRef, type ConvertedScore } from './toAlphaTab'

export type StaveMode = 'notation+tab' | 'tab'

/** What was clicked: the beat, and the tab string if the click was on the tab staff. */
export interface ScoreTarget extends BeatRef {
  string: number | null
}

interface Props {
  song: Song
  staveMode: StaveMode
  /** Playback position in seconds, or null when stopped. Read every animation frame. */
  positionRef?: RefObject<number | null>
  /** Editing cursor: highlights the beat and the string on the tab. */
  editCursor?: Cursor | null
  /** Selected beats, highlighted per bar. */
  selection?: Selection | null
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

function createApi(element: HTMLElement): alphaTab.AlphaTabApi {
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
      // Dynamics aren't part of our model yet (hides alphaTab's default "f"),
      // and the tuning label overlaps between tracks.
      elements: new Map([
        [alphaTab.NotationElement.EffectDynamics, false],
        [alphaTab.NotationElement.GuitarTuning, false]
      ])
    },
    player: { enablePlayer: false }
  })
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
const REST_GLYPHS: Record<number, string> = { 1: '\uE4E3', 2: '\uE4E4', 4: '\uE4E5', 8: '\uE4E6', 16: '\uE4E7', 32: '\uE4E8' }
const AUGMENTATION_DOT = '\uE1E7'

/**
 * alphaTab only draws rests on the tab staff when no notation is shown. With
 * notation, we draw them on the tab ourselves so rests can be seen and clicked there.
 */
function drawTabRests(container: HTMLElement, api: alphaTab.AlphaTabApi, converted: ConvertedScore, song: Song): void {
  container.replaceChildren()
  const spacing = tabLineSpacing(api)
  converted.beats.forEach((trackBeats, trackIndex) => {
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
        rest.style.top = `${staff.y + ((strings - 1) * spacing) / 2}px`
        container.appendChild(rest)
      }
    })
  })
}

/**
 * The beat under a point, in the staff under the point. alphaTab's own
 * getBeatAtPos() only uses y to find the line of music and then takes the
 * nearest beat of *any* track, so clicks on a second track landed on the first.
 */
function beatAtPoint(api: alphaTab.AlphaTabApi, x: number, y: number): alphaTab.model.Beat | null {
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
  return staff?.findBeatAtPos(x)?.beat ?? null
}

/** Top and bottom of a track's staves (notation and/or tab) in a bar. */
function trackStavesY(api: alphaTab.AlphaTabApi, barIndex: number, trackIndex: number): { top: number; bottom: number } | null {
  const bars = api.boundsLookup?.findMasterBarByIndex(barIndex)?.bars.filter((b) => b.bar.staff.track.index === trackIndex) ?? []
  if (bars.length === 0) return null
  return { top: Math.min(...bars.map((b) => b.realBounds.y)), bottom: Math.max(...bars.map((b) => b.realBounds.y + b.realBounds.h)) }
}

/** One highlight box per bar of the selection. */
function drawSelection(container: HTMLElement, api: alphaTab.AlphaTabApi, converted: ConvertedScore, song: Song, selection: Selection | null | undefined): void {
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
      y: staves.top - 4,
      w: last.visualBounds.x + last.visualBounds.w - first.visualBounds.x + 10,
      h: staves.bottom - staves.top + 8
    })
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

export function ScoreView({ song, staveMode, positionRef, editCursor, selection, onScoreClick, onSelectArea, endActions }: Props): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
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

  const timeline = useMemo(() => buildTimeline(song), [song])

  useEffect(() => {
    const api = createApi(hostRef.current!)
    apiRef.current = api
    api.renderFinished.on(() => {
      scrollRef.current!.dataset.renderMs = (performance.now() - renderStartRef.current).toFixed(0)
    })
    api.postRenderFinished.on(() => {
      renderVersionRef.current++
      const converted = convertedRef.current
      if (!converted || !restsRef.current) return
      if (staveModeRef.current === 'tab') restsRef.current.replaceChildren()
      else drawTabRests(restsRef.current, api, converted, songRef.current)
    })
    api.error.on((error) => console.error('alphaTab error', error))
    return () => {
      api.destroy()
      apiRef.current = null
    }
  }, [])

  useEffect(() => {
    const api = apiRef.current!
    const profile = staveMode === 'tab' ? alphaTab.StaveProfile.Tab : alphaTab.StaveProfile.ScoreTab
    if (api.settings.display.staveProfile !== profile) {
      api.settings.display.staveProfile = profile
      api.updateSettings()
    }
    renderStartRef.current = performance.now()
    const converted = songToAlphaTab(song, api.settings)
    convertedRef.current = converted
    api.renderScore(converted.score, song.tracks.map((_, i) => i))
  }, [song, staveMode])

  // Overlays are positioned every frame from alphaTab's layout, so they follow re-renders.
  useEffect(() => {
    let frame = 0
    const tick = (): void => {
      const api = apiRef.current
      const converted = convertedRef.current
      if (api?.boundsLookup && converted) {
        const position = positionRef?.current ?? null
        const span = position === null ? undefined : beatAt(timeline, 0, position)
        place(playCursorRef.current!, span ? beatColumn(api, converted.beats[0]?.[span.barIndex]?.[span.beatIndex]) : null)

        const editBeat = editCursor ? converted.beats[editCursor.track]?.[editCursor.bar]?.[editCursor.beat] : undefined
        place(editColumnRef.current!, editCursor ? beatColumn(api, editBeat) : null)
        const box = editCursor ? stringBox(api, converted, editCursor) : null
        place(editStringRef.current!, box)
        if (box && editCursor) keepVisible(box, `${editCursor.track}/${editCursor.bar}/${editCursor.beat}`)

        const selectionKey = `${renderVersionRef.current}|${JSON.stringify(selection ?? null)}`
        if (selectionKey !== drawnSelectionRef.current) {
          drawnSelectionRef.current = selectionKey
          drawSelection(selectionLayerRef.current!, api, converted, song, selection)
        }

        const lastBar = api.boundsLookup.staffSystems.at(-1)?.bars.at(-1)?.realBounds
        const end = endRef.current
        if (end && lastBar) {
          const maxX = hostRef.current!.clientWidth - end.offsetWidth - 8
          end.style.display = 'flex'
          end.style.left = `${Math.min(lastBar.x + lastBar.w + 14, maxX)}px`
          end.style.top = `${lastBar.y + lastBar.h / 2 - end.offsetHeight / 2}px`
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
      if (box.y < scroll.scrollTop + margin) scroll.scrollTop = box.y - margin
      else if (box.y + box.h > scroll.scrollTop + scroll.clientHeight - margin) scroll.scrollTop = box.y + box.h - scroll.clientHeight + margin
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [timeline, positionRef, editCursor, selection, song])

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
    const startBeat = beatAtPoint(api, from.x, from.y) ?? beatAtPoint(api, to.x, to.y)
    const track = startBeat ? converted.refs.get(startBeat)?.trackIndex : undefined
    if (track === undefined) return
    let first: { bar: number; beat: number } | null = null
    let last: { bar: number; beat: number } | null = null
    converted.beats[track].forEach((beats, bar) => {
      const staves = trackStavesY(api, bar, track)
      if (!staves || staves.bottom < area.y || staves.top > area.y + area.h) return
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
    const y = event.clientY - rect.top
    const beat = beatAtPoint(api, x, y)
    const ref = beat ? converted.refs.get(beat) : undefined
    if (!ref) return

    let string: number | null = null
    const staff = tabStaff(api, ref.barIndex, ref.trackIndex)
    const strings = song.tracks[ref.trackIndex].tuning.length
    const spacing = tabLineSpacing(api)
    if (staff && y >= staff.y - spacing && y <= staff.y + (strings - 1) * spacing + spacing) {
      string = Math.max(1, Math.min(strings, Math.round((y - staff.y) / spacing) + 1))
    }
    onScoreClick({ ...ref, string }, event.shiftKey)
  }

  return (
    <div ref={scrollRef} className="score-scroll">
      <div className="score-host-wrapper" onClick={handleClick} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
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
