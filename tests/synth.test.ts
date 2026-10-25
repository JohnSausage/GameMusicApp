import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { Bitcrusher, ChipSynth } from '../src/renderer/src/audio/synth/chipSynthCore'
import { isRetro, makeRetro, restoreSounds, updateMaster } from '../src/renderer/src/model/edit'
import { addTrack } from '../src/renderer/src/model/edit'
import { createDemoSong } from '../src/renderer/src/model/song'
import { DEFAULT_PATCH, FACTORY_PRESETS, factoryPreset, formatSampleRate, normalizePatch, type SynthPatch } from '../src/renderer/src/model/synth'
import { parsePreset, serializePreset } from '../src/renderer/src/project/presets'
import { parseProject, serializeProject } from '../src/renderer/src/project/projectFile'

const RATE = 48000

/** Renders `seconds` of a synth that plays one note from 0.1 s for `length` seconds. */
function renderNote(patch: Partial<SynthPatch>, pitch = 69, length = 0.5, seconds = 1): Float32Array {
  const synth = new ChipSynth(RATE, { ...DEFAULT_PATCH, ...patch })
  synth.schedule({ frame: 0.1 * RATE, type: 'on', pitch, velocity: 127 })
  synth.schedule({ frame: (0.1 + length) * RATE, type: 'off', pitch, velocity: 0 })
  const out = new Float32Array(seconds * RATE)
  for (let i = 0; i < out.length; i += 128) synth.render(out.subarray(i, i + 128), i) // like the worklet: 128-frame blocks
  return out
}

const rms = (x: Float32Array, from: number, to: number): number => {
  let sum = 0
  for (let i = from * RATE; i < to * RATE; i++) sum += x[i] * x[i]
  return Math.sqrt(sum / ((to - from) * RATE))
}

