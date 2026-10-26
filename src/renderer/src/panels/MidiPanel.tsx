import { useEffect, useRef, useState } from 'react'
import type { GetEngine } from '../App'
import type { LatencyInfo } from '../audio/engine'
import { COMPUTER_KEYS, MidiKeyboard, type MidiNoteMessage } from '../midi/midiInput'
import { GM_ACOUSTIC_GUITAR_STEEL, type Instrument } from '../model/song'
import { factoryPreset } from '../model/synth'
import type { AudioLatency, SettingsState } from '../platform'
import { noteName } from '../transcription/notes'

const INSTRUMENTS: { label: string; instrument: Instrument }[] = [
  ...['8-bit lead', '8-bit thin lead', 'Triangle bass', 'PWM lead', 'Soft pad'].map((name) => ({ label: `Synth: ${name}`, instrument: { kind: 'synth' as const, patch: factoryPreset(name) } })),
  { label: 'SoundFont: acoustic grand piano', instrument: { kind: 'soundfont', program: 0 } },
  { label: 'SoundFont: steel-string guitar', instrument: { kind: 'soundfont', program: GM_ACOUSTIC_GUITAR_STEEL } }
]

const LATENCY_LABELS: Record<AudioLatency, string> = { low: 'Low latency', standard: 'Standard' }

/** Audio buffer setting (SET-01); Chromium reads it at startup, so changes need a restart. */
function AudioLatencySetting(): React.JSX.Element | null {
  const bridge = window.gameMusicApp
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void bridge?.settings.get().then(setSettings)
  }, [bridge])

  if (!bridge) return null
  if (!settings) return null

  const choose = async (audioLatency: AudioLatency): Promise<void> => {
    setError('')
    try {
      const saved = await bridge.settings.set({ audioLatency })
      setSettings({ ...settings, saved })
    } catch (e) {
      setError(`Could not save the setting: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const option = (value: AudioLatency, text: React.ReactNode): React.JSX.Element => (
    <label className="checkbox">
      <input type="radio" name="audio-latency" checked={settings.saved.audioLatency === value} onChange={() => void choose(value)} />
      <span>
        <strong>{LATENCY_LABELS[value]}</strong>
        {settings.defaults.audioLatency === value && <span className="muted"> (default)</span>}. {text}
      </span>
    </label>
  )

  return (
    <div className="card">
      <h3>Audio latency</h3>
      <fieldset className="choice-group">
        <legend>Audio buffer</legend>
        {option('low', 'A 256-sample buffer: best for playing the MIDI keyboard live. On Linux about 30 ms from key to sound instead of 50 ms.')}
        {option('standard', 'The browser engine’s default buffer. Choose this if playback crackles or drops out, e.g. in big songs.')}
      </fieldset>
      {settings.saved.audioLatency !== settings.active.audioLatency ? (
        <p className="warning">
          Restart GameMusicApp to use “{LATENCY_LABELS[settings.saved.audioLatency]}”.{' '}
          <button onClick={() => void bridge.restart()}>Restart now</button>
        </p>
      ) : (
        <p className="muted small">In use now: {LATENCY_LABELS[settings.active.audioLatency]}. Changes apply after a restart.</p>
      )}
      {error && <p className="warning">{error}</p>}
    </div>
  )
}

export function MidiPanel({ getEngine }: { getEngine: GetEngine }): React.JSX.Element {
  const [devices, setDevices] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const [instrumentIndex, setInstrumentIndex] = useState(0)
  const [lastNote, setLastNote] = useState<MidiNoteMessage | null>(null)
  const [latency, setLatency] = useState<LatencyInfo | null>(null)
  const instrument = INSTRUMENTS[instrumentIndex].instrument
  const instrumentRef = useRef(instrument)
  instrumentRef.current = instrument
  const keyboard = useRef<MidiKeyboard | null>(null)

  const noteOn = async (pitch: number, velocity: number): Promise<void> => {
    const engine = await getEngine()
    engine.liveNoteOn(instrumentRef.current, pitch, velocity)
    setLatency(engine.latency)
  }
  const noteOff = async (pitch: number): Promise<void> => (await getEngine()).liveNoteOff(instrumentRef.current, pitch)

  const connect = async (): Promise<void> => {
    setError('')
    try {
      await getEngine() // load the synth before the first key press
      const midi = new MidiKeyboard()
      midi.onNote = (message) => {
        if (message.type === 'on') {
          setLastNote(message)
          void noteOn(message.pitch, message.velocity)
        } else void noteOff(message.pitch)
      }
      midi.onDevicesChanged = setDevices
      setDevices(await midi.connect())
      keyboard.current = midi
    } catch (e) {
      setError(`MIDI not available: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Computer keyboard fallback, active while this tab is open.
  useEffect(() => {
    const held = new Set<string>()
    const down = (event: KeyboardEvent): void => {
      const pitch = COMPUTER_KEYS[event.key.toLowerCase()]
      if (pitch === undefined || event.repeat || held.has(event.key) || event.target instanceof HTMLInputElement) return
      held.add(event.key)
      void noteOn(pitch, 100)
    }
    const up = (event: KeyboardEvent): void => {
      const pitch = COMPUTER_KEYS[event.key.toLowerCase()]
      if (pitch === undefined) return
      held.delete(event.key)
      void noteOff(pitch)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  })

  const estimatedTotal = latency ? (lastNote?.handlerDelayMs ?? 0) + latency.baseLatencyMs + latency.outputLatencyMs : null

  return (
    <section className="panel">
      <h2>MIDI keyboard</h2>
      <div className="form-row">
        <button onClick={() => void connect()}>{devices ? 'Reconnect' : 'Connect MIDI keyboard'}</button>
        <label>
          Sound
          <select value={instrumentIndex} onChange={(e) => setInstrumentIndex(Number(e.target.value))}>
            {INSTRUMENTS.map((x, i) => (
              <option key={x.label} value={i}>{x.label}</option>
            ))}
          </select>
        </label>
      </div>
      {devices && <p className="muted">Devices: {devices.length ? devices.join(', ') : 'none found – plug in your keyboard (hot-plugging works)'}</p>}
      {error && <p className="warning">{error}</p>}
      <p className="muted">No MIDI keyboard at hand? Keys A W S E D F T G Y H U J K play C4 to C5.</p>

      <div className="card">
        <h3>Last note</h3>
        <p className="big">{lastNote ? `${noteName(lastNote.pitch)} · velocity ${lastNote.velocity} · ${lastNote.inputName}` : '–'}</p>
        {latency && (
          <table className="metrics">
            <tbody>
              <tr><td>MIDI event → handler</td><td>{lastNote ? `${lastNote.handlerDelayMs.toFixed(1)} ms` : '–'}</td></tr>
              <tr><td>Audio base latency</td><td>{latency.baseLatencyMs.toFixed(1)} ms</td></tr>
              <tr><td>Audio output latency</td><td>{latency.outputLatencyMs.toFixed(1)} ms</td></tr>
              <tr><td><strong>Estimated key → sound</strong></td><td><strong>{estimatedTotal === null ? '–' : `${estimatedTotal.toFixed(1)} ms`}</strong> (goal ≤ 30 ms, limit 50 ms)</td></tr>
              <tr><td>Sample rate</td><td>{latency.sampleRate} Hz</td></tr>
            </tbody>
          </table>
        )}
      </div>

      <AudioLatencySetting />
    </section>
  )
}
