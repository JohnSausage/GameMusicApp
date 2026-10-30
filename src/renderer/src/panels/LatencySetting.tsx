import { useEffect, useState } from 'react'
import type { GetEngine } from '../App'
import { CALIBRATION_CLICKS, CALIBRATION_INTERVAL, CALIBRATION_LEAD, measureLatency, recordingLatency, saveRecordingLatency, type RecordingLatency } from '../audio/latency'
import { MicRecorder } from '../audio/recorder'

const ms = (seconds: number): number => Math.round(seconds * 1000)

/**
 * The recording latency (REQUIREMENTS.md REC-07): shown, measured by recording
 * clicks, or typed in. Recordings are lined up with the grid by it.
 */
export function LatencySetting({ getEngine, deviceId }: { getEngine: GetEngine; deviceId: string }): React.JSX.Element {
  const [latency, setLatency] = useState<RecordingLatency | null>(null)
  const [typed, setTyped] = useState('')
  const [measuring, setMeasuring] = useState(false)
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null)

  const show = (value: RecordingLatency): void => {
    setLatency(value)
    setTyped(String(ms(value.seconds)))
  }

  useEffect(() => {
    void getEngine().then((engine) => show(recordingLatency(engine.ctx)))
  }, [getEngine])

  const save = (seconds: number | null): void => {
    saveRecordingLatency(seconds)
    void getEngine().then((engine) => show(recordingLatency(engine.ctx)))
  }

  const measure = async (): Promise<void> => {
    setResult(null)
    setMeasuring(true)
    try {
      const engine = await getEngine()
      const recorder = new MicRecorder(engine.ctx)
      await recorder.start(deviceId || undefined)
      // As when recording a take: clicks are timed from when the recording started.
      const recordStart = engine.ctx.currentTime
      engine.scheduleClicks(recordStart + CALIBRATION_LEAD, CALIBRATION_INTERVAL, CALIBRATION_CLICKS, CALIBRATION_CLICKS)
      await new Promise((resolve) => window.setTimeout(resolve, (CALIBRATION_LEAD + CALIBRATION_CLICKS * CALIBRATION_INTERVAL + 0.5) * 1000))
      const samples = recorder.stop()
      const clickTimes = Array.from({ length: CALIBRATION_CLICKS }, (_, i) => CALIBRATION_LEAD + i * CALIBRATION_INTERVAL)
      const found = measureLatency(samples, engine.ctx.sampleRate, clickTimes)
      if (!found) {
        setResult({ ok: false, text: 'The clicks could not be heard clearly enough. Turn the speakers up, hold the mic closer to them, and try again in a quiet room.' })
      } else {
        save(found.seconds)
        setResult({ ok: true, text: `Measured ${ms(found.seconds)} ms (${found.heard} of ${CALIBRATION_CLICKS} clicks, ±${ms(found.spread)} ms). Recordings use it from now on.` })
      }
    } catch (e) {
      setResult({ ok: false, text: `Could not measure: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setMeasuring(false)
    }
  }

  return (
    <div className="latency-setting">
      <div className="form-row">
        <label>
          Recording latency (ms)
          <input
            type="number"
            min={0}
            max={999}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value)
              const value = Number(e.target.value)
              if (e.target.value !== '' && Number.isFinite(value) && value >= 0 && value < 1000) save(value / 1000)
            }}
          />
        </label>
        <button onClick={() => void measure()} disabled={measuring}>
          {measuring ? 'Listening…' : 'Measure'}
        </button>
        {latency?.measured && (
          <button onClick={() => save(null)} title="Forget the measured latency and use what the audio output reports">
            Use the estimate
          </button>
        )}
      </div>
      <p className="muted small">
        {latency && !latency.measured && 'Estimated from what the audio output reports, which leaves out the input. '}
        How much later a note played on the click arrives in the recording; takes are lined up by it. To measure it, turn the speakers up and hold the mic close to them: {CALIBRATION_CLICKS} clicks play and are timed. With headphones, play a muted string exactly on each click instead.
      </p>
      {result && <p className={result.ok ? 'success' : 'warning'}>{result.text}</p>}
    </div>
  )
}
