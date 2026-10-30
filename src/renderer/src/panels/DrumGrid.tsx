import { useEffect, useRef, useState } from 'react'
import { applyPattern, barToSteps, DRUM_GRIDS, DRUM_PATTERNS, gridFits, gridFor, gridLabel, hitsOnGrid, isTripletGrid, repeatBar, stepsInBar, strengthOf, toggleHit, VELOCITY, type HitStrength } from '../model/drums'
import { barTicks, clearBar, moveBar, type Cursor, type EditResult } from '../model/edit'
import { barCount, DRUM_PIECES } from '../model/song'
import type { Project } from '../project/useProject'

interface Props {
  project: Project
  /** The drum track shown; its bar at the cursor is edited, whichever track the cursor is on. */
  trackIndex: number
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Shows another drum track (when the song has several). */
  onSelectTrack: (index: number) => void
  /** Playback position in seconds (or null), for the playhead. */
  positionRef: React.RefObject<number | null>
  onEdit: (result: EditResult | null, failMessage?: string) => void
  onAudition: (note: number, velocity: number) => void
}

const STRENGTHS: { value: HitStrength; label: string; tip: string }[] = [
  { value: 'normal', label: 'Normal', tip: 'Clicking adds normal hits' },
  { value: 'accent', label: 'Accent', tip: 'Clicking adds accented (louder) hits. Shift+click also adds an accent.' },
  { value: 'ghost', label: 'Ghost', tip: 'Clicking adds ghost (quiet) hits. Alt+click also adds a ghost note.' }
]

/**
 * Step-sequencer editor for a drum track's bar at the cursor (REQUIREMENTS.md DRUM-01…05).
 * It stays docked under the score while other tracks are edited, and can be minimized.
 */
