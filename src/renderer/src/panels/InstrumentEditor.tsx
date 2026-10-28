import { useEffect, useMemo, useRef, useState } from 'react'
import type { GetEngine } from '../App'
import { COMPUTER_KEYS, MidiKeyboard } from '../midi/midiInput'
import { updateTrack } from '../model/edit'
import { DRUM_PIECES, isBassTrack, soundName, type Instrument } from '../model/song'
import {
  CRUSH_RATES,
  DEFAULT_PATCH,
  eightBitKit,
  FACTORY_PRESETS,
  formatSampleRate,
  PATCH_LIMITS,
  type DrumSound,
  type FilterType,
  type LfoTarget,
  type SynthPatch,
  type Waveform,
  varyPatch
} from '../model/synth'
import { saveFile } from '../platform'
import { createPresetStore, parsePreset, PRESET_EXTENSION, serializePreset, type UserPreset } from '../project/presets'
import type { Project } from '../project/useProject'
import { noteName } from '../transcription/notes'
import { SoundBrowser } from './SoundBrowser'
import { usePlayback } from './usePlayback'

interface Props {
  project: Project
  trackIndex: number
  getEngine: GetEngine
  /** What its play button plays: the song (default), or e.g. "effect" for a sound effect's own song. */
  playName?: string
  onClose: () => void
}

type NumberField = keyof typeof PATCH_LIMITS

interface SliderProps {
  label: string
  tip: string
  value: number
  field: NumberField
  step?: number
  /** Logarithmic slider (for frequencies). */
  log?: boolean
  format: (value: number) => string
  onChange: (value: number) => void
}

const SLIDER_STEPS = 1000

function Slider({ label, tip, value, field, step, log, format, onChange }: SliderProps): React.JSX.Element {
  const [min, max] = PATCH_LIMITS[field]
  const toPosition = (v: number): number => (log ? (Math.log(v / min) / Math.log(max / min)) * SLIDER_STEPS : v)
  const fromPosition = (p: number): number => (log ? Math.round(min * (max / min) ** (p / SLIDER_STEPS)) : p)
  return (
    <label className="slider" title={tip}>
      <span className="slider-label">
        {label} <span className="muted">{format(value)}</span>
      </span>
      <input
        type="range"
        min={log ? 0 : min}
        max={log ? SLIDER_STEPS : max}
        step={log ? 1 : (step ?? (max - min) / 200)}
        value={toPosition(value)}
        onChange={(e) => onChange(fromPosition(Number(e.target.value)))}
      />
    </label>
  )
}

