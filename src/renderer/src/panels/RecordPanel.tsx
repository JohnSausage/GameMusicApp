import { useEffect, useRef, useState } from 'react'
import type { GetEngine } from '../App'
import { importAudioFile, listInputDevices, MicRecorder, takeToAudioBuffer, type InputSettings, type Take } from '../audio/recorder'
import { encodeWav16 } from '../audio/wav'
import { saveFile } from '../platform'

const BEATS_PER_BAR = 4
/** Metronome clicks are scheduled up front for this long. */
const MAX_CLICK_SECONDS = 600

interface Props {
  getEngine: GetEngine
  take: Take | null
  onTake: (take: Take) => void
  onUseInLab: (take: Take) => void
}

function formatSettings(s: InputSettings): string {
  const flag = (value: boolean | undefined): string => (value === undefined ? 'n/a' : value ? 'ON' : 'off')
  return `${s.deviceLabel || 'default input'} · ${s.sampleRate ?? '?'} Hz · echo cancellation ${flag(s.echoCancellation)} · noise suppression ${flag(s.noiseSuppression)} · auto gain ${flag(s.autoGainControl)}`
}

export function RecordPanel({ getEngine, take, onTake, onUseInLab }: Props): React.JSX.Element {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [tempo, setTempo] = useState(100)
  const [metronome, setMetronome] = useState(true)
  const [recording, setRecording] = useState(false)
  const [level, setLevel] = useState(0)
  const [clipped, setClipped] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [inputSettings, setInputSettings] = useState<InputSettings | null>(null)
  const [error, setError] = useState('')
  const [playingTake, setPlayingTake] = useState<(() => void) | null>(null)
  const session = useRef<{ recorder: MicRecorder; stopClicks: (() => void) | null; firstDownbeat: number; startedAt: number; timer: number } | null>(null)

  const refreshDevices = async (): Promise<void> => setDevices(await listInputDevices())
  useEffect(() => {
    void refreshDevices()
  }, [])

  const start = async (): Promise<void> => {
    setError('')
    setClipped(false)
    try {
      const engine = await getEngine()
      const recorder = new MicRecorder(engine.ctx)
      recorder.onLevel = (peak) => {
        setLevel(peak)
        if (peak >= 0.99) setClipped(true)
      }
      await recorder.start(deviceId || undefined)
      setInputSettings(recorder.inputSettings)
      void refreshDevices() // labels become available after permission is granted
      const recordStart = engine.ctx.currentTime
      const clickStart = recordStart + 0.2
      const countInSeconds = (BEATS_PER_BAR * 60) / tempo
      const stopClicks = metronome ? engine.scheduleClicks(clickStart, tempo, Math.ceil((MAX_CLICK_SECONDS * tempo) / 60), BEATS_PER_BAR) : null
      const startedAt = performance.now()
      const timer = window.setInterval(() => setElapsed((performance.now() - startedAt) / 1000), 100)
      session.current = { recorder, stopClicks, firstDownbeat: metronome ? clickStart - recordStart + countInSeconds : 0, startedAt, timer }
      setRecording(true)
    } catch (e) {
      setError(`Could not start recording: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const stop = async (): Promise<void> => {
    const s = session.current
    if (!s) return
    session.current = null
    window.clearInterval(s.timer)
    s.stopClicks?.()
    const samples = s.recorder.stop()
    const engine = await getEngine()
    setRecording(false)
    setLevel(0)
    onTake({ name: `Recording ${new Date().toLocaleTimeString()}`, samples, sampleRate: engine.ctx.sampleRate, tempo, firstDownbeat: s.firstDownbeat })
  }

  const importFile = async (file: File): Promise<void> => {
    setError('')
    try {
      const engine = await getEngine()
      const { samples, sampleRate } = await importAudioFile(engine.ctx, file)
      onTake({ name: file.name, samples, sampleRate, tempo, firstDownbeat: 0 })
    } catch (e) {
      setError(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const togglePlayTake = async (): Promise<void> => {
    if (playingTake) {
      playingTake()
      setPlayingTake(null)
      return
    }
    if (!take) return
    const engine = await getEngine()
    const stopFn = engine.playBuffer(takeToAudioBuffer(engine.ctx, take), () => setPlayingTake(null))
    setPlayingTake(() => stopFn)
  }

  return (
    <section className="panel">
      <h2>Record from the microphone</h2>
      <p className="muted">Use headphones so the metronome doesn't end up in the recording. Quiet room, mic about 20–30 cm from where the neck meets the body.</p>
      <div className="form-row">
        <label>
          Input
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={recording}>
            <option value="">Default input</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${d.deviceId.slice(0, 6)}`}</option>
            ))}
          </select>
        </label>
        <label>
          Tempo (BPM)
          <input type="number" min={30} max={300} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} disabled={recording} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={metronome} onChange={(e) => setMetronome(e.target.checked)} disabled={recording} />
          Metronome with 1-bar count-in
        </label>
        {recording ? <button className="danger" onClick={() => void stop()}>■ Stop ({elapsed.toFixed(1)} s)</button> : <button onClick={() => void start()}>● Record</button>}
      </div>
      <div className="meter">
        <div className={`meter-fill ${clipped ? 'clipped' : ''}`} style={{ width: `${Math.min(100, level * 100)}%` }} />
      </div>
      {clipped && <p className="warning">Input is clipping – lower the gain.</p>}
      {inputSettings && <p className="muted small">Active input: {formatSettings(inputSettings)}</p>}

      <h2>Import a WAV file</h2>
      <p className="muted">E.g. exported from Audacity. Set the tempo above first; the first downbeat can be adjusted in the transcription lab.</p>
      <input type="file" accept="audio/*,.wav" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />

      {error && <p className="warning">{error}</p>}

      {take && (
        <div className="card">
          <h3>Current take: {take.name}</h3>
          <p className="muted">
            {(take.samples.length / take.sampleRate).toFixed(1)} s · {take.sampleRate} Hz · {take.tempo} BPM · first downbeat at {take.firstDownbeat.toFixed(2)} s
          </p>
          <div className="toolbar">
            <button onClick={() => void togglePlayTake()}>{playingTake ? '■ Stop' : '▶ Play take'}</button>
            <button onClick={() => void saveFile('take.wav', encodeWav16([take.samples], take.sampleRate))}>Save as WAV</button>
            <button onClick={() => onUseInLab(take)}>Open in transcription lab →</button>
          </div>
        </div>
      )}
    </section>
  )
}
