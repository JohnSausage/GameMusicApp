import { MIDIControllers } from 'spessasynth_core'
import { WorkletSynthesizer } from 'spessasynth_lib'
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url'
import type { Instrument, MasterSettings, Song } from '../model/song'
import type { SynthPatch } from '../model/synth'
import { buildTimeline, type NoteEvent, type SongTimeline } from '../model/timing'
import { createBitcrusher, createChipSynth, createTrackBus, crushActive, loadSynthWorklet } from './mixer'
import { channelForTrack, loadSoundFont, panToMidi } from './soundfont'
import type { ChipSynthMessage } from './synth/chipSynth.worklet'

/** How far ahead notes are handed to the audio thread. */
const LOOKAHEAD_SECONDS = 0.15
const SCHEDULER_INTERVAL_MS = 25
/** Sequenced notes are shortened slightly so repeated notes re-attack audibly. */
const GATE = 0.92
const LIVE_CHANNEL = 15

interface Playback {
  song: Song
  timeline: SongTimeline
  from: number
  /** Context time at which song time `from` is heard. */
  startTime: number
  nextNote: number
  timer: number
  /** Chip synth per track (null for SoundFont tracks). */
  synths: (AudioWorkletNode | null)[]
  buses: GainNode[]
}

const send = (node: AudioWorkletNode, message: ChipSynthMessage): void => node.port.postMessage(message)

export interface LatencyInfo {
  sampleRate: number
  baseLatencyMs: number
  outputLatencyMs: number
}

/**
 * Real-time playback: SoundFont tracks go to SpessaSynth, synth tracks to one
 * chip synth worklet each; both are scheduled from the same song timeline.
 */
export class AudioEngine {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' })
  /** Everything mixes into `master`, which goes through the optional master bitcrusher. */
  readonly master: GainNode
  private crusher: AudioWorkletNode | null = null
  private synth: WorkletSynthesizer | null = null
  private playback: Playback | null = null
  private generation = 0
  private liveSynth: AudioWorkletNode | null = null
  private livePatch: SynthPatch | null = null
  private liveProgram = -1
  onEnded: (() => void) | null = null

  private constructor() {
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(this.ctx.destination)
  }

  static async create(): Promise<AudioEngine> {
    const engine = new AudioEngine()
    await loadSynthWorklet(engine.ctx)
    await engine.ctx.audioWorklet.addModule(processorUrl)
    const synth = new WorkletSynthesizer(engine.ctx)
    synth.connect(engine.master)
    await synth.soundBankManager.addSoundBank(await loadSoundFont(), 'main')
    await synth.isReady
    engine.synth = synth
    return engine
  }

  get latency(): LatencyInfo {
    return {
      sampleRate: this.ctx.sampleRate,
      baseLatencyMs: this.ctx.baseLatency * 1000,
      outputLatencyMs: (this.ctx.outputLatency || 0) * 1000
    }
  }

  get isPlaying(): boolean {
    return this.playback !== null
  }

  /** Current song position in seconds (compensated for output latency), or null. */
  position(): number | null {
    const p = this.playback
    if (!p) return null
    return Math.max(p.from, p.from + this.ctx.currentTime - p.startTime - (this.ctx.outputLatency || 0))
  }

  /** Plays from song time `from`; `startAt` (context time) lets other audio start in sync. */
  async play(song: Song, from = 0, startAt?: number): Promise<void> {
    this.stop()
    await this.ctx.resume()
    const synth = this.synth!
    const timeline = buildTimeline(song)
    const buses = song.tracks.map((track) => createTrackBus(this.ctx, this.master, track.volume, track.pan))
    const synths = song.tracks.map((track, i) => {
      if (track.instrument.kind !== 'synth') return null
      const node = createChipSynth(this.ctx, track.instrument.patch)
      node.connect(buses[i])
      return node
    })
    this.setMasterCrush(song.master)

    song.tracks.forEach((track, trackIndex) => {
      if (track.instrument.kind !== 'soundfont') return
      const channel = channelForTrack(trackIndex)
      synth.programChange(channel, track.instrument.program)
      synth.controllerChange(channel, MIDIControllers.mainVolume, Math.round(track.volume * 127))
      synth.controllerChange(channel, MIDIControllers.pan, panToMidi(track.pan))
    })

    const playback: Playback = {
      song,
      timeline,
      from,
      startTime: startAt ?? this.ctx.currentTime + 0.08,
      nextNote: timeline.notes.findIndex((n) => n.start >= from),
      timer: 0,
      synths,
      buses
    }
    if (playback.nextNote < 0) playback.nextNote = timeline.notes.length
    playback.timer = window.setInterval(() => this.schedule(playback), SCHEDULER_INTERVAL_MS)
    this.playback = playback
    this.generation++
    this.schedule(playback)
  }

