// The chip synth's sound generation, in plain TypeScript so it runs in an
// AudioWorklet (live playback and WAV export) and in unit tests alike.
// Oscillators are deliberately naive (not band-limited) for the raw 8-bit sound.
import { LFO_DEPTH_SCALE, type SynthPatch } from '../../model/synth'

const MAX_VOICES = 12
/** Mix level per voice, leaving headroom for chords. */
const OUTPUT_GAIN = 0.2

export interface ScheduledNote {
  frame: number
  /** 'bend' moves the voice playing `pitch` to `to` without playing it again (hammer-ons, slides). */
  type: 'on' | 'off' | 'bend'
  pitch: number
  velocity: number
  to?: number
  /** Seconds a bend takes; 0 jumps. */
  glide?: number
}

/** Reduces bit depth and sample rate (SYN-30). */
export class Bitcrusher {
  private counter = 0
  private held = 0

  constructor(
    private readonly sampleRate: number,
    public bits = 16,
    public rate = 0
  ) {}

  get active(): boolean {
    return this.bits < 16 || (this.rate > 0 && this.rate < this.sampleRate)
  }

  process(x: number): number {
    const hold = this.rate > 0 && this.rate < this.sampleRate ? this.sampleRate / this.rate : 1
    this.counter += 1
    if (this.counter >= hold) {
      this.counter -= hold
      const steps = 2 ** (this.bits - 1)
      this.held = this.bits < 16 ? Math.round(x * steps) / steps : x
    }
    return this.held
  }
}

class Voice {
  /** Pitch the voice is gliding from/at, and the pitch it's heading to (mono glide). */
  currentPitch: number
  targetPitch: number
  phase = 0
  noisePhase = 0
  lfsr = 1
  /** Seconds since the note started. */
  time = 0
  released = false
  releaseAt = 0
  releaseLevel = 0
  envelope = 0
  done = false
  // Filter state (topology-preserving state variable filter).
  ic1 = 0
  ic2 = 0
  /** A slide in progress: from which pitch, starting when (voice time) and for how long. */
  slide: { from: number; start: number; duration: number } | null = null

  constructor(
    public pitch: number,
    public velocity: number,
    fromPitch: number
  ) {
    this.currentPitch = fromPitch
    this.targetPitch = pitch
  }
}

export class ChipSynth {
  private patch: SynthPatch
  private voices: Voice[] = []
  private events: ScheduledNote[] = []
  /** Mono mode: keys held down, latest last. */
  private held: number[] = []
  private lastPitch: number | null = null
  private readonly crusher: Bitcrusher
  private readonly dt: number

  constructor(
    private readonly sampleRate: number,
    patch: SynthPatch
  ) {
    this.patch = patch
    this.dt = 1 / sampleRate
    this.crusher = new Bitcrusher(sampleRate, patch.crushBits, patch.crushRate)
  }

  setPatch(patch: SynthPatch): void {
    this.patch = patch
    this.crusher.bits = patch.crushBits
    this.crusher.rate = patch.crushRate
  }

  get activeVoices(): number {
    return this.voices.length
  }

  /** Schedules a note on/off at an absolute frame; events are kept in time order. */
  schedule(event: ScheduledNote): void {
    let i = this.events.length
    while (i > 0 && this.events[i - 1].frame > event.frame) i--
    this.events.splice(i, 0, event)
  }

  /** Silences everything immediately and forgets scheduled notes. */
  reset(): void {
    this.events = []
    this.voices = []
    this.held = []
  }

  /** Renders `output.length` samples starting at absolute frame `startFrame` (overwrites output). */
  render(output: Float32Array, startFrame: number): void {
    let i = 0
    while (i < output.length) {
      while (this.events.length > 0 && this.events[0].frame <= startFrame + i) this.apply(this.events.shift()!)
      const nextEvent = this.events.length > 0 ? this.events[0].frame - startFrame : output.length
      const end = Math.min(output.length, Math.max(i + 1, nextEvent))
      for (; i < end; i++) output[i] = this.crusher.active ? this.crusher.process(this.sample()) : this.sample()
    }
    this.voices = this.voices.filter((v) => !v.done)
  }

