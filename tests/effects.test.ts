import { describe, expect, it } from 'vitest'
import { ChipSynth } from '../src/renderer/src/audio/synth/chipSynthCore'
import { TICKS_PER_QUARTER, type Cursor } from '../src/renderer/src/model/edit'
import {
  addEffect,
  deleteEffect,
  duplicateEffect,
  EFFECT_CURSOR,
  EFFECT_TEMPLATES,
  effectFileNames,
  effectSeconds,
  effectSong,
  END_FADE_SECONDS,
  finishEffectAudio,
  moveEffect,
  NORMALIZED_PEAK,
  setEffectColor,
  setEffectSong,
  updateEffect,
  varyEffect
} from '../src/renderer/src/model/effects'
import { PART_COLORS } from '../src/renderer/src/model/arrangement'
import { addRollNote } from '../src/renderer/src/model/keys'
import { createDemoSong, keyRow, rowPitch, type Song, type SoundEffect } from '../src/renderer/src/model/song'
import { DEFAULT_PATCH, PATCH_LIMITS, varyPatch, type SynthPatch } from '../src/renderer/src/model/synth'
import { buildTimeline } from '../src/renderer/src/model/timing'
import { checkLayout } from '../src/renderer/src/project/layout'
import { parseProject, serializeProject } from '../src/renderer/src/project/projectFile'

const CURSOR: Cursor = { track: 0, bar: 0, beat: 0, string: 1 }
const EIGHTH = TICKS_PER_QUARTER / 2

/** The demo song with an effect of two eighth notes, C5 then G5. */
function withJump(): { song: Song; id: string } {
  const added = addEffect(createDemoSong(), CURSOR)
  let song = updateEffect(added.result.song, CURSOR, added.id, { name: 'Jump', tempo: 150 })!.song
  let own = effectSong(song.effects![0])
  for (const [pitch, start] of [[72, 0], [79, EIGHTH]]) {
    own = addRollNote(own, EFFECT_CURSOR, 0, 0, 1, { row: keyRow(pitch), start, length: EIGHTH, velocity: 100 })!.song
  }
  song = setEffectSong(song, added.id, own)
  return { song, id: added.id }
}

