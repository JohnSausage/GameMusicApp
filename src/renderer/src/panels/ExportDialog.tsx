import { useEffect, useState } from 'react'
import { renderSongOffline } from '../audio/offline'
import { audioBufferToWav16 } from '../audio/wav'
import { sectionRanges, type BarRange } from '../model/edit'
import { audibleTracks, barCount, type Song } from '../model/song'
import { barSeconds, EXPORT_TAIL_SECONDS, exportFrameCount, type ExportEnding } from '../model/timing'
import { saveFile } from '../platform'

interface Props {
  song: Song
  /** Bars of the selection, or of the bar at the cursor. */
  bars: BarRange
  /** Section the cursor is in, if any. */
  section: string | null
  onClose: (message?: string) => void
}

const RATES = [48000, 44100]

/** WAV export of the whole song, a section or a bar range (REQUIREMENTS.md EXP-01…05). */
export function ExportDialog({ song, bars, section, onClose }: Props): React.JSX.Element {
  const sections = sectionRanges(song)
  const total = barCount(song)
  const [choice, setChoice] = useState<string>(() => {
    const index = sections.findIndex((s) => s.name === section)
    return bars.end - bars.start > 1 ? 'bars' : index >= 0 ? `section:${index}` : 'song'
  })
  const [from, setFrom] = useState(bars.start + 1)
  const [to, setTo] = useState(bars.end)
  const [rate, setRate] = useState(48000)
  /** Until chosen by hand: ring out for the whole song, cut (loopable) for parts of it. */
  const [ending, setEnding] = useState<ExportEnding | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const range: BarRange & { name: string | null } =
    choice === 'song'
      ? { start: 0, end: total, name: null }
      : choice === 'bars'
        ? { start: Math.min(from, to) - 1, end: Math.max(from, to), name: from === to ? `bar ${from}` : `bars ${Math.min(from, to)}-${Math.max(from, to)}` }
        : sections[Number(choice.slice(8))]
  const end: ExportEnding = ending ?? (choice === 'song' ? 'tail' : 'cut')
  const seconds = { start: range.start * barSeconds(song), end: range.end * barSeconds(song) }
  const frames = exportFrameCount(seconds, rate, end)
  const barsValid = choice !== 'bars' || (from >= 1 && to >= 1 && from <= total && to <= total)
  const silent = song.tracks.filter((_, i) => !audibleTracks(song)[i]).map((t) => t.name)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const exportWav = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const buffer = await renderSongOffline(song, rate, { range: seconds, ending: end })
      const name = range.name ? `${song.title} - ${range.name}` : song.title
      const path = await saveFile(`${name}.wav`, audioBufferToWav16(buffer))
      if (path) onClose(`WAV saved: ${path}`)
      else setBusy(false)
    } catch (e) {
      setError(`WAV export failed: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }

  const barCountText = (n: number): string => `${n} ${n === 1 ? 'bar' : 'bars'}`

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal export-dialog" role="dialog" aria-modal="true" aria-label="Export WAV">
        <button className="icon modal-close" aria-label="Close" title="Close (Esc)" onClick={() => onClose()} disabled={busy}>
          ×
        </button>
        <h2>Export WAV</h2>

        <div className="form-row">
          <label>
            What
            <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="What to export">
              <option value="song">Whole song ({barCountText(total)})</option>
              {sections.map((s, i) => (
                <option key={`${s.name}-${s.start}`} value={`section:${i}`}>
                  Section “{s.name}” (bars {s.start + 1}–{s.end})
                </option>
              ))}
              <option value="bars">Bars…</option>
            </select>
          </label>
          {choice === 'bars' && (
            <>
              <label>
                From bar
                <input type="number" min={1} max={total} value={from} onChange={(e) => setFrom(Number(e.target.value))} />
              </label>
              <label>
                To bar
                <input type="number" min={1} max={total} value={to} onChange={(e) => setTo(Number(e.target.value))} />
              </label>
            </>
          )}
          <label>
            Sample rate
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              {RATES.map((r) => (
                <option key={r} value={r}>{r / 1000} kHz, 16-bit</option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="choice-group">
          <legend>Ending</legend>
          <label className="checkbox">
            <input type="radio" name="ending" checked={end === 'cut'} onChange={() => setEnding('cut')} />
            <span>
              <strong>Cut at the end, for looping.</strong> Ends exactly at the last bar line with a tiny fade, so it loops without a gap (in Unity: tick <em>Loop</em> on
              the AudioSource). Notes still ringing at the end are cut off.
            </span>
          </label>
          <label className="checkbox">
            <input type="radio" name="ending" checked={end === 'tail'} onChange={() => setEnding('tail')} />
            <span>
              <strong>Let notes ring out.</strong> Adds {EXPORT_TAIL_SECONDS} s after the last bar, e.g. for a song that plays once.
            </span>
          </label>
        </fieldset>

        <p className="muted small">
          {barCountText(range.end - range.start)} · {(seconds.end - seconds.start).toFixed(2)} s{end === 'tail' ? ` + ${EXPORT_TAIL_SECONDS} s` : ''} · {frames.toLocaleString('en-US')} samples per
          channel, stereo
          {silent.length > 0 && <> · Muted, left out: {silent.join(', ')}</>}
        </p>
        {error && <p className="warning dialog-error">{error}</p>}

        <div className="toolbar dialog-actions">
          <span className="spacer" />
          <button onClick={() => onClose()} disabled={busy}>Cancel</button>
          <button className="active" disabled={busy || !barsValid} onClick={() => void exportWav()}>
            {busy ? 'Rendering…' : 'Export…'}
          </button>
        </div>
      </div>
    </div>
  )
}