  private apply(event: ScheduledNote): void {
    if (event.type === 'on') this.noteOn(event.pitch, event.velocity)
    else if (event.type === 'off') this.noteOff(event.pitch)
    else this.bend(event.pitch, event.to ?? event.pitch, event.glide ?? 0)
  }

  /** Moves the voice that plays `pitch` to another pitch; it keeps answering to `pitch` (e.g. for its note-off). */
  private bend(pitch: number, to: number, glide: number): void {
    const voice = this.voices.find((v) => v.pitch === pitch && !v.released)
    if (!voice) return
    voice.targetPitch = to
    if (glide > 0) voice.slide = { from: voice.currentPitch, start: voice.time, duration: glide }
    else {
      voice.slide = null
      voice.currentPitch = to
    }
  }

  private noteOn(pitch: number, velocity: number): void {
    const from = this.patch.glide > 0 && this.lastPitch !== null ? this.lastPitch : pitch
    this.lastPitch = pitch
    if (this.patch.mono) {
      this.held = [...this.held.filter((p) => p !== pitch), pitch]
      const voice = this.voices.find((v) => !v.released)
      if (voice) {
        // Legato: keep the envelope running and glide to the new pitch.
        voice.pitch = pitch
        voice.targetPitch = pitch
        if (this.patch.glide <= 0) voice.currentPitch = pitch
        return
      }
      this.voices.forEach((v) => this.release(v))
    } else {
      this.voices.filter((v) => v.pitch === pitch && !v.released).forEach((v) => this.release(v))
      if (this.voices.length >= MAX_VOICES) this.voices.shift()
    }
    this.voices.push(new Voice(pitch, velocity, this.patch.mono ? from : pitch))
  }

  private noteOff(pitch: number): void {
    if (this.patch.mono) {
      this.held = this.held.filter((p) => p !== pitch)
      const voice = this.voices.find((v) => !v.released)
      if (!voice || voice.pitch !== pitch) return
      const back = this.held[this.held.length - 1]
      if (back !== undefined) {
        voice.pitch = back
        voice.targetPitch = back
        if (this.patch.glide <= 0) voice.currentPitch = back
        this.lastPitch = back
      } else this.release(voice)
      return
    }
    this.voices.filter((v) => v.pitch === pitch && !v.released).forEach((v) => this.release(v))
  }

  private release(voice: Voice): void {
    if (voice.released) return
    voice.released = true
    voice.releaseAt = voice.time
    voice.releaseLevel = voice.envelope
  }

  private sample(): number {
    let sum = 0
    for (const voice of this.voices) if (!voice.done) sum += this.voiceSample(voice)
    return sum * OUTPUT_GAIN
  }

