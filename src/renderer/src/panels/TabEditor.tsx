import { useEffect, useMemo, useRef, useState } from 'react'
import type { GetEngine } from '../App'
import { songToMidi } from '../audio/midiExport'
import {
  addBars,
  addTrack,
  clearBar,
  clearBeat,
  clearSelection,
  deleteSelection,
  deleteBar,
  deleteBeat,
  deleteNote,
  deleteTrack,
  duplicateBar,
  insertBarBefore,
  isRetro,
  makeRetro,
  moveBar,
  moveBeat,
  moveString,
  moveTrack,
  nextSectionName,
  pasteBeats,
  loopBars,
  restoreSounds,
  sectionAt,
  sectionRangeOf,
  sectionRanges,
  selectionBeats,
  selectionBetween,
  selectTrack,
  setSelectionDuration,
  setDuration,
  setFret,
  setSection,
  stepDuration,
  switchTrack,
  updateMaster,
  updateTrack,
  type BarRange,
  type BeatPos,
  type Cursor,
  type LoopChoice,
  type Duration,
  type EditResult
} from '../model/edit'
import {
  audibleTracks,
  barCount,
  defaultInstrument,
  DRUM_PIECES,
  MASTER_DEFAULTS,
  MAX_FRET,
  NOTE_VALUES,
  notePitch,
  type Beat,
  type Instrument,
  type NoteValue,
  type Track,
  trackKind
} from '../model/song'
import { CRUSH_RATES, eightBitKit, FACTORY_PRESETS, formatSampleRate } from '../model/synth'
import { legatoTarget, toggleLegato, toggleTie, type Legato } from '../model/techniques'
import { barSeconds, buildTimeline } from '../model/timing'
import { saveFile } from '../platform'
import { readPref, writePref } from '../prefs'
import type { ApplyOptions, Project } from '../project/useProject'
import { ScoreView, type ScoreTarget, type StaveMode } from '../score/ScoreView'
import { noteName } from '../transcription/notes'
import { DrumGrid } from './DrumGrid'
import { ExportDialog } from './ExportDialog'
import { InstrumentEditor } from './InstrumentEditor'
import { TakeDialog } from './TakeDialog'
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

const GRID_COLLAPSED_KEY = 'drumGridCollapsed'
const ZOOM_KEY = 'scoreZoom'
/** Zoom levels of the score (VIEW-10). */
const ZOOM_STEPS = [0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

/** The next zoom level up (+1) or down (-1) from `zoom`. */
function stepZoom(zoom: number, direction: 1 | -1): number {
  const index = ZOOM_STEPS.findIndex((z) => z >= zoom - 0.001)
  const current = index < 0 ? ZOOM_STEPS.length - 1 : index
  return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, current + direction))]
}

const barsLabel = (range: BarRange): string => (range.end - range.start === 1 ? `bar ${range.start + 1}` : `bars ${range.start + 1}–${range.end}`)

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

interface Props {
  project: Project
  getEngine: GetEngine
}

function soundValue(track: Track): string {
  if (track.instrument.kind === 'soundfont') return 'soundfont'
  if (track.instrument.kind === 'synthkit') return 'synthkit'
  return 'synth:current'
}

const SOUNDFONT_LABELS = { guitar: 'Guitar (SoundFont)', bass: 'Bass (SoundFont)', drums: 'Drum kit (SoundFont)' }

