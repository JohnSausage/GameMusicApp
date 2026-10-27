import { useEffect, useMemo, useRef, useState } from 'react'
import type { GetEngine } from '../App'
import { detectFirstOnset, secondsPerClick } from '../audio/analysis'
import { importAudioFile, listInputDevices, MicRecorder, samplesToBuffer } from '../audio/recorder'
import { barsHaveNotes, removeTake, writeBars } from '../model/edit'
import { isFretted, newId, takeSeconds, type Song, type TakeInfo } from '../model/song'
import type { Project } from '../project/useProject'
import { ScoreView } from '../score/ScoreView'
import { extractNotes, runBasicPitch, type ModelOutput, type Sensitivity } from '../transcription/basicPitch'
import { transcribeToBars } from '../transcription/toTab'
import { usePlayback } from './usePlayback'
import { Waveform } from './Waveform'

const MAX_RECORDING_SECONDS = 600
/** Highest fret considered when transcribing (acoustic guitars usually have 20). */
const TRANSCRIBE_MAX_FRET = 20

interface PendingTake {
  info: TakeInfo
  samples: Float32Array
}

type Step = { kind: 'source' } | { kind: 'recording' } | { kind: 'align' } | { kind: 'transcribing'; progress: number } | { kind: 'preview'; model: ModelOutput }