  private voiceSample(v: Voice): number {
    const p = this.patch
    const t = v.time
    v.time += this.dt

    // Volume envelope (ADSR, linear segments).
    let env: number
    if (!v.released) {
      if (t < p.attack) env = t / p.attack
      else if (t < p.attack + p.decay) env = 1 - ((1 - p.sustain) * (t - p.attack)) / p.decay
      else env = p.sustain
    } else {
      const r = t - v.releaseAt
      env = p.release > 0 ? v.releaseLevel * (1 - r / p.release) : 0
      if (env <= 0) {
        v.done = true
        return 0
      }
    }
    v.envelope = env
    if (!v.released && p.sustain === 0 && t > p.attack + p.decay) {
      v.done = true
      return 0
    }

    // LFO wave (-1…1), fading in over 150 ms after its delay; scaled by depth per target below.
    let lfo = 0
    if (p.lfoTarget !== 'off' && t > p.lfoDelay) {
      const since = t - p.lfoDelay
      lfo = Math.sin(2 * Math.PI * p.lfoRate * since) * Math.min(1, since / 0.15)
    }

    // Pitch: a slide (straight to the target in its time) or glide (eases towards the target, ~`glide` seconds),
    // then octave/fine, pitch envelope, vibrato.
    if (v.slide) {
      const progress = Math.min(1, (t - v.slide.start) / v.slide.duration)
      v.currentPitch = v.slide.from + (v.targetPitch - v.slide.from) * progress
      if (progress >= 1) v.slide = null
    } else if (v.currentPitch !== v.targetPitch) {
      const distance = v.targetPitch - v.currentPitch
      v.currentPitch = Math.abs(distance) < 0.001 ? v.targetPitch : v.currentPitch + (distance * this.dt * 4) / Math.max(p.glide, 1e-3)
    }
    let semitones = v.currentPitch + p.octave * 12 + p.fine / 100
    if (p.pitchEnvAmount !== 0 && t < p.pitchEnvTime) semitones += p.pitchEnvAmount * (1 - t / p.pitchEnvTime)
    if (p.lfoTarget === 'pitch') semitones += lfo * p.lfoDepth * LFO_DEPTH_SCALE.pitch
    const frequency = 440 * 2 ** ((semitones - 69) / 12)

    // Oscillator.
    v.phase += frequency * this.dt
    v.phase -= Math.floor(v.phase)
    let x: number
    switch (p.waveform) {
      case 'pulse': {
        const duty = Math.min(0.98, Math.max(0.02, p.duty + (p.lfoTarget === 'duty' ? lfo * p.lfoDepth * LFO_DEPTH_SCALE.duty : 0)))
        x = (v.phase < duty ? 1 : -1) - (2 * duty - 1) // remove the DC offset of narrow pulses
        break
      }
      case 'triangle':
        x = 4 * Math.abs(v.phase - 0.5) - 1
        break
      case 'sawtooth':
        x = 2 * v.phase - 1
        break
      case 'sine':
        x = Math.sin(2 * Math.PI * v.phase)
        break
      case 'noise': {
        // 15-bit LFSR like the NES noise channel; higher notes clock it faster (C4 ≈ 8 kHz: bright hiss).
        v.noisePhase += frequency * 32 * this.dt
        while (v.noisePhase >= 1) {
          v.noisePhase -= 1
          const bit = (v.lfsr ^ (v.lfsr >> 1)) & 1
          v.lfsr = (v.lfsr >> 1) | (bit << 14)
        }
        x = v.lfsr & 1 ? 1 : -1
        break
      }
    }

    // Filter (state variable filter, Simper/Zavalishin form).
    if (p.filterType !== 'off') {
      const octaves = p.filterEnv * env + (p.lfoTarget === 'cutoff' ? lfo * p.lfoDepth * LFO_DEPTH_SCALE.cutoff : 0)
      const cutoff = Math.min(this.sampleRate * 0.45, Math.max(20, p.cutoff * 2 ** octaves))
      const g = Math.tan((Math.PI * cutoff) / this.sampleRate)
      const k = 1 / p.resonance
      const a1 = 1 / (1 + g * (g + k))
      const a2 = g * a1
      const a3 = g * a2
      const v3 = x - v.ic2
      const v1 = a1 * v.ic1 + a2 * v3
      const v2 = v.ic2 + a2 * v.ic1 + a3 * v3
      v.ic1 = 2 * v1 - v.ic1
      v.ic2 = 2 * v2 - v.ic2
      x = p.filterType === 'lowpass' ? v2 : x - k * v1 - v2
    }

    const velocityGain = 1 - p.velocity + (p.velocity * v.velocity) / 127
    // Tremolo dips the volume by up to `depth` (between 1 and 1 - depth).
    const tremolo = p.lfoTarget === 'volume' ? 1 - p.lfoDepth * LFO_DEPTH_SCALE.volume * 0.5 * (1 + lfo) : 1
    return x * env * p.volume * velocityGain * tremolo
  }
}
