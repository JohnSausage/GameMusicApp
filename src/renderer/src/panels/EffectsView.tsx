import { useEffect, useRef, useState } from 'react'
import type { GetEngine } from '../App'
import { renderEffect } from '../audio/offline'
import { ColorSwatches, partColor } from '../components/ColorSwatches'
import { ChevronDownIcon } from '../components/icons'
import { Menu, type MenuItem } from '../components/Menu'
import {
  deleteEffect,
  duplicateEffect,
  EFFECT_TEMPLATES,
  effectSeconds,
  findEffect,
  moveEffect,
  setEffectColor,
  updateEffect,
  varyEffect,
  type EffectTemplate
} from '../model/effects'
import { soundName, type SoundEffect, type Track } from '../model/song'
import type { Project } from '../project/useProject'

/** Gap between the effects in "Play all", in seconds. */
const PLAY_ALL_GAP = 0.5
const PLAY_RATE = 48000
/** Effects are heard as they are exported, but in stereo and at their own level. */
const PLAY_OPTIONS = { mono: false, normalize: false }
/** Keys 1–9 play the first nine effects. */
const EFFECT_KEYS = 9
/** After an edit, the effects keys play are rendered again once the edits pause. */
const RENDER_DELAY_MS = 300

/** "New effect" choices: from a template, or empty. */
const newEffectItems = (onNew: (template?: EffectTemplate) => void): MenuItem[] => [
  ...EFFECT_TEMPLATES.map((template) => ({ label: template.name, title: `${template.description}: a ready-made sound and notes to change`, onSelect: () => onNew(template) })),
  'separator',
  { label: 'Empty', title: 'An 8-bit sound and an empty bar, for your own notes', onSelect: () => onNew() }
]

/** An effect's color for its card and its header, if it has one. */
const colorStyle = (effect: SoundEffect): React.CSSProperties | undefined => (effect.color === undefined ? undefined : partColor(effect.color))

