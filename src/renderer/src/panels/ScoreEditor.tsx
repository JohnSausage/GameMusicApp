import { useEffect, useMemo, useRef, useState } from 'react'
import type { GetEngine } from '../App'
import { Menu } from '../components/Menu'
import {
  addBars,
  barTicks,
  clearBar,
  clearBeat,
  clearSelection,
  deleteSelection,
  deleteBar,
  deleteBeat,
  deleteNote,
  duplicateBar,
  insertBarBefore,
  moveBar,
  moveBeat,
  moveString,
  nextSectionName,
  pasteBeats,
  sectionAt,
  startRow,
  selectionBeats,
  selectionBetween,
  selectTrack,
  setSelectionDuration,
  setDuration,
  setFret,
  setSection,
  stepDuration,
  switchTrack,
  updateTrack,
  type BarRange,
  type BeatPos,
  type Cursor,
  type Duration,
  type EditResult
} from '../model/edit'
import { barCount, DRUM_PIECES, isFretted, rowPitch, MAX_FRET, NOTE_VALUES, notePitch, stringPitch, type Beat, type NoteValue, type Track } from '../model/song'
import type { MidiNoteMessage } from '../midi/midiInput'
import { quantizeNotes, writeRoll, type TimedNote } from '../model/keys'
import { songKey, usesFlats } from '../model/keySignature'
import { stepAdvance, stepEnter } from '../model/stepEntry'
import { legatoTarget, toggleLegato, toggleTie, type Legato } from '../model/techniques'
import { barSeconds, buildTimeline, secondsPerQuarter } from '../model/timing'
import { transpose, transposeMessage } from '../model/transpose'
import { moveToString } from '../model/tuning'
import { secondsPerClick } from '../audio/analysis'
import { readPref, writePref } from '../prefs'
import { showTrack, shownTracks, ZOOM_STEPS } from '../project/layout'
import type { ApplyOptions, Project } from '../project/useProject'
import { ScoreView, type ScoreTarget } from '../score/ScoreView'
import { noteName } from '../transcription/notes'
import { DrumGrid } from './DrumGrid'
import { PianoRoll } from './PianoRoll'
import { TransposeDialog } from './TransposeDialog'
import type { Playback } from './usePlayback'

const VALUE_LABELS: Record<NoteValue, { short: string; long: string }> = {
  1: { short: '1/1', long: 'Whole note' },
  2: { short: '1/2', long: 'Half note' },
  4: { short: '1/4', long: 'Quarter note' },
  8: { short: '1/8', long: 'Eighth note' },
  16: { short: '1/16', long: 'Sixteenth note' },
  32: { short: '1/32', long: 'Thirty-second note' },
  64: { short: '1/64', long: 'Sixty-fourth note' }
}

/** Two digits typed within this time on the same spot make one fret (1 then 2 → 12). */
const TWO_DIGIT_MS = 1000

const cursorKey = (c: Cursor): string => `${c.track}/${c.bar}/${c.beat}/${c.string}`

const STEP_INPUT_KEY = 'midiStepInput'
/** Empty bars added while recording, so you can play on past the end of the song. */
const RECORD_EXTRA_BARS = 8

/** A live MIDI recording into a keys track: notes in seconds from the start bar. */
interface MidiRecording {
  track: number
  startBar: number
  startSeconds: number
  gridTicks: number
  notes: TimedNote[]
  /** Keys held down: when they were pressed, and how hard. */
  open: Map<number, { start: number; velocity: number }>
  /** Playback has started (after the count-in). */
  started: boolean
}

/** Copied beats, and whether they came from a drum track (they only paste into the same kind). */
export interface Clipboard {
  beats: Beat[]
  drums: boolean
}

/** The next zoom level up (+1) or down (-1) from `zoom`. */
function stepZoom(zoom: number, direction: 1 | -1): number {
  const index = ZOOM_STEPS.findIndex((z) => z >= zoom - 0.001)
  const current = index < 0 ? ZOOM_STEPS.length - 1 : index
  return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, current + direction))]
}

