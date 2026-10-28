import { describe, expect, it } from 'vitest'
import { TICKS_PER_QUARTER, type Cursor } from '../src/renderer/src/model/edit'
import {
  addEffect,
  deleteEffect,
  duplicateEffect,
  EFFECT_CURSOR,
  effectFileNames,
  effectSeconds,
  effectSong,
  END_FADE_SECONDS,
  finishEffectAudio,
  moveEffect,
  NORMALIZED_PEAK,
  setEffectSong,
  updateEffect
} from '../src/renderer/src/model/effects'
import { addRollNote } from '../src/renderer/src/model/keys'
import { createDemoSong, keyRow, type Song } from '../src/renderer/src/model/song'
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