/** Upward zero crossings per second between two times. */
const frequency = (x: Float32Array, from: number, to: number): number => {
  let crossings = 0
  for (let i = from * RATE + 1; i < to * RATE; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++
  return crossings / (to - from)
}

describe('ChipSynth', () => {
  it('plays a note at the right pitch, only while it should', () => {
    const out = renderNote({ waveform: 'pulse', duty: 0.5, release: 0.05 })
    expect(rms(out, 0, 0.09)).toBe(0)
    expect(rms(out, 0.2, 0.5)).toBeGreaterThan(0.05)
    expect(frequency(out, 0.2, 0.5)).toBeCloseTo(440, -1)
    expect(rms(out, 0.7, 1)).toBe(0) // released at 0.6 s + 50 ms release
  })

  it('follows octave and fine tuning', () => {
    expect(frequency(renderNote({ waveform: 'sine', octave: -1 }), 0.2, 0.5)).toBeCloseTo(220, -1)
    expect(frequency(renderNote({ waveform: 'triangle', octave: 1 }), 0.2, 0.5)).toBeCloseTo(880, -1)
    expect(frequency(renderNote({ waveform: 'sawtooth', fine: 100 }), 0.2, 0.5)).toBeCloseTo(466, -1)
  })

  it('shapes the volume with attack, decay and sustain', () => {
    const out = renderNote({ waveform: 'sine', attack: 0.1, decay: 0.1, sustain: 0.25, release: 0 })
    const early = rms(out, 0.1, 0.12)
    const peak = rms(out, 0.19, 0.21)
    const sustained = rms(out, 0.35, 0.55)
    expect(early).toBeLessThan(peak * 0.3)
    expect(sustained / peak).toBeCloseTo(0.25, 1)
  })

  it('ends one-shot sounds (sustain 0) on their own', () => {
    const out = renderNote({ waveform: 'noise', attack: 0.001, decay: 0.1, sustain: 0 }, 60, 0.8)
    expect(rms(out, 0.1, 0.15)).toBeGreaterThan(0.01)
    expect(rms(out, 0.25, 0.9)).toBe(0)
  })

  it('makes noise that is not periodic', () => {
    const out = renderNote({ waveform: 'noise', sustain: 1 }, 60)
    const values = new Set(Array.from(out.subarray(0.2 * RATE, 0.3 * RATE)).map((v) => Math.sign(v)))
    expect(values.size).toBeGreaterThan(1)
    expect(frequency(out, 0.2, 0.5)).toBeGreaterThan(1000) // far more sign changes than a 262 Hz tone
  })

  it('sweeps the pitch down with a pitch envelope', () => {
    const out = renderNote({ waveform: 'sine', pitchEnvAmount: 12, pitchEnvTime: 0.3 })
    expect(frequency(out, 0.1, 0.15)).toBeGreaterThan(700) // starts near 880 Hz
    expect(frequency(out, 0.45, 0.55)).toBeCloseTo(440, -1)
  })

  it('a low-pass filter takes away high frequencies', () => {
    const bright = renderNote({ waveform: 'sawtooth' }, 81)
    const dark = renderNote({ waveform: 'sawtooth', filterType: 'lowpass', cutoff: 300, resonance: 0.7 }, 81)
    expect(rms(dark, 0.2, 0.5)).toBeLessThan(rms(bright, 0.2, 0.5) * 0.5)
  })

  it('glides between notes in mono mode', () => {
    const synth = new ChipSynth(RATE, { ...DEFAULT_PATCH, waveform: 'sine', mono: true, glide: 0.2 })
    synth.schedule({ frame: 0, type: 'on', pitch: 57, velocity: 127 }) // 220 Hz
    synth.schedule({ frame: 0.3 * RATE, type: 'on', pitch: 69, velocity: 127 }) // legato to 440 Hz
    const out = new Float32Array(RATE)
    synth.render(out, 0)
    expect(frequency(out, 0.1, 0.29)).toBeCloseTo(220, -1)
    const during = frequency(out, 0.31, 0.36)
    expect(during).toBeGreaterThan(230)
    expect(during).toBeLessThan(430)
    expect(frequency(out, 0.8, 1)).toBeCloseTo(440, -1)
    expect(synth.activeVoices).toBe(1)
  })

  it('stays within ±1 even with a chord on a loud patch', () => {
    const synth = new ChipSynth(RATE, factoryPreset('8-bit square'))
    for (const pitch of [60, 64, 67, 72]) synth.schedule({ frame: 0, type: 'on', pitch, velocity: 127 })
    const out = new Float32Array(RATE / 2)
    synth.render(out, 0)
    expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(1)
  })
})

describe('Bitcrusher', () => {
  it('quantizes to the bit depth', () => {
    const crusher = new Bitcrusher(RATE, 3)
    expect([0.1, 0.3, -0.6, 0.99].map((x) => crusher.process(x))).toEqual([0, 0.25, -0.5, 1])
  })

  it('holds samples to lower the sample rate', () => {
    const crusher = new Bitcrusher(RATE, 16, RATE / 4)
    const out = [1, 2, 3, 4, 5, 6, 7, 8].map((x) => crusher.process(x / 10))
    expect(new Set(out.slice(0, 3)).size).toBe(1)
    expect(out[3]).not.toBe(out[2])
  })

  it('is off at 16 bits and rate 0', () => {
    expect(new Bitcrusher(RATE).active).toBe(false)
  })
})

describe('patches and presets', () => {
  it('upgrades old patches and clamps out-of-range values', () => {
    const old = { waveform: 'pulse', duty: 0.25, attack: 0.005, decay: 0.12, sustain: 0.6, release: 0.08 }
    expect(normalizePatch(old)).toEqual({ ...DEFAULT_PATCH, ...old })
    const wild = normalizePatch({ waveform: 'banjo', octave: 9, cutoff: -5, lfoTarget: 'everything', mono: 'yes' })
    expect(wild).toMatchObject({ waveform: 'pulse', octave: 3, cutoff: 40, lfoTarget: 'off', mono: false })
  })

  it('has valid factory presets with unique names', () => {
    expect(new Set(FACTORY_PRESETS.map((p) => p.name)).size).toBe(FACTORY_PRESETS.length)
    for (const preset of FACTORY_PRESETS) expect(normalizePatch(preset)).toEqual(preset)
  })

  it('round-trips a preset file and rejects other files', () => {
    const patch = { ...factoryPreset('Saw bass'), name: 'My bass', cutoff: 500 }
    expect(parsePreset(serializePreset(patch))).toEqual(patch)
    expect(() => parsePreset('{"hello": 1}')).toThrow('not an instrument file')
    expect(() => parsePreset('not json')).toThrow('not an instrument file')
  })

  it('formats bitcrusher rates', () => {
    expect([0, 22050, 11025, 5512].map(formatSampleRate)).toEqual(['Off', '22 kHz', '11 kHz', '5.5 kHz'])
  })
})

describe('Make it retro', () => {
  const cursor = { track: 0, bar: 0, beat: 0, string: 1 }

  it('gives tracks 8-bit sounds by role and can switch back', () => {
    let song = addTrack(createDemoSong(), cursor, 'guitar').song // guitar, bass, guitar
    const original = song.tracks.map((t) => t.instrument)
    song = makeRetro(song, cursor).song
    expect(isRetro(song)).toBe(true)
    expect(song.tracks.map((t) => (t.instrument.kind === 'synth' ? t.instrument.patch.name : t.instrument.kind))).toEqual([
      '8-bit lead',
      'Triangle bass',
      '8-bit thin lead'
    ])
    song = restoreSounds(song, cursor).song
    expect(isRetro(song)).toBe(false)
    expect(song.tracks.map((t) => t.instrument)).toEqual(original)
  })

  it('keeps the very first original sound when applied twice', () => {
    let song = makeRetro(createDemoSong(), cursor).song
    song = makeRetro(song, cursor).song
    expect(restoreSounds(song, cursor).song.tracks[0].instrument).toEqual(createDemoSong().tracks[0].instrument)
  })
})

describe('project format 3', () => {
  const cursor = { track: 0, bar: 0, beat: 0, string: 1 }

  it('saves full patches, master effects and retro originals', () => {
    let song = makeRetro(createDemoSong(), cursor).song
    song = updateMaster(song, cursor, { crushBits: 6, crushRate: 11025 }).song
    const loaded = parseProject(serializeProject(song)).song
    expect(loaded.master).toEqual({ crushBits: 6, crushRate: 11025 })
    expect(loaded.tracks[0].originalInstrument).toEqual(createDemoSong().tracks[0].instrument)
    expect(loaded.tracks).toEqual(song.tracks)
  })

  it('upgrades the small synth patches of format 2 files', () => {
    const song = createDemoSong()
    const oldBass = { waveform: 'pulse', duty: 0.5, attack: 0.005, decay: 0.08, sustain: 0.8, release: 0.05 }
    const json = { app: 'GameMusicApp', formatVersion: 2, song: { ...song, tracks: [song.tracks[0], { ...song.tracks[1], instrument: { kind: 'synth', patch: oldBass } }] } }
    const loaded = parseProject(zipSync({ 'song.json': strToU8(JSON.stringify(json)) })).song
    const bass = loaded.tracks[1].instrument
    expect(bass.kind === 'synth' && bass.patch).toEqual({ ...DEFAULT_PATCH, ...oldBass })
    expect(loaded.master).toBeUndefined()
  })
})
