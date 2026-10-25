import { useEffect, useState } from 'react'
import type { GetEngine } from '../App'
import { renderSongOffline } from '../audio/offline'
import { takeToAudioBuffer, type Take } from '../audio/recorder'
import { createDemoSong, GUITAR_STANDARD, notePitch, type Song } from '../model/song'
import { ScoreView } from '../score/ScoreView'
import { runBasicPitch } from '../transcription/basicPitch'
import { comparePitchSequences, type Comparison } from '../transcription/compare'
import { noteName, parseNoteList, toSingleNotes, type DetectedNote } from '../transcription/notes'
import { trackNotes } from '../transcription/pitchTracker'
import { notesToSong } from '../transcription/toTab'
import { usePlayback } from './usePlayback'

type Method = 'Pitch tracker (YIN/MPM)' | 'Basic Pitch'

interface MethodResult {
  notes: DetectedNote[]
  rawCount: number
  ms: number
  backend?: string
  comparison: Comparison | null
  song: Song
}

interface Props {
  getEngine: GetEngine
  take: Take | null
  onTake: (take: Take) => void
}

/** Renders the first three bars of the demo melody with the SoundFont guitar, as a test take with known notes. */
async function createDemoTake(): Promise<{ take: Take; reference: string }> {
  const demo = createDemoSong()
  const guitar = { ...demo.tracks[0], bars: demo.tracks[0].bars.slice(0, 3) }
  const song: Song = { ...demo, tracks: [guitar] }
  const buffer = await renderSongOffline(song, 44100, 1)
  const reference = guitar.bars.flatMap((bar) => bar.beats.flatMap((beat) => beat.notes.map((n) => noteName(notePitch(guitar, n))))).join(' ')
  const samples = new Float32Array(buffer.length)
  for (let c = 0; c < buffer.numberOfChannels; c++) buffer.getChannelData(c).forEach((v, i) => (samples[i] += v / buffer.numberOfChannels))
  return { take: { name: 'Demo melody (synthesized guitar)', samples, sampleRate: buffer.sampleRate, tempo: demo.tempo, firstDownbeat: 0 }, reference }
}

