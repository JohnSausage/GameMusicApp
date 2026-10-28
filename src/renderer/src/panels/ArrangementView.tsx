import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ColorSwatches, partColor } from '../components/ColorSwatches'
import {
  addSection,
  copyCellPart,
  deletePart,
  deleteUnusedParts,
  duplicatePart,
  duplicateSection,
  MAX_SECTION_BARS,
  moveSection,
  newPart,
  partColors,
  partUses,
  placeSection,
  removeSection,
  renamePart,
  renameSection,
  resizeSection,
  sectionStarts,
  setCellPart,
  setPartColor,
  unusedParts
} from '../model/arrangement'
import { startRow, type BarRange, type EditResult } from '../model/edit'
import { barCount, type ArrangementSection, type Part, type Track } from '../model/song'
import { barSeconds } from '../model/timing'
import type { Project } from '../project/useProject'

/** Narrowest a bar is drawn; longer songs scroll sideways. */
const MIN_BAR_PX = 28
/** Width of the track names on the left, and of the "+" column on the right. */
const LABEL_PX = 120
const END_PX = 48
/** How far the pointer moves before a press becomes a drag. */
const DRAG_THRESHOLD = 5

interface Props {
  project: Project
  playing: boolean
  /** Playback position in seconds, null when stopped. */
  positionRef: React.RefObject<number | null>
  /** The bars loop playback repeats, when looping is on. */
  loop: BarRange | null
  message: string
  onMessage: (message: string) => void
  onLoopSection: (start: number) => void
  onEditInScore: () => void
  /** Keys that work the same here and in the score (play, loop, …); true if handled. */
  onSharedKey: (event: React.KeyboardEvent) => boolean
  onShowShortcuts?: () => void
  /** The score of the part being edited (project.part), shown under the grid. */
  partEditor: React.ReactNode
  /** The edited part is playing on its own. */
  partPlaying: boolean
  /** Plays the edited part on its own from its start, or stops. */
  onPlayPart: () => void
}

/** Something being dragged: a part (from a cell or the palette) or a section (by its name). */
type DragItem = { kind: 'part'; trackId: string; partId: string; label: string; color: number } | { kind: 'section'; sectionId: string; label: string }

interface Drag {
  item: DragItem
  startX: number
  startY: number
  x: number
  y: number
  /** Moved past the threshold: a drag, not a click. */
  moving: boolean
  /** A part: the section it would play in if dropped here. */
  target: string | null
  /** A section: where in the row it would go. */
  insertAt: number | null
}

