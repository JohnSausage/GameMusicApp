import { useEffect, useMemo, useRef, useState } from 'react'
import type { GetEngine } from '../App'
import { songToMidi } from '../audio/midiExport'
import { renderSongOffline } from '../audio/offline'
import { audioBufferToWav16 } from '../audio/wav'
import {
  addBars,
  addTrack,
  clearBar,
  clearBeat,
  deleteBar,
  deleteNote,
  deleteTrack,
  duplicateBar,
  insertBarBefore,
  moveBar,
  moveBeat,
  moveString,
  moveTrack,
  nextSectionName,
  pasteBar,
  sectionAt,
  setDuration,
  setFret,
  setSection,
  stepDuration,
  switchTrack,
  toggleDotted,
  updateTrack,
  type Cursor,
  type Duration,
  type EditResult
} from '../model/edit'
import {
  barCount,
  defaultInstrument,
  isBassTrack,
  MAX_FRET,
  NOTE_VALUES,
  notePitch,
  PULSE_BASS,
  PULSE_LEAD,
  type Bar,
  type NoteValue,
  type Track
} from '../model/song'
import { buildTimeline } from '../model/timing'
import { saveFile } from '../platform'
import type { ApplyOptions, Project } from '../project/useProject'
import { ScoreView, type ScoreTarget, type StaveMode } from '../score/ScoreView'
import { noteName } from '../transcription/notes'
import { usePlayback } from './usePlayback'

const VALUE_LABELS: Record<NoteValue, { short: string; long: string }> = {
  1: { short: '1/1', long: 'Whole note' },
  2: { short: '1/2', long: 'Half note' },
  4: { short: '1/4', long: 'Quarter note' },
  8: { short: '1/8', long: 'Eighth note' },
  16: { short: '1/16', long: 'Sixteenth note' },
  32: { short: '1/32', long: 'Thirty-second note' }
}

/** Two digits typed within this time on the same spot make one fret (1 then 2 → 12). */
const TWO_DIGIT_MS = 1000

const cursorKey = (c: Cursor): string => `${c.track}/${c.bar}/${c.beat}/${c.string}`

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

interface Props {
  project: Project
  getEngine: GetEngine
}

function TrackList({ project, onSelect }: { project: Project; onSelect: (index: number) => void }): React.JSX.Element {
  const { song, cursor } = project
  const setInstrument = (index: number, track: Track, value: string): void => {
    const bass = isBassTrack(track)
    const instrument = value === 'synth' ? { kind: 'synth' as const, patch: bass ? PULSE_BASS : PULSE_LEAD } : defaultInstrument(bass ? 'bass' : 'guitar')
    project.apply(updateTrack(song, cursor, index, { instrument }))
  }
  const remove = (index: number, track: Track): void => {
    if (song.tracks.length <= 1) return
    if (window.confirm(`Delete the track "${track.name}"?`)) project.apply(deleteTrack(song, cursor, index))
  }

  return (
    <aside className="track-list">
      <h3>Tracks</h3>
      {song.tracks.map((track, index) => (
        <div key={track.id} className={`track-card ${index === cursor.track ? 'selected' : ''}`} onClick={() => onSelect(index)}>
          <div className="track-card-row">
            <input
              className="track-name"
              value={track.name}
              aria-label="Track name"
              onChange={(e) => project.apply(updateTrack(song, cursor, index, { name: e.target.value }), { mergeKey: `name:${track.id}` })}
            />
            <button className="icon" title="Delete track" aria-label={`Delete ${track.name}`} disabled={song.tracks.length <= 1} onClick={(e) => {
              e.stopPropagation()
              remove(index, track)
            }}>
              ×
            </button>
          </div>
          <div className="track-card-row">
            <select value={track.instrument.kind} aria-label="Sound" onChange={(e) => setInstrument(index, track, e.target.value)}>
              <option value="soundfont">{isBassTrack(track) ? 'Bass' : 'Guitar'} (SoundFont)</option>
              <option value="synth">Pulse synth (8-bit)</option>
            </select>
          </div>
          <label className="track-card-row volume">
            Volume
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={track.volume}
              onChange={(e) => project.apply(updateTrack(song, cursor, index, { volume: Number(e.target.value) }), { mergeKey: `volume:${track.id}` })}
            />
          </label>
        </div>
      ))}
      <div className="toolbar">
        <button onClick={() => project.apply(addTrack(song, cursor, 'guitar'))}>+ Guitar</button>
        <button onClick={() => project.apply(addTrack(song, cursor, 'bass'))}>+ Bass</button>
      </div>
    </aside>
  )
}