export function TranscriptionPanel({ getEngine, take, onTake }: Props): React.JSX.Element {
  const [tempo, setTempo] = useState(take?.tempo ?? 100)
  const [firstDownbeat, setFirstDownbeat] = useState(take?.firstDownbeat ?? 0)
  const [stepsPerQuarter, setStepsPerQuarter] = useState(4)
  const [reference, setReference] = useState('')
  const [results, setResults] = useState<Partial<Record<Method, MethodResult>>>({})
  const [shownTab, setShownTab] = useState<Method | null>(null)
  const [progress, setProgress] = useState<string>('')
  const [error, setError] = useState('')
  const { playing, positionRef, play, stop } = usePlayback(getEngine)
  const [stopTake, setStopTake] = useState<(() => void) | null>(null)

  useEffect(() => {
    if (!take) return
    setTempo(take.tempo)
    setFirstDownbeat(take.firstDownbeat)
    setResults({})
    setShownTab(null)
  }, [take])

  const loadDemoTake = async (): Promise<void> => {
    setProgress('Rendering demo melody…')
    const { take: demoTake, reference: demoReference } = await createDemoTake()
    setReference(demoReference)
    onTake(demoTake)
    setProgress('')
  }

  const finish = (method: Method, raw: DetectedNote[], ms: number, referencePitches: number[] | null, backend?: string): void => {
    const notes = toSingleNotes(raw)
    const song = notesToSong(notes, { tempo, firstDownbeat, stepsPerQuarter, beatsPerBar: 4, tuning: GUITAR_STANDARD, title: method })
    const comparison = referencePitches ? comparePitchSequences(referencePitches, notes.map((n) => n.pitch)) : null
    setResults((r) => ({ ...r, [method]: { notes, rawCount: raw.length, ms, backend, comparison, song } }))
  }

  const run = async (): Promise<void> => {
    if (!take) return
    setError('')
    setResults({})
    let referencePitches: number[] | null = null
    try {
      referencePitches = reference.trim() ? parseNoteList(reference) : null
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return
    }

    setProgress('Pitch tracker running…')
    await new Promise((resolve) => setTimeout(resolve, 20))
    let started = performance.now()
    finish('Pitch tracker (YIN/MPM)', trackNotes(take.samples, take.sampleRate), performance.now() - started, referencePitches)

    setProgress('Basic Pitch: loading model…')
    started = performance.now()
    try {
      const result = await runBasicPitch(take.samples, take.sampleRate, (p) => setProgress(`Basic Pitch: ${Math.round(p * 100)} %`))
      finish('Basic Pitch', result.notes, performance.now() - started, referencePitches, result.backend)
    } catch (e) {
      setError(`Basic Pitch failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    setProgress('')
  }

  const togglePlayTake = async (): Promise<void> => {
    if (stopTake) {
      stopTake()
      setStopTake(null)
      return
    }
    if (!take) return
    const engine = await getEngine()
    const fn = engine.playBuffer(takeToAudioBuffer(engine.ctx, take), () => setStopTake(null))
    setStopTake(() => fn)
  }

  if (!take) {
    return (
      <section className="panel">
        <h2>Transcription lab</h2>
        <p>Record or import a take first, or try it with a synthesized test melody:</p>
        <button onClick={() => void loadDemoTake()}>Use demo melody as test take</button>
        {progress && <p className="status">{progress}</p>}
      </section>
    )
  }

  return (
    <section className="panel">
      <h2>Transcription lab</h2>
      <p className="muted">
        Take: <strong>{take.name}</strong> · {(take.samples.length / take.sampleRate).toFixed(1)} s · {take.sampleRate} Hz
        <button className="link" onClick={() => void togglePlayTake()}>{stopTake ? '■ stop' : '▶ play original'}</button>
        <button className="link" onClick={() => void loadDemoTake()}>use demo melody instead</button>
      </p>
      <div className="form-row">
        <label>
          Tempo (BPM)
          <input type="number" min={30} max={300} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} />
        </label>
        <label>
          First downbeat (s)
          <input type="number" step={0.01} min={0} value={firstDownbeat} onChange={(e) => setFirstDownbeat(Number(e.target.value))} />
        </label>
        <label>
          Grid
          <select value={stepsPerQuarter} onChange={(e) => setStepsPerQuarter(Number(e.target.value))}>
            <option value={2}>1/8 notes</option>
            <option value={4}>1/16 notes</option>
          </select>
        </label>
      </div>
      <label className="block">
        Reference notes (what you actually played, optional – e.g. <code>E4 G4 F#4 D4</code>)
        <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="E4 G4 F#4 D4 …" />
      </label>
      <div className="toolbar">
        <button onClick={() => void run()} disabled={progress !== ''}>Transcribe with both methods</button>
        {progress && <span className="status">{progress}</span>}
      </div>
      {error && <p className="warning">{error}</p>}

      <div className="results">
        {(Object.entries(results) as [Method, MethodResult][]).map(([method, result]) => (
          <div key={method} className="card">
            <h3>{method}</h3>
            <table className="metrics">
              <tbody>
                <tr><td>Time</td><td>{result.ms.toFixed(0)} ms{result.backend ? ` (TensorFlow.js backend: ${result.backend})` : ''}</td></tr>
                <tr><td>Notes</td><td>{result.notes.length} (raw detections: {result.rawCount})</td></tr>
                {result.comparison && (
                  <>
                    <tr><td><strong>Accuracy</strong></td><td><strong>{(result.comparison.accuracy * 100).toFixed(0)} %</strong> ({result.comparison.correct} of {result.comparison.referenceCount} correct)</td></tr>
                    <tr><td>Wrong pitch</td><td>{result.comparison.substitutions} (of which octave errors: {result.comparison.octaveErrors})</td></tr>
                    <tr><td>Missed / extra</td><td>{result.comparison.missed} / {result.comparison.extra}</td></tr>
                  </>
                )}
              </tbody>
            </table>
            <p className="note-list">{result.notes.map((n) => noteName(n.pitch)).join(' ') || 'No notes found.'}</p>
            <div className="toolbar">
              {playing ? <button onClick={stop}>■ Stop</button> : <button onClick={() => void play(result.song)}>▶ Play result</button>}
              <button onClick={() => setShownTab(shownTab === method ? null : method)}>{shownTab === method ? 'Hide tab' : 'Show as tab'}</button>
            </div>
          </div>
        ))}
      </div>

      {shownTab && results[shownTab] && <ScoreView song={results[shownTab]!.song} staveMode="notation+tab" positionRef={positionRef} />}
    </section>
  )
}