/** A section's length being dragged; the bar width stays as it was, so the edge follows the pointer. */
interface Resize {
  sectionId: string
  startX: number
  startLength: number
  length: number
  barPx: number
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

/** The click that ends a drag would select what is under the pointer; this swallows it. */
function swallowClick(): void {
  const swallow = (event: MouseEvent): void => {
    event.stopPropagation()
    event.preventDefault()
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

/**
 * The song form as a grid: sections from left to right, a lane per track, and
 * in each cell the part the track plays there, in the part's color. The cursor's
 * section and track are the selected cell, so playback starts there and "Edit in
 * score" goes there. Parts can be dragged onto other sections of their track,
 * sections dragged to another place, and their right edge dragged to resize them.
 * Under the grid, the part of the selected cell (or one picked in the palette) is
 * edited on its own; the palette under it lists every part of every track.
 */
export function ArrangementView(props: Props): React.JSX.Element {
  const { project, playing, positionRef, loop, message, onMessage, onLoopSection, onEditInScore, onSharedKey, onShowShortcuts } = props
  const { partEditor, partPlaying, onPlayPart } = props
  const { song, cursor } = project
  const gridRef = useRef<HTMLDivElement>(null)
  const partRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const laneRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const [available, setAvailable] = useState(0)
  // Drags live in refs (the window listeners read them) and redraw on every change.
  const dragRef = useRef<Drag | null>(null)
  const resizeRef = useRef<Resize | null>(null)
  const dropRef = useRef<(drag: Drag) => void>(() => {})
  const resizedRef = useRef<(resize: Resize) => void>(() => {})
  const [, redraw] = useState(0)
  const setDrag = (next: Drag | null): void => {
    dragRef.current = next
    redraw((n) => n + 1)
  }
  const setResize = (next: Resize | null): void => {
    resizeRef.current = next
    redraw((n) => n + 1)
  }
  const drag = dragRef.current
  const resize = resizeRef.current

  const arrangement = song.arrangement ?? []
  const starts = sectionStarts(arrangement)
  const current = Math.max(0, starts.findLastIndex((start) => start <= cursor.bar))
  const section = arrangement[current]
  const track = song.tracks[cursor.track]
  const uses = partUses(song, track)
  const cellPartId = section?.parts[track.id]
  // The part edited under the grid.
  const editedRef = project.editedPart
  const editedTrack = editedRef ? song.tracks.find((t) => t.id === editedRef.trackId) : undefined
  const edited = editedTrack?.parts?.find((p) => p.id === editedRef?.partId)
  const editedUses = edited && editedTrack ? (editedTrack === track ? uses : partUses(song, editedTrack)).get(edited.id) ?? [] : []
  const unused = unusedParts(song)
  const colors = partColors(song)
  const colorOf = (p: Part): number => colors.get(p.id) ?? 0

  // While a length is dragged, the grid shows it before it is applied.
  const shown = resize ? arrangement.map((s) => (s.id === resize.sectionId ? { ...s, length: resize.length } : s)) : arrangement
  const shownStarts = sectionStarts(shown)
  const total = Math.max(1, shown.reduce((sum, s) => sum + s.length, 0))
  // Bars share the width there is; long songs scroll sideways.
  const barPx = resize ? resize.barPx : Math.max(MIN_BAR_PX, available / total)
  const live = useRef({ shown, shownStarts, barPx })
  live.current = { shown, shownStarts, barPx }

  useEffect(() => {
    gridRef.current?.focus()
  }, [])

  /**
   * The part of the selected cell is edited under the grid. A silent cell keeps
   * the part of its track being edited, so it can be placed there.
   */
  const followCell = (s: ArrangementSection | undefined, t: Track): void => {
    const partId = s?.parts[t.id]
    if (partId) project.editPart({ trackId: t.id, partId })
    else if (project.editedPart?.trackId !== t.id) project.editPart(null)
  }
  // Also when the cell changes another way (the track list, undo, …).
  useEffect(() => followCell(section, track), [current, track.id, cellPartId])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setAvailable(element.clientWidth - LABEL_PX - END_PX))
    observer.observe(element)
    return () => observer.disconnect()
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
      if (position !== null) playhead.style.left = `${(position / bar) * live.current.barPx}px`
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, song, positionRef])