describe('sound effects', () => {
  it('are kept next to the song, each with its own sound, notes and tempo', () => {
    const song = createDemoSong()
    const { result, id } = addEffect(song, CURSOR)
    const effect = result.song.effects![0]
    expect(effect).toMatchObject({ id, name: 'Effect 1', tempo: 120 })
    expect(effect.track).toMatchObject({ kind: 'keys', instrument: { kind: 'synth' } })
    expect(effect.track.bars).toHaveLength(1)
    // The song itself doesn't change.
    expect(result.song.tracks).toBe(song.tracks)
    expect(addEffect(result.song, CURSOR).result.song.effects!.map((e) => e.name)).toEqual(['Effect 1', 'Effect 2'])
  })

  it('are edited as a song of their own, which goes back into the effect', () => {
    const { song, id } = withJump()
    const effect = song.effects![0]
    const own = effectSong(effect)
    expect(own).toBe(effectSong(effect))
    expect(own).toMatchObject({ tempo: 150, timeSignature: [4, 4], title: '' })
    expect(own.tracks).toHaveLength(1)
    expect(own.tracks[0].name).toBe('Jump')
    // Two eighth notes at 150 BPM.
    expect(effectSeconds(effect)).toBeCloseTo(0.4)
    // A tempo change in its own song (the sound window and the editor edit that) reaches the effect.
    const faster = setEffectSong(song, id, { ...own, tempo: 300 })
    expect(effectSeconds(faster.effects![0])).toBeCloseTo(0.2)
    expect(faster.tracks).toBe(song.tracks)
  })

  it('are duplicated, renamed, moved and deleted', () => {
    const { song, id } = withJump()
    const copy = duplicateEffect(song, CURSOR, id)!
    const again = duplicateEffect(copy.result.song, CURSOR, id)!
    expect(again.result.song.effects!.map((e) => e.name)).toEqual(['Jump', 'Jump 3', 'Jump 2'])
    const copied = copy.result.song.effects![1]
    expect(copied.id).toBe(copy.id)
    expect(copied.track.id).not.toBe(song.effects![0].track.id)
    expect(copied.track.bars).toEqual(song.effects![0].track.bars)

    const moved = moveEffect(copy.result.song, CURSOR, copy.id, -1)!
    expect(moved.song.effects!.map((e) => e.name)).toEqual(['Jump 2', 'Jump'])
    expect(moveEffect(moved.song, CURSOR, copy.id, -1)).toBeNull()

    expect(deleteEffect(moved.song, CURSOR, id)!.song.effects!.map((e) => e.name)).toEqual(['Jump 2'])
    expect(deleteEffect(moved.song, CURSOR, 'missing')).toBeNull()
  })

  it('are saved in the project file, and a damaged one is found', () => {
    const { song } = withJump()
    expect(parseProject(serializeProject(song)).song.effects).toEqual(song.effects)

    const damaged = structuredClone(song)
    damaged.effects![0].tempo = 1000
    expect(() => parseProject(serializeProject(damaged))).toThrow('sound effect "Jump" has an invalid tempo')
    const noBars = structuredClone(song)
    noBars.effects![0].track.bars = []
    expect(() => parseProject(serializeProject(noBars))).toThrow('sound effect "Jump" has no bars')
  })

  it('get a color to tell kinds apart, or none, kept by a copy and in the file', () => {
    const { song, id } = withJump()
    expect(song.effects![0].color).toBeUndefined()
    const teal = setEffectColor(song, CURSOR, id, 1)!.song
    expect(teal.effects![0].color).toBe(1)
    expect(teal.tracks).toBe(song.tracks)
    expect('color' in setEffectColor(teal, CURSOR, id, null)!.song.effects![0]).toBe(false)
    expect(setEffectColor(song, CURSOR, 'missing', 1)).toBeNull()

    const copy = duplicateEffect(teal, CURSOR, id)!
    expect(copy.result.song.effects![1].color).toBe(1)
    expect(parseProject(serializeProject(teal)).song.effects![0].color).toBe(1)
    // A color the app doesn't know is dropped, the effect is kept.
    for (const color of [PART_COLORS, -1, 1.5, 'red']) {
      const odd = structuredClone(teal)
      ;(odd.effects![0] as { color: unknown }).color = color
      const parsed = parseProject(serializeProject(odd)).song.effects![0]
      expect(parsed.name).toBe('Jump')
      expect('color' in parsed).toBe(false)
    }
  })

  it('have a tab of their own, kept in the layout', () => {
    expect(checkLayout({ view: 'effects' }).view).toBe('effects')
    expect(checkLayout({ view: 'mixer' }).view).toBe('score')
  })
})

