import { useEffect, useState } from 'react'
import type { Cursor, Selection } from '../model/edit'
import { isFretted, type Song } from '../model/song'
import { describeShift, transpose, type Fingering, type TransposeResult, type TransposeScope } from '../model/transpose'
import { readPref, writePref } from '../prefs'

interface Props {
  song: Song
  cursor: Cursor
  selection: Selection | null
  /** A part or sound effect on its own: it has one track, and no key of its own. */
  piece: boolean
  onApply: (result: TransposeResult, semitones: number, fingering: Fingering) => void
  onNothing: () => void
  onClose: () => void
}

const PREF_KEY = 'transpose'
const MAX_SEMITONES = 24

/** Transposing the selection, a track or the whole song by semitones (REQUIREMENTS.md EDIT-10). */
export function TransposeDialog({ song, cursor, selection, piece, onApply, onNothing, onClose }: Props): React.JSX.Element {
  const saved = readPref<{ semitones?: number; fingering?: Fingering }>(PREF_KEY, {})
  const [semitones, setSemitones] = useState(Number.isInteger(saved.semitones) && saved.semitones !== 0 ? saved.semitones! : 2)
  const [fingering, setFingering] = useState<Fingering>(saved.fingering === 'best' ? 'best' : 'keep')
  const [scope, setScope] = useState<TransposeScope['kind']>(selection ? 'selection' : 'track')
  const track = song.tracks[cursor.track]
  const fretted = scope === 'song' ? song.tracks.some(isFretted) : isFretted(track)
  const valid = Number.isInteger(semitones) && semitones !== 0 && Math.abs(semitones) <= MAX_SEMITONES

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const apply = (): void => {
    writePref(PREF_KEY, { semitones, fingering })
    const target: TransposeScope = scope === 'selection' && selection ? { kind: 'selection', selection } : scope === 'song' ? { kind: 'song' } : { kind: 'track', track: cursor.track }
    const result = transpose(song, cursor, target, semitones, fingering)
    if (result) onApply(result, semitones, fingering)
    else onNothing()
  }

  const step = (by: number): void => setSemitones((n) => Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, n + by)))

  return (
    // Keys pressed in here are not for the score around it (a digit would type a fret).
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
      <div className="modal transpose-dialog" role="dialog" aria-modal="true" aria-label="Transpose">
        <button className="icon modal-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
        <h2>Transpose</h2>

        <div className="transpose-amount">
          <div className="segmented">
            <button aria-label="A semitone lower" title="A semitone lower" onClick={() => step(-1)}>
              −
            </button>
            <input
              type="number"
              aria-label="Semitones"
              min={-MAX_SEMITONES}
              max={MAX_SEMITONES}
              value={semitones}
              autoFocus
              onChange={(e) => setSemitones(Math.trunc(Number(e.target.value)))}
              onKeyDown={(e) => e.key === 'Enter' && valid && apply()}
            />
            <button aria-label="A semitone higher" title="A semitone higher" onClick={() => step(1)}>
              +
            </button>
          </div>
          <span>{valid ? describeShift(semitones) : 'Pick how many semitones up (+) or down (−).'}</span>
        </div>

        <fieldset className="choice-group">
          <legend>What to transpose</legend>
          {selection && (
            <label className="checkbox">
              <input type="radio" name="transpose-scope" checked={scope === 'selection'} onChange={() => setScope('selection')} />
              <span>The selected beats</span>
            </label>
          )}
          <label className="checkbox">
            <input type="radio" name="transpose-scope" checked={scope === 'track'} onChange={() => setScope('track')} />
            <span>{piece ? `All of it (${track.name})` : `The track “${track.name}”, with all its parts`}</span>
          </label>
          {!piece && (
            <label className="checkbox">
              <input type="radio" name="transpose-scope" checked={scope === 'song'} onChange={() => setScope('song')} />
              <span>Every track but the drums: the whole song. The key signature moves too.</span>
            </label>
          )}
        </fieldset>

        {fretted && (
          <fieldset className="choice-group">
            <legend>Guitar and bass</legend>
            <label className="checkbox">
              <input type="radio" name="transpose-fingering" checked={fingering === 'keep'} onChange={() => setFingering('keep')} />
              <span>
                <strong>Keep the strings.</strong> The frets move; a note its string can't reach goes to a free string close by.
              </span>
            </label>
            <label className="checkbox">
              <input type="radio" name="transpose-fingering" checked={fingering === 'best'} onChange={() => setFingering('best')} />
              <span>
                <strong>Choose strings and frets anew,</strong> close to where the hand is, so the notes stay easy to play.
              </span>
            </label>
          </fieldset>
        )}
        <p className="muted small">Drums stay as they are. A note out of the instrument's range goes an octave the other way.</p>

        <div className="toolbar dialog-actions">
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="active" disabled={!valid} onClick={apply}>
            Transpose
          </button>
        </div>
      </div>
    </div>
  )
}
