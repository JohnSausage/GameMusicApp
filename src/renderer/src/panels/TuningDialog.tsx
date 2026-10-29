import { useEffect, useState } from 'react'
import type { GetEngine } from '../App'
import { hasNotes } from '../model/arrangement'
import type { Track } from '../model/song'
import { MAX_CAPO, soundingTuning, STRING_RANGE, stringLetters, TUNING_PRESETS, tuningPreset, type Retune } from '../model/tuning'
import { noteName } from '../transcription/notes'

interface Props {
  track: Track
  getEngine: GetEngine
  onApply: (tuning: number[], capo: number, keep: Retune) => void
  onClose: () => void
}

/** How long an auditioned string rings, in ms. */
const RING_MS = 700
/** Time between the strings of a strum, in ms. */
const STRUM_MS = 90

/** The tuning and capo of a guitar or bass track. */
export function TuningDialog({ track, getEngine, onApply, onClose }: Props): React.JSX.Element {
  const [tuning, setTuning] = useState(track.tuning)
  const [capo, setCapo] = useState(track.capo ?? 0)
  const [keep, setKeep] = useState<Retune>('sound')
  const presets = TUNING_PRESETS[tuning.length] ?? []
  const preset = tuningPreset(tuning)
  const changed = tuning.some((pitch, i) => pitch !== track.tuning[i]) || capo !== (track.capo ?? 0)
  const withNotes = hasNotes(track.bars) || (track.parts ?? []).some((part) => hasNotes(part.bars))
  const sounding = soundingTuning({ tuning, capo })
  // Strings from the lowest, as players count them across the neck.
  const strings = tuning.map((_, i) => i).reverse()

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** Plays notes one after the other, `gap` ms apart, on the track's sound. */
  const play = (pitches: number[], gap = 0): void => {
    void getEngine().then((engine) =>
      pitches.forEach((pitch, i) =>
        window.setTimeout(() => {
          engine.liveNoteOn(track.instrument, pitch, 90)
          window.setTimeout(() => engine.liveNoteOff(track.instrument, pitch), RING_MS + (pitches.length - 1 - i) * gap)
        }, i * gap)
      )
    )
  }

  const tuneString = (index: number, pitch: number): void => {
    if (pitch < STRING_RANGE.min || pitch > STRING_RANGE.max) return
    setTuning(tuning.map((p, i) => (i === index ? pitch : p)))
    play([pitch + capo])
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal tuning-dialog" role="dialog" aria-modal="true" aria-label="Tuning and capo">
        <button className="icon modal-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
        <h2>Tuning and capo · {track.name}</h2>

        <div className="form-row">
          <label>
            Tuning
            <select
              value={preset ? presets.indexOf(preset) : 'custom'}
              onChange={(e) => {
                const next = presets[Number(e.target.value)]?.tuning
                if (next) {
                  setTuning(next)
                  play(soundingTuning({ tuning: next, capo }).reverse(), STRUM_MS)
                }
              }}
            >
              {presets.map((p, i) => (
                <option key={p.name} value={i}>
                  {p.name} ({stringLetters(p.tuning)})
                </option>
              ))}
              {!preset && <option value="custom">Your own ({stringLetters(tuning)})</option>}
            </select>
          </label>
          <label>
            Capo
            <select value={capo} onChange={(e) => setCapo(Number(e.target.value))}>
              <option value={0}>No capo</option>
              {Array.from({ length: MAX_CAPO }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Fret {i + 1}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="tuning-strings" style={{ gridTemplateColumns: `repeat(${tuning.length}, minmax(0, 1fr))` }}>
          {strings.map((index) => (
            <div key={index} className="tuning-string">
              <span className="muted small">String {index + 1}</span>
              <div className="segmented">
                <button aria-label={`Tune string ${index + 1} down`} title="A semitone down" disabled={tuning[index] <= STRING_RANGE.min} onClick={() => tuneString(index, tuning[index] - 1)}>
                  −
                </button>
                <button className={`string-note ${tuning[index] !== track.tuning[index] ? 'active' : ''}`} title="Play this string" onClick={() => play([sounding[index]])}>
                  {noteName(tuning[index])}
                </button>
                <button aria-label={`Tune string ${index + 1} up`} title="A semitone up" disabled={tuning[index] >= STRING_RANGE.max} onClick={() => tuneString(index, tuning[index] + 1)}>
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="toolbar">
          <button title="Play the open strings from the lowest" onClick={() => play([...sounding].reverse(), STRUM_MS)}>
            ▶ Strum
          </button>
          {capo > 0 && (
            <span className="muted small">
              With the capo, the open strings sound {[...sounding].reverse().map((pitch) => noteName(pitch)).join(' ')}. Frets in the tab count from the capo (0 = the capo).
            </span>
          )}
        </div>

        {withNotes && changed && (
          <fieldset className="choice-group">
            <legend>The notes already written</legend>
            <label className="checkbox">
              <input type="radio" name="retune" checked={keep === 'sound'} onChange={() => setKeep('sound')} />
              <span>
                <strong>Keep how they sound.</strong> The frets change to play the same notes; a note its string can't reach moves to a free string.
              </span>
            </label>
            <label className="checkbox">
              <input type="radio" name="retune" checked={keep === 'frets'} onChange={() => setKeep('frets')} />
              <span>
                <strong>Keep the frets.</strong> The tab stays as it is, and the music sounds in the new tuning.
              </span>
            </label>
          </fieldset>
        )}

        <div className="toolbar dialog-actions">
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="active" disabled={!changed} onClick={() => onApply(tuning, capo, keep)}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