export function DrumGrid({ project, trackIndex, collapsed, onToggleCollapsed, onSelectTrack, positionRef, onEdit, onAudition }: Props): React.JSX.Element {
  const { song, cursor } = project
  // The grid picked, and the bar it was picked in: there it stays; other bars show in it when their hits are on its steps.
  const [picked, setPicked] = useState<{ stepsPerQuarter: number; bar: number | null }>({ stepsPerQuarter: 4, bar: null })
  const [strength, setStrength] = useState<HitStrength>('normal')
  const [repeatTimes, setRepeatTimes] = useState(3)
  const gridRef = useRef<HTMLDivElement>(null)

  const track = song.tracks[trackIndex]
  const bar = cursor.bar
  const stepsPerQuarter =
    picked.bar === bar && gridFits(song, picked.stepsPerQuarter) ? picked.stepsPerQuarter : gridFor(song, track.bars[bar], picked.stepsPerQuarter)
  const stepCount = stepsInBar(song, stepsPerQuarter)
  const ticksPerStep = barTicks(song) / stepCount
  const steps = barToSteps(track.bars[bar], stepCount, ticksPerStep)
  const beatLength = barTicks(song) / song.timeSignature[0]
  const offGrid = !hitsOnGrid(track.bars[bar], stepsPerQuarter)
  const isFourFour = stepsInBar(song, 4) === 16
  const hitCount = track.bars[bar].beats.reduce((sum, b) => sum + b.notes.length, 0)
  const drumTracks = song.tracks.flatMap((t, i) => (t.kind === 'drums' ? [{ index: i, name: t.name }] : []))

  // Edits made while the cursor is on another track leave the cursor where it is.
  const onDrums = cursor.track === trackIndex
  const at: Cursor = onDrums ? cursor : { ...cursor, track: trackIndex, beat: 0, string: 1 }
  const apply = (result: EditResult | null): void => onEdit(result && !onDrums ? { ...result, cursor } : result)

  // Playhead: highlight the step being played in this bar.
  useEffect(() => {
    if (collapsed) return
    let frame = 0
    let shown = -1
    const secondsPerStep = (60 / song.tempo) * (ticksPerStep / 960)
    const tick = (): void => {
      const position = positionRef.current
      const absolute = position === null ? -1 : Math.floor(position / secondsPerStep + 1e-6)
      const step = absolute >= bar * stepCount && absolute < (bar + 1) * stepCount ? absolute - bar * stepCount : -1
      if (step !== shown) {
        gridRef.current?.querySelectorAll('.drum-cell.playing').forEach((c) => c.classList.remove('playing'))
        if (step >= 0) gridRef.current?.querySelectorAll(`.drum-cell[data-step="${step}"]`).forEach((c) => c.classList.add('playing'))
        shown = step
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [collapsed, positionRef, song.tempo, ticksPerStep, stepCount, bar])

  const toggle = (event: React.MouseEvent, step: number, row: number): void => {
    const chosen: HitStrength = event.shiftKey ? 'accent' : event.altKey ? 'ghost' : strength
    const existing = steps[step].find((n) => n.string === row)
    apply(toggleHit(song, at, trackIndex, bar, step, row, chosen, stepsPerQuarter))
    if (!existing || strengthOf(existing.velocity) !== chosen) onAudition(DRUM_PIECES[row - 1].note, VELOCITY[chosen])
  }

  const title =
    drumTracks.length > 1 ? (
      <select value={trackIndex} aria-label="Drum track" onChange={(e) => onSelectTrack(Number(e.target.value))}>
        {drumTracks.map((t) => (
          <option key={t.index} value={t.index}>{t.name}</option>
        ))}
      </select>
    ) : (
      <strong>{track.name}</strong>
    )

  return (
    <section className={`drum-grid card ${collapsed ? 'collapsed' : ''}`}>
      <div className="toolbar">
        <button
          className="icon"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Show the drum grid' : 'Minimize the drum grid'}
          title={collapsed ? 'Show the drum grid' : 'Minimize the drum grid'}
          onClick={onToggleCollapsed}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        {title}
        <button onClick={() => project.setCursor(moveBar(song, cursor, -1))} disabled={bar === 0} aria-label="Previous bar">◀</button>
        <span>
          Bar {bar + 1} of {barCount(song)}
        </span>
        <button onClick={() => project.setCursor(moveBar(song, cursor, 1))} disabled={bar >= barCount(song) - 1} aria-label="Next bar">▶</button>
        {collapsed ? (
          <span className="muted small">{hitCount === 0 ? 'no hits in this bar' : `${hitCount} ${hitCount === 1 ? 'hit' : 'hits'} in this bar`}</span>
        ) : (
          <>
            <div className="segmented" role="group" aria-label="Grid">
              {[...DRUM_GRIDS]
                .sort((a, b) => Number(isTripletGrid(a)) - Number(isTripletGrid(b)) || a - b)
                .map((spq) => (
                  <button
                    key={spq}
                    className={stepsPerQuarter === spq ? 'active' : ''}
                    disabled={!gridFits(song, spq)}
                    onClick={() => setPicked({ stepsPerQuarter: spq, bar })}
                    title={
                      !gridFits(song, spq)
                        ? `Triplet steps don't fill a bar of ${song.timeSignature.join('/')}`
                        : isTripletGrid(spq)
                          ? `Grid: triplet ${spq === 3 ? 'eighths' : 'sixteenths'}, three steps where two straight ones go`
                          : 'Grid resolution'
                    }
                  >
                    {gridLabel(spq)}
                  </button>
                ))}
            </div>
            <div className="segmented" role="group" aria-label="Hit strength">
              {STRENGTHS.map((s) => (
                <button key={s.value} className={strength === s.value ? 'active' : ''} title={s.tip} onClick={() => setStrength(s.value)}>
                  {s.label}
                </button>
              ))}
            </div>
            <span className="spacer" />
            <select
              value=""
              aria-label="Starter pattern"
              disabled={!isFourFour}
              title={isFourFour ? 'Replace this bar with a starter pattern' : 'Starter patterns are for 4/4'}
              onChange={(e) => apply(applyPattern(song, at, trackIndex, bar, DRUM_PATTERNS[Number(e.target.value)]))}
            >
              <option value="">Pattern…</option>
              {DRUM_PATTERNS.map((p, i) => (
                <option key={p.name} value={i}>{p.name}</option>
              ))}
            </select>
            <span className="repeat-bar">
              <button title={`Copy this bar into the next ${repeatTimes} bars (adds bars at the end if needed)`} onClick={() => apply(repeatBar(song, at, trackIndex, bar, repeatTimes))}>
                Repeat bar
              </button>
              <input
                type="number"
                min={1}
                max={64}
                value={repeatTimes}
                aria-label="How many times"
                onChange={(e) => setRepeatTimes(Math.max(1, Math.min(64, Number(e.target.value))))}
              />
              ×
            </span>
            <button onClick={() => apply(clearBar(song, at))}>Clear bar</button>
          </>
        )}
      </div>

      {!collapsed && offGrid && (
        <p className="muted small drum-off-grid">Some hits in this bar are between the steps of this grid. They show at the step before, and move there when you edit the bar.</p>
      )}
      {!collapsed && (
        <div ref={gridRef} className="drum-rows" style={{ gridTemplateColumns: `110px repeat(${stepCount}, minmax(14px, 1fr))` }}>
          {DRUM_PIECES.map((piece, i) => {
            const row = i + 1
            return [
              <button key={`label-${row}`} className="drum-label" title={`Play ${piece.name}`} onClick={() => onAudition(piece.note, VELOCITY.normal)}>
                {piece.name}
              </button>,
              ...steps.map((hits, step) => {
                const hit = hits.find((n) => n.string === row)
                const level = hit ? strengthOf(hit.velocity) : 'off'
                return (
                  <button
                    key={`${row}-${step}`}
                    data-step={step}
                    className={`drum-cell ${level} ${(step * ticksPerStep) % beatLength === 0 ? 'beat-start' : ''} ${step === 0 ? 'bar-start' : ''}`}
                    title={`${piece.name}, step ${step + 1}${hit ? ` (${level})` : ''}`}
                    aria-label={`${piece.name} step ${step + 1}: ${hit ? level : 'off'}`}
                    onClick={(e) => toggle(e, step, row)}
                  />
                )
              })
            ]
          })}
        </div>
      )}
    </section>
  )
}
