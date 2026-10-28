import { useEffect, useState } from 'react'
import { renderEffect } from '../audio/offline'
import { encodeWav16 } from '../audio/wav'
import { effectFileNames, effectSeconds } from '../model/effects'
import type { SoundEffect } from '../model/song'
import { saveFile, saveFiles, type NamedFile } from '../platform'
import { readPref, writePref } from '../prefs'

interface Props {
  effects: SoundEffect[]
  /** The effect picked in the list, to export on its own. */
  selected: string | null
  onClose: (message?: string) => void
}

const RATES = [48000, 44100]

interface Settings {
  rate: number
  mono: boolean
  normalize: boolean
}

const SETTINGS_KEY = 'effectExport'
const DEFAULT_SETTINGS: Settings = { rate: 48000, mono: true, normalize: false }

/** The sound effects as WAV files: all of them into a folder, or one (REQUIREMENTS.md SYN-37). */
export function EffectExportDialog({ effects, selected, onClose }: Props): React.JSX.Element {
  const one = effects.find((e) => e.id === selected) ?? null
  const [which, setWhich] = useState<'all' | 'one'>('all')
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...readPref<Partial<Settings>>(SETTINGS_KEY, {}) }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { rate, mono, normalize } = settings
  const change = (next: Partial<Settings>): void => setSettings((s) => ({ ...s, ...next }))

  // The same effect always gets the same file name, whether exported alone or with the others.
  const names = effectFileNames(effects)
  const chosen = which === 'one' && one ? [one] : effects
  const withNotes = chosen.filter((e) => effectSeconds(e) > 0)
  const withoutNotes = chosen.filter((e) => effectSeconds(e) === 0).map((e) => e.name)
  const fileNames = withNotes.map((e) => names[effects.indexOf(e)])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const exportWavs = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const files: NamedFile[] = []
      const silent: string[] = [...withoutNotes]
      for (const effect of withNotes) {
        const audio = await renderEffect(effect, rate, { mono, normalize })
        if (audio) files.push({ name: names[effects.indexOf(effect)], data: encodeWav16(audio, rate) })
        else silent.push(effect.name)
      }
      if (files.length === 0) {
        setError('Nothing to export: these sound effects make no sound.')
        setBusy(false)
        return
      }
      writePref(SETTINGS_KEY, settings)
      const where = which === 'one' ? await saveFile(files[0].name, files[0].data) : await saveFiles(files)
      if (!where) {
        setBusy(false)
        return
      }
      const saved = which === 'one' ? `WAV saved: ${where}` : `${files.length} sound ${files.length === 1 ? 'effect' : 'effects'} saved as WAV in ${where}.`
      onClose(silent.length > 0 ? `${saved} Left out, they make no sound: ${silent.join(', ')}.` : saved)
    } catch (e) {
      setError(`WAV export failed: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal export-dialog" role="dialog" aria-modal="true" aria-label="Export sound effects">
        <button className="icon modal-close" aria-label="Close" title="Close (Esc)" onClick={() => onClose()} disabled={busy}>
          ×
        </button>
        <h2>Export sound effects</h2>

        <fieldset className="choice-group">
          <legend>What</legend>
          <label className="checkbox">
            <input type="radio" name="which" checked={which === 'all'} onChange={() => setWhich('all')} />
            <span>
              <strong>All {effects.length} sound effects,</strong> one WAV file each, into a folder you choose. Files there with the same names are replaced, so exporting
              again updates them in your game.
            </span>
          </label>
          <label className="checkbox">
            <input type="radio" name="which" checked={which === 'one'} disabled={!one} onChange={() => setWhich('one')} />
            <span>
              <strong>Only “{one?.name ?? '…'}”</strong>, the one picked in the list.
            </span>
          </label>
        </fieldset>

        <div className="form-row">
          <label>
            Sample rate
            <select value={rate} onChange={(e) => change({ rate: Number(e.target.value) })}>
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r / 1000} kHz, 16-bit
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="choice-group">
          <legend>Sound</legend>
          <label className="checkbox">
            <input type="checkbox" checked={mono} onChange={(e) => change({ mono: e.target.checked })} />
            <span>
              <strong>Mono.</strong> One channel, as games mostly play sound effects (the game places them left or right); half the size.
            </span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={normalize} onChange={(e) => change({ normalize: e.target.checked })} />
            <span>
              <strong>As loud as possible.</strong> Each one peaks at −1 dB. Without it they keep the loudness you hear here, compared to each other.
            </span>
          </label>
        </fieldset>

        <p className="muted small">
          Each file starts with the first beat and ends when the sound has faded, with a tiny fade.
          {fileNames.length > 0 && <> Files: {fileNames.join(', ')}.</>}
          {withoutNotes.length > 0 && <> Without notes, left out: {withoutNotes.join(', ')}.</>}
        </p>
        {error && <p className="warning dialog-error">{error}</p>}

        <div className="toolbar dialog-actions">
          <span className="spacer" />
          <button onClick={() => onClose()} disabled={busy}>
            Cancel
          </button>
          <button className="active" disabled={busy || withNotes.length === 0} onClick={() => void exportWavs()}>
            {busy ? 'Rendering…' : 'Export…'}
          </button>
        </div>
      </div>
    </div>
  )
}