export const barsLabel = (range: BarRange): string => (range.end - range.start === 1 ? `bar ${range.start + 1}` : `bars ${range.start + 1}–${range.end}`)

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

interface Props {
  /** What is edited: the whole song, or a piece on its own (Project.part, Project.effect). */
  target: Project
  /** Editing a part of the arrangement or a sound effect on its own: no sections, and the bar commands work on it. */
  piece?: 'part' | 'effect'
  getEngine: GetEngine
  playback: Playback
  /** Where playback is in this editor's song; holds null while something else plays. */
  positionRef: React.RefObject<number | null>
  /** Plays this editor's song from `seconds`. */
  onPlayFrom: (seconds: number) => void
  message: string
  onMessage: (message: string) => void
  clipboard: Clipboard | null
  onClipboard: (clipboard: Clipboard) => void
  /** Notes from the MIDI keyboard come here while this editor is shown. */
  midiRef: React.RefObject<((message: MidiNoteMessage) => void) | null>
  midiDevices: string[] | null
  /** Keys that work the same everywhere (loop, metronome, …); true if handled. */
  onSharedKey: (event: React.KeyboardEvent) => boolean
  /** The bars of the selection, for what to loop and export. */
  onSelectedBars?: (bars: BarRange | null) => void
  onShowShortcuts?: () => void
  /** The editor's element, for focusing it from outside. */
  elementRef?: React.RefObject<HTMLDivElement | null>
  autoFocus?: boolean
}

/**
 * The score with its edit toolbar, drum grid or piano roll and status bar:
 * typing frets, note lengths, techniques, selections, copy and paste, MIDI step
 * input and recording. It edits `target`, the whole song or a piece of it on its own.
 */
