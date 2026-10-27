import { useEffect, useRef } from 'react'
import {
  addSection,
  copyCellPart,
  deleteUnusedParts,
  duplicateSection,
  MAX_SECTION_BARS,
  moveSection,
  partUses,
  removeSection,
  renamePart,
  renameSection,
  resizeSection,
  sectionStarts,
  setCellPart,
  unusedParts
} from '../model/arrangement'
import { startRow, type BarRange, type Cursor, type EditResult } from '../model/edit'
import { barCount, type ArrangementSection, type Part } from '../model/song'
import { barSeconds } from '../model/timing'
import type { Project } from '../project/useProject'

/** Narrowest a bar is drawn; longer songs scroll sideways. */
const MIN_BAR_PX = 28
/** Lane colors, one per track (styles.css --lane-0 …). */
const LANE_COLORS = 6

interface Props {
  project: Project
  playing: boolean
  /** Playback position in seconds, null when stopped. */
  positionRef: React.RefObject<number | null>
  /** The bars loop playback repeats, when looping is on. */
  loop: BarRange | null
  message: string
  onMessage: (message: string) => void
  onMoveCursor: (cursor: Cursor) => void
  onLoopSection: (start: number) => void
  onEditInScore: () => void
  /** Keys that work the same here and in the score (play, loop, …); true if handled. */
  onSharedKey: (event: React.KeyboardEvent) => boolean
  onShowShortcuts?: () => void
}