const seconds = (v: number): string => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`)
const percent = (v: number): string => `${Math.round(v * 100)} %`

const WAVEFORMS: { value: Waveform; label: string; tip: string }[] = [
  { value: 'pulse', label: 'Pulse', tip: 'The classic 8-bit sound. The pulse width changes its color.' },
  { value: 'triangle', label: 'Triangle', tip: 'Soft and round, the typical 8-bit bass.' },
  { value: 'sawtooth', label: 'Saw', tip: 'Bright and buzzy, good for leads, basses and pads (try it with the filter).' },
  { value: 'sine', label: 'Sine', tip: 'Pure and soft, good for bells and flutes.' },
  { value: 'noise', label: 'Noise', tip: 'Hiss for drums and effects. Higher notes sound brighter.' }
]

const LFO_TARGETS: { value: LfoTarget; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'pitch', label: 'Vibrato (pitch)' },
  { value: 'volume', label: 'Tremolo (volume)' },
  { value: 'duty', label: 'Pulse width (PWM)' },
  { value: 'cutoff', label: 'Filter (wah)' }
]

const FILTERS: { value: FilterType; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'lowpass', label: 'Low-pass (darker)' },
  { value: 'highpass', label: 'High-pass (thinner)' }
]

/** Shape of the volume envelope, for orientation (SYN-07). */
function EnvelopeGraph({ patch }: { patch: SynthPatch }): React.JSX.Element {
  const width = 220
  const height = 56
  const hold = 0.3
  const total = Math.max(0.05, patch.attack + patch.decay + hold + patch.release)
  const x = (t: number): number => (t / total) * width
  const y = (level: number): number => height - 2 - level * (height - 4)
  const points = [
    [0, y(0)],
    [x(patch.attack), y(1)],
    [x(patch.attack + patch.decay), y(patch.sustain)],
    [x(patch.attack + patch.decay + hold), y(patch.sustain)],
    [x(total), y(0)]
  ]
  return (
    <svg className="envelope-graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="Envelope shape">
      <polyline points={points.map((p) => p.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  )
}

const BLACK_KEYS = new Set([1, 3, 6, 8, 10])

/** Computer keys that play the pieces of a drum kit, in kit order. */
const KIT_KEYS = 'asdfghjkl'
const PIECE_PITCH: [number, number] = [24, 108]

/** How long the note plays that previews a sound picked in the browser. */
const PREVIEW_MS = 700

const pieceName = (sound: DrumSound): string => DRUM_PIECES.find((d) => d.note === sound.note)?.name ?? `Drum ${sound.note}`

/** Two octaves of clickable piano keys. */
function Keyboard({ base, pressed, onDown, onUp }: { base: number; pressed: Set<number>; onDown: (p: number) => void; onUp: (p: number) => void }): React.JSX.Element {
  const keys = Array.from({ length: 25 }, (_, i) => base + i)
  const whites = keys.filter((p) => !BLACK_KEYS.has(p % 12))
  const whiteWidth = 100 / whites.length
  return (
    <div className="piano" onPointerLeave={() => pressed.forEach(onUp)}>
      {keys.map((pitch) => {
        const black = BLACK_KEYS.has(pitch % 12)
        const index = whites.filter((w) => w < pitch).length
        const style = black ? { left: `${index * whiteWidth - whiteWidth * 0.3}%`, width: `${whiteWidth * 0.6}%` } : { left: `${index * whiteWidth}%`, width: `${whiteWidth}%` }
        return (
          <div
            key={pitch}
            className={`piano-key ${black ? 'black' : 'white'} ${pressed.has(pitch) ? 'down' : ''}`}
            style={style}
            title={noteName(pitch)}
            onPointerDown={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId)
              onDown(pitch)
            }}
            onPointerUp={() => onUp(pitch)}
            onPointerLeave={() => pressed.has(pitch) && onUp(pitch)}
          >
            {pitch % 12 === 0 && <span>{noteName(pitch)}</span>}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The sound of a track, with live preview (REQUIREMENTS.md SYN-02…SYN-13, NFR-44).
 * Guitar, bass and keys tracks pick a sound in the browser; an 8-bit sound also
 * shows the synth to shape it. For a synth drum kit (SYN-20) it edits one kit
 * piece at a time, picked with the pads.
 */
export function InstrumentEditor({ project, trackIndex, getEngine, playName = 'song', onClose }: Props): React.JSX.Element {
  const { song, cursor } = project
  const track = song.tracks[trackIndex]
  const drumTrack = track.kind === 'drums'
  const kit = track.instrument.kind === 'synthkit' ? track.instrument.pieces : null
  const synth = track.instrument.kind === 'synth'
  const [pieceIndex, setPieceIndex] = useState(() => Math.max(0, kit?.findIndex((p) => p.note === 38) ?? 0))
  const piece = kit?.[pieceIndex] ?? null
  const patch = track.instrument.kind === 'synth' ? track.instrument.patch : (piece?.patch ?? DEFAULT_PATCH)
  const instrumentRef = useRef<Instrument>(track.instrument)
  instrumentRef.current = track.instrument

  const store = useMemo(createPresetStore, [])
  const [userPresets, setUserPresets] = useState<UserPreset[]>([])
  const [saveName, setSaveName] = useState(patch.name)
  const [message, setMessage] = useState('')
  const [base, setBase] = useState(isBassTrack(track) ? 36 : 60)
  const [pressed, setPressed] = useState(new Set<number>())
  const [midiDevices, setMidiDevices] = useState<string[] | null>(null)
  const midi = useRef<MidiKeyboard | null>(null)
  const playback = usePlayback(getEngine)

  const refreshPresets = (): void => {
    void store.list().then(setUserPresets)
  }
  useEffect(refreshPresets, [store])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 3500)
    return () => window.clearTimeout(timer)
  }, [message])

  const setPiece = (change: Partial<DrumSound>, mergeKey?: string): void => {
    if (!kit) return
    const pieces = kit.map((p, i) => (i === pieceIndex ? { ...p, ...change } : p))
    project.apply(updateTrack(song, cursor, trackIndex, { instrument: { kind: 'synthkit', pieces } }), { mergeKey })
  }
  const setPatch = (next: SynthPatch, mergeKey?: string): void => {
    if (kit) setPiece({ patch: next }, mergeKey)
    else project.apply(updateTrack(song, cursor, trackIndex, { instrument: { kind: 'synth', patch: next } }), { mergeKey })
    void getEngine().then((engine) => engine.setLivePatch(next))
  }
  const set = <K extends keyof SynthPatch>(field: K, value: SynthPatch[K]): void =>
    setPatch({ ...patch, [field]: value }, `patch:${track.id}:${kit ? `${pieceIndex}:` : ''}${field}`)

  /** A sound picked in the browser: browsing undoes as one step, and each sound plays a note. */
  const choose = (next: Instrument): void => {
    const mergeKey = `sound:${track.id}`
    if (next.kind === 'synth') {
      setPatch(next.patch, mergeKey)
      setSaveName(next.patch.name)
    } else {
      project.apply(updateTrack(song, cursor, trackIndex, { instrument: next }), { mergeKey })
    }
    const pitch = base + 12
    void getEngine().then((engine) => {
      engine.liveNoteOn(next, pitch, 100)
      window.setTimeout(() => engine.liveNoteOff(next, pitch), PREVIEW_MS)
    })
  }

  /** Nudges the sound at random (SYN-13) and plays a note of it; each try is its own undo step. */
  const vary = (): void => {
    const next = varyPatch(patch)
    setPatch(next)
    const instrument: Instrument = kit ? { kind: 'synthkit', pieces: kit.map((p, i) => (i === pieceIndex ? { ...p, patch: next } : p)) } : { kind: 'synth', patch: next }
    const pitch = piece ? piece.note : base + 12
    void getEngine().then((engine) => {
      engine.liveNoteOn(instrument, pitch, 100)
      window.setTimeout(() => engine.liveNoteOff(instrument, pitch), PREVIEW_MS)
    })
  }

  const resetPiece = (): void => {
    const original = piece && eightBitKit().find((p) => p.note === piece.note)
    if (!original) return
    setPiece({ pitch: original.pitch, patch: original.patch })
    setSaveName(original.patch.name)
  }

  // Live notes always use the newest sound. For a kit, `pitch` is the piece's drum note.
  const noteOn = (pitch: number, velocity = 100): void => {
    setPressed((s) => new Set(s).add(pitch))
    void getEngine().then((engine) => engine.liveNoteOn(instrumentRef.current, pitch, velocity))
  }
  const noteOff = (pitch: number): void => {
    setPressed((s) => {
      const next = new Set(s)
      next.delete(pitch)
      return next
    })
    void getEngine().then((engine) => engine.liveNoteOff(instrumentRef.current, pitch))
  }

  /** The note a computer key plays: a kit piece (A…L), or a piano key from the lowest C (A…K). */
  const keyNote = (key: string): number | undefined => {
    if (kit) return kit[KIT_KEYS.indexOf(key)]?.note
    return COMPUTER_KEYS[key] === undefined ? undefined : COMPUTER_KEYS[key] - 60 + base
  }

  // Computer keys play notes; Z / X shift the piano's octave. Esc closes.
  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      // Ctrl/Cmd shortcuts (undo, save) are not notes.
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.repeat || event.ctrlKey || event.metaKey) return
      const key = event.key.toLowerCase()
      const note = keyNote(key)
      if (key === 'escape') onClose()
      else if (note !== undefined) noteOn(note)
      else if (key === 'z' && !kit) setBase((b) => Math.max(24, b - 12))
      else if (key === 'x' && !kit) setBase((b) => Math.min(84, b + 12))
      else return
      event.preventDefault()
    }
    const up = (event: KeyboardEvent): void => {
      const note = keyNote(event.key.toLowerCase())
      if (note !== undefined) noteOff(note)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  })

  useEffect(
    () => () => {
      if (midi.current) midi.current.onNote = null
    },
    []
  )

  const connectMidi = async (): Promise<void> => {
    try {
      const keyboard = (midi.current ??= new MidiKeyboard())
      keyboard.onNote = (m) => (m.type === 'on' ? noteOn(m.pitch, m.velocity) : noteOff(m.pitch))
      keyboard.onDevicesChanged = setMidiDevices
      setMidiDevices(await keyboard.connect())
    } catch (e) {
      setMessage(`MIDI not available: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const loadPreset = (value: string): void => {
    const preset = value.startsWith('factory:') ? FACTORY_PRESETS[Number(value.slice(8))] : userPresets.find((p) => p.id === value.slice(5))?.patch
    if (!preset) return
    setPatch({ ...preset })
    setSaveName(preset.name)
  }

  const savePreset = async (): Promise<void> => {
    const name = saveName.trim() || 'My instrument'
    const named = { ...patch, name }
    setPatch(named)
    await store.save(named)
    refreshPresets()
    setMessage(`Saved "${name}" to your presets.`)
  }

  const deletePreset = async (preset: UserPreset): Promise<void> => {
    if (!window.confirm(`Delete your preset "${preset.patch.name}"?`)) return
    await store.remove(preset.id)
    refreshPresets()
  }

  const exportPreset = async (): Promise<void> => {
    const path = await saveFile(`${patch.name}.${PRESET_EXTENSION}`, new TextEncoder().encode(serializePreset(patch)))
    if (path) setMessage(`Exported to ${path}`)
  }

  const importPreset = async (file: File): Promise<void> => {
    try {
      const imported = parsePreset(await file.text())
      setPatch(imported)
      setSaveName(imported.name)
      setMessage(`Loaded "${imported.name}". Save it to keep it in your presets.`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  const playSong = (): void => {
    const span = buildStart()
    void playback.play(song, span)
  }
  const buildStart = (): number => (60 / song.tempo) * 4 * (song.timeSignature[0] / song.timeSignature[1]) * cursor.bar

  const previewBar = (
    <div className="toolbar preview-bar">
      <span className="muted small">
        {kit ? 'Try it: click the pads above, use A–L on your computer keyboard, or' : 'Try it: click the keys, use A–K on your computer keyboard (Z/X = octave), or'}
      </span>
      <button onClick={() => void connectMidi()}>{midiDevices ? `MIDI: ${midiDevices.join(', ') || 'no device'}` : 'Connect MIDI keyboard'}</button>
      <span className="spacer" />
      {playback.playing ? <button onClick={playback.stop}>■ Stop</button> : <button onClick={playSong} title={`Play the ${playName} from the cursor's bar`}>▶ Play {playName}</button>}
    </div>
  )

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal instrument-editor" role="dialog" aria-modal="true" aria-label={`Sound of ${track.name}`}>
        <button className="icon modal-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>×</button>
        <h2>
          Sound of {track.name}
          <span className="muted"> · {soundName(track.instrument)}</span>
        </h2>

        {!drumTrack && (
          <>
            <SoundBrowser
              instrument={track.instrument}
              userPresets={userPresets}
              onChoose={choose}
              onDeletePreset={(preset) => void deletePreset(preset)}
              onImportPreset={(file) => void importPreset(file)}
            />
            {previewBar}
            <Keyboard base={base} pressed={pressed} onDown={(p) => noteOn(p)} onUp={noteOff} />
          </>
        )}

        {kit && piece && (
          <div className="kit-editor">
            <div className="kit-pads" onPointerLeave={() => pressed.forEach(noteOff)}>
              {kit.map((p, i) => (
                <button
                  key={p.note}
                  className={`kit-pad ${i === pieceIndex ? 'active' : ''} ${pressed.has(p.note) ? 'down' : ''}`}
                  title={`Edit and play the ${pieceName(p).toLowerCase()} (key ${KIT_KEYS[i].toUpperCase()})`}
                  onPointerDown={() => {
                    if (i !== pieceIndex) setSaveName(p.patch.name)
                    setPieceIndex(i)
                    noteOn(p.note)
                  }}
                  onPointerUp={() => noteOff(p.note)}
                >
                  {pieceName(p)}
                  <kbd>{KIT_KEYS[i].toUpperCase()}</kbd>
                </button>
              ))}
            </div>
            <div className="toolbar">
              <strong>Editing: {pieceName(piece)}</strong>
              <label className="slider kit-pitch" title="The note the synth plays for this drum. Higher sounds brighter, also for noise.">
                <span className="slider-label">
                  Pitch <span className="muted">{noteName(piece.pitch)}</span>
                </span>
                <input
                  type="range"
                  min={PIECE_PITCH[0]}
                  max={PIECE_PITCH[1]}
                  step={1}
                  value={piece.pitch}
                  onChange={(e) => setPiece({ pitch: Number(e.target.value) }, `pitch:${track.id}:${pieceIndex}`)}
                />
              </label>
              <button onClick={resetPiece} title="Back to the built-in 8-bit sound of this drum">Reset this drum</button>
            </div>
          </div>
        )}

        {(synth || kit) && (
          <div className="synth-editor">
            {synth && (
              <h3 className="synth-editor-title">
                8-bit synth <span className="muted small">Shape the sound; you hear every change right away.</span>
              </h3>
            )}
            <div className="toolbar preset-bar">
              {kit && (
                <select value="" onChange={(e) => loadPreset(e.target.value)} aria-label="Load a preset">
                  <option value="">Load a preset…</option>
                  <optgroup label="Built-in">
                    {FACTORY_PRESETS.map((p, i) => (
                      <option key={p.name} value={`factory:${i}`}>{p.name}</option>
                    ))}
                  </optgroup>
                  {userPresets.length > 0 && (
                    <optgroup label="My presets">
                      {userPresets.map((p) => (
                        <option key={p.id} value={`user:${p.id}`}>{p.patch.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              )}
              <button onClick={vary} title="Nudge the settings at random and hear it: the same kind of sound, a little different. Again for another try, Ctrl+Z to go back.">
                Vary
              </button>
              <input value={saveName} onChange={(e) => setSaveName(e.target.value)} aria-label="Preset name" title="Name for saving this sound" />
              <button onClick={() => void savePreset()} title="Keep this sound in your presets, for any project">Save to my presets</button>
              <button onClick={() => void exportPreset()} title={`Save as a .${PRESET_EXTENSION} file, e.g. to send to a friend`}>Export…</button>
              {kit && (
                <label className="file-button" title={`Load a .${PRESET_EXTENSION} file`}>
                  Import…
                  <input type="file" accept={`.${PRESET_EXTENSION},application/json`} onChange={(e) => e.target.files?.[0] && void importPreset(e.target.files[0])} />
                </label>
              )}
            </div>
            {kit && userPresets.length > 0 && (
              <div className="preset-chips">
                <span className="muted small">My presets:</span>
                {userPresets.map((p) => (
                  <span key={p.id} className="chip">
                    <button className="link" onClick={() => loadPreset(`user:${p.id}`)}>{p.patch.name}</button>
                    <button className="icon" title="Delete preset" aria-label={`Delete ${p.patch.name}`} onClick={() => void deletePreset(p)}>×</button>
                  </span>
                ))}
              </div>
            )}

            <div className="synth-sections">
              <section className="card">
                <h3>Oscillator</h3>
                <div className="segmented waveform-buttons">
                  {WAVEFORMS.map((w) => (
                    <button key={w.value} className={patch.waveform === w.value ? 'active' : ''} title={w.tip} onClick={() => set('waveform', w.value)}>
                      {w.label}
                    </button>
                  ))}
                </div>
                {patch.waveform === 'pulse' && (
                  <>
                    <Slider label="Pulse width" field="duty" value={patch.duty} format={(v) => `${Math.round(v * 1000) / 10} %`} onChange={(v) => set('duty', v)}
                      tip="Width of the pulse: 50 % is a hollow square, 25 % and 12.5 % are thinner and brighter." />
                    <div className="toolbar compact">
                      {[0.125, 0.25, 0.5].map((d) => (
                        <button key={d} className={Math.abs(patch.duty - d) < 0.001 ? 'active' : ''} onClick={() => set('duty', d)}>{d * 100} %</button>
                      ))}
                    </div>
                  </>
                )}
                <Slider label="Octave" field="octave" step={1} value={patch.octave} format={(v) => (v > 0 ? `+${v}` : `${v}`)} onChange={(v) => set('octave', v)}
                  tip="Plays the instrument up to 3 octaves higher or lower than the written notes." />
                <Slider label="Fine tune" field="fine" step={1} value={patch.fine} format={(v) => `${v > 0 ? '+' : ''}${v} cents`} onChange={(v) => set('fine', v)}
                  tip="Detunes slightly; 100 cents are one semitone." />
                <Slider label="Volume" field="volume" value={patch.volume} format={percent} onChange={(v) => set('volume', v)} tip="Loudness of this instrument." />
              </section>

              <section className="card">
                <h3>Envelope</h3>
                <EnvelopeGraph patch={patch} />
                <Slider label="Attack" field="attack" value={patch.attack} format={seconds} onChange={(v) => set('attack', v)} tip="How long the note takes to fade in." />
                <Slider label="Decay" field="decay" value={patch.decay} format={seconds} onChange={(v) => set('decay', v)} tip="How long it then takes to fall to the sustain level." />
                <Slider label="Sustain" field="sustain" value={patch.sustain} format={percent} onChange={(v) => set('sustain', v)}
                  tip="Volume while the note is held. 0 makes short plucks and hits." />
                <Slider label="Release" field="release" value={patch.release} format={seconds} onChange={(v) => set('release', v)} tip="How long the note fades out after it ends." />
                <Slider label="Velocity" field="velocity" value={patch.velocity} format={percent} onChange={(v) => set('velocity', v)}
                  tip="How much harder playing (MIDI velocity) makes the note louder." />
              </section>

              <section className="card">
                <h3>Pitch</h3>
                <Slider label="Pitch sweep" field="pitchEnvAmount" step={1} value={patch.pitchEnvAmount} format={(v) => `${v > 0 ? '+' : ''}${v} semitones`}
                  onChange={(v) => set('pitchEnvAmount', v)} tip="Starts each note this far higher (or lower) and slides to the real pitch: lasers, zaps and drum hits." />
                <Slider label="Sweep time" field="pitchEnvTime" value={patch.pitchEnvTime} format={seconds} onChange={(v) => set('pitchEnvTime', v)}
                  tip="How long the pitch sweep takes." />
                <label className="checkbox" title="Only one note at a time, like a real 8-bit channel. A new note glides from the previous one.">
                  <input type="checkbox" checked={patch.mono} onChange={(e) => set('mono', e.target.checked)} />
                  Mono (one note at a time)
                </label>
                <Slider label="Glide" field="glide" value={patch.glide} format={seconds} onChange={(v) => set('glide', v)}
                  tip="Time to slide from one note to the next. Works in mono mode, or between separate notes." />
              </section>

              <section className="card">
                <h3>Wobble (LFO)</h3>
                <label>
                  Wobbles
                  <select value={patch.lfoTarget} onChange={(e) => set('lfoTarget', e.target.value as LfoTarget)} title="What the slow wobble changes.">
                    {LFO_TARGETS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </label>
                {patch.lfoTarget !== 'off' && (
                  <>
                    <Slider label="Speed" field="lfoRate" value={patch.lfoRate} format={(v) => `${v.toFixed(1)} Hz`} onChange={(v) => set('lfoRate', v)} tip="Wobbles per second." />
                    <Slider label="Depth" field="lfoDepth" value={patch.lfoDepth} format={percent} onChange={(v) => set('lfoDepth', v)} tip="How strong the wobble is." />
                    <Slider label="Delay" field="lfoDelay" value={patch.lfoDelay} format={seconds} onChange={(v) => set('lfoDelay', v)}
                      tip="Wait this long before the wobble starts. Delayed vibrato is a classic for chip leads." />
                  </>
                )}
              </section>

              <section className="card">
                <h3>Filter</h3>
                <label>
                  Type
                  <select value={patch.filterType} onChange={(e) => set('filterType', e.target.value as FilterType)} title="Removes high (low-pass) or low (high-pass) frequencies.">
                    {FILTERS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </label>
                {patch.filterType !== 'off' && (
                  <>
                    <Slider label="Cutoff" field="cutoff" log value={patch.cutoff} format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${v} Hz`)}
                      onChange={(v) => set('cutoff', v)} tip="Where the filter starts cutting." />
                    <Slider label="Resonance" field="resonance" value={patch.resonance} format={(v) => v.toFixed(1)} onChange={(v) => set('resonance', v)}
                      tip="Boosts the sound right at the cutoff. High values whistle." />
                    <Slider label="Envelope" field="filterEnv" value={patch.filterEnv} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} oct`} onChange={(v) => set('filterEnv', v)}
                      tip="How far the note's envelope opens the filter. Positive values give plucky “bwow” sounds." />
                  </>
                )}
              </section>

              <section className="card">
                <h3>Lo-fi</h3>
                <Slider label="Bit depth" field="crushBits" step={1} value={patch.crushBits} format={(v) => (v >= 16 ? 'off' : `${v} bit`)} onChange={(v) => set('crushBits', v)}
                  tip="Fewer bits make the sound grittier, like old consoles. 16 = off." />
                <label title="A lower sample rate adds a crunchy, aliased sound.">
                  Sample rate
                  <select value={patch.crushRate} onChange={(e) => set('crushRate', Number(e.target.value))}>
                    {CRUSH_RATES.map((r) => (
                      <option key={r} value={r}>{formatSampleRate(r)}</option>
                    ))}
                  </select>
                </label>
              </section>
            </div>
          </div>
        )}

        {kit && previewBar}
        {message && <p className="status">{message}</p>}
      </div>
    </div>
  )
}
