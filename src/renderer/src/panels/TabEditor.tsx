import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GetEngine } from '../App'
import { songToMidi } from '../audio/midiExport'
import { ChevronDownIcon, ExportIcon, EyeIcon, EyeOffIcon, LoopIcon, MetronomeIcon, PencilIcon, PlayIcon, RecordIcon, StopIcon } from '../components/icons'
import { Menu } from '../components/Menu'
import {
  addTrack,
  deleteTrack,
  isRetro,
  makeRetro,
  loopBars,
  restoreSounds,
  sectionRangeOf,
  sectionRanges,
  switchTrack,
  updateMaster,
  updateTrack,
  type BarRange,
  type LoopChoice
} from '../model/edit'
import { addEffect, effectSong, findEffect, type EffectTemplate } from '../model/effects'
import { audibleTracks, defaultInstrument, isFretted, MASTER_DEFAULTS, soundName, type Instrument, type SoundEffect, type Track } from '../model/song'
import { setStemName } from '../model/stems'
import { MidiKeyboard, type MidiNoteMessage } from '../midi/midiInput'
import { importMidi } from '../model/midiImport'
import { CRUSH_RATES, eightBitKit, formatSampleRate } from '../model/synth'
import { barTime, buildTimeline, songSeconds } from '../model/timing'
import { retuneTrack, tuningLabel, type Retune } from '../model/tuning'
import { saveFile } from '../platform'
import { scorePdf } from '../score/pdf'
import gameMusicPlayerScript from '../../../../unity/GameMusicPlayer.cs?raw'
import type { HeaderSlots } from '../pages/EditorPage'
import { MAIN_VIEWS, showTrack, shownTracks, type MainView } from '../project/layout'
import type { Project } from '../project/useProject'
import { ArrangementView } from './ArrangementView'
import { EffectExportDialog } from './EffectExportDialog'
import { EffectEditor, EffectList } from './EffectsView'
import { ExportDialog } from './ExportDialog'
import { InstrumentEditor } from './InstrumentEditor'
import { MasterMeter } from './MasterMeter'
import { barsLabel, ScoreEditor, type Clipboard } from './ScoreEditor'
import { TakeDialog } from './TakeDialog'
import { TuningDialog } from './TuningDialog'
import { usePlayback, type Playback } from './usePlayback'

interface Props {
  project: Project
  getEngine: GetEngine
  /** Where to put the transport and the record/export buttons in the page's top bar. */
  headerSlots?: HeaderSlots
  onShowShortcuts?: () => void
}

/** What plays: the song, the part edited in the arrangement on its own, or a sound effect. */
type Heard = 'song' | 'part' | { effect: string }