  stop(): void {
    const p = this.playback
    if (!p) return
    this.playback = null
    window.clearInterval(p.timer)
    for (const node of p.synths) {
      if (!node) continue
      send(node, { type: 'dispose' })
      node.disconnect()
    }
    p.buses.forEach((b) => b.disconnect())
    this.synth?.stopAll(true)
    // Notes already queued in the worklet (up to LOOKAHEAD) may still start; silence them too.
    const generation = this.generation
    window.setTimeout(() => {
      if (this.generation === generation && !this.playback) this.synth?.stopAll(true)
    }, LOOKAHEAD_SECONDS * 1000 + 60)
  }

  private schedule(p: Playback): void {
    const horizon = this.ctx.currentTime + LOOKAHEAD_SECONDS
    const notes = p.timeline.notes
    while (p.nextNote < notes.length) {
      const note = notes[p.nextNote]
      const when = p.startTime + note.start - p.from
      if (when > horizon) break
      if (when >= this.ctx.currentTime - 0.01) this.playNote(p, note, when)
      p.nextNote++
    }
    const position = this.position()
    if (position !== null && position > p.timeline.duration + 0.5) {
      this.stop()
      this.onEnded?.()
    }
  }

  private playNote(p: Playback, note: NoteEvent, when: number): void {
    const instrument = p.song.tracks[note.trackIndex].instrument
    const length = note.duration * GATE
    if (instrument.kind === 'soundfont') {
      const channel = channelForTrack(note.trackIndex)
      this.synth!.noteOn(channel, note.pitch, note.velocity, { time: when })
      this.synth!.noteOff(channel, note.pitch, { time: when + length })
    } else {
      const node = p.synths[note.trackIndex]
      if (node) send(node, { type: 'note', time: when, pitch: note.pitch, velocity: note.velocity, duration: length })
    }
  }

  /** Routes the master bus through a bitcrusher while one is set (SYN-30). */
  setMasterCrush(settings: MasterSettings | undefined): void {
    const crush = settings ? { bits: settings.crushBits, rate: settings.crushRate } : undefined
    if (crushActive(crush)) {
      if (!this.crusher) {
        this.crusher = createBitcrusher(this.ctx, crush)
        this.master.disconnect()
        this.master.connect(this.crusher).connect(this.ctx.destination)
      } else this.crusher.port.postMessage(crush)
    } else if (this.crusher) {
      this.master.disconnect()
      this.crusher.disconnect()
      this.crusher = null
      this.master.connect(this.ctx.destination)
    }
  }

  /** The synth used for live notes; patch changes apply to notes that are already sounding (SYN-06). */
  private liveSynthFor(patch: SynthPatch): AudioWorkletNode {
    if (!this.liveSynth) {
      this.liveSynth = createChipSynth(this.ctx, patch)
      this.liveSynth.connect(this.master)
      this.livePatch = patch
    } else if (this.livePatch !== patch) {
      send(this.liveSynth, { type: 'patch', patch })
      this.livePatch = patch
    }
    return this.liveSynth
  }

  /** Updates the sound of live notes right away, e.g. while editing an instrument. */
  setLivePatch(patch: SynthPatch): void {
    if (this.liveSynth) this.liveSynthFor(patch)
  }

  /** Live note from the MIDI keyboard or computer keyboard. */
  liveNoteOn(instrument: Instrument, pitch: number, velocity: number): void {
    void this.ctx.resume()
    this.liveNoteOff(instrument, pitch)
    if (instrument.kind === 'soundfont') {
      if (this.liveProgram !== instrument.program) {
        this.synth!.programChange(LIVE_CHANNEL, instrument.program)
        this.liveProgram = instrument.program
      }
      this.synth!.noteOn(LIVE_CHANNEL, pitch, velocity)
    } else {
      send(this.liveSynthFor(instrument.patch), { type: 'on', pitch, velocity })
    }
  }

  liveNoteOff(instrument: Instrument, pitch: number): void {
    if (instrument.kind === 'soundfont') this.synth!.noteOff(LIVE_CHANNEL, pitch)
    else if (this.liveSynth) send(this.liveSynth, { type: 'off', pitch })
  }

  /**
   * Metronome clicks; the first click of each bar is accented. `firstBeatInBar`
   * says where in the bar the first click falls. Returns a stop function.
   */
  scheduleClicks(startTime: number, secondsPerClick: number, count: number, clicksPerBar: number, firstBeatInBar = 0): () => void {
    const oscillators: OscillatorNode[] = []
    for (let i = 0; i < count; i++) {
      const t = startTime + i * secondsPerClick
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.frequency.value = (i + firstBeatInBar) % clicksPerBar === 0 ? 1500 : 1000
      gain.gain.setValueAtTime(0.3, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
      osc.connect(gain).connect(this.master)
      osc.start(t)
      osc.stop(t + 0.06)
      oscillators.push(osc)
    }
    return () => oscillators.forEach((o) => {
      try {
        o.stop()
      } catch {
        // already stopped
      }
    })
  }

  /** Plays an audio buffer (e.g. a recorded take), now or at context time `when`. Returns a stop function. */
  playBuffer(buffer: AudioBuffer, onEnded?: () => void, when = 0): () => void {
    void this.ctx.resume()
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.master)
    source.onended = () => onEnded?.()
    source.start(when)
    return () => source.stop()
  }
}
