import { useEffect, useMemo, useState } from 'react'
import type { Cursor, EditResult } from '../model/edit'
import { MAX_TIMES, orderText, playOrder, repeatAt, setRepeat } from '../model/repeats'
import { barCount, type Song } from '../model/song'

interface Props {
  song: Song
  cursor: Cursor
  bar: number
  onApply: (result: EditResult) => void
  onClose: () => void
}

/** Endings offered: the first four times through. */
const ENDINGS = [1, 2, 3, 4]
const ORDINALS = ['1st', '2nd', '3rd', '4th']

/** Repeat signs and endings at a bar (REQUIREMENTS.md EDIT-14), with the order the bars then play in. */
export function RepeatDialog({ song, cursor, bar, onApply, onClose }: Props): React.JSX.Element {
  const signs = repeatAt(song, bar)
  const [start, setStart] = useState(!!signs?.start)
  const [end, setEnd] = useState(!!signs?.times)
  const [times, setTimes] = useState(signs?.times ?? 2)
  const [ending, setEnding] = useState<number[]>(signs?.ending ?? [])
  const result = useMemo(
    () => setRepeat(song, cursor, bar, { ...(start && { start }), ...(end && { times }), ...(ending.length > 0 && { ending }) }),
    [song, cursor, bar, start, end, times, ending]
  )
  const order = orderText(playOrder(result?.song ?? song, barCount(song)))
  const removed = useMemo(() => (signs ? setRepeat(song, cursor, bar, {}) : null), [song, cursor, bar, signs])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const toggleEnding = (n: number): void => setEnding((list) => (list.includes(n) ? list.filter((e) => e !== n) : [...list, n].sort((a, b) => a - b)))

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal repeat-dialog" role="dialog" aria-modal="true" aria-label="Repeat and endings">
        <button className="icon modal-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
        <h2>Repeat and endings at bar {bar + 1}</h2>
        <label className="checkbox">
          <input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} autoFocus />
          A repeat starts at this bar (‖:)
        </label>
        <div className="form-row">
          <label className="checkbox">
            <input type="checkbox" checked={end} onChange={(e) => setEnd(e.target.checked)} />
            A repeat ends with this bar (:‖), played
          </label>
          <label>
            <input type="number" min={2} max={MAX_TIMES} value={times} disabled={!end} aria-label="Times played in all"
              onChange={(e) => setTimes(Math.min(MAX_TIMES, Math.max(2, Math.round(Number(e.target.value)) || 2)))} />
            times in all
          </label>
        </div>
        <fieldset className="choice-group">
          <legend>Ending: this bar plays only the</legend>
          <div className="toolbar compact">
            {ENDINGS.map((n, i) => (
              <label key={n} className="checkbox">
                <input type="checkbox" checked={ending.includes(n)} onChange={() => toggleEnding(n)} />
                {ORDINALS[i]}
              </label>
            ))}
            <span className="muted small">time through (none: every time)</span>
          </div>
        </fieldset>
        <p className="muted small">
          {start || end || ending.length > 0 || (song.repeats?.length ?? 0) > 0 ? `The bars play in this order: ${order}.` : 'No repeats: the bars play once, in order.'} A repeat without a start sign goes back to the start of
          the song, or to the bar after the last repeat.
        </p>
        <div className="toolbar dialog-actions">
          {removed && (
            <button onClick={() => onApply(removed)} title="Take the repeat signs and endings off this bar">
              Remove from this bar
            </button>
          )}
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="active" disabled={!result} onClick={() => result && onApply(result)}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