/** How a part fills its section: "4 bars", "2 bars ×2", "8 bars, cut to 4". */
function fillText(part: Part, section: ArrangementSection): string {
  const bars = `${part.bars.length} ${part.bars.length === 1 ? 'bar' : 'bars'}`
  if (part.bars.length === section.length) return bars
  if (part.bars.length > section.length) return `${bars}, cut to ${section.length}`
  const times = section.length / part.bars.length
  return `${bars} ×${Number.isInteger(times) ? times : times.toFixed(1)}`
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function formatTime(seconds: number): string {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The song form as a grid: sections from left to right, a lane per track, and
 * in each cell the part the track plays there. The cursor's section and track
 * are the selected cell, so playback starts there and "Edit in score" goes there.
 */
export function ArrangementView(props: Props): React.JSX.Element {
  const { project, playing, positionRef, loop, message, onMessage, onMoveCursor, onLoopSection, onEditInScore, onSharedKey, onShowShortcuts } = props
  const { song, cursor } = project
  const rootRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const arrangement = song.arrangement ?? []
  const starts = sectionStarts(arrangement)
  const total = Math.max(1, barCount(song))
  const current = Math.max(0, starts.findLastIndex((start) => start <= cursor.bar))
  const section = arrangement[current]
  const track = song.tracks[cursor.track]
  const uses = partUses(song, track)
  const part = track.parts?.find((p) => p.id === section?.parts[track.id])
  const elsewhere = part ? (uses.get(part.id) ?? []).filter((s) => s !== section) : []
  const unused = unusedParts(song)

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  // The selected section stays in view in long songs.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])

  // The playhead follows playback.
  useEffect(() => {
    const playhead = playheadRef.current
    if (!playhead) return
    playhead.style.display = 'none'
    if (!playing) return
    const bar = barSeconds(song)
    let frame = 0
    const tick = (): void => {
      const position = positionRef.current
      playhead.style.display = position === null ? 'none' : 'block'
      if (position !== null) playhead.style.left = `${Math.min(100, (position / bar / total) * 100)}%`
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, song, total, positionRef])

  if (!section) return <div className="arrangement muted">This song has no arrangement.</div>

  const edit = (result: EditResult | null, failMessage?: string, mergeKey?: string): void => {
    if (!project.apply(result, { mergeKey }) && failMessage) onMessage(failMessage)
  }

  /** Selects a cell: the cursor goes to the start of the section, on that track. */
  const select = (index: number, trackIndex = cursor.track): void => {
    const s = Math.max(0, Math.min(arrangement.length - 1, index))
    const t = Math.max(0, Math.min(song.tracks.length - 1, trackIndex))
    const sameKind = song.tracks[t].kind === track.kind
    onMoveCursor({ track: t, bar: starts[s], beat: 0, string: startRow(song, t, starts[s], 0, sameKind ? cursor.string : null) })
    rootRef.current?.focus()
  }

  /** Where bars are drawn in a lane, with a small gap between neighbors. */
  const span = (start: number, length: number): React.CSSProperties => ({ left: `calc(${(start / total) * 100}% + 2px)`, width: `calc(${(length / total) * 100}% - 4px)` })

  const duplicate = (): void => edit(duplicateSection(song, cursor, section.id))
  const remove = (): void => edit(removeSection(song, cursor, section.id), 'A song needs at least one section.')
  const move = (delta: -1 | 1): void => edit(moveSection(song, cursor, section.id, delta))
  const silence = (): void => edit(setCellPart(song, cursor, section.id, track.id, null))
  const copyPart = (): void => {
    if (!part) return
    const result = copyCellPart(song, cursor, section.id, track.id)
    edit(result)
    const copy = result?.song.tracks[cursor.track].parts?.at(-1)
    if (copy) onMessage(`“${section.name}” now plays its own copy, “${copy.name}”: changes to it stay in this section.`)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return
    const ctrl = event.ctrlKey || event.metaKey
    const key = event.key
    let handled = true
    if (key === 'ArrowLeft' && event.altKey) move(-1)
    else if (key === 'ArrowRight' && event.altKey) move(1)
    else if (key === 'ArrowLeft') select(current - 1)
    else if (key === 'ArrowRight') select(current + 1)
    else if (key === 'ArrowUp') select(current, cursor.track - 1)
    else if (key === 'ArrowDown') select(current, cursor.track + 1)
    else if (key === 'Home') select(0)
    else if (key === 'End') select(arrangement.length - 1)
    else if (ctrl && key.toLowerCase() === 'd') duplicate()
    else if (ctrl && (key === 'Delete' || key === 'Backspace')) remove()
    else if (key === 'Delete' || key === 'Backspace') silence()
    else if (key === 'Enter') onEditInScore()
    else handled = onSharedKey(event)
    if (handled) event.preventDefault()
  }

  const describe = (s: ArrangementSection, p: Part | undefined, others: ArrangementSection[]): string => {
    if (!p) return 'Silent here. Pick a part above, or double-click to write notes in the score.'
    const also = others.length > 0 ? `; also plays in ${others.map((o) => `“${o.name}”`).join(', ')}` : ''
    return `“${p.name}”: ${fillText(p, s)}${also}. Double-click to edit it in the score.`
  }

  return (
    <div ref={rootRef} className="arrangement" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="toolbar edit-toolbar arrangement-toolbar" role="group" aria-label="Section">
        <strong className="toolbar-title">Section</strong>
        <input
          className="arr-section-name"
          value={section.name}
          aria-label="Section name"
          title="Name of the section"
          onChange={(e) => edit(renameSection(song, cursor, section.id, e.target.value), undefined, `section-name:${section.id}`)}
        />
        <label className="inline-field" title="Length of the section in bars. A shorter part repeats to fill it; a longer one is cut off (its bars stay in the part).">
          <input
            type="number"
            min={1}
            max={MAX_SECTION_BARS}
            value={section.length}
            aria-label="Section length in bars"
            onChange={(e) => edit(resizeSection(song, cursor, section.id, Number(e.target.value)), undefined, `section-length:${section.id}`)}
          />
          bars
        </label>
        <div className="segmented">
          <button title="Move the section earlier (Alt+←)" aria-label="Move the section earlier" disabled={current === 0} onClick={() => move(-1)}>
            ◀
          </button>
          <button title="Move the section later (Alt+→)" aria-label="Move the section later" disabled={current === arrangement.length - 1} onClick={() => move(1)}>
            ▶
          </button>
        </div>
        <button title="Add a copy right after it, playing the same parts: a repeat (Ctrl+D)" onClick={duplicate}>
          Duplicate
        </button>
        <button title="Remove the section from the song; its parts stay and can be picked again (Ctrl+Del)" disabled={arrangement.length <= 1} onClick={remove}>
          Delete
        </button>
        <button title="Loop playback on this section" onClick={() => onLoopSection(starts[current])}>
          Loop it
        </button>
        <span className="spacer" />
        <button title="Add 4 empty bars as a new section at the end" onClick={() => edit(addSection(song, cursor))}>
          + Section
        </button>
      </div>

      <div className="toolbar edit-toolbar arrangement-toolbar" role="group" aria-label="Part">
        <strong className="toolbar-title" title={`What “${track.name}” plays in “${section.name}”`}>
          {track.name}
        </strong>
        <select
          className="arr-part-select"
          aria-label="Part"
          title="The part this track plays in this section, or nothing"
          value={part?.id ?? ''}
          onChange={(e) => edit(setCellPart(song, cursor, section.id, track.id, e.target.value || null))}
        >
          {(track.parts ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || '(no name)'}
              {uses.has(p.id) ? '' : ' (not used)'}
            </option>
          ))}
          <option value="">Silent</option>
        </select>
        {part && (
          <>
            <input
              className="arr-part-name"
              value={part.name}
              aria-label="Part name"
              title="Name of the part, in every section that plays it"
              onChange={(e) => edit(renamePart(song, cursor, track.id, part.id, e.target.value), undefined, `part-name:${part.id}`)}
            />
            <button
              title={elsewhere.length > 0 ? 'Give this section its own copy of the part, to change it here without changing the other sections' : 'Make a copy of the part for this section (it plays nowhere else yet)'}
              onClick={copyPart}
            >
              Own copy
            </button>
          </>
        )}
        <button title="Write and change the notes in the score (Enter, or double-click a cell)" onClick={onEditInScore}>
          Edit in score
        </button>
        <span className="muted small arr-part-info">{part ? (elsewhere.length > 0 ? `Also plays in ${elsewhere.map((s) => `“${s.name}”`).join(', ')}` : 'Plays only here') : 'Silent in this section'}</span>
      </div>

      <div className="arrangement-scroll">
        <div className="arrangement-grid" style={{ minWidth: `calc(var(--arr-label) + var(--arr-end) + ${total * MIN_BAR_PX}px)` }}>
          <div className="arr-row arr-ruler">
            <div className="arr-label">Song</div>
            <div className="arr-lane">
              {loop && <div className="arr-loop" style={span(loop.start, loop.end - loop.start)} title="Loop playback repeats these bars" />}
              {arrangement.map((s, i) => (
                <button
                  key={s.id}
                  ref={i === current ? selectedRef : undefined}
                  className={`arr-section ${i === current ? 'selected' : ''}`}
                  style={span(starts[i], s.length)}
                  title={`“${s.name}”: bars ${starts[i] + 1}–${starts[i] + s.length}. Double-click to loop it.`}
                  onClick={() => select(i)}
                  onDoubleClick={() => onLoopSection(starts[i])}
                >
                  <span className="arr-name">{s.name || '(no name)'}</span>
                  <small>{plural(s.length, 'bar')}</small>
                </button>
              ))}
            </div>
            <div className="arr-end">
              <button className="arr-add" title="Add 4 empty bars as a new section at the end" aria-label="Add a section" onClick={() => edit(addSection(song, cursor))}>
                +
              </button>
            </div>
          </div>

          {song.tracks.map((t, ti) => {
            const trackUses = ti === cursor.track ? uses : partUses(song, t)
            return (
              <div key={t.id} className={`arr-row ${ti === cursor.track ? 'selected' : ''}`} style={{ '--lane': `var(--lane-${ti % LANE_COLORS})` } as React.CSSProperties}>
                <button className="arr-label" title={`Select “${t.name}”`} onClick={() => select(current, ti)}>
                  {t.name}
                </button>
                <div className="arr-lane">
                  {arrangement.map((s, i) => {
                    const p = t.parts?.find((x) => x.id === s.parts[t.id])
                    const selected = i === current && ti === cursor.track
                    return (
                      <button
                        key={s.id}
                        className={`arr-cell ${p ? 'arr-part' : 'arr-silent'} ${selected ? 'selected' : ''}`}
                        style={span(starts[i], s.length)}
                        title={`${t.name} in “${s.name}”: ${describe(s, p, p ? (trackUses.get(p.id) ?? []).filter((o) => o !== s) : [])}`}
                        aria-label={`${t.name} in ${s.name}: ${p ? p.name : 'silent'}`}
                        onClick={() => select(i, ti)}
                        onDoubleClick={() => {
                          select(i, ti)
                          onEditInScore()
                        }}
                      >
                        {p && (
                          <>
                            {/* Where a shorter part starts again. */}
                            {Array.from({ length: Math.max(0, Math.ceil(s.length / p.bars.length) - 1) }, (_, k) => (
                              <span key={k} className="arr-repeat" style={{ left: `${(((k + 1) * p.bars.length) / s.length) * 100}%` }} />
                            ))}
                            <span className="arr-name">{p.name || '(no name)'}</span>
                            <small>{fillText(p, s)}</small>
                          </>
                        )}
                      </button>
                    )
                  })}
                </div>
                <div className="arr-end" />
              </div>
            )
          })}
          <div className="arr-playhead-layer" aria-hidden="true">
            <div ref={playheadRef} className="arr-playhead" />
          </div>
        </div>
      </div>

      <div className="status-bar">
        <span className="cursor-info">
          {plural(arrangement.length, 'section')} · {plural(barCount(song), 'bar')} · {formatTime(barCount(song) * barSeconds(song))}
        </span>
        {message && <span className="status">{message}</span>}
        <span className="spacer" />
        {unused.length > 0 && (
          <button
            title={`Parts no section plays: ${unused.map((u) => `${song.tracks[u.track].name}: “${u.part.name}”`).join(', ')}`}
            onClick={() => edit(deleteUnusedParts(song, cursor))}
          >
            Delete {plural(unused.length, 'unused part')}
          </button>
        )}
        <button className="icon-button help-button" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={onShowShortcuts}>
          ?
        </button>
      </div>
    </div>
  )
}
