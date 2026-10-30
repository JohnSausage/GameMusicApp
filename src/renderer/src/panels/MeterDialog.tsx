import { useEffect, useMemo, useState } from 'react'
import type { Cursor } from '../model/edit'
import { changeAt, meterAt, setMeter, type MeterEdit } from '../model/meter'
import type { Song } from '../model/song'
import { TIME_SIGNATURES } from '../model/timeSignature'

interface Props {
  song: Song
  cursor: Cursor
  /** The bar the change is at (1 or later). */
  bar: number
  onApply: (edit: MeterEdit) => void
  onClose: () => void
}

const signatureValue = ([beats, unit]: [number, number]): string => `${beats}/${unit}`
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Tempo and time signature from a bar on (REQUIREMENTS.md PRJ-04). */
export function MeterDialog({ song, cursor, bar, onApply, onClose }: Props): React.JSX.Element {
  const now = meterAt(song, bar)
  const before = meterAt(song, bar - 1)
  const existing = changeAt(song, bar)
  const [tempo, setTempo] = useState(String(now.tempo))
  const [signature, setSignature] = useState<[number, number]>(now.timeSignature)
  const tempoValue = Number(tempo)
  const validTempo = Number.isFinite(tempoValue) && tempoValue >= 20 && tempoValue <= 400
  const signatures = [now.timeSignature, before.timeSignature].reduce(
    (list, ts) => (list.some((s) => signatureValue(s) === signatureValue(ts)) ? list : [...list, ts]),
    TIME_SIGNATURES
  )
  const result = useMemo(
    () => (validTempo ? setMeter(song, cursor, bar, { tempo: tempoValue, timeSignature: signature }) : null),
    [song, cursor, bar, validTempo, tempoValue, signature]
  )
  const removed = useMemo(() => (existing ? setMeter(song, cursor, bar, before) : null), [song, cursor, bar, existing])
  const following = song.changes?.find((c) => c.bar > bar)
  // The bars that take the time signature: up to the next bar with one of its own.
  const next = song.changes?.find((c) => c.bar > bar && c.timeSignature)?.bar ?? null
  const newSignature = signatureValue(signature) !== signatureValue(now.timeSignature)
  const lost = result ? result.removed + result.shortened : 0

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal meter-dialog" role="dialog" aria-modal="true" aria-label="Tempo and time signature">
        <button className="icon modal-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
        <h2>From bar {bar + 1} on</h2>
        <p className="muted small">
          Until bar {bar} it is {before.tempo} BPM in {signatureValue(before.timeSignature)}. What you set here holds until{' '}
          {following ? `bar ${following.bar + 1}, where it changes again` : 'the end of the song'}.
        </p>
        <div className="form-row">
          <label>
            Tempo (BPM)
            <input type="number" min={20} max={400} value={tempo} onChange={(e) => setTempo(e.target.value)} autoFocus />
          </label>
          <label>
            Time signature
            <select value={signatureValue(signature)} onChange={(e) => setSignature(signatures.find((ts) => signatureValue(ts) === e.target.value) ?? signature)}>
              {signatures.map((ts) => (
                <option key={signatureValue(ts)} value={signatureValue(ts)}>
                  {signatureValue(ts)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!validTempo && <p className="warning">The tempo goes from 20 to 400 BPM.</p>}
        {newSignature && result && (
          <p className="muted small">
            {next === null ? `The bars from bar ${bar + 1} on` : next === bar + 1 ? `Bar ${bar + 1}` : `Bars ${bar + 1}–${next}`} become {signatureValue(signature)}. Each keeps its
            notes from its start
            {result.fitted === 0
              ? '.'
              : lost > 0
                ? `; ${plural(lost, 'note')} no longer fit${lost === 1 ? 's' : ''} and ${lost === 1 ? 'is' : 'are'} cut (Ctrl+Z brings ${lost === 1 ? 'it' : 'them'} back).`
                : `; ${plural(result.fitted, 'bar')} ${result.fitted === 1 ? 'gets' : 'get'} ${wholeNotes(signature) > wholeNotes(now.timeSignature) ? 'rests at the end' : 'shorter, losing only rests'}.`}
          </p>
        )}

        <div className="toolbar dialog-actions">
          {removed && (
            <button onClick={() => onApply(removed)} title={`Back to ${before.tempo} BPM in ${signatureValue(before.timeSignature)}, as before bar ${bar + 1}`}>
              Remove the change
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

/** How long a bar of a time signature is, in whole notes. */
const wholeNotes = ([beats, unit]: [number, number]): number => beats / unit
