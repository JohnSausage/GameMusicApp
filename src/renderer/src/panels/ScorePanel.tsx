import { useMemo, useState } from 'react'
import type { GetEngine } from '../App'
import { songToMidi } from '../audio/midiExport'
import { renderSongOffline } from '../audio/offline'
import { audioBufferToWav16, peakLevel } from '../audio/wav'
import { createDemoSong, createStressSong, GM_ACOUSTIC_GUITAR_STEEL, GM_FINGER_BASS, notePitch, PULSE_BASS, PULSE_LEAD, type Instrument, type Song, type Track } from '../model/song'
import { buildTimeline } from '../model/timing'
import { saveFile } from '../platform'
import { ScoreView, type StaveMode } from '../score/ScoreView'
import type { BeatRef } from '../score/toAlphaTab'
import { noteName } from '../transcription/notes'
import { usePlayback } from './usePlayback'

function alternateInstrument(track: Track): Instrument {
  const isBass = track.tuning.length === 4
  if (track.instrument.kind === 'synth') return { kind: 'soundfont', program: isBass ? GM_FINGER_BASS : GM_ACOUSTIC_GUITAR_STEEL }
  return { kind: 'synth', patch: isBass ? PULSE_BASS : PULSE_LEAD }
}

function describeInstrument(instrument: Instrument): string {
  if (instrument.kind === 'soundfont') return `SoundFont (GM program ${instrument.program})`
  return `Synth: ${instrument.patch.waveform}${instrument.patch.waveform === 'pulse' ? ` ${instrument.patch.duty * 100} %` : ''}`
}

/** Moves one random note up or down a fret, to measure edit → re-render time. */
function randomEdit(song: Song): Song {
  const copy = structuredClone(song)
  const candidates = copy.tracks.flatMap((t) => t.bars.flatMap((b) => b.beats.flatMap((beat) => beat.notes)))
  const note = candidates[Math.floor(Math.random() * candidates.length)]
  note.fret = note.fret === 0 ? 1 : note.fret + (Math.random() < 0.5 ? -1 : 1)
  return copy
}

export function ScorePanel({ getEngine }: { getEngine: GetEngine }): React.JSX.Element {
  const [song, setSong] = useState<Song>(createDemoSong)
  const [staveMode, setStaveMode] = useState<StaveMode>('notation+tab')
  const [selected, setSelected] = useState<BeatRef | null>(null)
  const [renderMs, setRenderMs] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const { playing, positionRef, play, stop } = usePlayback(getEngine)
  const timeline = useMemo(() => buildTimeline(song), [song])
  const isStress = song.tracks.length > 2

  const selectedInfo = (() => {
    if (!selected) return null
    const track = song.tracks[selected.trackIndex]
    const beat = track.bars[selected.barIndex]?.beats[selected.beatIndex]
    if (!beat) return null
    const notes = beat.notes.map((n) => `${noteName(notePitch(track, n))} (string ${n.string}, fret ${n.fret})`).join(', ') || 'rest'
    return `${track.name}, bar ${selected.barIndex + 1}, beat ${selected.beatIndex + 1}: ${notes}`
  })()

  const playFromSelection = (): void => {
    const span = selected && timeline.beats.find((b) => b.trackIndex === selected.trackIndex && b.barIndex === selected.barIndex && b.beatIndex === selected.beatIndex)
    void play(song, span ? span.start : 0)
  }

  const toggleInstrument = (trackIndex: number): void => {
    stop()
    setSong((s) => ({ ...s, tracks: s.tracks.map((t, i) => (i === trackIndex ? { ...t, instrument: alternateInstrument(t) } : t)) }))
  }

  const exportWav = async (): Promise<void> => {
    setBusy(true)
    setStatus('Rendering WAV…')
    try {
      const started = performance.now()
      const buffer = await renderSongOffline(song, 48000)
      const ms = performance.now() - started
      const channels = [buffer.getChannelData(0), buffer.getChannelData(1)]
      const path = await saveFile('m0-demo.wav', audioBufferToWav16(buffer))
      setStatus(`Rendered ${buffer.duration.toFixed(1)} s of 48 kHz audio in ${ms.toFixed(0)} ms (peak ${peakLevel(channels).toFixed(2)}). ${path ? `Saved: ${path}` : 'Not saved.'}`)
    } catch (error) {
      setStatus(`WAV export failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const exportMidi = async (): Promise<void> => {
    const path = await saveFile('m0-demo.mid', songToMidi(song))
    setStatus(path ? `MIDI saved: ${path}` : 'MIDI not saved.')
  }

  return (
    <section className="panel">
      <div className="toolbar">
        {playing ? <button onClick={stop}>■ Stop</button> : <button onClick={playFromSelection}>▶ Play{selected ? ' from selection' : ''}</button>}
        <div className="segmented">
          <button className={staveMode === 'notation+tab' ? 'active' : ''} onClick={() => setStaveMode('notation+tab')}>Notation + tab</button>
          <button className={staveMode === 'tab' ? 'active' : ''} onClick={() => setStaveMode('tab')}>Tab only</button>
        </div>
        <button disabled={busy} onClick={() => void exportWav()}>Export WAV</button>
        <button onClick={() => void exportMidi()}>Export MIDI</button>
        <span className="spacer" />
        <button onClick={() => setSong((s) => randomEdit(s))}>Random edit</button>
        <button onClick={() => { stop(); setSelected(null); setSong(isStress ? createDemoSong() : createStressSong()) }}>
          {isStress ? 'Back to demo song' : 'Stress test: 200 bars × 6 tracks'}
        </button>
      </div>

      {!isStress && (
        <div className="tracks">
          {song.tracks.map((track, i) => (
            <div key={track.id} className="track-row">
              <strong>{track.name}</strong>
              <span className="muted">{describeInstrument(track.instrument)}</span>
              <button onClick={() => toggleInstrument(i)}>
                Switch to {track.instrument.kind === 'soundfont' ? 'pulse synth' : 'SoundFont'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="info-line">
        <span>Render: {renderMs === null ? '…' : `${renderMs.toFixed(0)} ms`}</span>
        <span>{selectedInfo ?? 'Click a note in the score to select it.'}</span>
      </div>
      {status && <p className="status">{status}</p>}

      <ScoreView song={song} staveMode={staveMode} positionRef={positionRef} selected={selected} onBeatClick={setSelected} onRendered={setRenderMs} />
    </section>
  )
}
