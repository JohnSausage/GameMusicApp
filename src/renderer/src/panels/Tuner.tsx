import { useEffect, useState } from 'react'
import type { GetEngine } from '../App'
import { InputMonitor } from '../audio/recorder'
import { detectPitch, IN_TUNE_CENTS, median, nearestNote, TUNER_WINDOW } from '../audio/tuner'
import type { Track } from '../model/song'
import { noteName } from '../transcription/notes'
import { useInputDevice, type InputDevice } from './useInputDevice'

/** Readings per second. */
const READ_MS = 80
/** Readings the shown note is the median of. */
const SMOOTHING = 5
/** How long a note stays shown after it has faded. */
const HOLD_MS = 1500

interface Reading {
  pitch: number
  cents: number
  frequency: number
}

interface Props {
  getEngine: GetEngine
  deviceId: string
  /** Open strings to tune (MIDI notes, string 1 first), e.g. of the guitar track being recorded; none for chromatic only. */
  strings?: number[]
  /** Called once the input is open (device names can be listed then). */
  onOpened?: () => void
}

/**
 * Chromatic tuner on the recording input (REQUIREMENTS.md REC-11): the nearest
 * note, how many cents off it is, and which open string that note is.
 */
export function Tuner({ getEngine, deviceId, strings, onOpened }: Props): React.JSX.Element {
  const [reading, setReading] = useState<Reading | null>(null)
  const [fresh, setFresh] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    let monitor: InputMonitor | null = null
    let timer = 0
    let closed = false
    const recent: number[] = []
    let heardAt = 0
    void (async () => {
      try {
        const engine = await getEngine()
        if (closed) return
        monitor = new InputMonitor(engine.ctx, TUNER_WINDOW)
        await monitor.start(deviceId || undefined)
        if (closed) return monitor.stop()
        setError('')
        onOpened?.()
        const samples = new Float32Array(TUNER_WINDOW)
        timer = window.setInterval(() => {
          monitor?.read(samples)
          let peak = 0
          for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
          setLevel(peak)
          const found = detectPitch(samples, engine.ctx.sampleRate)
          const now = performance.now()
          if (!found) {
            setFresh(false)
            if (now - heardAt > HOLD_MS) setReading(null)
            return
          }
          // Another note played: start over rather than average the two.
          if (recent.length > 0 && Math.abs(nearestNote(found.frequency).pitch - nearestNote(median(recent)).pitch) > 1) recent.length = 0
          recent.push(found.frequency)
          if (recent.length > SMOOTHING) recent.shift()
          const frequency = median(recent)
          heardAt = now
          setFresh(true)
          setReading({ ...nearestNote(frequency), frequency })
        }, READ_MS)
      } catch (e) {
        if (!closed) setError(`Could not open the input: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
    return () => {
      closed = true
      window.clearInterval(timer)
      monitor?.stop()
    }
  }, [deviceId, getEngine])

  const inTune = reading !== null && Math.abs(reading.cents) <= IN_TUNE_CENTS
  const cents = reading ? Math.round(reading.cents) : 0
  const advice = !reading ? 'Play a single note.' : inTune ? 'In tune' : `${Math.abs(cents)} cents ${cents < 0 ? 'flat: tune up' : 'sharp: tune down'}`
  // Lowest string first, as tunings are named (E A D G B E).
  const openStrings = (strings ?? []).map((pitch, i) => ({ pitch, string: i + 1 })).reverse()

  return (
    <div className={`tuner ${reading ? '' : 'idle'} ${fresh ? '' : 'faded'}`} aria-live="polite">
      {error ? (
        <p className="warning">{error}</p>
      ) : (
        <>
          <div className={`tuner-note ${inTune ? 'in-tune' : ''}`}>{reading ? noteName(reading.pitch) : '–'}</div>
          <div className="tuner-scale" role="meter" aria-label="Cents off the note" aria-valuemin={-50} aria-valuemax={50} aria-valuenow={cents}>
            <span className="tuner-center" />
            {reading && <span className={`tuner-needle ${inTune ? 'in-tune' : ''}`} style={{ left: `${50 + Math.max(-50, Math.min(50, reading.cents))}%` }} />}
          </div>
          <div className="tuner-marks muted small">
            <span>−50</span>
            <span>flat · sharp</span>
            <span>+50</span>
          </div>
          <p className={`tuner-advice ${inTune ? 'in-tune' : ''}`}>
            {advice}
            {reading && <span className="muted small"> · {reading.frequency.toFixed(1)} Hz</span>}
          </p>
          {openStrings.length > 0 && (
            <div className="tuner-strings" aria-label="Open strings">
              {openStrings.map(({ pitch, string }) => (
                <span key={string} className={`tuner-string ${reading?.pitch === pitch ? (inTune ? 'in-tune' : 'active') : ''}`} title={`String ${string}`}>
                  {noteName(pitch)}
                </span>
              ))}
            </div>
          )}
          <div className="meter tuner-level" title="Input level">
            <div className="meter-fill" style={{ width: `${Math.min(100, level * 100)}%` }} />
          </div>
        </>
      )}
    </div>
  )
}

/** The tuner on its own, from the ☰ menu: with the input to use, and the strings of a guitar or bass track. */
export function TunerDialog({ getEngine, track, onClose }: { getEngine: GetEngine; track?: Track; onClose: () => void }): React.JSX.Element {
  const input = useInputDevice()

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal tuner-dialog" role="dialog" aria-modal="true" aria-label="Tuner">
        <button className="icon modal-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
        <h2>Tuner</h2>
        <InputSelect {...input} />
        <Tuner getEngine={getEngine} deviceId={input.deviceId} strings={track?.tuning} onOpened={input.refresh} />
        {track && <p className="muted small">The open strings of {track.name}{track.capo ? ', without the capo' : ''}.</p>}
      </div>
    </div>
  )
}

/** Which audio input to record from (and tune with). */
export function InputSelect({ devices, deviceId, setDeviceId }: Pick<InputDevice, 'devices' | 'deviceId' | 'setDeviceId'>): React.JSX.Element {
  return (
    <label>
      Input
      <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
        <option value="">Default input</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Input ${d.deviceId.slice(0, 6)}`}
          </option>
        ))}
      </select>
    </label>
  )
}