export function TabEditor({ project, getEngine }: Props): React.JSX.Element {
  const { song, cursor } = project
  const [staveMode, setStaveMode] = useState<StaveMode>('notation+tab')
  const [entryDuration, setEntryDuration] = useState<Duration>({ value: 4, dotted: false })
  const [message, setMessage] = useState('')
  const [clipboard, setClipboard] = useState<Bar | null>(null)
  const [busy, setBusy] = useState(false)
  const pendingDigit = useRef<{ key: string; digit: number; at: number } | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const { playing, positionRef, play, stop } = usePlayback(getEngine)
  const timeline = useMemo(() => buildTimeline(song), [song])

  const track = song.tracks[cursor.track]
  const beat = track.bars[cursor.bar].beats[cursor.beat]
  const noteOnString = beat.notes.find((n) => n.string === cursor.string)
  const section = sectionAt(song, cursor.bar)

  useEffect(() => {
    editorRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 3500)
    return () => window.clearTimeout(timer)
  }, [message])

  const focus = (): void => editorRef.current?.focus()

  const edit = (result: EditResult | null, failMessage?: string, options?: ApplyOptions): void => {
    if (!project.apply(result, options) && failMessage) setMessage(failMessage)
    focus()
  }

  const audition = async (pitch: number): Promise<void> => {
    const engine = await getEngine()
    engine.liveNoteOn(track.instrument, pitch, 90)
    window.setTimeout(() => engine.liveNoteOff(track.instrument, pitch), 300)
  }

  const enterDigit = (digit: number): void => {
    const key = cursorKey(cursor)
    const pending = pendingDigit.current
    const now = performance.now()
    let fret = digit
    let mergeKey = `fret:${key}:${now}`
    if (pending && pending.key === key && pending.digit > 0 && now - pending.at < TWO_DIGIT_MS && pending.digit * 10 + digit <= MAX_FRET) {
      fret = pending.digit * 10 + digit
      mergeKey = `fret:${key}:${pending.at}`
      pendingDigit.current = null
    } else {
      pendingDigit.current = { key, digit, at: now }
    }
    if (project.apply(setFret(song, cursor, fret, entryDuration), { mergeKey })) {
      void audition(track.tuning[cursor.string - 1] + fret)
    }
  }

  const playFromCursor = (): void => {
    const span = timeline.beats.find((b) => b.trackIndex === cursor.track && b.barIndex === cursor.bar && b.beatIndex === cursor.beat)
    void play(song, span?.start ?? 0)
  }

  const chooseDuration = (duration: Duration): void => {
    setEntryDuration(duration)
    edit(setDuration(song, cursor, duration), 'Not enough room left in this bar for a longer note.')
  }

  const copyBar = (): void => {
    setClipboard(structuredClone(track.bars[cursor.bar]))
    setMessage(`Copied bar ${cursor.bar + 1}.`)
  }

  const paste = (): void => {
    if (!clipboard) setMessage('Copy a bar first (Ctrl+C).')
    else edit(pasteBar(song, cursor, clipboard), "The copied bar doesn't fit this time signature.")
  }

  const addBar = (): void => edit(addBars(song, cursor, 1))
  const addSection = (): void => edit(addBars(song, cursor, 4, nextSectionName(song)))

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (isTyping(event.target)) return
    const ctrl = event.ctrlKey || event.metaKey
    const key = event.key
    let handled = true
    if (/^[0-9]$/.test(key) && !ctrl && !event.altKey) enterDigit(Number(key))
    else if (key === 'ArrowRight') project.setCursor(ctrl ? moveBar(song, cursor, 1) : moveBeat(song, cursor, 1))
    else if (key === 'ArrowLeft') project.setCursor(ctrl ? moveBar(song, cursor, -1) : moveBeat(song, cursor, -1))
    else if (key === 'ArrowUp') project.setCursor(ctrl ? moveTrack(song, cursor, -1) : moveString(song, cursor, -1))
    else if (key === 'ArrowDown') project.setCursor(ctrl ? moveTrack(song, cursor, 1) : moveString(song, cursor, 1))
    else if ((key === 'Delete' || key === 'Backspace') && ctrl) edit(deleteBar(song, cursor), 'A song needs at least one bar.')
    else if (key === 'Delete' || key === 'Backspace') edit(deleteNote(song, cursor))
    else if (key === '+' || key === '=') edit(stepDuration(song, cursor, 'longer'), 'Not enough room left in this bar for a longer note.')
    else if (key === '-') edit(stepDuration(song, cursor, 'shorter'))
    else if (key === '.') edit(toggleDotted(song, cursor), 'Not enough room left in this bar for a dotted note.')
    else if (key.toLowerCase() === 'r' && !ctrl) edit(clearBeat(song, cursor))
    else if (key === ' ') playing ? stop() : playFromCursor()
    else if (key === 'Insert') edit(insertBarBefore(song, cursor))
    else if (ctrl && key.toLowerCase() === 'c') copyBar()
    else if (ctrl && key.toLowerCase() === 'v') paste()
    else if (ctrl && key.toLowerCase() === 'd') edit(duplicateBar(song, cursor))
    else handled = false
    if (handled) event.preventDefault()
  }

  const onScoreClick = (target: ScoreTarget): void => {
    const sameTrack = target.trackIndex === cursor.track
    project.setCursor({
      track: target.trackIndex,
      bar: target.barIndex,
      beat: target.beatIndex,
      string: target.string ?? (sameTrack ? cursor.string : 1)
    })
    focus()
  }

  const exportWav = async (): Promise<void> => {
    setBusy(true)
    setMessage('Rendering WAV…')
    try {
      const buffer = await renderSongOffline(song, 48000)
      const path = await saveFile(`${song.title}.wav`, audioBufferToWav16(buffer))
      setMessage(path ? `WAV saved: ${path}` : '')
    } catch (error) {
      setMessage(`WAV export failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const exportMidi = async (): Promise<void> => {
    const path = await saveFile(`${song.title}.mid`, songToMidi(song))
    setMessage(path ? `MIDI saved: ${path}` : '')
  }

  const describeCursor = (): string => {
    const open = noteName(track.tuning[cursor.string - 1])
    const what = noteOnString ? `fret ${noteOnString.fret} (${noteName(notePitch(track, noteOnString))})` : beat.notes.length === 0 ? 'rest' : 'empty string'
    return `${track.name} · bar ${cursor.bar + 1} of ${barCount(song)} · beat ${cursor.beat + 1} · string ${cursor.string} (${open}) · ${what}`
  }

  return (
    <div className="tab-editor">
      <TrackList project={project} onSelect={(index) => project.setCursor(switchTrack(song, cursor, index))} />

      <div ref={editorRef} className="editor-main" tabIndex={0} onKeyDown={onKeyDown}>
        <div className="toolbar">
          {playing ? <button onClick={stop}>■ Stop</button> : <button onClick={playFromCursor} title="Play from the cursor (Space)">▶ Play</button>}
          <div className="segmented">
            <button className={staveMode === 'notation+tab' ? 'active' : ''} onClick={() => setStaveMode('notation+tab')}>Notation + tab</button>
            <button className={staveMode === 'tab' ? 'active' : ''} onClick={() => setStaveMode('tab')}>Tab only</button>
          </div>
          <span className="spacer" />
          <button disabled={busy} onClick={() => void exportWav()}>Export WAV</button>
          <button onClick={() => void exportMidi()}>Export MIDI</button>
        </div>

        <div className="toolbar edit-toolbar">
          <div className="segmented" role="group" aria-label="Note length">
            {NOTE_VALUES.map((value) => (
              <button
                key={value}
                className={beat.value === value ? 'active' : ''}
                title={`${VALUE_LABELS[value].long} (+ / − change the length)`}
                onClick={() => chooseDuration({ value, dotted: beat.dotted })}
              >
                {VALUE_LABELS[value].short}
              </button>
            ))}
          </div>
          <button className={beat.dotted ? 'active' : ''} title="Dotted (.)" onClick={() => chooseDuration({ value: beat.value, dotted: !beat.dotted })}>
            Dotted
          </button>
          <button title="Make this beat a rest (R)" onClick={() => edit(clearBeat(song, cursor))}>Rest</button>
          <span className="divider" />
          <button title="Insert an empty bar before this one (Insert)" onClick={() => edit(insertBarBefore(song, cursor))}>Insert bar</button>
          <button title="Duplicate this bar (Ctrl+D)" onClick={() => edit(duplicateBar(song, cursor))}>Duplicate</button>
          <button title="Copy this bar (Ctrl+C)" onClick={copyBar}>Copy</button>
          <button title="Paste over this bar (Ctrl+V)" onClick={paste}>Paste</button>
          <button title="Clear this bar in the current track" onClick={() => edit(clearBar(song, cursor))}>Clear</button>
          <button title="Delete this bar from all tracks (Ctrl+Delete)" onClick={() => edit(deleteBar(song, cursor), 'A song needs at least one bar.')}>Delete bar</button>
          <span className="divider" />
          {section === null ? (
            <button title="Start a named section at this bar" onClick={() => edit(setSection(song, cursor, cursor.bar, nextSectionName(song)))}>
              Start section here
            </button>
          ) : (
            <label className="section-name">
              Section
              <input
                value={section}
                onChange={(e) => project.apply(setSection(song, cursor, cursor.bar, e.target.value), { mergeKey: `section:${cursor.bar}` })}
              />
              <button className="icon" title="Remove section" aria-label="Remove section" onClick={() => edit(setSection(song, cursor, cursor.bar, null))}>
                ×
              </button>
            </label>
          )}
        </div>

        <div className="info-line">
          <span>{describeCursor()}</span>
          {message && <span className="status">{message}</span>}
        </div>

        <ScoreView
          song={song}
          staveMode={staveMode}
          positionRef={positionRef}
          editCursor={cursor}
          onScoreClick={onScoreClick}
          endActions={
            <>
              <button onClick={addBar} title="Add an empty bar at the end">+ Bar</button>
              <button onClick={addSection} title="Add 4 empty bars as a new named section">+ Section</button>
            </>
          }
        />

        <p className="shortcuts muted small">
          <kbd>←</kbd> <kbd>→</kbd> beat · <kbd>↑</kbd> <kbd>↓</kbd> string · <kbd>Ctrl</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> track · <kbd>Ctrl</kbd>+<kbd>←</kbd>/<kbd>→</kbd> bar ·
          <kbd>0</kbd>–<kbd>9</kbd> fret (type two digits for 10–24) · <kbd>Del</kbd> remove note · <kbd>R</kbd> rest · <kbd>+</kbd> <kbd>−</kbd> length ·
          <kbd>.</kbd> dotted · <kbd>Space</kbd> play · <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> undo/redo · <kbd>Ctrl</kbd>+<kbd>S</kbd> save
        </p>
      </div>
    </div>
  )
}