describe('sound effect WAV files', () => {
  const RATE = 1000
  /** A tone of `loud` samples, then a fading tail of `quiet` samples, then silence. */
  const effectAudio = (loud: number, quiet: number, silence: number, level = 0.5): Float32Array[] => {
    const left = new Float32Array(loud + quiet + silence)
    for (let i = 0; i < loud; i++) left[i] = i % 2 ? level : -level
    for (let i = 0; i < quiet; i++) left[loud + i] = 0.0001
    return [left, left.map((v) => v / 2)]
  }

  it('end when the sound has faded, with a tiny fade', () => {
    const [left, right] = finishEffectAudio(effectAudio(200, 50, 500), RATE, { mono: false, normalize: false })!
    const fade = END_FADE_SECONDS * RATE
    expect(left.length).toBe(200 + fade)
    expect(right.length).toBe(left.length)
    expect(left.at(-1)).toBe(0)
    expect(left[101]).toBe(0.5)
  })

  it('are made mono or as loud as possible on request', () => {
    const [mono, ...rest] = finishEffectAudio(effectAudio(200, 0, 100), RATE, { mono: true, normalize: false })!
    expect(rest).toHaveLength(0)
    expect(mono[1]).toBeCloseTo(0.375)
    const [loud] = finishEffectAudio(effectAudio(200, 0, 100, 0.1), RATE, { mono: false, normalize: true })!
    expect(Math.max(...loud.map(Math.abs))).toBeCloseTo(NORMALIZED_PEAK)
  })

  it('are left out when silent', () => {
    expect(finishEffectAudio([new Float32Array(100)], RATE, { mono: false, normalize: true })).toBeNull()
  })

  it('are named after the effects, safe for files and each its own', () => {
    expect(effectFileNames([{ name: 'Jump' }, { name: 'coin/pickup?' }, { name: 'jump' }, { name: ' ' }, { name: 'Jump' }, { name: 'Boss.' }])).toEqual([
      'Jump.wav',
      'coinpickup.wav',
      'jump 2.wav',
      'Effect.wav',
      'Jump 3.wav',
      'Boss.wav'
    ])
  })
})

