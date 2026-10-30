import { useEffect, useMemo, useState } from 'react'
import { hasNotes } from '../model/arrangement'
import { barTicks, updateSong, type Cursor, type EditResult } from '../model/edit'
import { ALL_KEYS, keyAccidentals, keyName, keyShift, sameKey, songKey, type KeySignature } from '../model/keySignature'
import type { Song } from '../model/song'
import { changeTimeSignature, firstOwnSignature, TIME_SIGNATURES, type Rebar } from '../model/timeSignature'
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

const signatureValue = ([beats, unit]: [number, number]): string => `${beats}/${unit}`
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Song properties (REQUIREMENTS.md PRJ-03): title, author, tempo, time signature and key signature. */
export function SongDialog({ song, cursor, onApply, onClose }: Props): React.JSX.Element {
  const [title, setTitle] = useState(song.title)
  const [author, setAuthor] = useState(song.author ?? '')
  const [tempo, setTempo] = useState(String(song.tempo))
  const [key, setKey] = useState(songKey(song))
  const [moveNotes, setMoveNotes] = useState(true)
  const [signature, setSignature] = useState<[number, number]>(song.timeSignature)
  const [chosenRebar, setRebar] = useState<Rebar | null>(null)
  const tempoValue = Number(tempo)
  const validTempo = Number.isFinite(tempoValue) && tempoValue >= 20 && tempoValue <= 400
  const shift = keyShift(songKey(song), key)
  const melodic = song.tracks.some((t) => t.kind !== 'drums' && hasNotes(t.bars))
  const withNotes = song.tracks.some((t) => hasNotes(t.bars))
  const newSignature = signatureValue(signature) !== signatureValue(song.timeSignature)
  const signatures = TIME_SIGNATURES.some((ts) => signatureValue(ts) === signatureValue(song.timeSignature)) ? TIME_SIGNATURES : [...TIME_SIGNATURES, song.timeSignature]
  const from = barTicks(song)
  const to = barTicks({ ...song, timeSignature: signature })
  // What each way of laying out the bars would do, to show before applying.
  const previews = useMemo(
    () => (newSignature && from !== to ? { flow: changeTimeSignature(song, cursor, signature, 'flow')!, bars: changeTimeSignature(song, cursor, signature, 'bars')! } : null),
    [signatureValue(signature)]
  )
  // Moving the bar lines loses nothing; keeping the bars suits a beat more or less per bar, unless notes would go.
  const lossy = previews !== null && previews.bars.removed + previews.bars.shortened > 0
  // With time-signature changes later in the song, only the bars before the first one change, keeping their notes.
  const ownFrom = firstOwnSignature(song)
  const rebar: Rebar = chosenRebar ?? (lossy || to % from === 0 || from % to === 0 ? 'flow' : 'bars')
  const changed =
    title !== song.title || author.trim() !== (song.author ?? '') || (validTempo && tempoValue !== song.tempo) || !sameKey(key, songKey(song)) || newSignature

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const apply = (): void => {
    // The bars first, then the notes move (that moves the key too), then the key is set as picked (e.g. C♯ rather than D♭ major).
    const rebarred = (newSignature && changeTimeSignature(song, cursor, signature, rebar)?.result) || { song, cursor }
    const moved = (moveNotes && shift !== 0 && transpose(rebarred.song, rebarred.cursor, { kind: 'song' }, shift, 'keep')?.result) || rebarred
    onApply(updateSong(moved.song, moved.cursor, { title, author: author.trim(), key, ...(validTempo && { tempo: tempoValue }) }))
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
          <label title={song.changes?.length ? 'The tempo from bar 1 until the first tempo change' : undefined}>
            {song.changes?.some((c) => c.tempo !== undefined) ? 'Tempo at bar 1' : 'Tempo (BPM)'}
            <input type="number" min={20} max={400} value={tempo} onChange={(e) => setTempo(e.target.value)} />
          </label>
          <label>
            Time signature
            <select value={signatureValue(signature)} onChange={(e) => setSignature(signatures.find((ts) => signatureValue(ts) === e.target.value) ?? signature)}>
              {signatures.map((ts) => (
                <option key={signatureValue(ts)} value={signatureValue(ts)}>
                  {signatureValue(ts)}
                </option>
              ))}
            </select>
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

        {previews && withNotes && ownFrom !== null && (
          <p className="muted small">
            From bar {ownFrom + 1} on the time signature changes again, so only bars 1–{ownFrom} become {signatureValue(signature)}. Each keeps its notes from its start
            {to > from ? '; the bars end with rests.' : lossy ? `; ${plural(previews.bars.removed + previews.bars.shortened, 'note')} no longer fit${previews.bars.removed + previews.bars.shortened === 1 ? 's' : ''} and ${previews.bars.removed + previews.bars.shortened === 1 ? 'is' : 'are'} cut.` : '.'}
          </p>
        )}
        {previews && withNotes && ownFrom === null && (
          <fieldset className="choice-group">
            <legend>The bars, now {signatureValue(signature)}</legend>
            <label className="checkbox">
              <input type="radio" name="rebar" checked={rebar === 'flow'} onChange={() => setRebar('flow')} />
              <span>
                <strong>Move the bar lines.</strong> Every note stays where it is in time; a note across a new bar line is held over into the next bar.
                {previews.flow.padded > 0 && ` ${plural(previews.flow.padded, 'section')} no longer fill${previews.flow.padded === 1 ? 's' : ''} whole bars and end${previews.flow.padded === 1 ? 's' : ''} with rests.`}
                {previews.flow.copied > 0 && ` ${plural(previews.flow.copied, 'repeated part')} get${previews.flow.copied === 1 ? 's' : ''} a copy for a section, so the repeats still follow each other.`}
              </span>
            </label>
            <label className="checkbox">
              <input type="radio" name="rebar" checked={rebar === 'bars'} onChange={() => setRebar('bars')} />
              <span>
                <strong>Keep the bars.</strong> Each bar keeps its notes from its start, and sections keep their number of bars.
                {to > from
                  ? ' The bars end with rests.'
                  : lossy
                    ? ` What no longer fits is left out: ${[previews.bars.removed > 0 && `${plural(previews.bars.removed, 'note')} go`, previews.bars.shortened > 0 && `${plural(previews.bars.shortened, 'note')} get${previews.bars.shortened === 1 ? 's' : ''} shorter`].filter(Boolean).join(', ')}.`
                    : ' Nothing is lost: the end of every bar is empty.'}
              </span>
            </label>
          </fieldset>
        )}

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