  // Dragging a part or a section: follow the pointer, drop on release, Esc cancels.
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const move = (event: PointerEvent): void => {
      const d = dragRef.current
      if (!d) return
      const moving = d.moving || Math.hypot(event.clientX - d.startX, event.clientY - d.startY) > DRAG_THRESHOLD
      if (!moving) return
      let target: string | null = null
      let insertAt: number | null = null
      if (d.item.kind === 'part') {
        const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-cell]')
        if (cell?.dataset.track === d.item.trackId) target = cell.dataset.section ?? null
      } else {
        const lane = laneRef.current?.getBoundingClientRect()
        const { shown: sections, shownStarts: at, barPx: px } = live.current
        if (lane) insertAt = sections.filter((s, i) => (at[i] + s.length / 2) * px < event.clientX - lane.left).length
      }
      setDrag({ ...d, moving, x: event.clientX, y: event.clientY, target, insertAt })
    }
    const up = (): void => {
      const d = dragRef.current
      setDrag(null)
      if (!d?.moving) return
      swallowClick()
      dropRef.current(d)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key)
    }
  }, [dragging])

  // Dragging a section's right edge.
  const resizing = resize !== null
  useEffect(() => {
    if (!resizing) return
    const move = (event: PointerEvent): void => {
      const r = resizeRef.current
      if (!r) return
      const length = Math.max(1, Math.min(MAX_SECTION_BARS, r.startLength + Math.round((event.clientX - r.startX) / r.barPx)))
      if (length !== r.length) setResize({ ...r, length })
    }
    const up = (): void => {
      const r = resizeRef.current
      setResize(null)
      if (!r || r.length === r.startLength) return
      swallowClick()
      resizedRef.current(r)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setResize(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key)
    }
  }, [resizing])

  if (!section) return <div className="arrangement muted">This song has no arrangement.</div>

  const edit = (result: EditResult | null, failMessage?: string, mergeKey?: string): boolean => {
    const applied = project.apply(result, { mergeKey })
    if (!applied && failMessage) onMessage(failMessage)
    return applied
  }

  /** Selects a cell: the cursor goes to the start of the section, on that track. */
  const select = (index: number, trackIndex = cursor.track): void => {
    const s = Math.max(0, Math.min(arrangement.length - 1, index))
    const t = Math.max(0, Math.min(song.tracks.length - 1, trackIndex))
    const sameKind = song.tracks[t].kind === track.kind
    project.setCursor({ track: t, bar: starts[s], beat: 0, string: startRow(song, t, starts[s], 0, sameKind ? cursor.string : null) })
    followCell(arrangement[s], song.tracks[t])
    gridRef.current?.focus()
  }

  /** A part plays in a section (the selected one by default), and that cell is selected. */
  const place = (t: Track, p: Part, sectionIndex = current): void => {
    edit(setCellPart(song, cursor, arrangement[sectionIndex].id, t.id, p.id))
    select(sectionIndex, song.tracks.indexOf(t))
    project.editPart({ trackId: t.id, partId: p.id })
  }

  dropRef.current = ({ item, target, insertAt }: Drag): void => {
    if (item.kind === 'part' && target) {
      const t = song.tracks.find((x) => x.id === item.trackId)
      const p = t?.parts?.find((x) => x.id === item.partId)
      if (t && p) place(t, p, arrangement.findIndex((s) => s.id === target))
    } else if (item.kind === 'section' && insertAt !== null) {
      edit(placeSection(song, cursor, item.sectionId, insertAt))
    }
  }
  resizedRef.current = (r: Resize): void => {
    edit(resizeSection(song, cursor, r.sectionId, r.length))
  }

  const startDrag = (event: React.PointerEvent, item: DragItem): void => {
    if (event.button !== 0) return
    setDrag({ item, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moving: false, target: null, insertAt: null })
  }
  const partItem = (t: Track, p: Part): DragItem => ({ kind: 'part', trackId: t.id, partId: p.id, label: p.name || '(no name)', color: colorOf(p) })

  const startResize = (event: React.PointerEvent, s: ArrangementSection): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    setResize({ sectionId: s.id, startX: event.clientX, startLength: s.length, length: s.length, barPx })
  }

  /** Where bars are drawn in a lane, with a small gap between neighbors. */
  const span = (start: number, length: number): React.CSSProperties => ({ left: start * barPx + 2, width: Math.max(4, length * barPx - 4) })

  const duplicate = (): void => void edit(duplicateSection(song, cursor, section.id))
  const remove = (): void => void edit(removeSection(song, cursor, section.id), 'A song needs at least one section.')
  const move = (delta: -1 | 1): void => void edit(moveSection(song, cursor, section.id, delta))
  const silence = (): void => void edit(setCellPart(song, cursor, section.id, track.id, null))
  const copyPart = (): void => {
    const result = copyCellPart(song, cursor, section.id, track.id)
    const copy = result?.song.tracks[cursor.track].parts?.at(-1)
    if (edit(result) && copy) onMessage(`“${section.name}” now plays its own copy, “${copy.name}”: changes to it stay in this section.`)
  }

  /** A new empty part for a track, as long as the selected section; with `here`, the selected section plays it. */
  const addPart = (t: Track, here = false): void => {
    const result = newPart(song, cursor, t.id, section.length, here ? section.id : undefined)
    const created = result?.song.tracks.find((x) => x.id === t.id)?.parts?.at(-1)
    if (!edit(result) || !created) return
    project.editPart({ trackId: t.id, partId: created.id })
    onMessage(
      here
        ? `“${section.name}” now plays the new part “${created.name}”: write its notes below.`
        : `New part “${created.name}” for ${t.name}: write its notes below, then drag it onto a section.`
    )
  }

  /** A copy of the edited part to build a variation on; it is edited from then on. */
  const duplicateEdited = (): void => {
    if (!edited || !editedTrack) return
    const result = duplicatePart(song, cursor, editedTrack.id, edited.id)
    const copy = result?.song.tracks.find((t) => t.id === editedTrack.id)?.parts?.find((p) => !editedTrack.parts?.some((o) => o.id === p.id))
    if (!edit(result) || !copy) return
    project.editPart({ trackId: editedTrack.id, partId: copy.id })
    onMessage(`“${copy.name}” is a copy of “${edited.name}”: change it below, then drag it onto a section or use “Place in”.`)
  }

  /** Grid keys: they work while the grid has the focus. */
  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (isTyping(event.target)) return
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
    else if (key === 'Enter') partEditor ? partRef.current?.querySelector<HTMLElement>('.editor-main')?.focus() : onEditInScore()
    else handled = false
    if (handled) event.preventDefault()
  }

  /** Keys everywhere else: the shared ones (play, loop, …). The part editor handles its own. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || isTyping(event.target)) return
    onSharedKey(event)
  }

  /** Esc in the part editor (with nothing selected there) goes back to the grid. */
  const onPartKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || isTyping(event.target)) return
    event.preventDefault()
    gridRef.current?.focus()
  }

  const describe = (s: ArrangementSection, p: Part | undefined, others: ArrangementSection[]): string => {
    if (!p) return 'Silent here. Drag a part here, or make a new one below; double-click to write notes in the score.'
    const also = others.length > 0 ? `; also plays in ${others.map((o) => `“${o.name}”`).join(', ')}` : ''
    return `“${p.name}”: ${fillText(p, s)}${also}. It's edited below; drag it onto another section to play it there too, double-click to see it in the score.`
  }
  const sectionNames = (sections: ArrangementSection[]): string => sections.map((s) => `“${s.name}”`).join(', ')

  const draggingPart = drag?.moving && drag.item.kind === 'part' ? drag.item : null
  const draggingSection = drag?.moving && drag.item.kind === 'section' ? drag.item : null
  const insertX = draggingSection && drag?.insertAt !== null && drag?.insertAt !== undefined ? (drag.insertAt < shown.length ? shownStarts[drag.insertAt] : total) * barPx : null

  const placeHere = edited && editedTrack && section.parts[editedTrack.id] !== edited.id
  const cellPlaysEdited = edited && editedTrack === track && cellPartId === edited.id

  return (
    <div className={`arrangement ${drag?.moving || resize ? 'dragging' : ''}`} onKeyDown={onKeyDown}>
      <div className="toolbar edit-toolbar arrangement-toolbar" role="group" aria-label="Section">
        <strong className="toolbar-title">Section</strong>
        <input
          className="arr-section-name"
          value={section.name}
          aria-label="Section name"
          title="Name of the section"
          onChange={(e) => edit(renameSection(song, cursor, section.id, e.target.value), undefined, `section-name:${section.id}`)}
        />
        <label className="inline-field" title="Length of the section in bars (or drag its right edge). A shorter part repeats to fill it; a longer one is cut off (its bars stay in the part).">
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
          <button title="Move the section earlier (Alt+←, or drag its name)" aria-label="Move the section earlier" disabled={current === 0} onClick={() => move(-1)}>
            ◀
          </button>
          <button title="Move the section later (Alt+→, or drag its name)" aria-label="Move the section later" disabled={current === arrangement.length - 1} onClick={() => move(1)}>
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
        <button title="Show the selected section in the score, with all tracks (Enter or double-click a cell)" onClick={onEditInScore}>
          Show in score
        </button>
        <button title="Add 4 empty bars as a new section at the end" onClick={() => edit(addSection(song, cursor))}>
          + Section
        </button>
      </div>

      <div ref={gridRef} className="arrangement-grid-area" tabIndex={0} onKeyDown={onGridKeyDown}>
        <div ref={scrollRef} className="arrangement-scroll">
          <div
            className="arrangement-grid"
            style={{ '--arr-label': `${LABEL_PX}px`, '--arr-end': `${END_PX}px`, width: LABEL_PX + END_PX + total * barPx } as React.CSSProperties}
          >
            <div className="arr-row arr-ruler">
              <div className="arr-label">Song</div>
              <div ref={laneRef} className="arr-lane">
                {loop && <div className="arr-loop" style={span(loop.start, loop.end - loop.start)} title="Loop playback repeats these bars" />}
                {shown.map((s, i) => (
                  <button
                    key={s.id}
                    ref={i === current ? selectedRef : undefined}
                    className={`arr-section ${i === current ? 'selected' : ''} ${draggingSection?.sectionId === s.id ? 'drag-source' : ''}`}
                    style={span(shownStarts[i], s.length)}
                    title={`“${s.name}”: bars ${shownStarts[i] + 1}–${shownStarts[i] + s.length}. Drag to move it, drag its right edge to change its length, double-click to loop it.`}
                    onPointerDown={(e) => startDrag(e, { kind: 'section', sectionId: s.id, label: s.name || '(no name)' })}
                    onClick={() => select(i)}
                    onDoubleClick={() => onLoopSection(starts[i])}
                  >
                    <span className="arr-name">{s.name || '(no name)'}</span>
                    <small>{plural(s.length, 'bar')}</small>
                    <span className="arr-resize" title="Drag to change the length" onPointerDown={(e) => startResize(e, s)} />
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
              const dropOk = draggingPart?.trackId === t.id
              return (
                <div key={t.id} className={`arr-row ${ti === cursor.track ? 'selected' : ''}`}>
                  <button className="arr-label" title={`Select “${t.name}”`} onClick={() => select(current, ti)}>
                    {t.name}
                  </button>
                  <div className="arr-lane">
                    {shown.map((s, i) => {
                      const p = t.parts?.find((x) => x.id === s.parts[t.id])
                      const selected = i === current && ti === cursor.track
                      const target = dropOk && drag?.target === s.id
                      const editing = p !== undefined && p === edited
                      return (
                        <button
                          key={s.id}
                          data-cell=""
                          data-track={t.id}
                          data-section={s.id}
                          className={`arr-cell ${p ? 'arr-part' : 'arr-silent'} ${selected ? 'selected' : ''} ${editing ? 'editing' : ''} ${dropOk ? 'drop-ok' : ''} ${target ? 'drop-target' : ''}`}
                          style={{ ...span(shownStarts[i], s.length), ...(p && partColor(colorOf(p))) }}
                          title={`${t.name} in “${s.name}”: ${describe(s, p, p ? (trackUses.get(p.id) ?? []).filter((o) => o !== s) : [])}`}
                          aria-label={`${t.name} in ${s.name}: ${p ? p.name : 'silent'}`}
                          onPointerDown={p ? (e) => startDrag(e, partItem(t, p)) : undefined}
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
                                <span key={k} className="arr-repeat" style={{ left: (k + 1) * p.bars.length * barPx - 2 }} />
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
              {insertX !== null && <div className="arr-insert" style={{ left: insertX }} />}
            </div>
          </div>
        </div>
      </div>

      <div ref={partRef} className="arr-part-editor" onKeyDown={onPartKeyDown}>
        {edited && editedTrack ? (
          <>
            <div className="toolbar edit-toolbar arrangement-toolbar arr-part-head" role="group" aria-label="Part" style={partColor(colorOf(edited))}>
              <strong className="toolbar-title" title={`The part edited here belongs to “${editedTrack.name}”`}>
                {editedTrack.name}
              </strong>
              <input
                className="arr-part-name"
                value={edited.name}
                aria-label="Part name"
                title="Name of the part, in every section that plays it"
                onChange={(e) => edit(renamePart(song, cursor, editedTrack.id, edited.id, e.target.value), undefined, `part-name:${edited.id}`)}
              />
              <ColorSwatches
                value={colorOf(edited)}
                label="Part color"
                title="color of the part, in every section that plays it"
                onChange={(color) => color !== null && edit(setPartColor(song, cursor, editedTrack.id, edited.id, color))}
              />
              <button title="A copy of this part to build a variation on: same notes and color, played in no section yet. The copy is edited here." onClick={duplicateEdited}>
                Duplicate
              </button>
              <button
                className={partPlaying ? 'active' : ''}
                title={partPlaying ? 'Stop (Space)' : 'Play this part on its own, from its start (Space in the part plays from its cursor)'}
                onClick={onPlayPart}
              >
                {partPlaying ? '■ Stop' : '▶ Play part'}
              </button>
              {placeHere && (
                <button
                  title={`Play this part in “${section.name}”${section.parts[editedTrack.id] ? `, instead of what ${editedTrack.name} plays there now` : ''} (or drag it from the palette)`}
                  onClick={() => place(editedTrack, edited)}
                >
                  Place in “{section.name}”
                </button>
              )}
              {cellPlaysEdited && editedUses.length > 1 && (
                <button title={`Give “${section.name}” its own copy of the part, to change it there without changing ${sectionNames(editedUses.filter((s) => s !== section))}`} onClick={copyPart}>
                  Own copy for “{section.name}”
                </button>
              )}
              {cellPlaysEdited && (
                <button title={`${editedTrack.name} plays nothing in “${section.name}” (Del in the grid); the part stays in the palette`} onClick={silence}>
                  Silence in “{section.name}”
                </button>
              )}
              <span className="muted small arr-part-info" title={editedUses.length > 0 ? `Plays in ${sectionNames(editedUses)}` : undefined}>
                {plural(edited.bars.length, 'bar')} · {editedUses.length > 0 ? `plays in ${sectionNames(editedUses)}` : 'no section plays it yet'}
              </span>
            </div>
            {partEditor}
          </>
        ) : (
          <div className="arr-part-empty">
            <p>
              <strong>{track.name}</strong> is silent in “{section.name}”.
            </p>
            <div className="toolbar">
              <button title={`A new empty part of ${plural(section.length, 'bar')}, played in “${section.name}”`} onClick={() => addPart(track, true)}>
                + New part here
              </button>
              <span className="muted small">or drag a part from the palette onto the section, or click one there to edit it.</span>
            </div>
          </div>
        )}
      </div>

      <div className="arr-palette" role="group" aria-label="Parts">
        <div className="arr-palette-head">
          <strong>Parts</strong>
          <span className="muted small">Click a part to edit it above, drag it onto a section of its track to play it there; + makes a new one.</span>
        </div>
        {song.tracks.map((t, ti) => {
          const trackUses = ti === cursor.track ? uses : partUses(song, t)
          return (
            <div key={t.id} className="arr-palette-row">
              <span className="arr-palette-track" title={t.name}>
                {t.name}
              </span>
              <div className="arr-chips">
                {(t.parts ?? []).map((p) => {
                  const count = trackUses.get(p.id)?.length ?? 0
                  return (
                    <span key={p.id} className="arr-chip-wrap">
                      <button
                        className={`arr-chip ${count > 0 ? '' : 'unused'} ${p === edited ? 'selected' : ''}`}
                        style={partColor(colorOf(p))}
                        title={`“${p.name}” (${plural(p.bars.length, 'bar')}): ${count > 0 ? `plays in ${plural(count, 'section')}` : 'no section plays it'}. Click to edit it, or drag it onto a section.`}
                        onPointerDown={(e) => startDrag(e, partItem(t, p))}
                        onClick={() => project.editPart({ trackId: t.id, partId: p.id })}
                      >
                        <span className="arr-name">{p.name || '(no name)'}</span>
                        <small>{count > 0 ? `${count}×` : 'not used'}</small>
                      </button>
                      {count === 0 && (
                        <button className="icon arr-chip-delete" title="Delete this part" aria-label={`Delete the part ${p.name}`} onClick={() => edit(deletePart(song, cursor, t.id, p.id))}>
                          ×
                        </button>
                      )}
                    </span>
                  )
                })}
                <button
                  className="arr-chip-add"
                  title={`A new empty part for ${t.name}, ${plural(section.length, 'bar')} long like “${section.name}”: write it above, then drag it onto a section`}
                  aria-label={`New part for ${t.name}`}
                  onClick={() => addPart(t)}
                >
                  +
                </button>
              </div>
            </div>
          )
        })}
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

      {drag?.moving && (
        <div className={`arr-ghost ${drag.item.kind}`} style={{ left: drag.x + 14, top: drag.y + 10, ...(drag.item.kind === 'part' && partColor(drag.item.color)) }}>
          {drag.item.label}
        </div>
      )}
    </div>
  )
}
