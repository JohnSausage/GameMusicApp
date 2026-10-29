import { useEffect, useState } from 'react'
import { updateSong, type Cursor, type EditResult } from '../model/edit'
import { ALL_KEYS, keyAccidentals, keyName, keyShift, sameKey, songKey, type KeySignature } from '../model/keySignature'
import type { Song } from '../model/song'
import { describeShift, transpose } from '../model/transpose'

interface Props {
  song: Song
  cursor: Cursor
  onApply: (result: EditResult) => void
  onClose: () => void
}

const keyValue = (key: KeySignature): string => `${key.fifths}:${key.minor ? 'minor' : 'major'}`

/** C first, then the keys with sharps, then the ones with flats (as key signatures are usually listed). */
const keyOrder = (key: KeySignature): number => (key.fifths >= 0 ? key.fifths : 7 - key.fifths)

/** Song properties (REQUIREMENTS.md PRJ-03): title, author, tempo and key signature. */
export function SongDialog({ song, cursor, onApply, onClose }: Props): React.JSX.Element {
  const [title, setTitle] = useState(song.title)
  const [author, setAuthor] = useState(song.author ?? '')
  const [tempo, setTempo] = useState(String(song.tempo))
  const [key, setKey] = useState(songKey(song))
  const [moveNotes, setMoveNotes] = useState(true)
  const tempoValue = Number(tempo)
  const validTempo = Number.isFinite(tempoValue) && tempoValue >= 20 && tempoValue <= 400
  const shift = keyShift(songKey(song), key)
  const melodic = song.tracks.some((t) => t.kind !== 'drums' && t.bars.some((bar) => bar.beats.some((b) => b.notes.length > 0)))
  const changed = title !== song.title || author.trim() !== (song.author ?? '') || (validTempo && tempoValue !== song.tempo) || !sameKey(key, songKey(song))

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const apply = (): void => {
    // The notes move first (that moves the key too), then the key is set as picked (e.g. C♯ rather than D♭ major).
    const moved = moveNotes && shift !== 0 ? transpose(song, cursor, { kind: 'song' }, shift, 'keep')?.result : null
    const from = moved ?? { song, cursor }
    onApply(updateSong(from.song, from.cursor, { title, author: author.trim(), key, ...(validTempo && { tempo: tempoValue }) }))
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal song-dialog" role="dialog" aria-modal="true" aria-label="Song properties">
        <button className="icon modal-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
        <h2>Song properties</h2>

        <div className="form-row">
          <label className="grow">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </label>
          <label className="grow">
            Author
            <input value={author} placeholder="Shown under the title" onChange={(e) => setAuthor(e.target.value)} />
          </label>
        </div>
        <div className="form-row">
          <label>
            Tempo (BPM)
            <input type="number" min={20} max={400} value={tempo} onChange={(e) => setTempo(e.target.value)} />
          </label>
          <label>
            Time signature
            <span className="song-time-signature" title="Chosen when the project is created">
              {song.timeSignature.join('/')}
            </span>
          </label>
          <label className="grow">
            Key
            <select value={keyValue(key)} onChange={(e) => setKey(ALL_KEYS.find((k) => keyValue(k) === e.target.value) ?? key)}>
              {[false, true].map((minor) => (
                <optgroup key={String(minor)} label={minor ? 'Minor' : 'Major'}>
                  {ALL_KEYS.filter((k) => k.minor === minor)
                    .sort((a, b) => keyOrder(a) - keyOrder(b))
                    .map((k) => (
                      <option key={keyValue(k)} value={keyValue(k)}>
                        {keyName(k)} ({keyAccidentals(k)})
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">The key sets the sharps or flats in the score. Notes sound the same, and are written in the key.</p>

        {melodic && shift !== 0 && (
          <fieldset className="choice-group">
            <legend>The notes already written</legend>
            <label className="checkbox">
              <input type="radio" name="key-notes" checked={moveNotes} onChange={() => setMoveNotes(true)} />
              <span>
                <strong>Move them to {keyName(key)}:</strong> every track but the drums goes {describeShift(shift)}. Guitar and bass keep their strings where they can.
              </span>
            </label>
            <label className="checkbox">
              <input type="radio" name="key-notes" checked={!moveNotes} onChange={() => setMoveNotes(false)} />
              <span>
                <strong>Keep them as they sound.</strong> Only the sharps and flats in the score change.
              </span>
            </label>
          </fieldset>
        )}

        <div className="toolbar dialog-actions">
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="active" disabled={!changed} onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