export function ScoreEditor(props: Props): React.JSX.Element {
  const { target: project, piece, getEngine, playback, positionRef, onPlayFrom, message, onMessage: setMessage, clipboard, onClipboard: setClipboard } = props
  const { midiRef, midiDevices, onSharedKey, onSelectedBars, onShowShortcuts, autoFocus = false } = props
  const { song, cursor } = project
  const part = piece !== undefined
  const pieceName = piece === 'effect' ? 'sound effect' : 'part'
  const { staves, zoom, pageView, drumGridMinimized, pianoRollMinimized } = project.layout
  const [entryDuration, setEntryDuration] = useState<Duration>({ value: 4, dotted: false })
  /** Where the current selection started; the selection runs from here to the cursor. */
  const [anchor, setAnchor] = useState<{ track: number; pos: BeatPos } | null>(null)
  /** The drum track the grid showed last, so it stays when the cursor moves to another track. */
  const [gridTrackId, setGridTrackId] = useState<string | null>(null)
  const [stepInput, setStepInput] = useState(() => readPref(STEP_INPUT_KEY, false))
  const [recording, setRecording] = useState(false)
  const [transposing, setTransposing] = useState(false)
  const recordingRef = useRef<MidiRecording | null>(null)
  /** Keys of the chord being step-entered, and its undo key. */
  const stepChord = useRef<{ held: Set<number>; id: string } | null>(null)
  const onMidiNoteRef = useRef<(message: MidiNoteMessage) => void>(() => {})
  const pendingDigit = useRef<{ key: string; digit: number; at: number } | null>(null)
  const ownRef = useRef<HTMLDivElement>(null)
  const editorRef = props.elementRef ?? ownRef
  const { playing, stop } = playback
  const timeline = useMemo(() => buildTimeline(song), [song])

  const track = song.tracks[cursor.track]
  const drums = track.kind === 'drums'
  const keys = track.kind === 'keys'
  const fretted = isFretted(track)
  // A part on its own is always shown; in the song, tracks can be left out of the score.
  const shown = part ? song.tracks.map((_, i) => i) : shownTracks(song, project.layout)
  const shownKey = shown.join(',')
  const drumTracks = song.tracks.flatMap((t, i) => (t.kind === 'drums' ? [i] : []))
  // The drum grid shows the drum track at the cursor, else the one shown last, else the first one.
  const gridTrack = drums ? cursor.track : (drumTracks.find((i) => song.tracks[i].id === gridTrackId) ?? drumTracks[0] ?? null)
  const beat = track.bars[cursor.bar].beats[cursor.beat]
  const noteOnString = beat.notes.find((n) => n.string === cursor.string)
  const section = part ? null : sectionAt(song, cursor.bar)
  const selection =
    anchor && anchor.track === cursor.track && (anchor.pos.bar !== cursor.bar || anchor.pos.beat !== cursor.beat)
      ? selectionBetween(cursor.track, anchor.pos, cursor)
      : null
  const selectedCount = selection ? selectionBeats(song, selection).length : 0
  const selectedStart = selection?.start.bar
  const selectedEnd = selection?.end.bar

  useEffect(() => {
    if (autoFocus) editorRef.current?.focus()
  }, [])

  useEffect(() => {
    if (drums) setGridTrackId(track.id)
  }, [drums, track.id])

  // The cursor stays on the tracks shown: the nearest one when its track is left out.
  useEffect(() => {
    if (shown.includes(cursor.track)) return
    const nearest = shown.reduce((best, i) => (Math.abs(i - cursor.track) < Math.abs(best - cursor.track) ? i : best))
    setAnchor(null)
    project.setCursor(switchTrack(song, cursor, nearest))
  }, [shownKey, cursor.track])

  useEffect(() => {
    onSelectedBars?.(selectedStart === undefined || selectedEnd === undefined ? null : { start: selectedStart, end: selectedEnd + 1 })
  }, [selectedStart, selectedEnd])

  useEffect(() => () => onSelectedBars?.(null), [])

  const changeZoom = (next: (zoom: number) => number): void => project.setLayout((layout) => ({ zoom: next(layout.zoom) }))

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
    if (project.apply(setFret(song, cursor, 0, entryDuration))) void audition(stringPitch(track, cursor.string, 0))
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
      void audition(stringPitch(track, cursor.string, fret))
    }
  }

  const playFromCursor = (): void => {
    const span = timeline.beats.find((b) => b.trackIndex === cursor.track && b.barIndex === cursor.bar && b.beatIndex === cursor.beat)
    onPlayFrom(span?.start ?? 0)
  }

  // ---------------------------------------------------------------- MIDI keyboard

  // MIDI keyboard notes come here while this editor is shown.
  useEffect(() => {
    const handler = (m: MidiNoteMessage): void => onMidiNoteRef.current(m)
    midiRef.current = handler
    return () => {
      if (midiRef.current === handler) midiRef.current = null
    }
  }, [])

  /**
   * A key on the MIDI keyboard: it sounds with the track's instrument, and is
   * recorded (live recording) or entered at the cursor (step input).
   */
  const onMidiNote = (m: MidiNoteMessage): void => {
    const rec = recordingRef.current
    const soundOf = song.tracks[rec ? rec.track : cursor.track]
    const drumSound = soundOf.kind === 'drums'
    void getEngine().then((engine) =>
      m.type === 'on' ? engine.liveNoteOn(soundOf.instrument, m.pitch, m.velocity, drumSound) : engine.liveNoteOff(soundOf.instrument, m.pitch, drumSound)
    )

    if (rec) {
      const heard = playback.positionAt(m.timeStamp)
      if (heard === null) return
      const at = Math.max(0, heard - rec.startSeconds)
      if (m.type === 'on') rec.open.set(m.pitch, { start: at, velocity: m.velocity })
      else {
        const pressed = rec.open.get(m.pitch)
        if (pressed) rec.notes.push({ pitch: m.pitch, start: pressed.start, end: at, velocity: pressed.velocity })
        rec.open.delete(m.pitch)
      }
      return
    }

    if (!stepInput) return
    if (m.type === 'on') {
      const chord = (stepChord.current ??= { held: new Set(), id: `step:${m.timeStamp}` })
      chord.held.add(m.pitch)
      project.update((s, c) => stepEnter(s, c, m.pitch, m.velocity, entryDuration), { mergeKey: chord.id })
    } else {
      const chord = stepChord.current
      if (!chord?.held.delete(m.pitch) || chord.held.size > 0) return
      stepChord.current = null
      project.update((s, c) => stepAdvance(s, c), { mergeKey: chord.id })
    }
  }
  onMidiNoteRef.current = onMidiNote

  const toggleStepInput = (): void => {
    const on = !stepInput
    setStepInput(on)
    writePref(STEP_INPUT_KEY, on)
    setMessage(on ? (midiDevices?.length ? 'Step input on: keys you play are entered at the cursor with the chosen length.' : 'Step input is on, but no MIDI keyboard is connected yet.') : 'Step input off.')
    focus()
  }

  /** Records the MIDI keyboard into the keys track at the cursor, from the cursor's bar, after a one-bar count-in. */
  const startRecording = async (gridTicks: number): Promise<void> => {
    stop()
    const engine = await getEngine()
    const bar = barSeconds(song)
    // The recorded track is muted while recording, and there is room to play on past the end of the song.
    const backing = addBars(updateTrack(song, cursor, cursor.track, { mute: true, solo: false }).song, cursor, RECORD_EXTRA_BARS).song
    const countIn = engine.ctx.currentTime + 0.1
    const clicks = song.timeSignature[0]
    // At the practice speed, like the playback after it.
    engine.scheduleClicks(countIn, secondsPerClick(song.tempo, song.timeSignature) / playback.speed, clicks, clicks)
    const rec: MidiRecording = { track: cursor.track, startBar: cursor.bar, startSeconds: cursor.bar * bar, gridTicks, notes: [], open: new Map(), started: false }
    recordingRef.current = rec
    setRecording(true)
    setMessage(
      midiDevices?.length
        ? 'Count-in… then play. Space or "Stop recording" ends the recording.'
        : 'Recording, but no MIDI keyboard is connected; plug one in (it is found automatically).'
    )
    await playback.play(backing, rec.startSeconds, { startAt: countIn + bar / playback.speed, metronome: true })
    rec.started = true
  }

  /** Ends a recording and writes the notes, snapped to the grid, into the track (one undo step). */
  const stopRecording = (): void => {
    const rec = recordingRef.current
    if (!rec) return
    const end = Math.max(0, (playback.positionAt(performance.now()) ?? rec.startSeconds) - rec.startSeconds)
    recordingRef.current = null
    setRecording(false)
    stop()
    for (const [pitch, pressed] of rec.open) rec.notes.push({ pitch, start: pressed.start, end: Math.max(pressed.start, end), velocity: pressed.velocity })
    const notes = quantizeNotes(rec.notes, secondsPerQuarter(song) / 960, rec.gridTicks)
    if (notes.length === 0) {
      setMessage('Nothing was recorded.')
      return
    }
    const bars = Math.max(1, Math.ceil(Math.max(...notes.map((n) => n.start + n.length)) / barTicks(song)))
    project.update((s, c) => writeRoll(s, c, rec.track, rec.startBar, rec.startBar + bars, notes))
    setMessage(`Recorded ${notes.length} ${notes.length === 1 ? 'note' : 'notes'} into ${barsLabel({ start: rec.startBar, end: rec.startBar + bars })}. Ctrl+Z undoes it.`)
    focus()
  }

  // The recording ends when playback does (e.g. stopped another way).
  useEffect(() => {
    if (!playing && recordingRef.current?.started) stopRecording()
  }, [playing])

  /** The cursor to the next track shown above (-1) or below (1). */
  const nextTrack = (delta: 1 | -1): Cursor => {
    const next = delta > 0 ? shown.find((i) => i > cursor.track) : shown.findLast((i) => i < cursor.track)
    return next === undefined ? cursor : switchTrack(song, cursor, next)
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

  /** Triplets on or off for the selection or the beat; notes typed next onto rests are triplets too (or not). */
  const toggleTriplets = (): void => {
    const triplet = !(selection ? selectionBeats(song, selection).every((b) => b.triplet) : beat.triplet)
    setEntryDuration((d) => ({ value: selection ? d.value : beat.value, dotted: false, triplet }))
    changeLength((b) => ({ value: b.value, dotted: false, triplet }))
  }

  const stepLength = (direction: 'shorter' | 'longer'): void => {
    if (!selection) {
      edit(stepDuration(song, cursor, direction), NO_ROOM)
      return
    }
    changeLength((b) => {
      const index = NOTE_VALUES.indexOf(b.value) + (direction === 'shorter' ? 1 : -1)
      return { value: NOTE_VALUES[Math.min(NOTE_VALUES.length - 1, Math.max(0, index))], dotted: b.dotted, triplet: b.triplet }
    })
  }

  /** Alt+↑ / Alt+↓: the selection, or the beat at the cursor, a semitone up or down (strings kept). */
  const nudgePitch = (semitones: number): void => {
    const result = transpose(song, cursor, { kind: 'selection', selection: selection ?? selectionBetween(cursor.track, cursor, cursor) }, semitones, 'keep')
    if (!result) {
      setMessage(drums ? 'Drums are not transposed.' : 'No notes here to transpose.')
      return
    }
    edit(result.result)
    setMessage(transposeMessage(result, semitones, 'keep'))
  }

  /** The note at the cursor to the next string up (-1) or down (1) that can play it (EDIT-09). */
  const changeString = (direction: -1 | 1): void => {
    if (!fretted) {
      setMessage('Only guitar and bass notes can move to another string.')
      return
    }
    if (!beat.notes.some((n) => n.string === cursor.string)) {
      setMessage('Put the cursor on a note to move it to another string.')
      return
    }
    const result = moveToString(song, cursor, direction)
    if (!result) {
      setMessage(`No string ${direction < 0 ? 'above' : 'below'} is free and reaches this note.`)
      return
    }
    edit(result)
    const note = result.song.tracks[cursor.track].bars[result.cursor.bar].beats[result.cursor.beat].notes.find((n) => n.string === result.cursor.string)
    setMessage(`Moved to string ${result.cursor.string}, fret ${note?.fret}.`)
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
  const lastBarMessage = `A ${part ? pieceName : 'song'} needs at least one bar.`

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (isTyping(event.target)) return
    const ctrl = event.ctrlKey || event.metaKey
    const key = event.key
    // Space plays this editor's song (the whole song, or the piece on its own).
    if (key === ' ' && !ctrl) {
      event.preventDefault()
      if (recording) stopRecording()
      else if (playing) stop()
      else playFromCursor()
      return
    }
    if (onSharedKey(event)) return
    let handled = true
    const shift = event.shiftKey
    if (ctrl && (key === '=' || key === '+')) changeZoom((z) => stepZoom(z, 1))
    else if (ctrl && key === '-') changeZoom((z) => stepZoom(z, -1))
    else if (ctrl && key === '0') changeZoom(() => 1)
    else if (keys && /^[0-9]$/.test(key) && !ctrl && !event.altKey) setMessage('Keys tracks: add notes in the piano roll, or play them in with a MIDI keyboard (Step input).')
    else if (drums && /^[0-9xX]$/.test(key) && !ctrl && !event.altKey) {
      setAnchor(null)
      enterHit()
    } else if (/^[0-9]$/.test(key) && !ctrl && !event.altKey) {
      setAnchor(null)
      enterDigit(Number(key))
    } else if (event.altKey && !ctrl && (key === 'ArrowUp' || key === 'ArrowDown')) nudgePitch(key === 'ArrowUp' ? 1 : -1)
    else if (key === 'ArrowRight') moveCursor(ctrl ? moveBar(song, cursor, 1) : moveBeat(song, cursor, 1), shift)
    else if (key === 'ArrowLeft') moveCursor(ctrl ? moveBar(song, cursor, -1) : moveBeat(song, cursor, -1), shift)
    else if (shift && !ctrl && fretted && (key === 'ArrowUp' || key === 'ArrowDown')) changeString(key === 'ArrowUp' ? -1 : 1)
    else if (key === 'ArrowUp') ctrl ? moveCursor(nextTrack(-1)) : project.setCursor(moveString(song, cursor, -1))
    else if (key === 'ArrowDown') ctrl ? moveCursor(nextTrack(1)) : project.setCursor(moveString(song, cursor, 1))
    else if (key === 'Escape' && selection) setAnchor(null)
    else if ((key === 'Delete' || key === 'Backspace') && ctrl) {
      setAnchor(null)
      edit(deleteBar(song, cursor), lastBarMessage)
    } else if ((key === 'Delete' || key === 'Backspace') && selection) removeSelection(shift)
    else if ((key === 'Delete' || key === 'Backspace') && (shift || beat.notes.length === 0)) removeBeat()
    else if (key === 'Delete' || key === 'Backspace') {
      edit(deleteNote(song, cursor), 'No note on this string. Shift+Delete removes the whole beat.')
    }
    else if (key === '+' || key === '=') stepLength('longer')
    else if (key === '-') stepLength('shorter')
    else if (key === '.') toggleDots()
    else if (key === '/' && !ctrl) toggleTriplets()
    else if (key.toLowerCase() === 'r' && !ctrl) selection ? removeSelection(false) : edit(clearBeat(song, cursor))
    else if (key.toLowerCase() === 't' && !ctrl && !drums) tie()
    else if (key.toLowerCase() === 'h' && !ctrl && fretted) legato('hammer')
    else if (key.toLowerCase() === 's' && !ctrl && fretted) legato('slide')
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
        string: startRow(song, target.trackIndex, target.barIndex, target.beatIndex, target.string ?? (sameTrack ? cursor.string : null))
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
    // The string as it sounds at fret 0 (on the capo, if there is one).
    const open = noteName(stringPitch(track, cursor.string, 0))
    // Notes are named as the score writes them: B♭ in a key with flats, A♯ otherwise.
    const flats = usesFlats(songKey(song))
    const what = drums
      ? noteOnString ? 'hit' : beat.notes.length === 0 ? 'rest' : 'no hit'
      : keys
        ? noteOnString ? `note${noteOnString.tie ? ' · held from the note before' : ''}` : beat.notes.length === 0 ? 'rest' : 'not on this key'
      : noteOnString ? `fret ${noteOnString.fret} (${noteName(notePitch(track, noteOnString), flats)})${techniqueText()}` : beat.notes.length === 0 ? 'rest' : 'empty string'
    const spot = drums ? DRUM_PIECES[cursor.string - 1]?.name : keys ? noteName(rowPitch(cursor.string), flats) : `string ${cursor.string} (${open})`
    const where = `${track.name} · bar ${cursor.bar + 1} of ${barCount(song)} · beat ${cursor.beat + 1} · ${spot} · ${what}`
    if (!selection) return where
    const bars = selection.start.bar === selection.end.bar ? `bar ${selection.start.bar + 1}` : `bars ${selection.start.bar + 1}–${selection.end.bar + 1}`
    return `${track.name} · ${selectedCount} beats selected (${bars}) · Esc to deselect`
  }

  return (
    <div ref={editorRef} className={`editor-main ${part ? 'part-editor' : ''}`} tabIndex={0} onKeyDown={onKeyDown}>
      <div className="toolbar edit-toolbar">
        <div className="segmented lengths" role="group" aria-label="Note length">
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
        <div className="segmented">
          <button className={beat.dotted ? 'active' : ''} title="Dotted (.); works on all selected beats" onClick={toggleDots}>
            Dotted
          </button>
          <button className={beat.triplet ? 'active' : ''} title="Triplet (/): three notes in the time of two; works on all selected beats" onClick={toggleTriplets}>
            Triplet
          </button>
          <button title="Make this beat a rest (R)" onClick={() => edit(clearBeat(song, cursor))}>
            Rest
          </button>
        </div>
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
            {fretted && (
              <>
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
              </>
            )}
          </div>
        )}
        <button
          className={stepInput ? 'active' : ''}
          aria-pressed={stepInput}
          title={`Step input: keys played on the MIDI keyboard are entered at the cursor with the chosen length (chords: press keys together). ${midiDevices?.length ? `Keyboard: ${midiDevices.join(', ')}` : 'No MIDI keyboard connected.'}`}
          onClick={toggleStepInput}
        >
          Step input
        </button>
        <span className="divider" />
        <Menu
          label="Edit"
          title="Edit"
          items={[
            { label: selection ? 'Copy selection' : 'Copy bar', shortcut: 'Ctrl+C', onSelect: () => copy() },
            { label: selection ? 'Cut selection' : 'Cut bar', shortcut: 'Ctrl+X', onSelect: () => copy(true) },
            { label: 'Paste', shortcut: 'Ctrl+V', title: 'At the cursor or the start of the selection, overwriting what’s there', onSelect: paste },
            'separator',
            { label: 'Delete beat', shortcut: 'Shift+Del', title: 'The rest of the bar moves up', onSelect: removeBeat },
            { label: 'Move note to the string above', shortcut: 'Shift+↑', title: 'Same pitch, on the next string up that reaches it', onSelect: () => changeString(-1) },
            { label: 'Move note to the string below', shortcut: 'Shift+↓', title: 'Same pitch, on the next string down that reaches it', onSelect: () => changeString(1) },
            { label: 'Transpose…', shortcut: 'Alt+↑ / ↓', title: 'Move notes up or down by semitones (Alt+↑ / Alt+↓: the selection a semitone)', onSelect: () => setTransposing(true) },
            { label: part ? `Select the whole ${pieceName}` : 'Select whole track', shortcut: 'Ctrl+A', onSelect: selectAll }
          ]}
        />
        <Menu
          label="Bar"
          title="Bar"
          items={
            part
              ? [
                  { label: 'Insert bar before', shortcut: 'Insert', onSelect: () => edit(insertBarBefore(song, cursor)) },
                  { label: 'Duplicate bar', shortcut: 'Ctrl+D', onSelect: () => edit(duplicateBar(song, cursor)) },
                  { label: 'Clear bar', onSelect: () => edit(clearBar(song, cursor)) },
                  { label: 'Delete bar', shortcut: 'Ctrl+Del', onSelect: () => edit(deleteBar(song, cursor), lastBarMessage) },
                  'separator',
                  { label: 'Add a bar at the end', onSelect: addBar }
                ]
              : [
                  { label: 'Insert bar before', shortcut: 'Insert', onSelect: () => edit(insertBarBefore(song, cursor)) },
                  { label: 'Duplicate bar', shortcut: 'Ctrl+D', onSelect: () => edit(duplicateBar(song, cursor)) },
                  { label: 'Clear bar in this track', onSelect: () => edit(clearBar(song, cursor)) },
                  { label: 'Delete bar in all tracks', shortcut: 'Ctrl+Del', onSelect: () => edit(deleteBar(song, cursor), lastBarMessage) },
                  'separator',
                  section === null
                    ? { label: 'Start a section here', onSelect: () => edit(setSection(song, cursor, cursor.bar, nextSectionName(song))) }
                    : { label: `Remove section “${section}”`, onSelect: () => edit(setSection(song, cursor, cursor.bar, null)) },
                  { label: 'Add a bar at the end', onSelect: addBar },
                  { label: 'Add a section at the end', title: '4 empty bars with a new section name', onSelect: addSection }
                ]
          }
        />
        {section !== null && (
          <label className="section-name" title="Name of the section that starts at this bar">
            Section
            <input
              value={section}
              onChange={(e) => project.apply(setSection(song, cursor, cursor.bar, e.target.value), { mergeKey: `section:${cursor.bar}` })}
            />
          </label>
        )}
      </div>

      <ScoreView
        song={song}
        staveMode={staves}
        tracks={part ? undefined : shown}
        zoom={zoom}
        pageView={!part && pageView}
        positionRef={positionRef}
        editCursor={cursor}
        selection={selection}
        onSelectArea={onSelectArea}
        onScoreClick={onScoreClick}
        endActions={
          part ? (
            <button onClick={addBar} title={`Add an empty bar at the end of the ${pieceName}`}>+ Bar</button>
          ) : (
            <>
              <button onClick={addBar} title="Add an empty bar at the end">+ Bar</button>
              <button onClick={addSection} title="Add 4 empty bars as a new named section">+ Section</button>
            </>
          )
        }
      />

      {keys ? (
        <PianoRoll
          project={project}
          trackIndex={cursor.track}
          collapsed={pianoRollMinimized}
          onToggleCollapsed={() => project.setLayout((layout) => ({ pianoRollMinimized: !layout.pianoRollMinimized }))}
          positionRef={positionRef}
          onEdit={edit}
          onAudition={(pitch, velocity) => void audition(pitch, velocity)}
          recording={recording}
          onRecord={(gridTicks) => void startRecording(gridTicks)}
          onStopRecording={stopRecording}
        />
      ) : gridTrack !== null && (
        <DrumGrid
          project={project}
          trackIndex={gridTrack}
          collapsed={drumGridMinimized}
          onToggleCollapsed={() => project.setLayout((layout) => ({ drumGridMinimized: !layout.drumGridMinimized }))}
          onSelectTrack={(index) => {
            if (!drums) setGridTrackId(song.tracks[index].id)
            else {
              // Picked to work on in the score: it shows again if it was left out.
              if (!shown.includes(index)) project.setLayout((layout) => showTrack(song, layout, song.tracks[index].id, true))
              moveCursor(switchTrack(song, cursor, index))
            }
          }}
          positionRef={positionRef}
          onEdit={edit}
          onAudition={(note, velocity) => void audition(note, velocity, song.tracks[gridTrack])}
        />
      )}

      <div className="status-bar">
        <span className="cursor-info">{describeCursor()}</span>
        {message && !part && <span className="status">{message}</span>}
        <span className="spacer" />
        {midiDevices && midiDevices.length > 0 && (
          <span className="muted small" title="Connected MIDI keyboards">
            MIDI: {midiDevices.join(', ')}
          </span>
        )}
        <div className="segmented" role="group" aria-label="View">
          <button className={staves === 'notation+tab' ? 'active' : ''} title="Notation above the tab" onClick={() => project.setLayout({ staves: 'notation+tab' })}>
            Notation + tab
          </button>
          <button className={staves === 'tab' ? 'active' : ''} title="Only the tab (drums as a rhythm line)" onClick={() => project.setLayout({ staves: 'tab' })}>
            Tab only
          </button>
        </div>
        {!part && (
          <div className="segmented" role="group" aria-label="Pages">
            <button className={pageView ? '' : 'active'} title="The score as wide as the window" onClick={() => project.setLayout({ pageView: false })}>
              Screen
            </button>
            <button className={pageView ? 'active' : ''} title="The score on A4 pages, as in the PDF (Export → PDF)" onClick={() => project.setLayout({ pageView: true })}>
              Pages
            </button>
          </div>
        )}
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
        {!part && (
          <button className="icon-button help-button" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={onShowShortcuts}>
            ?
          </button>
        )}
      </div>
      {transposing && (
        <TransposeDialog
          song={song}
          cursor={cursor}
          selection={selection}
          piece={part}
          onApply={(result, semitones, fingering) => {
            setTransposing(false)
            edit(result.result)
            setMessage(transposeMessage(result, semitones, fingering))
          }}
          onNothing={() => {
            setTransposing(false)
            setMessage(drums ? 'Drums are not transposed.' : 'No notes there to transpose.')
            focus()
          }}
          onClose={() => {
            setTransposing(false)
            focus()
          }}
        />
      )}
    </div>
  )
}
