import * as alphaTab from '@coderline/alphatab'
import bravuraWoff from '@coderline/alphatab/font/Bravura.woff?url'
import bravuraWoff2 from '@coderline/alphatab/font/Bravura.woff2?url'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import type { Cursor } from '../model/edit'
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
  onScoreClick?: (target: ScoreTarget) => void
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

export function ScoreView({ song, staveMode, positionRef, editCursor, onScoreClick, endActions }: Props): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const playCursorRef = useRef<HTMLDivElement>(null)
  const editColumnRef = useRef<HTMLDivElement>(null)
  const editStringRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null)
  const convertedRef = useRef<ConvertedScore | null>(null)
  const renderStartRef = useRef(0)
  const scrolledToRef = useRef('')

  const timeline = useMemo(() => buildTimeline(song), [song])

  useEffect(() => {
    const api = createApi(hostRef.current!)
    apiRef.current = api
    api.renderFinished.on(() => {
      scrollRef.current!.dataset.renderMs = (performance.now() - renderStartRef.current).toFixed(0)
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
  }, [timeline, positionRef, editCursor])

  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const api = apiRef.current
    const converted = convertedRef.current
    if (!api?.boundsLookup || !converted || !onScoreClick) return
    if ((event.target as HTMLElement).closest('.score-end-actions')) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const beat = api.boundsLookup.getBeatAtPos(x, y)
    const ref = beat ? converted.refs.get(beat) : undefined
    if (!ref) return

    let string: number | null = null
    const staff = tabStaff(api, ref.barIndex, ref.trackIndex)
    const strings = song.tracks[ref.trackIndex].tuning.length
    const spacing = tabLineSpacing(api)
    if (staff && y >= staff.y - spacing && y <= staff.y + (strings - 1) * spacing + spacing) {
      string = Math.max(1, Math.min(strings, Math.round((y - staff.y) / spacing) + 1))
    }
    onScoreClick({ ...ref, string })
  }

  return (
    <div ref={scrollRef} className="score-scroll">
      <div className="score-host-wrapper" onClick={handleClick}>
        <div ref={hostRef} className="score-host" />
        <div ref={editColumnRef} className="score-edit-column" />
        <div ref={editStringRef} className="score-edit-string" />
        <div ref={playCursorRef} className="score-cursor" />
        {endActions && (
          <div ref={endRef} className="score-end-actions">
            {endActions}
          </div>
        )}
      </div>
    </div>
  )
}
