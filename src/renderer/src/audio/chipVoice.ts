import type { SynthPatch } from '../model/song'

const PEAK_GAIN = 0.22
const HARMONICS = 64

const pulseWaves = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>()

export function midiToFrequency(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12)
}

/** Band-limited pulse wave built from its Fourier series: a_n = 2/(nπ)·sin(nπ·duty). */
function pulseWave(ctx: BaseAudioContext, duty: number): PeriodicWave {
  let cache = pulseWaves.get(ctx)
  if (!cache) {
    cache = new Map()
    pulseWaves.set(ctx, cache)
  }
  const key = Math.round(duty * 1000)
  let wave = cache.get(key)
  if (!wave) {
    const real = new Float32Array(HARMONICS)
    const imag = new Float32Array(HARMONICS)
    for (let n = 1; n < HARMONICS; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty)
    wave = ctx.createPeriodicWave(real, imag)
    cache.set(key, wave)
  }
  return wave
}

export interface ChipVoice {
  /** Starts the release phase at the given context time. */
  release(at: number): void
  /** Silences the voice immediately (used when playback stops). */
  stopNow(): void
}

/**
 * Plays one synth note. Pass `duration` for sequenced notes; omit it for live
 * notes and call release() on key-up. Works in AudioContext and OfflineAudioContext.
 */
export function startChipVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  patch: SynthPatch,
  pitch: number,
  velocity: number,
  start: number,
  duration?: number
): ChipVoice {
  const osc = ctx.createOscillator()
  if (patch.waveform === 'pulse') osc.setPeriodicWave(pulseWave(ctx, patch.duty))
  else osc.type = patch.waveform
  osc.frequency.value = midiToFrequency(pitch)

  const envelope = ctx.createGain()
  const gain = envelope.gain
  const peak = PEAK_GAIN * (velocity / 127)
  gain.setValueAtTime(0, start)
  gain.linearRampToValueAtTime(peak, start + patch.attack)
  gain.linearRampToValueAtTime(peak * patch.sustain, start + patch.attack + patch.decay)

  osc.connect(envelope).connect(destination)
  osc.start(start)

  let released = false
  const voice: ChipVoice = {
    release(at) {
      if (released) return
      released = true
      const t = Math.max(at, start)
      gain.cancelAndHoldAtTime(t)
      gain.linearRampToValueAtTime(0, t + patch.release)
      osc.stop(t + patch.release + 0.02)
    },
    stopNow() {
      released = true
      try {
        osc.stop()
      } catch {
        // already stopped
      }
      envelope.disconnect()
    }
  }
  if (duration !== undefined) voice.release(start + duration)
  return voice
}

/** Per-track volume + pan, feeding the master bus. */
export function createTrackBus(ctx: BaseAudioContext, master: AudioNode, volume: number, pan: number): GainNode {
  const gain = ctx.createGain()
  gain.gain.value = volume
  const panner = ctx.createStereoPanner()
  panner.pan.value = pan
  gain.connect(panner).connect(master)
  return gain
}