describe('sound effect templates', () => {
  const RATE = 48000

  /** An effect's notes played on its synth, as in the export (without the mixer). */
  function render(effect: SoundEffect, seconds = 3): Float32Array {
    if (effect.track.instrument.kind !== 'synth') throw new Error('not a synth')
    const synth = new ChipSynth(RATE, effect.track.instrument.patch)
    for (const note of buildTimeline(effectSong(effect)).notes) {
      synth.schedule({ frame: Math.round(note.start * RATE), type: 'on', pitch: note.pitch, velocity: note.velocity })
      synth.schedule({ frame: Math.round((note.start + note.duration * 0.92) * RATE), type: 'off', pitch: note.pitch, velocity: 0 })
    }
    const out = new Float32Array(seconds * RATE)
    for (let i = 0; i < out.length; i += 128) synth.render(out.subarray(i, i + 128), i)
    return out
  }
  const fromTemplate = (name: string): SoundEffect => {
    const template = EFFECT_TEMPLATES.find((t) => t.name === name)!
    return addEffect(createDemoSong(), CURSOR, template).result.song.effects![0]
  }
  /** Upward zero crossings per second between two times. */
  const frequency = (x: Float32Array, from: number, to: number): number => {
    let crossings = 0
    for (let i = Math.round(from * RATE) + 1; i < to * RATE; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++
    return crossings / (to - from)
  }

  it('start an effect with a sound and notes, named after the template', () => {
    const song = addEffect(createDemoSong(), CURSOR, EFFECT_TEMPLATES[1]).result.song
    const again = addEffect(song, CURSOR, EFFECT_TEMPLATES[1]).result.song
    expect(again.effects!.map((e) => e.name)).toEqual(['Coin', 'Coin 2'])
    const coin = song.effects![0]
    expect(coin.track.instrument).toMatchObject({ kind: 'synth', patch: { name: 'Coin', sustain: 0 } })
    expect(buildTimeline(effectSong(coin)).notes.map((n) => n.pitch)).toEqual([83, 88])
    expect(coin.track.bars).toHaveLength(1)
    expect(coin.track.bars[0].beats[0].notes.map((n) => rowPitch(n.string))).toEqual([83])
  })

  it('each give their effects a color of their own; an empty effect has none', () => {
    const colors = EFFECT_TEMPLATES.map((t) => t.color)
    expect(new Set(colors).size).toBe(colors.length)
    for (const color of colors) expect(color >= 0 && color < PART_COLORS).toBe(true)
    expect(fromTemplate('Coin').color).toBe(EFFECT_TEMPLATES.find((t) => t.name === 'Coin')!.color)
    expect('color' in addEffect(createDemoSong(), CURSOR).result.song.effects![0]).toBe(false)
  })

  it('all sound, and are short', () => {
    for (const template of EFFECT_TEMPLATES) {
      const audio = finishEffectAudio([render(fromTemplate(template.name))], RATE, { mono: true, normalize: false })
      expect(audio, template.name).not.toBeNull()
      const seconds = audio![0].length / RATE
      expect(seconds, template.name).toBeGreaterThan(0.05)
      expect(seconds, template.name).toBeLessThan(template.name === 'Explosion' ? 1.6 : 0.8)
    }
  })

  it('sweep the way their names say', () => {
    const jump = render(fromTemplate('Jump'))
    expect(frequency(jump, 0.12, 0.16)).toBeGreaterThan(frequency(jump, 0, 0.04) * 1.4)
    const laser = render(fromTemplate('Laser'))
    expect(frequency(laser, 0.15, 0.19)).toBeLessThan(frequency(laser, 0, 0.04) / 2)
    const powerUp = render(fromTemplate('Power-up'))
    expect(frequency(powerUp, 0.36, 0.4)).toBeGreaterThan(frequency(powerUp, 0.01, 0.04) * 3)
  })
})

describe('Vary', () => {
  const sequence = (...values: number[]): (() => number) => {
    let i = 0
    return () => values[i++ % values.length]
  }
  const jump: SynthPatch = { ...DEFAULT_PATCH, ...EFFECT_TEMPLATES[0].sound, name: 'Jump' }

  it('nudges the settings that make the sound, and keeps its kind', () => {
    // Every setting as far up as it goes: times and sweeps get longer, and so on.
    const up = varyPatch(jump, () => 1)
    expect(up.decay).toBeCloseTo(jump.decay * 1.4, 2)
    expect(up.pitchEnvAmount).toBeCloseTo(jump.pitchEnvAmount * 1.4, 1)
    expect(up.pitchEnvTime).toBeCloseTo(jump.pitchEnvTime * 1.5, 2)
    expect(up.duty).toBeCloseTo(0.35)
    expect(up).toMatchObject({ name: 'Jump', waveform: 'pulse', sustain: 0, volume: jump.volume, lfoTarget: 'off', filterType: 'off', crushBits: 16 })
    // In the middle nothing changes.
    expect(varyPatch(jump, () => 0.5)).toEqual(jump)
  })

  it('stays within what the synth allows', () => {
    const extreme: SynthPatch = { ...DEFAULT_PATCH, duty: 0.95, decay: 3, sustain: 1, pitchEnvAmount: -48, lfoTarget: 'pitch', lfoDepth: 1, filterType: 'lowpass', cutoff: 18000, crushBits: 1 }
    for (const random of [() => 0, () => 1, sequence(0.1, 0.9, 0.3, 0.7)]) {
      const varied = varyPatch(extreme, random)
      for (const [field, [min, max]] of Object.entries(PATCH_LIMITS)) {
        const value = varied[field as keyof typeof PATCH_LIMITS]
        expect(value, field).toBeGreaterThanOrEqual(min)
        expect(value, field).toBeLessThanOrEqual(max)
      }
      expect(Number.isInteger(varied.crushBits)).toBe(true)
    }
  })

  it('varies a sound effect as an edit, only an 8-bit one', () => {
    const { song, id } = withJump()
    const varied = varyEffect(song, CURSOR, id, () => 0)!
    const patch = (s: Song) => (s.effects![0].track.instrument as { patch: SynthPatch }).patch
    expect(patch(varied.song).decay).toBeLessThan(patch(song).decay)
    expect(varied.song.effects![0].track.bars).toBe(song.effects![0].track.bars)
    const piano = { ...song, effects: song.effects!.map((e) => ({ ...e, track: { ...e.track, instrument: { kind: 'soundfont' as const, program: 0 } } })) }
    expect(varyEffect(piano, CURSOR, id)).toBeNull()
  })
})