interface Props {
  project: Project
  getEngine: GetEngine
  /** Closes the dialog; `message` is shown in the editor. */
  onClose: (message?: string) => void
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * Record or import a take, line up beat 1, transcribe it with Basic Pitch and
 * insert the result into a track (REQUIREMENTS.md REC-01…REC-21, TRN-01…TRN-11).
 */
export function TakeDialog({ project, getEngine, onClose }: Props): React.JSX.Element {
  const { song, cursor } = project
  const [step, setStep] = useState<Step>({ kind: 'source' })
  const [take, setTake] = useState<PendingTake | null>(null)
  const [error, setError] = useState('')

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [metronome, setMetronome] = useState(true)
  const [level, setLevel] = useState(0)
  const [clipped, setClipped] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const recording = useRef<{ recorder: MicRecorder; stopClicks: (() => void) | null; firstDownbeat: number | null; timer: number } | null>(null)

  const [sensitivity, setSensitivity] = useState<Sensitivity>('normal')
  const [stepsPerQuarter, setStepsPerQuarter] = useState(4)
  const [preferredFret, setPreferredFret] = useState(3)
  // Transcriptions go into fretted tracks only, not drums.
  const [targetTrack, setTargetTrack] = useState(() => (isFretted(song.tracks[cursor.track]) ? cursor.track : Math.max(0, song.tracks.findIndex(isFretted))))
  const [startBar, setStartBar] = useState(cursor.bar + 1)
  const models = useRef(new Map<string, ModelOutput>())

  const playback = usePlayback(getEngine)
  const stopAudio = useRef<(() => void) | null>(null)
  const [audioPlaying, setAudioPlaying] = useState(false)

  const clicksPerBar = song.timeSignature[0]
  const clickSeconds = secondsPerClick(take?.info.tempo ?? song.tempo, song.timeSignature)
  const track = song.tracks[targetTrack]

  useEffect(() => {
    void listInputDevices().then(setDevices)
  }, [])

  const stopPlaying = (): void => {
    stopAudio.current?.()
    stopAudio.current = null
    setAudioPlaying(false)
    playback.stop()
  }

  // Stop everything when the dialog closes.
  useEffect(
    () => () => {
      stopAudio.current?.()
      const r = recording.current
      if (r) {
        window.clearInterval(r.timer)
        r.stopClicks?.()
        r.recorder.stop()
      }
    },
    []
  )

  const close = (message?: string): void => {
    if (step.kind === 'recording') return
    stopPlaying()
    onClose(message)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const newTakeInfo = (name: string, sampleRate: number, firstDownbeat: number): TakeInfo => ({
    id: newId(),
    name,
    sampleRate,
    tempo: song.tempo,
    firstDownbeat,
    createdAt: new Date().toISOString()
  })

  // ------------------------------------------------------------ sources

  const startRecording = async (): Promise<void> => {
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
      void listInputDevices().then(setDevices) // labels appear once access is granted
      const recordStart = engine.ctx.currentTime
      const clickStart = recordStart + 0.3
      const songClick = secondsPerClick(song.tempo, song.timeSignature)
      const countIn = clicksPerBar * songClick
      // Estimate of where the first downbeat lands in the recording; refine it in the next step.
      const latency = (engine.ctx.outputLatency || 0) + engine.ctx.baseLatency
      const startedAt = performance.now()
      recording.current = {
        recorder,
        stopClicks: metronome ? engine.scheduleClicks(clickStart, songClick, Math.ceil(MAX_RECORDING_SECONDS / songClick), clicksPerBar) : null,
        firstDownbeat: metronome ? clickStart - recordStart + countIn + latency : null,
        timer: window.setInterval(() => {
          const seconds = (performance.now() - startedAt) / 1000
          setElapsed(seconds)
          if (seconds >= MAX_RECORDING_SECONDS) void stopRecording()
        }, 100)
      }
      setStep({ kind: 'recording' })
    } catch (e) {
      setError(`Could not start recording: ${errorText(e)}`)
    }
  }

  const stopRecording = async (keep = true): Promise<void> => {
    const r = recording.current
    if (!r) return
    recording.current = null
    window.clearInterval(r.timer)
    r.stopClicks?.()
    const samples = r.recorder.stop()
    setLevel(0)
    if (!keep) {
      setStep({ kind: 'source' })
      return
    }
    const sampleRate = (await getEngine()).ctx.sampleRate
    const firstDownbeat = Math.min(r.firstDownbeat ?? detectFirstOnset(samples, sampleRate), samples.length / sampleRate)
    setTake({ samples, info: newTakeInfo(`Take ${song.takes.length + 1}`, sampleRate, Math.round(firstDownbeat * 1000) / 1000) })
    setStep({ kind: 'align' })
  }

  const importFile = async (file: File): Promise<void> => {
    setError('')
    try {
      const engine = await getEngine()
      const { samples, sampleRate } = await importAudioFile(engine.ctx, file)
      setTake({ samples, info: newTakeInfo(file.name.replace(/\.[^.]+$/, ''), sampleRate, detectFirstOnset(samples, sampleRate)) })
      setStep({ kind: 'align' })
    } catch (e) {
      setError(`Could not import ${file.name}: ${errorText(e)}`)
    }
  }

  const openSaved = (info: TakeInfo): void => {
    const samples = project.audio.get(info.id)
    if (!samples) return
    setTake({ info: { ...info }, samples })
    setStep({ kind: 'align' })
  }

  const deleteSaved = (info: TakeInfo): void => {
    if (window.confirm(`Delete "${info.name}" from the project? The notes already inserted stay.`)) project.apply(removeTake(song, cursor, info.id))
  }

  // ------------------------------------------------------------ listening

  const playTake = async (options: { clicks?: boolean; transcription?: Song; samples?: Float32Array; info?: TakeInfo } = {}): Promise<void> => {
    const samples = options.samples ?? take?.samples
    const info = options.info ?? take?.info
    if (!samples || !info) return
    stopPlaying()
    const engine = await getEngine()
    const buffer = samplesToBuffer(engine.ctx, samples, info.sampleRate)
    const start = engine.ctx.currentTime + 0.15
    const stops = [engine.playBuffer(buffer, () => setAudioPlaying(false), start)]
    if (options.clicks) {
      const seconds = secondsPerClick(info.tempo, song.timeSignature)
      const before = Math.floor(info.firstDownbeat / seconds)
      const firstClick = info.firstDownbeat - before * seconds
      const count = Math.ceil((buffer.duration - firstClick) / seconds)
      stops.push(engine.scheduleClicks(start + firstClick, seconds, count, clicksPerBar, (((-before) % clicksPerBar) + clicksPerBar) % clicksPerBar))
    }
    if (options.transcription) void playback.play(options.transcription, 0, { startAt: start + info.firstDownbeat })
    stopAudio.current = () =>
      stops.forEach((stop) => {
        try {
          stop()
        } catch {
          // already finished
        }
      })
    setAudioPlaying(true)
  }

  // ------------------------------------------------------------ alignment

  const updateInfo = (patch: Partial<TakeInfo>): void => setTake((t) => (t ? { ...t, info: { ...t.info, ...patch } } : t))
  const setDownbeat = (seconds: number): void => {
    if (!take) return
    updateInfo({ firstDownbeat: Math.max(0, Math.min(take.samples.length / take.info.sampleRate, Math.round(seconds * 1000) / 1000)) })
  }

  const transcribe = async (): Promise<void> => {
    if (!take) return
    stopPlaying()
    setError('')
    const cached = models.current.get(take.info.id)
    if (cached) {
      setStep({ kind: 'preview', model: cached })
      return
    }
    setStep({ kind: 'transcribing', progress: 0 })
    try {
      const model = await runBasicPitch(take.samples, take.info.sampleRate, (p) => setStep({ kind: 'transcribing', progress: p }))
      models.current.set(take.info.id, model)
      setStep({ kind: 'preview', model })
    } catch (e) {
      setError(`Transcription failed: ${errorText(e)}`)
      setStep({ kind: 'align' })
    }
  }

  // ------------------------------------------------------------ preview + insert

  const transcription = useMemo(() => {
    if (step.kind !== 'preview' || !take) return null
    const range = { minPitch: Math.min(...track.tuning), maxPitch: Math.max(...track.tuning) + TRANSCRIBE_MAX_FRET }
    const notes = extractNotes(step.model, sensitivity, range)
    return transcribeToBars(notes, {
      tempo: take.info.tempo,
      firstDownbeat: take.info.firstDownbeat,
      stepsPerQuarter,
      timeSignature: song.timeSignature,
      tuning: track.tuning,
      preferredFret
    })
  }, [step, take, sensitivity, stepsPerQuarter, preferredFret, track, song.timeSignature])

  const previewSong = useMemo<Song | null>(
    () =>
      transcription && take
        ? { title: '', tempo: take.info.tempo, timeSignature: song.timeSignature, sections: [], takes: [], tracks: [{ ...track, bars: transcription.bars }] }
        : null,
    [transcription, take, track, song.timeSignature]
  )

  const insert = (): void => {
    if (!take || !transcription) return
    stopPlaying()
    if (!project.audio.has(take.info.id)) project.addTakeAudio(take.info.id, take.samples)
    const bar = Math.max(1, Math.round(startBar))
    if (project.apply(writeBars(song, cursor, targetTrack, bar - 1, transcription.bars, take.info))) {
      onClose(`Inserted ${transcription.bars.length} bars from "${take.info.name}" into ${track.name} at bar ${bar}.`)
    } else {
      setError('The transcription could not be inserted.')
    }
  }

  // ------------------------------------------------------------ views

  const meter = (
    <>
      <div className="meter">
        <div className={`meter-fill ${clipped ? 'clipped' : ''}`} style={{ width: `${Math.min(100, level * 100)}%` }} />
      </div>
      {clipped && <p className="warning">Input is clipping – lower the gain or move the mic further away.</p>}
    </>
  )

  const listenButtons = (transcriptionSong?: Song | null): React.JSX.Element => (
    <div className="toolbar">
      {audioPlaying || playback.playing ? (
        <button onClick={stopPlaying}>■ Stop</button>
      ) : (
        <>
          <button onClick={() => void playTake()}>▶ Take</button>
          <button onClick={() => void playTake({ clicks: true })}>▶ Take + click</button>
          {transcriptionSong && <button onClick={() => void playback.play(transcriptionSong)}>▶ Transcription</button>}
          {transcriptionSong && (
            <button onClick={() => void playTake({ transcription: transcriptionSong })} title="Play both at once to check that they line up">
              ▶ Both
            </button>
          )}
        </>
      )}
    </div>
  )

  let body: React.JSX.Element
  if (step.kind === 'source') {
    body = (
      <>
        <h2>Record or import a take</h2>
        <section className="card">
          <h3>Record</h3>
          <div className="form-row">
            <label>
              Input
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">Default input</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${d.deviceId.slice(0, 6)}`}</option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={metronome} onChange={(e) => setMetronome(e.target.checked)} />
              Metronome with a 1-bar count-in ({song.tempo} BPM, {song.timeSignature.join('/')})
            </label>
            <button className="active" onClick={() => void startRecording()}>● Record</button>
          </div>
          <p className="muted small">Use headphones so the metronome doesn't end up in the recording. Quiet room; mic about 20–30 cm from where the neck meets the body.</p>
        </section>
        <section className="card">
          <h3>Import</h3>
          <p className="muted small">A WAV (or other audio file) recorded at a fixed tempo, e.g. in Audacity. You'll line up beat 1 in the next step.</p>
          <input type="file" accept="audio/*,.wav" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
        </section>
        {song.takes.length > 0 && (
          <section className="card">
            <h3>Takes in this project</h3>
            <ul className="take-list">
              {song.takes.map((info) => (
                <li key={info.id}>
                  <span>
                    <strong>{info.name}</strong> <span className="muted">· {takeSeconds(info, project.audio).toFixed(1)} s · {info.tempo} BPM</span>
                  </span>
                  <span className="toolbar">
                    <button onClick={() => void playTake({ samples: project.audio.get(info.id), info })}>▶</button>
                    {(audioPlaying || playback.playing) && <button onClick={stopPlaying}>■</button>}
                    <button onClick={() => openSaved(info)}>Transcribe again</button>
                    <button className="icon" title="Delete take" aria-label={`Delete ${info.name}`} onClick={() => deleteSaved(info)}>×</button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    )
  } else if (step.kind === 'recording') {
    body = (
      <>
        <h2>● Recording… {elapsed.toFixed(1)} s</h2>
        <p className="muted">{metronome ? 'Wait for the 1-bar count-in, then play.' : 'Play now.'}</p>
        {meter}
        <div className="toolbar">
          <button className="danger" onClick={() => void stopRecording()}>■ Stop</button>
          <button onClick={() => void stopRecording(false)}>Cancel</button>
        </div>
      </>
    )
  } else if (step.kind === 'align' && take) {
    body = (
      <>
        <h2>Line up beat 1</h2>
        <p className="muted">
          The lines are the beat grid; thicker ones are bar lines and the red line is beat 1 of the first bar. Click the waveform where you played
          beat 1, then check with “Take + click”.
        </p>
        <Waveform
          samples={take.samples}
          sampleRate={take.info.sampleRate}
          secondsPerClick={clickSeconds}
          clicksPerBar={clicksPerBar}
          firstDownbeat={take.info.firstDownbeat}
          onPick={setDownbeat}
        />
        <div className="form-row">
          <label>
            Name
            <input value={take.info.name} onChange={(e) => updateInfo({ name: e.target.value })} />
          </label>
          <label>
            Tempo of the take (BPM)
            <input
              type="number"
              min={20}
              max={400}
              value={take.info.tempo}
              onChange={(e) => {
                const tempo = Number(e.target.value)
                if (tempo >= 20 && tempo <= 400) updateInfo({ tempo })
              }}
            />
          </label>
          <label>
            Beat 1 at (s)
            <input type="number" step={0.01} min={0} value={take.info.firstDownbeat} onChange={(e) => setDownbeat(Number(e.target.value))} />
          </label>
          <button onClick={() => setDownbeat(take.info.firstDownbeat - 0.01)} title="10 ms earlier">−10 ms</button>
          <button onClick={() => setDownbeat(take.info.firstDownbeat + 0.01)} title="10 ms later">+10 ms</button>
          <button onClick={() => setDownbeat(detectFirstOnset(take.samples, take.info.sampleRate))} title="Use the first note you played as beat 1">
            Snap to first note
          </button>
        </div>
        {listenButtons()}
        <div className="toolbar dialog-actions">
          <button onClick={() => { stopPlaying(); setStep({ kind: 'source' }) }}>← Back</button>
          <span className="spacer" />
          <button className="active" onClick={() => void transcribe()}>Transcribe →</button>
        </div>
      </>
    )
  } else if (step.kind === 'transcribing') {
    body = (
      <>
        <h2>Transcribing…</h2>
        <p className="muted">Basic Pitch is listening to the take. The first time takes a few seconds longer while the model loads.</p>
        <div className="meter">
          <div className="meter-fill" style={{ width: `${Math.round(step.progress * 100)}%` }} />
        </div>
      </>
    )
  } else if (step.kind === 'preview' && take && transcription && previewSong) {
    const bar = Math.max(1, Math.round(startBar))
    const overwrites = barsHaveNotes(song, targetTrack, bar - 1, transcription.bars.length)
    body = (
      <>
        <h2>Check the transcription</h2>
        <div className="form-row">
          <label>
            Sensitivity
            <select value={sensitivity} onChange={(e) => setSensitivity(e.target.value as Sensitivity)}>
              <option value="low">Low – fewer extra notes</option>
              <option value="normal">Normal</option>
              <option value="high">High – catches quiet notes</option>
            </select>
          </label>
          <label>
            Rhythm grid
            <select value={stepsPerQuarter} onChange={(e) => setStepsPerQuarter(Number(e.target.value))}>
              <option value={2}>1/8 notes</option>
              <option value={4}>1/16 notes</option>
            </select>
          </label>
          <label>
            Fingering near fret {preferredFret}
            <input type="range" min={0} max={12} value={preferredFret} onChange={(e) => setPreferredFret(Number(e.target.value))} />
          </label>
        </div>
        <p className="muted small">
          {plural(transcription.noteCount, 'note')} in {plural(transcription.bars.length, 'bar')}
          {transcription.beforeStart > 0 && ` · ${transcription.beforeStart} before beat 1 left out`}
          {transcription.dropped > 0 && ` · ${transcription.dropped} not playable or on the same grid step, left out`}
          {` · Basic Pitch took ${step.model.seconds.toFixed(1)} s (${step.model.backend})`}
        </p>
        {listenButtons(previewSong)}
        <div className="dialog-score">
          <ScoreView song={previewSong} staveMode="notation+tab" positionRef={playback.positionRef} />
        </div>
        <div className="form-row">
          <label>
            Insert into
            <select value={targetTrack} onChange={(e) => setTargetTrack(Number(e.target.value))}>
              {song.tracks.map((t, i) =>
                !isFretted(t) ? null : (
                  <option key={t.id} value={i}>{t.name}</option>
                )
              )}
            </select>
          </label>
          <label>
            At bar
            <input type="number" min={1} value={startBar} onChange={(e) => setStartBar(Number(e.target.value))} />
          </label>
          {overwrites && (
            <p className="warning small">
              This replaces {transcription.bars.length === 1 ? `bar ${bar}` : `bars ${bar}–${bar + transcription.bars.length - 1}`} of {track.name}, which
              already {transcription.bars.length === 1 ? 'has' : 'have'} notes.
            </p>
          )}
        </div>
        <div className="toolbar dialog-actions">
          <button onClick={() => { stopPlaying(); setStep({ kind: 'align' }) }}>← Back to alignment</button>
          <span className="spacer" />
          <button onClick={() => close()}>Discard</button>
          <button className="active" onClick={insert} disabled={transcription.noteCount === 0}>
            Insert into {track.name} at bar {bar}
          </button>
        </div>
      </>
    )
  } else {
    body = <p>Loading…</p>
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Record or import a take">
        <button className="icon modal-close" aria-label="Close" title="Close (Esc)" onClick={() => close()} disabled={step.kind === 'recording'}>
          ×
        </button>
        {body}
        {error && <p className="warning dialog-error">{error}</p>}
        {step.kind === 'source' && (
          <p className="muted small">
            The transcription goes into {song.tracks[targetTrack].name} from bar {cursor.bar + 1}; you can change that before inserting.
          </p>
        )}
      </div>
    </div>
  )
}