function TrackList({ project, onSelect, onEditSound }: { project: Project; onSelect: (index: number) => void; onEditSound: (index: number) => void }): React.JSX.Element {
  const { song, cursor } = project
  const retro = isRetro(song)
  const master = { ...MASTER_DEFAULTS, ...song.master }
  const audible = audibleTracks(song)

  const setSound = (index: number, track: Track, value: string): void => {
    if (value === 'synth:current' || value === soundValue(track)) return
    const instrument: Instrument =
      value === 'soundfont'
        ? defaultInstrument(trackKind(track))
        : value === 'synthkit'
          ? { kind: 'synthkit', pieces: eightBitKit() }
          : { kind: 'synth', patch: { ...FACTORY_PRESETS[Number(value.slice(7))] } }
    project.apply(updateTrack(song, cursor, index, { instrument }))
  }
  const remove = (index: number, track: Track): void => {
    if (song.tracks.length <= 1) return
    if (window.confirm(`Delete the track "${track.name}"?`)) project.apply(deleteTrack(song, cursor, index))
  }

  return (
    <aside className="track-list">
      <div className="track-list-header">
        <h3>Tracks</h3>
        <button
          className={retro ? '' : 'active'}
          title={retro ? 'Switch every track back to the sound it had before' : 'Give every track an 8-bit sound by its role (bass, lead, …). Notes stay the same.'}
          onClick={() => project.apply(retro ? restoreSounds(song, cursor) : makeRetro(song, cursor))}
        >
          {retro ? '↩ Original sounds' : '★ Make it retro'}
        </button>
      </div>
      {song.tracks.map((track, index) => (
        <div key={track.id} className={`track-card ${index === cursor.track ? 'selected' : ''} ${audible[index] ? '' : 'silent'}`} onClick={() => onSelect(index)}>
          <div className="track-card-row">
            <input
              className="track-name"
              value={track.name}
              aria-label="Track name"
              onChange={(e) => project.apply(updateTrack(song, cursor, index, { name: e.target.value }), { mergeKey: `name:${track.id}` })}
            />
            <button
              className={`icon mute ${track.mute ? 'active' : ''}`}
              aria-pressed={!!track.mute}
              aria-label={`Mute ${track.name}`}
              title="Mute: don't play this track (also left out of WAV export)"
              onClick={(e) => {
                e.stopPropagation()
                project.apply(updateTrack(song, cursor, index, { mute: !track.mute }))
              }}
            >
              M
            </button>
            <button
              className={`icon solo ${track.solo ? 'active' : ''}`}
              aria-pressed={!!track.solo}
              aria-label={`Solo ${track.name}`}
              title="Solo: play only the soloed tracks (also for WAV export)"
              onClick={(e) => {
                e.stopPropagation()
                project.apply(updateTrack(song, cursor, index, { solo: !track.solo }))
              }}
            >
              S
            </button>
            <button className="icon" title="Delete track" aria-label={`Delete ${track.name}`} disabled={song.tracks.length <= 1} onClick={(e) => {
              e.stopPropagation()
              remove(index, track)
            }}>
              ×
            </button>
          </div>
          <div className="track-card-row">
            <select value={soundValue(track)} aria-label="Sound" onChange={(e) => setSound(index, track, e.target.value)}>
              <option value="soundfont">{SOUNDFONT_LABELS[trackKind(track)]}</option>
              {track.kind === 'drums' ? (
                <option value="synthkit">8-bit drum kit (synth)</option>
              ) : (
                <>
                  {track.instrument.kind === 'synth' && <option value="synth:current">Synth: {track.instrument.patch.name}</option>}
                  <optgroup label="Synth presets">
                    {FACTORY_PRESETS.map((p, i) => (
                      <option key={p.name} value={`preset:${i}`}>{p.name}</option>
                    ))}
                  </optgroup>
                </>
              )}
            </select>
          </div>
          {track.instrument.kind !== 'soundfont' && (
            <div className="track-card-row">
              <button onClick={(e) => {
                e.stopPropagation()
                onEditSound(index)
              }}>
                Edit sound…
              </button>
            </div>
          )}
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
        <button onClick={() => project.apply(addTrack(song, cursor, 'drums'))}>+ Drums</button>
      </div>

      <div className="track-card master-card">
        <strong>Master: lo-fi</strong>
        <label className="track-card-row volume" title="Bitcrusher on the whole mix, including SoundFont tracks. Fewer bits are grittier; 16 = off.">
          Bits
          <input
            type="range"
            min={1}
            max={16}
            step={1}
            value={master.crushBits}
            onChange={(e) => project.apply(updateMaster(song, cursor, { crushBits: Number(e.target.value) }), { mergeKey: 'master:bits' })}
          />
          <span className="muted small">{master.crushBits >= 16 ? 'off' : master.crushBits}</span>
        </label>
        <label className="track-card-row" title="Lower sample rates add a crunchy, aliased sound.">
          Rate
          <select value={master.crushRate} onChange={(e) => project.apply(updateMaster(song, cursor, { crushRate: Number(e.target.value) }))}>
            {CRUSH_RATES.map((r) => (
              <option key={r} value={r}>{formatSampleRate(r)}</option>
            ))}
          </select>
        </label>
      </div>
    </aside>
  )
}

export function TabEditor({ project, getEngine }: Props): React.JSX.Element {
  const { song, cursor } = project
  const [staveMode, setStaveMode] = useState<StaveMode>('notation+tab')
  const [entryDuration, setEntryDuration] = useState<Duration>({ value: 4, dotted: false })
  const [message, setMessage] = useState('')
  /** Copied beats, and whether they came from a drum track (they only paste into the same kind). */
  const [clipboard, setClipboard] = useState<{ beats: Beat[]; drums: boolean } | null>(null)
  /** Where the current selection started; the selection runs from here to the cursor. */
  const [anchor, setAnchor] = useState<{ track: number; pos: BeatPos } | null>(null)
  const [takeDialog, setTakeDialog] = useState(false)
  const [exportDialog, setExportDialog] = useState(false)
  const [loop, setLoop] = useState(false)
  const [loopChoice, setLoopChoice] = useState<LoopChoice>({ kind: 'song' })
  const [metronome, setMetronome] = useState(false)
  const [zoom, setZoom] = useState(() => readPref(ZOOM_KEY, 1))
  const [soundEditor, setSoundEditor] = useState<number | null>(null)
  const [gridCollapsed, setGridCollapsed] = useState(() => readPref(GRID_COLLAPSED_KEY, false))
  /** The drum track the grid showed last, so it stays when the cursor moves to another track. */
  const [gridTrackId, setGridTrackId] = useState<string | null>(null)
  const pendingDigit = useRef<{ key: string; digit: number; at: number } | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const playback = usePlayback(getEngine)
  const { playing, positionRef, stop } = playback
  const timeline = useMemo(() => buildTimeline(song), [song])

  const track = song.tracks[cursor.track]
  const drums = track.kind === 'drums'
  const drumTracks = song.tracks.flatMap((t, i) => (t.kind === 'drums' ? [i] : []))
  // The drum grid shows the drum track at the cursor, else the one shown last, else the first one.
  const gridTrack = drums ? cursor.track : (drumTracks.find((i) => song.tracks[i].id === gridTrackId) ?? drumTracks[0] ?? null)
  const beat = track.bars[cursor.bar].beats[cursor.beat]
  const noteOnString = beat.notes.find((n) => n.string === cursor.string)
  const section = sectionAt(song, cursor.bar)
  const selection =
    anchor && anchor.track === cursor.track && (anchor.pos.bar !== cursor.bar || anchor.pos.beat !== cursor.beat)
      ? selectionBetween(cursor.track, anchor.pos, cursor)
      : null
  const selectedCount = selection ? selectionBeats(song, selection).length : 0
  const cursorSection = sectionRangeOf(song, cursor.bar)
  const selectedBars: BarRange | null = selection ? { start: selection.start.bar, end: selection.end.bar + 1 } : null
  const loopRange = loopBars(song, loopChoice)

  useEffect(() => {
    editorRef.current?.focus()
  }, [])

  useEffect(() => {
    if (drums) setGridTrackId(track.id)
  }, [drums, track.id])

  const toggleGrid = (): void => {
    setGridCollapsed((collapsed) => {
      writePref(GRID_COLLAPSED_KEY, !collapsed)
      return !collapsed
    })
  }

  const changeZoom = (next: (zoom: number) => number): void => {
    setZoom((zoom) => {
      const value = next(zoom)
      writePref(ZOOM_KEY, value)
      return value
    })
  }

  // Ctrl + mouse wheel over the editor zooms the score.
  useEffect(() => {
    const element = editorRef.current
    if (!element) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return
      event.preventDefault()
      changeZoom((z) => stepZoom(z, event.deltaY < 0 ? 1 : -1))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  // Volume, mute and solo changes are heard right away while playing.
  useEffect(() => {
    if (playing) playback.updateMix(song)
  }, [song, playing])

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

  /** Plays a note of a track (by default the cursor's) for a moment. */
  const audition = async (pitch: number, velocity = 90, on: Track = track): Promise<void> => {
    const engine = await getEngine()
    const isDrums = on.kind === 'drums'
    engine.liveNoteOn(on.instrument, pitch, velocity, isDrums)
    window.setTimeout(() => engine.liveNoteOff(on.instrument, pitch, isDrums), 300)
  }

  /** Drum tracks: a hit on the cursor's kit piece (digits and X). */
  const enterHit = (): void => {
    if (project.apply(setFret(song, cursor, 0, entryDuration))) void audition(track.tuning[cursor.string - 1])
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

  /** Plays from `from` seconds with the current (or given) loop and metronome settings. */
  const playFrom = (from: number, withLoop = loop, range: BarRange = loopRange): void => {
    const bar = barSeconds(song)
    void playback.play(song, from, { loop: withLoop ? { start: range.start * bar, end: range.end * bar } : null, metronome })
  }

  const playFromCursor = (): void => {
    const span = timeline.beats.find((b) => b.trackIndex === cursor.track && b.barIndex === cursor.bar && b.beatIndex === cursor.beat)
    playFrom(span?.start ?? 0)
  }

  /** Loop on/off; while playing, playback continues from where it is with the new setting. */
  const toggleLoop = (): void => {
    setLoop(!loop)
    if (playing) playFrom(positionRef.current ?? 0, !loop)
  }

  /** Picks what to loop and switches looping on; while playing, it applies right away. */
  const chooseLoop = (value: string): void => {
    const choice: LoopChoice =
      value === 'selection' && selectedBars
        ? { kind: 'bars', ...selectedBars }
        : value.startsWith('section:')
          ? { kind: 'section', start: Number(value.slice(8)) }
          : value === 'song'
            ? { kind: 'song' }
            : loopChoice
    setLoopChoice(choice)
    setLoop(true)
    if (playing) playFrom(positionRef.current ?? 0, true, loopBars(song, choice))
    focus()
  }

  const toggleMetronome = (): void => {
    setMetronome(!metronome)
    playback.setMetronome(!metronome)
  }

  /** Moves the cursor; with `extend` (Shift) the selection grows from where it started. */
  const moveCursor = (next: Cursor, extend = false): void => {
    if (extend && next.track === cursor.track) setAnchor((a) => (a && a.track === cursor.track ? a : { track: cursor.track, pos: { bar: cursor.bar, beat: cursor.beat } }))
    else setAnchor(null)
    project.setCursor(next)
  }

  const NO_ROOM = 'Not enough room left in the bar for longer notes. Make room first (e.g. shorten or delete what follows).'

  /** Changes the length of the selected beats, or of the beat at the cursor. */
  const changeLength = (change: (b: Beat) => Duration): void => {
    if (selection) edit(setSelectionDuration(song, cursor, selection, change), NO_ROOM)
    else edit(setDuration(song, cursor, change(beat)), NO_ROOM)
  }

  const chooseDuration = (duration: Duration): void => {
    setEntryDuration(duration)
    changeLength(() => duration)
  }

  const toggleDots = (): void => {
    const dotted = !(selection ? selectionBeats(song, selection).every((b) => b.dotted) : beat.dotted)
    changeLength((b) => ({ value: b.value, dotted }))
  }

  const stepLength = (direction: 'shorter' | 'longer'): void => {
    if (!selection) {
      edit(stepDuration(song, cursor, direction), NO_ROOM)
      return
    }
    changeLength((b) => {
      const index = NOTE_VALUES.indexOf(b.value) + (direction === 'shorter' ? 1 : -1)
      return { value: NOTE_VALUES[Math.min(NOTE_VALUES.length - 1, Math.max(0, index))], dotted: b.dotted }
    })
  }

  const copy = (cut = false): void => {
    const beats = selection ? selectionBeats(song, selection) : structuredClone(track.bars[cursor.bar].beats)
    setClipboard({ beats, drums })
    setMessage(selection ? `${cut ? 'Cut' : 'Copied'} ${beats.length} beats.` : `${cut ? 'Cut' : 'Copied'} bar ${cursor.bar + 1}.`)
    if (cut) edit(selection ? clearSelection(song, cursor, selection) : clearBar(song, cursor))
  }

  /** Pastes at the start of the selection, or at the cursor. */
  const paste = (): void => {
    if (!clipboard) {
      setMessage('Copy something first (Ctrl+C).')
      return
    }
    if (clipboard.drums !== drums) {
      setMessage(clipboard.drums ? 'Drum beats can only be pasted into a drum track.' : 'Guitar and bass notes can’t be pasted into a drum track.')
      return
    }
    const at = selection ? { ...cursor, bar: selection.start.bar, beat: selection.start.beat } : cursor
    setAnchor(null)
    edit(pasteBeats(song, at, clipboard.beats))
  }

  /** Delete: selected beats become rests. Shift+Delete / "Delete beat": they're removed and the bar closes the gap. */
  const removeSelection = (remove: boolean): void => {
    if (!selection) return
    if (remove) {
      setAnchor(null)
      edit(deleteSelection(song, cursor, selection))
    } else edit(clearSelection(song, cursor, selection))
  }

  const removeBeat = (): void => {
    if (selection) removeSelection(true)
    else edit(deleteBeat(song, cursor), 'Only rests follow in this bar, so there is nothing to move up.')
  }

  /** Hold (tie) the note before the cursor through this beat, or stop holding it. */
  const tie = (): void => {
    setAnchor(null)
    edit(toggleTie(song, cursor, entryDuration), 'Nothing to hold: the beat before has no note on this string.')
  }

  /** Hammer-on/pull-off or slide from the note at the cursor into the next one. */
  const legato = (kind: Legato): void => {
    setAnchor(null)
    edit(
      toggleLegato(song, cursor, kind),
      noteOnString
        ? 'Hammer-ons and slides go into a note on another fret of this string, in the very next beat. Enter that note first.'
        : 'Put the cursor on a note first.'
    )
  }

  const selectAll = (): void => {
    const all = selectTrack(song, cursor.track)
    setAnchor({ track: cursor.track, pos: all.start })
    project.setCursor({ ...cursor, bar: all.end.bar, beat: all.end.beat })
  }

  const addBar = (): void => edit(addBars(song, cursor, 1))
  const addSection = (): void => edit(addBars(song, cursor, 4, nextSectionName(song)))

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (isTyping(event.target)) return
    const ctrl = event.ctrlKey || event.metaKey
    const key = event.key
    let handled = true
    const shift = event.shiftKey
    if (ctrl && (key === '=' || key === '+')) changeZoom((z) => stepZoom(z, 1))
    else if (ctrl && key === '-') changeZoom((z) => stepZoom(z, -1))
    else if (ctrl && key === '0') changeZoom(() => 1)
    else if (drums && /^[0-9xX]$/.test(key) && !ctrl && !event.altKey) {
      setAnchor(null)
      enterHit()
    } else if (/^[0-9]$/.test(key) && !ctrl && !event.altKey) {
      setAnchor(null)
      enterDigit(Number(key))
    } else if (key === 'ArrowRight') moveCursor(ctrl ? moveBar(song, cursor, 1) : moveBeat(song, cursor, 1), shift)
    else if (key === 'ArrowLeft') moveCursor(ctrl ? moveBar(song, cursor, -1) : moveBeat(song, cursor, -1), shift)
    else if (key === 'ArrowUp') ctrl ? moveCursor(moveTrack(song, cursor, -1)) : project.setCursor(moveString(song, cursor, -1))
    else if (key === 'ArrowDown') ctrl ? moveCursor(moveTrack(song, cursor, 1)) : project.setCursor(moveString(song, cursor, 1))
    else if (key === 'Escape' && selection) setAnchor(null)
    else if ((key === 'Delete' || key === 'Backspace') && ctrl) {
      setAnchor(null)
      edit(deleteBar(song, cursor), 'A song needs at least one bar.')
    } else if ((key === 'Delete' || key === 'Backspace') && selection) removeSelection(shift)
    else if ((key === 'Delete' || key === 'Backspace') && (shift || beat.notes.length === 0)) removeBeat()
    else if (key === 'Delete' || key === 'Backspace') {
      edit(deleteNote(song, cursor), 'No note on this string. Shift+Delete removes the whole beat.')
    }
    else if (key === '+' || key === '=') stepLength('longer')
    else if (key === '-') stepLength('shorter')
    else if (key === '.') toggleDots()
    else if (key.toLowerCase() === 'r' && !ctrl) selection ? removeSelection(false) : edit(clearBeat(song, cursor))
    else if (key === ' ') playing ? stop() : playFromCursor()
    else if (key.toLowerCase() === 't' && !ctrl && !drums) tie()
    else if (key.toLowerCase() === 'h' && !ctrl && !drums) legato('hammer')
    else if (key.toLowerCase() === 's' && !ctrl && !drums) legato('slide')
    else if (key.toLowerCase() === 'l' && !ctrl) toggleLoop()
    else if (key.toLowerCase() === 'm' && !ctrl) toggleMetronome()
    else if (key === 'Insert') edit(insertBarBefore(song, cursor))
    else if (ctrl && key.toLowerCase() === 'a') selectAll()
    else if (ctrl && key.toLowerCase() === 'c') copy()
    else if (ctrl && key.toLowerCase() === 'x') copy(true)
    else if (ctrl && key.toLowerCase() === 'v') paste()
    else if (ctrl && key.toLowerCase() === 'd') edit(duplicateBar(song, cursor))
    else handled = false
    if (handled) event.preventDefault()
  }

  const onScoreClick = (target: ScoreTarget, extend: boolean): void => {
    const sameTrack = target.trackIndex === cursor.track
    moveCursor(
      {
        track: target.trackIndex,
        bar: target.barIndex,
        beat: target.beatIndex,
        string: target.string ?? (sameTrack ? cursor.string : 1)
      },
      extend
    )
    focus()
  }

  /** A rectangle dragged over the score selects the beats inside it. */
  const onSelectArea = (area: { track: number; start: BeatPos; end: BeatPos }): void => {
    setAnchor({ track: area.track, pos: area.start })
    const strings = song.tracks[area.track].tuning.length
    project.setCursor({ track: area.track, bar: area.end.bar, beat: area.end.beat, string: Math.min(cursor.string, strings) })
    focus()
  }

  const exportMidi = async (): Promise<void> => {
    const path = await saveFile(`${song.title}.mid`, songToMidi(song))
    setMessage(path ? `MIDI saved: ${path}` : '')
  }

  /** E.g. " · held · hammer-on" for the note at the cursor. */
  const techniqueText = (): string => {
    if (!noteOnString) return ''
    const target = legatoTarget(song, cursor)
    const into = target ? (target.fret > noteOnString.fret ? 'up' : 'down') : null
    const parts = [
      noteOnString.tie && 'held from the note before',
      noteOnString.hammer && (into === 'down' ? 'pull-off' : 'hammer-on'),
      noteOnString.slide && `slide${into ? ` ${into}` : ''}`
    ].filter(Boolean)
    return parts.length > 0 ? ` · ${parts.join(' · ')}` : ''
  }

  const describeCursor = (): string => {
    const open = noteName(track.tuning[cursor.string - 1])
    const what = drums
      ? noteOnString ? 'hit' : beat.notes.length === 0 ? 'rest' : 'no hit'
      : noteOnString ? `fret ${noteOnString.fret} (${noteName(notePitch(track, noteOnString))})${techniqueText()}` : beat.notes.length === 0 ? 'rest' : 'empty string'
    const spot = drums ? DRUM_PIECES[cursor.string - 1]?.name : `string ${cursor.string} (${open})`
    const where = `${track.name} · bar ${cursor.bar + 1} of ${barCount(song)} · beat ${cursor.beat + 1} · ${spot} · ${what}`
    if (!selection) return where
    const bars = selection.start.bar === selection.end.bar ? `bar ${selection.start.bar + 1}` : `bars ${selection.start.bar + 1}–${selection.end.bar + 1}`
    return `${track.name} · ${selectedCount} beats selected (${bars}) · Esc to deselect`
  }

  return (
    <div className="tab-editor">
      <TrackList
        project={project}
        onSelect={(index) => project.setCursor(switchTrack(song, cursor, index))}
        onEditSound={(index) => {
          stop()
          setSoundEditor(index)
        }}
      />

      <div ref={editorRef} className="editor-main" tabIndex={0} onKeyDown={onKeyDown}>
        <div className="toolbar">
          {playing ? <button onClick={stop}>■ Stop</button> : <button onClick={playFromCursor} title="Play from the cursor (Space)">▶ Play</button>}
          <div className="loop-control">
            <button className={loop ? 'active' : ''} aria-pressed={loop} title="Loop playback on/off (L)" onClick={toggleLoop}>
              ⟲ Loop
            </button>
            <select
              aria-label="What to loop"
              title="What loop playback repeats. It stays the same while you click around in the score."
              value={loopRange.kind === 'section' ? `section:${loopRange.start}` : loopRange.kind}
              onChange={(e) => chooseLoop(e.target.value)}
            >
              <option value="song">Whole song</option>
              {sectionRanges(song).map((s) => (
                <option key={s.start} value={`section:${s.start}`}>
                  “{s.name}” ({barsLabel(s)})
                </option>
              ))}
              {loopRange.kind === 'bars' && <option value="bars">{barsLabel(loopRange).replace(/^b/, 'B')}</option>}
              <option value="selection" disabled={!selectedBars}>
                {selectedBars ? `Selected ${barsLabel(selectedBars)}` : 'Selected bars (select some beats first)'}
              </option>
            </select>
          </div>
          <button className={metronome ? 'active' : ''} aria-pressed={metronome} title="Metronome during playback (M)" onClick={toggleMetronome}>
            Metronome
          </button>
          <span className="divider" />
          <div className="segmented">
            <button className={staveMode === 'notation+tab' ? 'active' : ''} onClick={() => setStaveMode('notation+tab')}>Notation + tab</button>
            <button className={staveMode === 'tab' ? 'active' : ''} onClick={() => setStaveMode('tab')}>Tab only</button>
          </div>
          <div className="segmented" role="group" aria-label="Zoom">
            <button title="Zoom out (Ctrl+−, Ctrl+wheel)" aria-label="Zoom out" disabled={zoom <= ZOOM_STEPS[0]} onClick={() => changeZoom((z) => stepZoom(z, -1))}>
              −
            </button>
            <button title="Back to 100 % (Ctrl+0)" className="zoom-level" onClick={() => changeZoom(() => 1)}>
              {Math.round(zoom * 100)} %
            </button>
            <button title="Zoom in (Ctrl++, Ctrl+wheel)" aria-label="Zoom in" disabled={zoom >= ZOOM_STEPS.at(-1)!} onClick={() => changeZoom((z) => stepZoom(z, 1))}>
              +
            </button>
          </div>
          <button
            title={song.tracks.some((t) => t.kind !== 'drums') ? 'Record or import a take and transcribe it into a guitar or bass track' : 'Add a guitar or bass track first'}
            disabled={!song.tracks.some((t) => t.kind !== 'drums')}
            onClick={() => {
              stop()
              setTakeDialog(true)
            }}
          >
            ● Record / import
          </button>
          <span className="spacer" />
          <button
            title="Export the song, a section or some bars as WAV (loopable for Unity)"
            onClick={() => {
              stop()
              setExportDialog(true)
            }}
          >
            Export WAV…
          </button>
          <button onClick={() => void exportMidi()}>Export MIDI</button>
        </div>

        <div className="toolbar edit-toolbar">
          <div className="segmented" role="group" aria-label="Note length">
            {NOTE_VALUES.map((value) => (
              <button
                key={value}
                className={beat.value === value ? 'active' : ''}
                title={`${VALUE_LABELS[value].long} (+ / − change the length)`}
                onClick={() => chooseDuration({ value, dotted: false })}
              >
                {VALUE_LABELS[value].short}
              </button>
            ))}
          </div>
          <button className={beat.dotted ? 'active' : ''} title="Dotted (.); works on all selected beats" onClick={toggleDots}>
            Dotted
          </button>
          <button title="Make this beat a rest (R)" onClick={() => edit(clearBeat(song, cursor))}>Rest</button>
          {!drums && (
            <div className="segmented" role="group" aria-label="Techniques">
              <button
                className={noteOnString?.tie ? 'active' : ''}
                aria-pressed={!!noteOnString?.tie}
                title="Hold (T): the note before keeps sounding through this beat, also across a bar line (a tie)"
                onClick={tie}
              >
                Hold
              </button>
              <button
                className={noteOnString?.hammer ? 'active' : ''}
                aria-pressed={!!noteOnString?.hammer}
                title="Hammer-on / pull-off (H) from this note into the next note on this string"
                onClick={() => legato('hammer')}
              >
                H/P
              </button>
              <button
                className={noteOnString?.slide ? 'active' : ''}
                aria-pressed={!!noteOnString?.slide}
                title="Slide (S) from this note into the next note on this string"
                onClick={() => legato('slide')}
              >
                Slide
              </button>
            </div>
          )}
          <button title="Remove this beat or rest; the rest of the bar moves up (Shift+Delete, or Delete on a rest)" onClick={removeBeat}>
            Delete beat
          </button>
          <span className="divider" />
          <button title="Insert an empty bar before this one (Insert)" onClick={() => edit(insertBarBefore(song, cursor))}>Insert bar</button>
          <button title="Duplicate this bar (Ctrl+D)" onClick={() => edit(duplicateBar(song, cursor))}>Duplicate</button>
          <button title="Copy the selected beats, or this bar (Ctrl+C). Ctrl+X cuts." onClick={() => copy()}>Copy</button>
          <button title="Paste at the cursor or the start of the selection, overwriting what's there (Ctrl+V)" onClick={paste}>Paste</button>
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
          zoom={zoom}
          positionRef={positionRef}
          editCursor={cursor}
          selection={selection}
          onSelectArea={onSelectArea}
          onScoreClick={onScoreClick}
          endActions={
            <>
              <button onClick={addBar} title="Add an empty bar at the end">+ Bar</button>
              <button onClick={addSection} title="Add 4 empty bars as a new named section">+ Section</button>
            </>
          }
        />

        {gridTrack !== null && (
          <DrumGrid
            project={project}
            trackIndex={gridTrack}
            collapsed={gridCollapsed}
            onToggleCollapsed={toggleGrid}
            onSelectTrack={(index) => (drums ? moveCursor(switchTrack(song, cursor, index)) : setGridTrackId(song.tracks[index].id))}
            positionRef={positionRef}
            onEdit={edit}
            onAudition={(note, velocity) => void audition(note, velocity, song.tracks[gridTrack])}
          />
        )}

        <p className="shortcuts muted small">
          <kbd>←</kbd> <kbd>→</kbd> beat · <kbd>↑</kbd> <kbd>↓</kbd> {drums ? 'kit piece' : 'string'} · <kbd>Ctrl</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> track · <kbd>Ctrl</kbd>+<kbd>←</kbd>/<kbd>→</kbd> bar ·{' '}
          {drums ? (
            <>
              <kbd>X</kbd> or <kbd>0</kbd>–<kbd>9</kbd> hit
            </>
          ) : (
            <>
              <kbd>0</kbd>–<kbd>9</kbd> fret (type two digits for 10–24)
            </>
          )}{' '}
          · <kbd>Del</kbd> remove note or rest · <kbd>Shift</kbd>+<kbd>Del</kbd> remove beat · <kbd>R</kbd> rest · {!drums && (
            <>
              <kbd>T</kbd> hold · <kbd>H</kbd> hammer-on/pull-off · <kbd>S</kbd> slide ·{' '}
            </>
          )} <kbd>+</kbd> <kbd>−</kbd> length ·
          <kbd>.</kbd> dotted · <kbd>Space</kbd> play · <kbd>L</kbd> loop · <kbd>M</kbd> metronome · <kbd>Ctrl</kbd>+wheel zoom · <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> undo/redo · <kbd>Ctrl</kbd>+<kbd>S</kbd> save ·
          select: <kbd>Shift</kbd>+click, drag a box, <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd>, <kbd>Ctrl</kbd>+<kbd>A</kbd> · <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>X</kbd>/<kbd>V</kbd> copy/cut/paste
          {gridTrack !== null && (
            <>
              {' '}
              · drum grid: click add/remove, <kbd>Shift</kbd>+click accent, <kbd>Alt</kbd>+click ghost
            </>
          )}
        </p>
      </div>

      {soundEditor !== null && song.tracks[soundEditor] && song.tracks[soundEditor].instrument.kind !== 'soundfont' && (
        <InstrumentEditor
          project={project}
          trackIndex={soundEditor}
          getEngine={getEngine}
          onClose={() => {
            setSoundEditor(null)
            focus()
          }}
        />
      )}

      {exportDialog && (
        <ExportDialog
          song={song}
          bars={selectedBars ?? { start: cursor.bar, end: cursor.bar + 1 }}
          section={cursorSection?.name ?? null}
          onClose={(result) => {
            setExportDialog(false)
            if (result) setMessage(result)
            focus()
          }}
        />
      )}

      {takeDialog && (
        <TakeDialog
          project={project}
          getEngine={getEngine}
          onClose={(result) => {
            setTakeDialog(false)
            if (result) setMessage(result)
            focus()
          }}
        />
      )}
    </div>
  )
}