/** Playback speeds offered for practicing (PLAY-08). */
const SPEEDS = [0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

const VIEW_TABS: Record<MainView, { label: string; title: string }> = {
  score: { label: 'Score', title: 'The notes, bar by bar (Ctrl+Tab switches)' },
  arrangement: { label: 'Arrangement', title: 'The song’s sections, and the part each track plays in them (Ctrl+Tab switches)' },
  effects: { label: 'Sound effects', title: 'The game’s sound effects, each with its own sound and notes, exported one WAV file each (Ctrl+Tab switches)' }
}

interface TrackListProps {
  project: Project
  onSelect: (index: number) => void
  onEditSound: (index: number) => void
  onEditTuning: (index: number) => void
  onMessage: (message: string) => void
}

function TrackList({ project, onSelect, onEditSound, onEditTuning, onMessage }: TrackListProps): React.JSX.Element {
  const { song, cursor } = project
  const retro = isRetro(song)
  const master = { ...MASTER_DEFAULTS, ...song.master }
  const audible = audibleTracks(song)
  const shown = shownTracks(song, project.layout)

  /** Drum tracks switch between the SoundFont kit and the 8-bit kit; other tracks pick their sound in the sound window. */
  const setDrumKit = (index: number, value: string): void => {
    const instrument: Instrument = value === 'synthkit' ? { kind: 'synthkit', pieces: eightBitKit() } : defaultInstrument('drums')
    if (instrument.kind !== song.tracks[index].instrument.kind) project.apply(updateTrack(song, cursor, index, { instrument }))
  }
  /** Adds the tracks of a MIDI file (EXP-08). */
  const importMidiFile = async (file: File): Promise<void> => {
    try {
      const imported = importMidi(song, cursor, new Uint8Array(await file.arrayBuffer()))
      if (!imported) {
        onMessage(`${file.name} has no notes to import.`)
        return
      }
      project.apply(imported.result)
      const tempo = imported.fileTempo && Math.round(imported.fileTempo) !== song.tempo ? ` The file is at ${Math.round(imported.fileTempo)} BPM; the song stays at ${song.tempo} BPM (change it at the top).` : ''
      const skipped = imported.skipped > 0 ? ` ${imported.skipped} notes outside the piano or the drum kit were left out.` : ''
      onMessage(`Imported ${imported.tracks} ${imported.tracks === 1 ? 'track' : 'tracks'} (${imported.notes} notes) from ${file.name}.${tempo}${skipped}`)
    } catch (error) {
      onMessage(`${file.name} could not be read as a MIDI file: ${error instanceof Error ? error.message : String(error)}`)
    }
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
              className={`icon show ${shown.includes(index) ? '' : 'off'}`}
              aria-pressed={shown.includes(index)}
              aria-label={`Show ${track.name} in the score`}
              title={
                shown.includes(index)
                  ? shown.length > 1
                    ? 'Shown in the score: click to leave it out (it still plays)'
                    : 'The only track shown in the score'
                  : 'Left out of the score (it still plays): click to show it'
              }
              disabled={shown.includes(index) && shown.length === 1}
              onClick={(e) => {
                e.stopPropagation()
                project.setLayout((layout) => showTrack(song, layout, track.id, !shown.includes(index)))
              }}
            >
              {shown.includes(index) ? <EyeIcon size={15} /> : <EyeOffIcon size={15} />}
            </button>
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
            {track.kind === 'drums' ? (
              <>
                <select className="track-sound" value={track.instrument.kind} aria-label="Drum kit" onChange={(e) => setDrumKit(index, e.target.value)}>
                  <option value="soundfont">Drum kit (SoundFont)</option>
                  <option value="synthkit">8-bit drum kit (synth)</option>
                </select>
                {track.instrument.kind === 'synthkit' && (
                  <button
                    className="icon-button"
                    title="Edit sound…"
                    aria-label={`Edit the sound of ${track.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditSound(index)
                    }}
                  >
                    <PencilIcon size={16} />
                  </button>
                )}
              </>
            ) : (
              <button
                className="track-sound sound-button"
                title="Choose the sound of this track, try it and shape 8-bit sounds"
                aria-label={`Sound of ${track.name}: ${soundName(track.instrument)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onEditSound(index)
                }}
              >
                <span className="sound-button-name">{soundName(track.instrument)}</span>
                <ChevronDownIcon size={14} />
              </button>
            )}
          </div>
          {isFretted(track) && (
            <div className="track-card-row">
              <button
                className="sound-button tuning-button"
                title="Tuning and capo"
                aria-label={`Tuning of ${track.name}: ${tuningLabel(track)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onEditTuning(index)
                }}
              >
                <span className="sound-button-name">
                  <span className="muted">Tuning</span> {tuningLabel(track)}
                </span>
                <ChevronDownIcon size={14} />
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
        <button title="A track for keyboard parts: synth leads, pads, piano; edited in a piano roll or played in with a MIDI keyboard" onClick={() => project.apply(addTrack(song, cursor, 'keys'))}>
          + Keys
        </button>
        <label className="file-button" title="Add the tracks of a MIDI file (.mid): drums become a drum track, everything else keys tracks">
          Import MIDI…
          <input
            type="file"
            accept=".mid,.midi,audio/midi"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void importMidiFile(file)
            }}
          />
        </label>
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


export function TabEditor({ project, getEngine, headerSlots, onShowShortcuts }: Props): React.JSX.Element {
  const { song, cursor } = project
  const { view } = project.layout
  const [message, setMessage] = useState('')
  const [clipboard, setClipboard] = useState<Clipboard | null>(null)
  const [takeDialog, setTakeDialog] = useState(false)
  const [exportDialog, setExportDialog] = useState(false)
  const [loop, setLoop] = useState(false)
  const [loopChoice, setLoopChoice] = useState<LoopChoice>({ kind: 'song' })
  const [metronome, setMetronome] = useState(false)
  const [soundEditor, setSoundEditor] = useState<number | null>(null)
  const [tuningDialog, setTuningDialog] = useState<number | null>(null)
  const [effectSound, setEffectSound] = useState(false)
  const [effectExport, setEffectExport] = useState(false)
  /** The sound effect just added, to type its name. */
  const [addedEffect, setAddedEffect] = useState<string | null>(null)
  /** MIDI keyboards found (null: MIDI not available or not connected yet). */
  const [midiDevices, setMidiDevices] = useState<string[] | null>(null)
  /** The bars of the selection in the score, for what to loop and export. */
  const [selectedBars, setSelectedBars] = useState<BarRange | null>(null)
  const [heard, setHeard] = useState<Heard>('song')
  /** The editor shown gets the notes of the MIDI keyboard here. */
  const midiRef = useRef<((message: MidiNoteMessage) => void) | null>(null)
  const onMidiNoteRef = useRef<(message: MidiNoteMessage) => void>(() => {})
  const editorRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  /** For the editor whose song isn't the one playing: no playhead. */
  const noPosition = useRef<number | null>(null)
  const playback = usePlayback(getEngine)
  const { playing, positionRef, stop } = playback
  const timeline = useMemo(() => buildTimeline(song), [song])
  const part = project.part
  const editedPart = project.editedPart
  const effect = project.effect
  const editedEffect = project.editedEffect
  const effects = song.effects ?? []
  const playingPart = heard === 'part'
  const playingEffect = playing && typeof heard === 'object' ? heard.effect : null
  const cursorSection = sectionRangeOf(song, cursor.bar)
  const loopRange = loopBars(song, loopChoice)

  // Volume, mute and solo changes are heard right away while playing.
  useEffect(() => {
    if (playing && heard === 'song') playback.updateMix(song)
  }, [song, playing])

  // Another part picked while one plays: it stops, as the playhead would show the new one.
  useEffect(() => {
    if (playingPart) stop()
  }, [editedPart?.trackId, editedPart?.partId])

  // The same for sound effects (one started from the list is picked as it starts).
  useEffect(() => {
    if (playingEffect && playingEffect !== editedEffect) stop()
  }, [editedEffect])

  // The sound effects show one: the first, until another is picked.
  const pickEffect = view === 'effects' && !effect && effects.length > 0
  useEffect(() => {
    if (pickEffect) project.editEffect(effects[0].id)
  }, [pickEffect])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 3500)
    return () => window.clearTimeout(timer)
  }, [message])

  /** Focuses the score, or in the arrangement the grid. */
  const focus = (): void => (editorRef.current ?? areaRef.current?.querySelector<HTMLElement>('.arrangement-grid-area'))?.focus()

  /** The playback of the song, the part or an effect: what an editor starts is marked as such. */
  const playbackFor = (what: Heard): Playback => ({
    ...playback,
    play: (played, from, options) => {
      setHeard(what)
      // Sound effects always sound as they are exported: the practice speed is for music.
      return playback.play(played, from, typeof what === 'object' ? { speed: 1, ...options } : options)
    }
  })

  /** Plays from `from` seconds with the current (or given) loop and metronome settings. */
  const playFrom = (from: number, withLoop = loop, range: BarRange = loopRange): void => {
    setHeard('song')
    void playback.play(song, from, { loop: withLoop ? { start: barTime(song, range.start), end: barTime(song, range.end) } : null, metronome })
  }

  const playFromCursor = (): void => {
    const span = timeline.beats.find((b) => b.trackIndex === cursor.track && b.barIndex === cursor.bar && b.beatIndex === cursor.beat)
    playFrom(span?.start ?? 0)
  }

  /** Plays the part edited in the arrangement on its own; looping repeats the whole part. */
  const playPartFrom = (from: number, withLoop = loop): void => {
    if (!part) return
    const end = songSeconds(part.song)
    setHeard('part')
    void playback.play(part.song, from, { loop: withLoop ? { start: 0, end } : null, metronome })
  }

  /** Plays a sound effect from `from` seconds; it doesn't loop. */
  const playEffect = (effect: SoundEffect, from: number): void => {
    setHeard({ effect: effect.id })
    void playback.play(effectSong(effect), from, { speed: 1 })
  }

  const playEffectFrom = (id: string, from: number): void => {
    const found = findEffect(song, id)
    if (found) playEffect(found, from)
  }

  /** A new sound effect, picked to be named; one from a template plays right away. */
  const newEffect = (template?: EffectTemplate): void => {
    const added = addEffect(song, cursor, template)
    project.apply(added.result)
    project.editEffect(added.id)
    setAddedEffect(added.id)
    if (template) playEffect(findEffect(added.result.song, added.id)!, 0)
  }

  /** Plays the song or the part again from where it is, e.g. with the loop switched. Sound effects don't loop. */
  const restart = (withLoop: boolean, range: BarRange = loopRange): void => {
    if (playingPart) playPartFrom(positionRef.current ?? 0, withLoop)
    else if (heard === 'song') playFrom(positionRef.current ?? 0, withLoop, range)
  }

  /** Loop on/off; while playing, playback continues from where it is with the new setting. */
  const toggleLoop = (): void => {
    setLoop(!loop)
    if (playing) restart(!loop)
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
    if (playing) restart(true, loopBars(song, choice))
    focus()
  }

  /** Practice speed; while playing, playback goes on from where it is at the new speed. */
  const changeSpeed = (speed: number): void => {
    playback.setSpeed(speed)
    if (playing) restart(loop)
    focus()
  }

  const toggleMetronome = (): void => {
    setMetronome(!metronome)
    playback.setMetronome(!metronome)
  }

  // ---------------------------------------------------------------- MIDI keyboard

  // Connects to MIDI keyboards (also ones plugged in later); notes go to onMidiNote below.
  useEffect(() => {
    const keyboard = new MidiKeyboard()
    keyboard.onNote = (message) => onMidiNoteRef.current(message)
    keyboard.onDevicesChanged = setMidiDevices
    keyboard.connect().then(setMidiDevices, () => setMidiDevices(null))
    return () => keyboard.dispose()
  }, [])

  const modalOpen = soundEditor !== null || takeDialog || exportDialog || effectSound || effectExport

  /** A key on the MIDI keyboard goes to the editor shown, or just sounds with the cursor's track. */
  const onMidiNote = (m: MidiNoteMessage): void => {
    if (modalOpen) return
    if (midiRef.current) {
      midiRef.current(m)
      return
    }
    const track = song.tracks[cursor.track]
    const drums = track.kind === 'drums'
    void getEngine().then((engine) =>
      m.type === 'on' ? engine.liveNoteOn(track.instrument, m.pitch, m.velocity, drums) : engine.liveNoteOff(track.instrument, m.pitch, drums)
    )
  }
  onMidiNoteRef.current = onMidiNote

  /** Score, arrangement or sound effects; playback goes on. */
  const showView = (next: MainView): void => project.setLayout({ view: next })

  /** Keys that work the same in the score and the arrangement; true if handled. */
  const sharedKey = (event: React.KeyboardEvent): boolean => {
    const ctrl = event.ctrlKey || event.metaKey
    const key = event.key
    if (ctrl && key === 'Tab') showView(MAIN_VIEWS[(MAIN_VIEWS.indexOf(view) + (event.shiftKey ? MAIN_VIEWS.length - 1 : 1)) % MAIN_VIEWS.length])
    else if (key === ' ') playing ? stop() : playFromCursor()
    else if (key.toLowerCase() === 'l' && !ctrl) toggleLoop()
    else if (key.toLowerCase() === 'm' && !ctrl) toggleMetronome()
    else if (key === '?') onShowShortcuts?.()
    else return false
    event.preventDefault()
    return true
  }

  const exportMidi = async (): Promise<void> => {
    const path = await saveFile(`${song.title}.mid`, songToMidi(song))
    setMessage(path ? `MIDI saved: ${path}` : '')
  }

  /** New tuning and capo for a guitar or bass track, and what became of its notes. */
  const retune = (index: number, tuning: number[], capo: number, keep: Retune): void => {
    const retuned = retuneTrack(song, cursor, index, tuning, capo, keep)
    if (!retuned) return
    project.apply(retuned.result)
    const notes = (n: number): string => `${n} ${n === 1 ? 'note' : 'notes'}`
    const moved = retuned.moved > 0 ? ` ${notes(retuned.moved)} moved to another string to keep their sound.` : ''
    const changed = retuned.changed > 0 ? ` ${notes(retuned.changed)} can't be played at the same pitch any more and kept their fret.` : ''
    setMessage(`${song.tracks[index].name}: ${tuningLabel({ tuning, capo })}.${moved}${changed}`)
  }

  /** The Unity script that plays exported stems (unity/GameMusicPlayer.cs in the repository). */
  const exportUnityScript = async (): Promise<void> => {
    const path = await saveFile('GameMusicPlayer.cs', new TextEncoder().encode(gameMusicPlayerScript))
    setMessage(path ? `Unity script saved: ${path}. Put it into your Assets folder, add it to a GameObject and drag the stems into it.` : '')
  }

  /** The score as in the page view: the tracks shown, with the staves shown. */
  const exportPdf = async (): Promise<void> => {
    setMessage('Making the PDF…')
    try {
      const pdf = await scorePdf(song, project.layout.staves, shownTracks(song, project.layout))
      const path = pdf && (await saveFile(`${song.title}.pdf`, pdf))
      setMessage(path ? `PDF saved: ${path}` : '')
    } catch (error) {
      setMessage(`The PDF could not be made: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** What the score and the part editor share. */
  const editorProps = {
    getEngine,
    message,
    onMessage: setMessage,
    clipboard,
    onClipboard: setClipboard,
    midiRef,
    midiDevices,
    onSharedKey: sharedKey,
    onShowShortcuts
  }

  return (
    <div className="tab-editor">
      {view === 'effects' ? (
        <EffectList
          project={project}
          getEngine={getEngine}
          playing={playing}
          songPlaying={playing && heard === 'song'}
          playingEffect={playingEffect}
          keys={!modalOpen}
          onPlay={(id) => {
            project.editEffect(id)
            playEffectFrom(id, 0)
          }}
          onStop={stop}
          onNew={newEffect}
          onExport={() => {
            stop()
            setEffectExport(true)
          }}
          onMessage={setMessage}
        />
      ) : (
        <TrackList
          project={project}
          onSelect={(index) => {
            // A track picked while it is left out of the score shows again.
            if (view === 'score' && !shownTracks(song, project.layout).includes(index)) project.setLayout((layout) => showTrack(song, layout, song.tracks[index].id, true))
            project.setCursor(switchTrack(song, cursor, index))
          }}
          onEditSound={(index) => {
            stop()
            setSoundEditor(index)
          }}
          onEditTuning={(index) => {
            stop()
            setTuningDialog(index)
          }}
          onMessage={setMessage}
        />
      )}

      {headerSlots?.transport &&
        createPortal(
          <>
            {playing ? (
              <button className="transport-play active" onClick={stop} title="Stop (Space)">
                <StopIcon /> <span className="button-label">Stop</span>
              </button>
            ) : (
              <button className="transport-play" onClick={playFromCursor} title="Play from the cursor (Space)">
                <PlayIcon /> <span className="button-label">Play</span>
              </button>
            )}
            <div className="loop-control">
              <button className={`icon-button ${loop ? 'active' : ''}`} aria-pressed={loop} aria-label="Loop" title="Loop playback on/off (L)" onClick={toggleLoop}>
                <LoopIcon />
              </button>
              <select
                aria-label="What to loop"
                title="What loop playback repeats. It stays the same while you click around in the score. A part played on its own repeats as a whole."
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
            <button
              className={`icon-button ${metronome ? 'active' : ''}`}
              aria-pressed={metronome}
              aria-label="Metronome"
              title="Metronome during playback (M)"
              onClick={toggleMetronome}
            >
              <MetronomeIcon />
            </button>
            <select
              className={`speed-select ${playback.speed !== 1 ? 'active' : ''}`}
              aria-label="Playback speed"
              title="Playback speed, to practice slowly: the song's tempo stays as it is, and so do exports"
              value={playback.speed}
              onChange={(e) => changeSpeed(Number(e.target.value))}
            >
              {SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {Math.round(speed * 100)} %
                </option>
              ))}
            </select>
            <MasterMeter getEngine={getEngine} active={playing} />
          </>,
          headerSlots.transport
        )}

      {headerSlots?.actions &&
        createPortal(
          <>
            <button
              className="record-button"
              title={song.tracks.some(isFretted) ? 'Record or import a take and transcribe it into a guitar or bass track' : 'Add a guitar or bass track first'}
              disabled={!song.tracks.some(isFretted)}
              onClick={() => {
                stop()
                setTakeDialog(true)
              }}
            >
              <RecordIcon size={14} /> <span className="button-label">Record</span>
            </button>
            <Menu
              label={
                <>
                  <ExportIcon size={16} /> <span className="button-label">Export</span>
                </>
              }
              title="Export"
              align="right"
              items={[
                {
                  label: 'WAV…',
                  title: 'The song, a section or some bars, loopable for Unity',
                  onSelect: () => {
                    stop()
                    setExportDialog(true)
                  }
                },
                { label: 'MIDI', title: 'All tracks as a MIDI file', onSelect: () => void exportMidi() },
                { label: 'PDF', title: 'The score on A4 pages, as in the page view (the tracks shown in the score)', onSelect: () => void exportPdf() },
                'separator',
                {
                  label: 'Sound effects (WAV)…',
                  title: effects.length > 0 ? 'The sound effects, one WAV file each' : 'Make sound effects in the Sound effects tab first',
                  disabled: effects.length === 0,
                  onSelect: () => {
                    stop()
                    setEffectExport(true)
                  }
                },
                'separator',
                {
                  label: 'Unity player script (C#)…',
                  title: 'GameMusicPlayer.cs: plays exported stems in sync in Unity, fades layers in and out, and follows the beat map',
                  onSelect: () => void exportUnityScript()
                }
              ]}
            />
          </>,
          headerSlots.actions
        )}

      <div ref={areaRef} className="editor-area">
        <div className="view-tabs" role="tablist" aria-label="Main view">
          {MAIN_VIEWS.map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={`view-tab ${view === v ? 'current' : ''}`} title={VIEW_TABS[v].title} onClick={() => showView(v)}>
              {VIEW_TABS[v].label}
            </button>
          ))}
        </div>
        {view === 'effects' ? (
          <EffectEditor
            project={project}
            playing={playingEffect !== null && playingEffect === editedEffect}
            onPlay={() => (playingEffect && playingEffect === editedEffect ? stop() : editedEffect && playEffectFrom(editedEffect, 0))}
            onHear={(changed) => playEffect(changed, 0)}
            onNew={newEffect}
            onEditSound={() => {
              stop()
              setEffectSound(true)
            }}
            selectName={addedEffect !== null && addedEffect === editedEffect}
            message={message}
            onMessage={setMessage}
            editor={
              effect &&
              editedEffect && (
                <ScoreEditor
                  key={editedEffect}
                  {...editorProps}
                  target={effect}
                  piece="effect"
                  playback={playbackFor({ effect: editedEffect })}
                  positionRef={playingEffect === editedEffect ? positionRef : noPosition}
                  onPlayFrom={(from) => playEffectFrom(editedEffect, from)}
                  elementRef={editorRef}
                />
              )
            }
          />
        ) : view === 'arrangement' ? (
          <ArrangementView
            project={project}
            playing={playing && heard === 'song'}
            positionRef={positionRef}
            loop={loop ? loopRange : null}
            message={message}
            onMessage={setMessage}
            onLoopSection={(start) => chooseLoop(`section:${start}`)}
            onEditInScore={() => showView('score')}
            onSharedKey={sharedKey}
            onShowShortcuts={onShowShortcuts}
            partPlaying={playing && playingPart}
            onPlayPart={() => (playing ? stop() : playPartFrom(0))}
            partEditor={
              part &&
              editedPart && (
                <ScoreEditor
                  key={`${editedPart.trackId}/${editedPart.partId}`}
                  {...editorProps}
                  target={part}
                  piece="part"
                  playback={playbackFor('part')}
                  positionRef={playingPart ? positionRef : noPosition}
                  onPlayFrom={(from) => playPartFrom(from)}
                />
              )
            }
          />
        ) : (
          <ScoreEditor
            {...editorProps}
            target={project}
            playback={playbackFor('song')}
            positionRef={heard === 'song' ? positionRef : noPosition}
            onPlayFrom={(from) => playFrom(from)}
            onSelectedBars={setSelectedBars}
            elementRef={editorRef}
            autoFocus
          />
        )}
      </div>

      {soundEditor !== null && song.tracks[soundEditor] && (song.tracks[soundEditor].kind !== 'drums' || song.tracks[soundEditor].instrument.kind === 'synthkit') && (
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

      {effectSound && effect && (
        <InstrumentEditor
          project={effect}
          trackIndex={0}
          getEngine={getEngine}
          playName="effect"
          onClose={() => {
            setEffectSound(false)
            focus()
          }}
        />
      )}

      {effectExport && (
        <EffectExportDialog
          effects={effects}
          selected={editedEffect}
          onClose={(result) => {
            setEffectExport(false)
            if (result) setMessage(result)
            focus()
          }}
        />
      )}

      {tuningDialog !== null && song.tracks[tuningDialog] && isFretted(song.tracks[tuningDialog]) && (
        <TuningDialog
          track={song.tracks[tuningDialog]}
          getEngine={getEngine}
          onApply={(tuning, capo, keep) => {
            retune(tuningDialog, tuning, capo, keep)
            setTuningDialog(null)
            focus()
          }}
          onClose={() => {
            setTuningDialog(null)
            focus()
          }}
        />
      )}

      {exportDialog && (
        <ExportDialog
          song={song}
          bars={selectedBars ?? { start: cursor.bar, end: cursor.bar + 1 }}
          section={cursorSection?.name ?? null}
          onStemName={(index, name) => project.apply(setStemName(song, cursor, index, name), { mergeKey: `stem-name:${song.tracks[index].id}` })}
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