const lengthText = (effect: SoundEffect): string => {
  const seconds = effectSeconds(effect)
  return seconds === 0 ? 'no notes' : `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

interface ListProps {
  project: Project
  getEngine: GetEngine
  /** Something plays in the editor (the song, a part or an effect). */
  playing: boolean
  /** The song plays: effects started from the list play over it. */
  songPlaying: boolean
  /** The effect playing in its editor, if any. */
  playingEffect: string | null
  /** Keys 1–9 play effects (not while a dialog is open). */
  keys: boolean
  /** Plays an effect from its start in its editor (it is picked). */
  onPlay: (id: string) => void
  onStop: () => void
  /** Adds an effect, from a template or empty. */
  onNew: (template?: EffectTemplate) => void
  onExport: () => void
  onMessage: (message: string) => void
}

/**
 * The game's sound effects, in the place of the track list: pick one to edit,
 * play one or all of them one after the other, add one, export them. Keys 1–9
 * play them over whatever plays, like in the game.
 */
export function EffectList({ project, getEngine, playing, songPlaying, playingEffect, keys, onPlay, onStop, onNew, onExport, onMessage }: ListProps): React.JSX.Element {
  const { song } = project
  const effects = song.effects ?? []
  /** "Play all": the effect heard now (null while rendering), and how to stop it. */
  const [allPlaying, setAllPlaying] = useState<{ heard: string | null } | null>(null)
  const stopAll = useRef<(() => void) | null>(null)
  /** Effects played over the song (keys 1–9): how many of each sound now, and how to stop them. */
  const [shots, setShots] = useState<Record<string, number>>({})
  const stopShots = useRef(new Set<() => void>())
  /** Each effect's audio as it is exported, by its track (its notes and sound) and tempo: rendered once per change. */
  const rendered = useRef(new WeakMap<Track, { tempo: number; audio: Promise<AudioBuffer | null> }>())

  const audioOf = (effect: SoundEffect): Promise<AudioBuffer | null> => {
    const known = rendered.current.get(effect.track)
    if (known?.tempo === effect.tempo) return known.audio
    const audio = renderEffect(effect, PLAY_RATE, PLAY_OPTIONS).then((channels) => {
      if (!channels) return null
      const buffer = new AudioBuffer({ numberOfChannels: channels.length, length: channels[0].length, sampleRate: PLAY_RATE })
      channels.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c))
      return buffer
    })
    // A render that failed is tried again next time.
    audio.catch(() => {
      if (rendered.current.get(effect.track)?.audio === audio) rendered.current.delete(effect.track)
    })
    rendered.current.set(effect.track, { tempo: effect.tempo, audio })
    return audio
  }

  const stopPlayingAll = (): void => {
    stopAll.current?.()
    stopAll.current = null
    setAllPlaying(null)
  }

  // Playback in the editor stops "Play all", and so does leaving the sound effects.
  useEffect(() => {
    if (playing) stopPlayingAll()
  }, [playing])
  useEffect(
    () => () => {
      stopAll.current?.()
      stopShots.current.forEach((stop) => stop())
    },
    []
  )

  // The effects keys play are ready to start right away.
  useEffect(() => {
    if (!keys) return
    const timer = window.setTimeout(() => effects.slice(0, EFFECT_KEYS).forEach((effect) => void audioOf(effect).catch(() => {})), RENDER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [effects, keys])

  /** Plays an effect as it is exported, over whatever plays (the song, other effects). */
  const playOver = async (effect: SoundEffect): Promise<void> => {
    try {
      const [audio, engine] = await Promise.all([audioOf(effect), getEngine()])
      if (!audio) {
        onMessage(`“${effect.name}” has no notes yet.`)
        return
      }
      const { id } = effect
      const stop = engine.playEffect(audio, () => {
        stopShots.current.delete(stop)
        setShots((s) => ({ ...s, [id]: s[id] - 1 }))
      })
      stopShots.current.add(stop)
      setShots((s) => ({ ...s, [id]: (s[id] ?? 0) + 1 }))
    } catch (error) {
      onMessage(`“${effect.name}” could not be played: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Keys 1–9 play the first nine effects, before the score sees them (where digits are frets).
  useEffect(() => {
    if (!keys) return
    const down = (event: KeyboardEvent): void => {
      if (!/^[1-9]$/.test(event.key) || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      const effect = effects[Number(event.key) - 1]
      if (effect && !event.repeat) void playOver(effect)
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  })

  /** Every effect as it is exported, one after the other. */
  const playAll = async (): Promise<void> => {
    onStop()
    let cancelled = false
    stopAll.current = () => (cancelled = true)
    setAllPlaying({ heard: null })
    try {
      const sounds: { id: string; audio: AudioBuffer }[] = []
      for (const effect of effects) {
        const audio = await audioOf(effect)
        if (cancelled) return
        if (audio) sounds.push({ id: effect.id, audio })
      }
      if (sounds.length === 0) {
        setAllPlaying(null)
        onMessage('The sound effects have no notes yet.')
        return
      }
      const gap = Math.round(PLAY_ALL_GAP * PLAY_RATE)
      const length = sounds.reduce((sum, r) => sum + r.audio.length + gap, 0)
      const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: PLAY_RATE })
      const timers: number[] = []
      let offset = 0
      for (const { id, audio } of sounds) {
        for (let c = 0; c < 2; c++) buffer.copyToChannel(audio.getChannelData(Math.min(c, audio.numberOfChannels - 1)), c, offset)
        timers.push(window.setTimeout(() => setAllPlaying({ heard: id }), (offset / PLAY_RATE) * 1000))
        offset += audio.length + gap
      }
      const engine = await getEngine()
      if (cancelled) return
      const stopBuffer = engine.playEffect(buffer, () => {
        timers.forEach((t) => window.clearTimeout(t))
        setAllPlaying(null)
      })
      stopAll.current = () => {
        timers.forEach((t) => window.clearTimeout(t))
        stopBuffer()
      }
    } catch (error) {
      setAllPlaying(null)
      onMessage(`The sound effects could not be played: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <aside className="track-list effect-list">
      <div className="track-list-header">
        <h3>Sound effects</h3>
        <Menu label="+ New" title="A new sound effect: start from a ready-made one (Jump, Coin, …) or an empty one" align="right" items={newEffectItems(onNew)} />
      </div>
      {effects.map((effect, index) => {
        const live = playingEffect === effect.id
        const heard = live || allPlaying?.heard === effect.id || (shots[effect.id] ?? 0) > 0
        const key = index < EFFECT_KEYS ? String(index + 1) : null
        return (
          <div
            key={effect.id}
            className={`track-card effect-card ${effect.color !== undefined ? 'colored' : ''} ${effect.id === project.editedEffect ? 'selected' : ''} ${heard ? 'heard' : ''}`}
            style={colorStyle(effect)}
            onClick={() => project.editEffect(effect.id)}
          >
            <div className="track-card-row">
              <button
                className={`icon effect-play ${live ? 'active' : ''}`}
                aria-label={live ? `Stop ${effect.name}` : `Play ${effect.name}`}
                title={live ? 'Stop' : songPlaying ? 'Play this sound effect over the song' : 'Play this sound effect'}
                onClick={(e) => {
                  e.stopPropagation()
                  if (songPlaying) {
                    void playOver(effect)
                    return
                  }
                  stopPlayingAll()
                  if (live) onStop()
                  else onPlay(effect.id)
                }}
              >
                {live ? '■' : '▶'}
              </button>
              <span className="effect-name" title={effect.name}>
                {effect.name || 'Untitled'}
              </span>
              {key && (
                <kbd className="effect-key" title={`Key ${key} plays this sound effect, also over the song`}>
                  {key}
                </kbd>
              )}
              <span className="muted small effect-length" title="How long its notes last (the sound may ring on a little)">
                {lengthText(effect)}
              </span>
            </div>
            <div className="track-card-row muted small effect-sound">{soundName(effect.track.instrument)}</div>
          </div>
        )
      })}
      {effects.length === 0 && <p className="muted small">No sound effects yet.</p>}
      <div className="toolbar">
        {allPlaying ? (
          <button className="active" title="Stop" onClick={stopPlayingAll}>
            {allPlaying.heard ? '■ Stop' : 'Rendering…'}
          </button>
        ) : (
          <button title="Play every sound effect one after the other, as they are exported" disabled={effects.length === 0} onClick={() => void playAll()}>
            ▶ Play all
          </button>
        )}
        <button title="Save the sound effects as WAV files, one per effect, named after it" disabled={effects.length === 0} onClick={onExport}>
          Export WAV…
        </button>
      </div>
      {effects.length > 0 && (
        <p className="muted small effect-keys-hint">
          {effects.length === 1 ? 'Key 1 plays it' : `Keys 1–${Math.min(effects.length, EFFECT_KEYS)} play them`}, also over the song: start it with ▶ at the top, then press keys as in
          your game.
        </p>
      )}
    </aside>
  )
}

interface EditorProps {
  project: Project
  /** The edited effect playing. */
  playing: boolean
  /** Plays the edited effect from its start, or stops it. */
  onPlay: () => void
  /** Plays an effect from its start, e.g. as it is after an edit. */
  onHear: (effect: SoundEffect) => void
  onNew: (template?: EffectTemplate) => void
  onEditSound: () => void
  /** Picks its name to type a new one, e.g. for a new effect. */
  selectName: boolean
  message: string
  onMessage: (message: string) => void
  /** The score editor of the effect (Project.effect). */
  editor: React.ReactNode
}

/** The sound effect picked in the list: its name, tempo and sound over its score and piano roll. */
export function EffectEditor({ project, playing, onPlay, onHear, onNew, onEditSound, selectName, message, onMessage, editor }: EditorProps): React.JSX.Element {
  const { song, cursor } = project
  const effects = song.effects ?? []
  const index = effects.findIndex((e) => e.id === project.editedEffect)
  const effect = effects[index] as SoundEffect | undefined
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (selectName) nameRef.current?.select()
  }, [selectName, effect?.id])

  if (!effect) {
    return (
      <div className="arr-part-empty effects-empty">
        <p>
          <strong>Sound effects for your game</strong>: a jump, a coin, a laser, … Each one has its own sound, notes and tempo, and is saved as a WAV file of its own that ends
          when its sound has faded. Keep them all here, next to the music, to hear how they fit together.
        </p>
        <div className="toolbar">
          <span className="muted">Start with</span>
          {EFFECT_TEMPLATES.map((template) => (
            <button
              key={template.name}
              className="effect-template"
              style={partColor(template.color)}
              title={`${template.description}: a ready-made sound and notes to change`}
              onClick={() => onNew(template)}
            >
              {template.name}
            </button>
          ))}
          <span className="muted">or</span>
          <button title="An 8-bit sound and an empty bar, for your own notes" onClick={() => onNew()}>
            Empty
          </button>
        </div>
      </div>
    )
  }

  const remove = (): void => {
    if (!window.confirm(`Delete the sound effect “${effect.name}”?`)) return
    project.apply(deleteEffect(song, cursor, effect.id))
    project.editEffect(effects[index + 1]?.id ?? effects[index - 1]?.id ?? null)
  }

  /** Nudges the 8-bit sound at random, and plays the result. */
  const vary = (): void => {
    const varied = varyEffect(song, cursor, effect.id)
    if (!varied) return
    project.apply(varied)
    onHear(findEffect(varied.song, effect.id)!)
  }

  const duplicate = (): void => {
    const copy = duplicateEffect(song, cursor, effect.id)
    if (!copy) return
    project.apply(copy.result)
    project.editEffect(copy.id)
    onMessage(`“${effect.name}” copied: change the copy to try a variation.`)
  }

  return (
    <div className="effect-editor">
      <div className={`toolbar edit-toolbar arrangement-toolbar effect-head ${effect.color !== undefined ? 'colored' : ''}`} role="group" aria-label="Sound effect" style={colorStyle(effect)}>
        <input
          ref={nameRef}
          className="effect-name-input"
          value={effect.name}
          aria-label="Sound effect name"
          title="Name of the sound effect, also of its WAV file"
          onChange={(e) => project.apply(updateEffect(song, cursor, effect.id, { name: e.target.value }), { mergeKey: `effect-name:${effect.id}` })}
        />
        <ColorSwatches
          value={effect.color ?? null}
          none
          label="Sound effect color"
          title="color of the sound effect in the list, e.g. one per kind of effect"
          onChange={(color) => project.apply(setEffectColor(song, cursor, effect.id, color))}
        />
        <label className="tempo" title="Tempo of this sound effect in beats per minute (a faster tempo makes shorter notes)">
          <span aria-hidden="true">♩ =</span>
          <input
            type="number"
            min={20}
            max={400}
            value={effect.tempo}
            aria-label="Sound effect tempo"
            onChange={(e) => {
              const tempo = Number(e.target.value)
              if (tempo >= 20 && tempo <= 400) project.apply(updateEffect(song, cursor, effect.id, { tempo }), { mergeKey: `effect-tempo:${effect.id}` })
            }}
          />
        </label>
        <button
          className="sound-button effect-sound-button"
          title="Choose the sound of this effect, try it and shape 8-bit sounds"
          aria-label={`Sound of ${effect.name}: ${soundName(effect.track.instrument)}`}
          onClick={onEditSound}
        >
          <span className="sound-button-name">{soundName(effect.track.instrument)}</span>
          <ChevronDownIcon size={14} />
        </button>
        <button className={playing ? 'active' : ''} title={playing ? 'Stop (Space)' : 'Play this sound effect from its start (Space in the score plays from the cursor)'} onClick={onPlay}>
          {playing ? '■ Stop' : '▶ Play'}
        </button>
        <button
          disabled={effect.track.instrument.kind !== 'synth'}
          title={
            effect.track.instrument.kind === 'synth'
              ? 'Nudge the sound’s settings at random and hear it; again for another try, Ctrl+Z to go back. Duplicate first to keep this one.'
              : 'Only 8-bit sounds can be varied'
          }
          onClick={vary}
        >
          Vary
        </button>
        <button title="A copy of this sound effect right after it, to try a variation" onClick={duplicate}>
          Duplicate
        </button>
        <Menu
          label="More"
          title="More"
          items={[
            { label: 'Move up in the list', disabled: index === 0, onSelect: () => project.apply(moveEffect(song, cursor, effect.id, -1)) },
            { label: 'Move down in the list', disabled: index === effects.length - 1, onSelect: () => project.apply(moveEffect(song, cursor, effect.id, 1)) },
            'separator',
            { label: 'Delete sound effect…', onSelect: remove }
          ]}
        />
        <span className="muted small">{lengthText(effect)}</span>
        {message && <span className="status">{message}</span>}
      </div>
      {editor}
    </div>
  )
}
