import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { barStartTicks, moveBar, type EditResult } from '../model/edit'
import { addRollNote, barLengths, removeRollNote, rollNotes, type RollNote } from '../model/keys'
import { barCount, KEYS_TUNING, keyRow, rowPitch, timeSignatureAt } from '../model/song'
import { tickAtTime } from '../model/timing'
import type { Project } from '../project/useProject'
import { noteName } from '../transcription/notes'

interface Props {
  project: Project
  /** The keys track shown; the cursor is on it. */
  trackIndex: number
  collapsed: boolean
  onToggleCollapsed: () => void
  positionRef: React.RefObject<number | null>
  onEdit: (result: EditResult | null, failMessage?: string) => void
  onAudition: (pitch: number, velocity: number) => void
  /** Live MIDI recording into this track from the cursor's bar, quantized to the grid. */
  recording: boolean
  onRecord: (gridTicks: number) => void
  onStopRecording: () => void
}

const ROW_HEIGHT = 12
const BARS_SHOWN = 2
const BLACK = new Set([1, 3, 6, 8, 10])
const GRIDS = [
  { label: '1/8', ticks: 480 },
  { label: '1/16', ticks: 240 },
  { label: '1/32', ticks: 120 }
]

/** Piano roll for the keys track at the cursor (REQUIREMENTS.md INST-02): two bars from the cursor's bar. */
export function PianoRoll(props: Props): React.JSX.Element {
  const { project, trackIndex, collapsed, onToggleCollapsed, positionRef, onEdit, onAudition, recording, onRecord, onStopRecording } = props
  const { song, cursor } = project
  const [gridTicks, setGridTicks] = useState(240)
  const [draft, setDraft] = useState<RollNote | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ note: RollNote; pointerId: number } | null>(null)

  const from = cursor.bar
  const to = Math.min(barCount(song), from + BARS_SHOWN)
  // The bars shown, as long as their time signatures make them.
  const lengths = barLengths(song, from, to)
  const barStarts = lengths.map((_, i) => lengths.slice(0, i).reduce((sum, t) => sum + t, 0))
  const total = lengths.reduce((sum, t) => sum + t, 0)
  const steps = total / gridTicks
  const notes = rollNotes(song, trackIndex, from, to)
  const rows = KEYS_TUNING.length

  // Scroll to the notes (or middle C) when other bars are shown, and when the notes change but none of them can be seen.
  const rowsKey = notes.map((n) => n.row).join(',')
  const shownRef = useRef('')
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || collapsed) {
      shownRef.current = '' // scroll again when shown again
      return
    }
    const rowsInView = notes.map((n) => n.row)
    const view = `${trackIndex}/${from}`
    const top = scroll.scrollTop / ROW_HEIGHT + 1
    const bottom = (scroll.scrollTop + scroll.clientHeight) / ROW_HEIGHT
    const anyVisible = rowsInView.some((row) => row >= top && row <= bottom)
    if (view === shownRef.current && (anyVisible || rowsInView.length === 0)) return
    shownRef.current = view
    const center = rowsInView.length > 0 ? rowsInView.reduce((a, b) => a + b, 0) / rowsInView.length : keyRow(60)
    scroll.scrollTop = (center - 1) * ROW_HEIGHT - scroll.clientHeight / 2
  }, [trackIndex, from, collapsed, rowsKey])

  // Playhead over the shown bars.
  useEffect(() => {
    if (collapsed) return
    let frame = 0
    const first = barStartTicks(song, from)[from]
    const tick = (): void => {
      const position = positionRef.current
      const at = position === null ? -1 : tickAtTime(song, position) - first
      const head = playheadRef.current
      if (head) {
        head.style.display = at >= 0 && at < total ? 'block' : 'none'
        head.style.left = `${(at / total) * 100}%`
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [collapsed, positionRef, song, from, total])

  /** Grid position under a pointer: the step's start tick and the row. */
  const cellAt = (event: React.PointerEvent): { tick: number; row: number } => {
    const rect = gridRef.current!.getBoundingClientRect()
    const step = Math.max(0, Math.min(steps - 1, Math.floor(((event.clientX - rect.left) / rect.width) * steps)))
    const row = Math.max(1, Math.min(rows, Math.floor((event.clientY - rect.top) / ROW_HEIGHT) + 1))
    return { tick: step * gridTicks, row }
  }

  const onPointerDown = (event: React.PointerEvent): void => {
    if (event.button !== 0 || recording) return
    const { tick, row } = cellAt(event)
    const hit = notes.find((n) => n.row === row && n.start <= tick && n.start + n.length > tick)
    if (hit) {
      onEdit(removeRollNote(song, cursor, trackIndex, from, to, row, tick))
      return
    }
    const note: RollNote = { row, start: tick, length: gridTicks, velocity: 96 }
    dragRef.current = { note, pointerId: event.pointerId }
    gridRef.current!.setPointerCapture(event.pointerId)
    setDraft(note)
    onAudition(rowPitch(row), 96)
  }

  const onPointerMove = (event: React.PointerEvent): void => {
    const drag = dragRef.current
    if (!drag) return
    const { tick } = cellAt(event)
    const length = Math.max(gridTicks, tick + gridTicks - drag.note.start)
    if (length !== drag.note.length) {
      drag.note = { ...drag.note, length }
      setDraft(drag.note)
    }
  }

  const onPointerUp = (): void => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    setDraft(null)
    onEdit(addRollNote(song, cursor, trackIndex, from, to, drag.note))
  }

  const box = (n: RollNote): React.CSSProperties => ({
    left: `${(n.start / total) * 100}%`,
    width: `${(n.length / total) * 100}%`,
    top: (n.row - 1) * ROW_HEIGHT,
    height: ROW_HEIGHT - 1
  })

  const lines = lengths.flatMap((length, i) => {
    const [beats] = timeSignatureAt(song, from + i)
    return Array.from({ length: beats }, (_, k) => ({ at: (barStarts[i] + (k * length) / beats) / total, bar: k === 0 }))
  })

  return (
    <section className={`piano-roll card ${collapsed ? 'collapsed' : ''}`}>
      <div className="toolbar">
        <button
          className="icon"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Show the piano roll' : 'Minimize the piano roll'}
          title={collapsed ? 'Show the piano roll' : 'Minimize the piano roll'}
          onClick={onToggleCollapsed}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <strong>{song.tracks[trackIndex].name}</strong>
        <button onClick={() => project.setCursor(moveBar(song, cursor, -1))} disabled={from === 0} aria-label="Previous bar">◀</button>
        <span>
          {to - from > 1 ? `Bars ${from + 1}–${to}` : `Bar ${from + 1}`} of {barCount(song)}
        </span>
        <button onClick={() => project.setCursor(moveBar(song, cursor, 1))} disabled={from >= barCount(song) - 1} aria-label="Next bar">▶</button>
        {!collapsed && (
          <>
            <div className="segmented" role="group" aria-label="Grid">
              {GRIDS.map((g) => (
                <button key={g.ticks} className={gridTicks === g.ticks ? 'active' : ''} title="Grid for drawing and for recording" onClick={() => setGridTicks(g.ticks)}>
                  {g.label}
                </button>
              ))}
            </div>
            <span className="spacer" />
            {recording ? (
              <button className="active record-live" onClick={onStopRecording} title="Stop recording (Space)">
                ■ Stop recording
              </button>
            ) : (
              <button
                className="record-live"
                title={`Record from the MIDI keyboard from bar ${from + 1}, with a one-bar count-in and the metronome; notes snap to the grid`}
                onClick={() => onRecord(gridTicks)}
              >
                ● Record MIDI
              </button>
            )}
            <span className="muted small">Drag: add a note · click a note: remove it</span>
          </>
        )}
      </div>

      {!collapsed && (
        <div ref={scrollRef} className="roll-scroll">
          <div className="roll" style={{ height: rows * ROW_HEIGHT }}>
            <div className="roll-keys">
              {KEYS_TUNING.map((pitch) => (
                <button
                  key={pitch}
                  className={`roll-key ${BLACK.has(pitch % 12) ? 'black' : 'white'}`}
                  style={{ height: ROW_HEIGHT }}
                  title={noteName(pitch)}
                  tabIndex={-1}
                  onPointerDown={() => onAudition(pitch, 96)}
                >
                  {pitch % 12 === 0 ? noteName(pitch) : ''}
                </button>
              ))}
            </div>
            <div
              ref={gridRef}
              className="roll-grid"
              style={{ '--steps': steps } as React.CSSProperties}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                dragRef.current = null
                setDraft(null)
              }}
            >
              {KEYS_TUNING.map((pitch, i) => (BLACK.has(pitch % 12) ? <div key={pitch} className="roll-row-black" style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }} /> : null))}
              {lines.map((line) => (
                <div key={line.at} className={`roll-line ${line.bar ? 'bar' : ''}`} style={{ left: `${line.at * 100}%` }} />
              ))}
              {notes.map((n) => (
                <div
                  key={`${n.row}-${n.start}`}
                  className={`roll-note ${n.continued ? 'continued' : ''}`}
                  style={{ ...box(n), opacity: 0.55 + (0.45 * n.velocity) / 127 }}
                  title={`${noteName(rowPitch(n.row))}${n.continued ? ' (held from before)' : ''}`}
                />
              ))}
              {draft && <div className="roll-note draft" style={box(draft)} />}
              <div ref={playheadRef} className="roll-playhead" />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
