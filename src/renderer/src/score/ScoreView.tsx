import * as alphaTab from '@coderline/alphatab'
import bravuraWoff from '@coderline/alphatab/font/Bravura.woff?url'
import bravuraWoff2 from '@coderline/alphatab/font/Bravura.woff2?url'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import type { Song } from '../model/song'
import { beatAt, buildTimeline } from '../model/timing'
import { songToAlphaTab, type BeatRef, type ConvertedScore } from './toAlphaTab'

export type StaveMode = 'notation+tab' | 'tab'

interface Props {
  song: Song
  staveMode: StaveMode
  /** Playback position in seconds, or null when stopped. Read every animation frame. */
  positionRef?: RefObject<number | null>
  selected?: BeatRef | null
  onBeatClick?: (ref: BeatRef) => void
  onRendered?: (milliseconds: number) => void
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
      // Dynamics aren't part of our model yet; hide alphaTab's default "f".
      elements: new Map([[alphaTab.NotationElement.EffectDynamics, false]])
    },
    player: { enablePlayer: false }
  })
}

function placeOverBeat(box: HTMLElement, api: alphaTab.AlphaTabApi, beat: alphaTab.model.Beat | undefined, fullHeight: boolean): void {
  const bounds = beat ? api.boundsLookup?.findBeat(beat) : null
  if (!bounds) {
    box.style.display = 'none'
    return
  }
  const vertical = fullHeight ? bounds.barBounds.masterBarBounds.realBounds : bounds.visualBounds
  box.style.display = 'block'
  box.style.left = `${bounds.visualBounds.x}px`
  box.style.top = `${vertical.y}px`
  box.style.width = `${Math.max(4, bounds.visualBounds.w)}px`
  box.style.height = `${vertical.h}px`
}

export function ScoreView({ song, staveMode, positionRef, selected, onBeatClick, onRendered }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const selectionRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null)
  const convertedRef = useRef<ConvertedScore | null>(null)
  const renderStartRef = useRef(0)
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  const timeline = useMemo(() => buildTimeline(song), [song])

  useEffect(() => {
    const api = createApi(hostRef.current!)
    apiRef.current = api
    api.renderFinished.on(() => onRenderedRef.current?.(performance.now() - renderStartRef.current))
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

  useEffect(() => {
    let frame = 0
    const tick = (): void => {
      const api = apiRef.current
      const converted = convertedRef.current
      const cursor = cursorRef.current
      if (api && converted && cursor) {
        const position = positionRef?.current ?? null
        const span = position === null ? undefined : beatAt(timeline, 0, position)
        placeOverBeat(cursor, api, span && converted.beats[0]?.[span.barIndex]?.[span.beatIndex], true)
        const selection = selectionRef.current!
        placeOverBeat(selection, api, selected ? converted.beats[selected.trackIndex]?.[selected.barIndex]?.[selected.beatIndex] : undefined, false)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [timeline, positionRef, selected])

  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const api = apiRef.current
    const converted = convertedRef.current
    if (!api?.boundsLookup || !converted) return
    const rect = event.currentTarget.getBoundingClientRect()
    const beat = api.boundsLookup.getBeatAtPos(event.clientX - rect.left, event.clientY - rect.top)
    const ref = beat ? converted.refs.get(beat) : undefined
    if (ref) onBeatClick?.(ref)
  }

  return (
    <div className="score-scroll">
      <div className="score-host-wrapper" onClick={handleClick}>
        <div ref={hostRef} className="score-host" />
        <div ref={selectionRef} className="score-selection" />
        <div ref={cursorRef} className="score-cursor" />
      </div>
    </div>
  )
}
