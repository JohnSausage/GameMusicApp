import { useEffect, useRef, useState } from 'react'
import type { GetEngine } from '../App'
import { renderEffect } from '../audio/offline'
import { ChevronDownIcon } from '../components/icons'
import { Menu } from '../components/Menu'
import { addEffect, deleteEffect, duplicateEffect, effectSeconds, moveEffect, updateEffect } from '../model/effects'
import { soundName, type SoundEffect } from '../model/song'
import type { Project } from '../project/useProject'

/** Gap between the effects in "Play all", in seconds. */
const PLAY_ALL_GAP = 0.5
const PLAY_ALL_RATE = 48000

const lengthText = (effect: SoundEffect): string => {
  const seconds = effectSeconds(effect)
  return seconds === 0 ? 'no notes' : `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`
}

interface ListProps {
  project: Project
  getEngine: GetEngine
  /** Something plays in the editor (the song, a part or an effect). */
  playing: boolean
  /** The effect playing in its editor, if any. */
  playingEffect: string | null
  /** Plays an effect from its start in its editor (it is picked). */
  onPlay: (id: string) => void
  onStop: () => void
  /** A new effect was added (it is picked, to be named). */
  onAdded: (id: string) => void
  onExport: () => void
  onMessage: (message: string) => void
}

/**
 * The game's sound effects, in the place of the track list: pick one to edit,
 * play one or all of them one after the other, add one, export them.
 */
export function EffectList({ project, getEngine, playing, playingEffect, onPlay, onStop, onAdded, onExport, onMessage }: ListProps): React.JSX.Element {
  const { song, cursor } = project
  const effects = song.effects ?? []
  /** "Play all": the effect heard now (null while rendering), and how to stop it. */
  const [allPlaying, setAllPlaying] = useState<{ heard: string | null } | null>(null)
  const stopAll = useRef<(() => void) | null>(null)

  const stopPlayingAll = (): void => {
    stopAll.current?.()
    stopAll.current = null
    setAllPlaying(null)
  }

  // Playback in the editor stops "Play all", and so does leaving the sound effects.
  useEffect(() => {
    if (playing) stopPlayingAll()
  }, [playing])
  useEffect(() => () => stopAll.current?.(), [])

  /** Every effect as it is exported, one after the other. */
  const playAll = async (): Promise<void> => {
    onStop()
    let cancelled = false
    stopAll.current = () => (cancelled = true)
    setAllPlaying({ heard: null })
    try {
      const rendered: { id: string; channels: Float32Array[] }[] = []
      for (const effect of effects) {
        const channels = await renderEffect(effect, PLAY_ALL_RATE, { mono: false, normalize: false })
        if (cancelled) return
        if (channels) rendered.push({ id: effect.id, channels })
      }
      if (rendered.length === 0) {
        setAllPlaying(null)
        onMessage('The sound effects have no notes yet.')
        return
      }
      const gap = Math.round(PLAY_ALL_GAP * PLAY_ALL_RATE)
      const length = rendered.reduce((sum, r) => sum + r.channels[0].length + gap, 0)
      const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: PLAY_ALL_RATE })
      const timers: number[] = []
      let offset = 0
      for (const { id, channels } of rendered) {
        for (let c = 0; c < 2; c++) buffer.copyToChannel(channels[Math.min(c, channels.length - 1)] as Float32Array<ArrayBuffer>, c, offset)
        timers.push(window.setTimeout(() => setAllPlaying({ heard: id }), (offset / PLAY_ALL_RATE) * 1000))
        offset += channels[0].length + gap
      }
      const engine = await getEngine()
      if (cancelled) return
      // Not through the song's master bitcrusher, as they are exported.
      engine.setMasterCrush(undefined)
      const stopBuffer = engine.playBuffer(buffer, () => {
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

  const add = (): void => {
    const added = addEffect(song, cursor)
    project.apply(added.result)
    onAdded(added.id)
  }

  return (
    <aside className="track-list effect-list">
      <div className="track-list-header">
        <h3>Sound effects</h3>
      </div>
      {effects.map((effect) => {
        const live = playingEffect === effect.id
        const heard = live || allPlaying?.heard === effect.id
        return (
          <div
            key={effect.id}
            className={`track-card effect-card ${effect.id === project.editedEffect ? 'selected' : ''} ${heard ? 'heard' : ''}`}
            onClick={() => project.editEffect(effect.id)}
          >
            <div className="track-card-row">
              <button
                className={`icon effect-play ${live ? 'active' : ''}`}
                aria-label={live ? `Stop ${effect.name}` : `Play ${effect.name}`}
                title={live ? 'Stop' : 'Play this sound effect'}
                onClick={(e) => {
                  e.stopPropagation()
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
        <button title="A new sound effect: an empty bar for an 8-bit sound, played in the piano roll" onClick={add}>
          + New effect
        </button>
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
    </aside>
  )
}

interface EditorProps {
  project: Project
  /** The edited effect playing. */
  playing: boolean
  /** Plays the edited effect from its start, or stops it. */
  onPlay: () => void
  onEditSound: () => void
  /** Picks its name to type a new one, e.g. for a new effect. */
  selectName: boolean
  message: string
  onMessage: (message: string) => void
  /** The score editor of the effect (Project.effect). */
  editor: React.ReactNode
}

/** The sound effect picked in the list: its name, tempo and sound over its score and piano roll. */
export function EffectEditor({ project, playing, onPlay, onEditSound, selectName, message, onMessage, editor }: EditorProps): React.JSX.Element {
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
          <button
            onClick={() => {
              const added = addEffect(song, cursor)
              project.apply(added.result)
              project.editEffect(added.id)
            }}
          >
            + New effect
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

  const duplicate = (): void => {
    const copy = duplicateEffect(song, cursor, effect.id)
    if (!copy) return
    project.apply(copy.result)
    project.editEffect(copy.id)
    onMessage(`“${effect.name}” copied: change the copy to try a variation.`)
  }

  return (
    <div className="effect-editor">
      <div className="toolbar edit-toolbar arrangement-toolbar effect-head" role="group" aria-label="Sound effect">
        <input
          ref={nameRef}
          className="effect-name-input"
          value={effect.name}
          aria-label="Sound effect name"
          title="Name of the sound effect, also of its WAV file"
          onChange={(e) => project.apply(updateEffect(song, cursor, effect.id, { name: e.target.value }), { mergeKey: `effect-name:${effect.id}` })}
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
