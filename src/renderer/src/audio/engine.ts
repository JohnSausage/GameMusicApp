import { MIDIControllers } from 'spessasynth_core'
import { WorkletSynthesizer } from 'spessasynth_lib'
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url'
import { consoleNotes } from '../model/consoles'
import { audibleTracks, type Instrument, type MasterSettings, type Song } from '../model/song'
import type { SynthPatch } from '../model/synth'
import { buildTimeline, metronomeClicks, type NoteEvent, type SongTimeline, type TimeRange } from '../model/timing'
import { BEND_RANGE, pitchWheelSteps, WHEEL_CENTER } from './bends'
import { songPosition, startPosition, startSchedule, takeDue, validLoop, type ScheduleState } from './scheduler'
import { peakOf, savedOutputDevice } from './meter'
import { createBitcrusher, createChipSynth, createTrackBus, crushActive, loadSynthWorklet } from './mixer'
import { channelForTrack, loadSoundFont, panToMidi } from './soundfont'
import type { ChipSynthMessage } from './synth/chipSynth.worklet'

/** How far ahead notes are handed to the audio thread. */
const LOOKAHEAD_SECONDS = 0.15
const SCHEDULER_INTERVAL_MS = 25
/** Sequenced notes are shortened slightly so repeated notes re-attack audibly. */
const GATE = 0.92
const LIVE_CHANNEL = 15
/** Playback speeds (PLAY-08). */
export const MIN_SPEED = 0.25
export const MAX_SPEED = 2
const DRUM_CHANNEL = 9

export interface PlayOptions {
  /** Context time to start at, so other audio can start in sync. */
  startAt?: number
  /** Play this range over and over (PLAY-02). Playback starts at its start unless `from` is inside it. */
  loop?: TimeRange | null
  /** Metronome clicks during playback (PLAY-07); setMetronome() switches it while playing. */
  metronome?: boolean
  /** Playback speed for practicing (PLAY-08), 0.25–2: the song's tempo stays, notes keep their pitch. */
  speed?: number
}

interface Playback {
  song: Song
  timeline: SongTimeline
  from: number
  /** Context time at which song time `from` is heard. */
  startTime: number
  /** Song seconds per context second. */
  speed: number
  loop: TimeRange | null
  schedule: ScheduleState
  timer: number
  /** Pitch wheel moves for SoundFont hammer-ons and slides, in time order; handed out like notes, shortly before they're due. */
  wheel: { when: number; channel: number; value: number }[]
  /** Chip synths per track: none for SoundFont tracks, one for a synth, one per piece for a synth drum kit. */
  synths: TrackSynth[]
  buses: GainNode[]
  audible: boolean[]
}


/** Chip synth nodes of a track by the note they play, with the pitch to send them. */
type TrackSynth = Map<number | 'any', { node: AudioWorkletNode; pitch?: number }>

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
  /** What is heard: the master (after the bitcrusher) and sound effects. The level meter measures it (PLAY-06). */
  readonly output: GainNode
  private readonly meters: AnalyserNode[]
  private readonly meterData = new Float32Array(1024)
  private crusher: AudioWorkletNode | null = null
  private synth: WorkletSynthesizer | null = null
  private playback: Playback | null = null
  private generation = 0
  private liveSynth: AudioWorkletNode | null = null
  private livePatch: SynthPatch | null = null
  private liveProgram = -1
  private metronome = false
  onEnded: (() => void) | null = null

  private constructor() {
    // Always stereo, so a mono sound shows on both sides of the meter.
    this.output = new GainNode(this.ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' })
    this.output.connect(this.ctx.destination)
    const splitter = this.ctx.createChannelSplitter(2)
    this.output.connect(splitter)
    this.meters = [0, 1].map((channel) => {
      const analyser = new AnalyserNode(this.ctx, { fftSize: this.meterData.length })
      splitter.connect(analyser, channel)
      return analyser
    })
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(this.output)
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
    // The output picked before; if it's gone, the default one.
    const device = savedOutputDevice()
    if (device) await engine.setOutputDevice(device).catch(() => undefined)
    return engine
  }

  get latency(): LatencyInfo {
    return {
      sampleRate: this.ctx.sampleRate,
      baseLatencyMs: this.ctx.baseLatency * 1000,
      outputLatencyMs: (this.ctx.outputLatency || 0) * 1000
    }
  }

  /** Peak levels of the left and right output over the last 20 ms or so (1 = full scale). */
  levels(): [number, number] {
    const [left, right] = this.meters.map((analyser) => {
      analyser.getFloatTimeDomainData(this.meterData)
      return peakOf(this.meterData)
    })
    return [left, right]
  }

  /** Plays through another audio output (PLAY-10); '' = the system's default. */
  async setOutputDevice(deviceId: string): Promise<void> {
    const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
    if (!ctx.setSinkId) throw new Error('This version cannot choose the audio output.')
    await ctx.setSinkId(deviceId)
  }

  get isPlaying(): boolean {
    return this.playback !== null
  }

  /** Current song position in seconds (compensated for output latency), or null. */
  position(): number | null {
    const p = this.playback
    if (!p) return null
    return songPosition(p.from, (this.ctx.currentTime - p.startTime - (this.ctx.outputLatency || 0)) * p.speed, p.loop)
  }

  /**
   * The song position that was audible at a performance.now() time, e.g. a MIDI
   * key press, so recorded notes land where the player heard the music. Null when not playing.
   */
  positionAt(performanceMs: number): number | null {
    const p = this.playback
    if (!p) return null
    const stamp = this.ctx.getOutputTimestamp()
    const heard =
      stamp.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.performanceTime > 0
        ? stamp.contextTime + (performanceMs - stamp.performanceTime) / 1000
        : this.ctx.currentTime - (this.ctx.outputLatency || 0) - (performance.now() - performanceMs) / 1000
    return songPosition(p.from, (heard - p.startTime) * p.speed, p.loop)
  }

  /** Plays from song time `from`, optionally looping a range and with the metronome. */
  async play(song: Song, from = 0, options: PlayOptions = {}): Promise<void> {
    this.stop()
    await this.ctx.resume()
    const synth = this.synth!
    const full = buildTimeline(song)
    // In authentic mode, the notes as the song's console plays them (SYN-36).
    const timeline = { ...full, notes: consoleNotes(song, full.notes) }
    const loop = validLoop(options.loop)
    from = startPosition(from, loop)
    this.metronome = options.metronome ?? false
    const buses = song.tracks.map((track) => createTrackBus(this.ctx, this.master, track.volume, track.pan))
    const synths = song.tracks.map((track, i): TrackSynth => {
      const synth: TrackSynth = new Map()
      const add = (key: number | 'any', patch: SynthPatch, pitch?: number): void => {
        const node = createChipSynth(this.ctx, patch)
        node.connect(buses[i])
        synth.set(key, { node, pitch })
      }
      if (track.instrument.kind === 'synth') add('any', track.instrument.patch)
      else if (track.instrument.kind === 'synthkit') for (const piece of track.instrument.pieces) add(piece.note, piece.patch, piece.pitch)
      return synth
    })
    this.setMasterCrush(song.master)

    song.tracks.forEach((track, trackIndex) => {
      if (track.instrument.kind !== 'soundfont') return
      const channel = channelForTrack(song, trackIndex)
      synth.programChange(channel, track.instrument.program)
      synth.controllerChange(channel, MIDIControllers.pan, panToMidi(track.pan))
      synth.pitchWheelRange(channel, BEND_RANGE)
      synth.pitchWheel(channel, WHEEL_CENTER)
    })

    const startTime = options.startAt ?? this.ctx.currentTime + 0.08
    const speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, options.speed ?? 1))
    const playback: Playback = {
      song,
      timeline,
      from,
      startTime,
      speed,
      loop,
      schedule: startSchedule(timeline, from, startTime, loop, metronomeClicks(song, timeline.duration), speed),
      timer: 0,
      wheel: [],
      synths,
      buses,
      audible: []
    }
    this.playback = playback
    this.updateMix(song)
    playback.timer = window.setInterval(() => this.schedule(playback), SCHEDULER_INTERVAL_MS)
    this.generation++
    this.schedule(playback)
  }

  /**
   * Applies track volumes, mute and solo, also while playing (PLAY-05). Tracks
   * keep their place: only how loud they are changes.
   */
  updateMix(song: Song): void {
    const p = this.playback
    if (!p || song.tracks.length !== p.song.tracks.length) return
    p.audible = audibleTracks(song)
    song.tracks.forEach((track, i) => {
      const volume = p.audible[i] ? track.volume : 0
      p.buses[i].gain.setTargetAtTime(volume, this.ctx.currentTime, 0.01)
      if (p.song.tracks[i].instrument.kind === 'soundfont') {
        this.synth!.controllerChange(channelForTrack(p.song, i), MIDIControllers.mainVolume, Math.round(volume * 127))
      }
    })
  }

  /** Switches the metronome on or off, also while playing. */
  setMetronome(on: boolean): void {
    this.metronome = on
  }

  stop(): void {
    const p = this.playback
    if (!p) return
    this.playback = null
    window.clearInterval(p.timer)
    for (const synth of p.synths) {
      for (const { node } of synth.values()) {
        send(node, { type: 'dispose' })
        node.disconnect()
      }
    }
    p.buses.forEach((b) => b.disconnect())
    this.synth?.stopAll(true)
    // Notes already queued in the worklet (up to LOOKAHEAD) may still start; silence them too.
    const generation = this.generation
    window.setTimeout(() => {
      if (this.generation === generation && !this.playback) this.synth?.stopAll(true)
    }, LOOKAHEAD_SECONDS * 1000 + 60)
  }

  /** Hands notes and clicks that are due soon to the audio thread. */
  private schedule(p: Playback): void {
    const now = this.ctx.currentTime
    const due = takeDue(p.schedule, now, now + LOOKAHEAD_SECONDS)
    for (const { note, when } of due.notes) this.playNote(p, note, when)
    if (this.metronome) for (const { when, accent } of due.clicks) this.click(when, accent)
    while (p.wheel.length > 0 && p.wheel[0].when <= now + LOOKAHEAD_SECONDS) {
      const { when, channel, value } = p.wheel.shift()!
      this.synth!.pitchWheel(channel, value, { time: when })
    }
    const position = this.position()
    if (!p.loop && position !== null && position > p.timeline.duration + 0.5) {
      this.stop()
      this.onEnded?.()
    }
  }

  private playNote(p: Playback, note: NoteEvent, when: number): void {
    if (!p.audible[note.trackIndex]) return
    const instrument = p.song.tracks[note.trackIndex].instrument
    // Song seconds from the note's start, in context time (slower playback stretches them).
    const later = (songSeconds: number): number => when + songSeconds / p.speed
    const length = note.duration * GATE
    if (instrument.kind === 'soundfont') {
      const channel = channelForTrack(p.song, note.trackIndex)
      this.synth!.noteOn(channel, note.pitch, note.velocity, { time: when })
      this.synth!.noteOff(channel, note.pitch, { time: later(length) })
      const steps = pitchWheelSteps(note, note.start + length)
      if (steps.length > 0) {
        p.wheel.push(...steps.map((step) => ({ when: later(step.time - note.start), channel, value: step.value })))
        p.wheel.sort((a, b) => a.when - b.when)
      }
    } else {
      const synth = p.synths[note.trackIndex]
      const target = synth.get(note.pitch) ?? synth.get('any')
      const bends = note.bends?.map((bend) => ({ ...bend, time: later(bend.time - note.start), glide: bend.glide / p.speed }))
      if (target) send(target.node, { type: 'note', time: when, pitch: target.pitch ?? note.pitch, velocity: note.velocity, duration: length / p.speed, bends })
    }
  }

  /** Routes the master bus through a bitcrusher while one is set (SYN-30). */
  setMasterCrush(settings: MasterSettings | undefined): void {
    const crush = settings ? { bits: settings.crushBits, rate: settings.crushRate } : undefined
    if (crushActive(crush)) {
      if (!this.crusher) {
        this.crusher = createBitcrusher(this.ctx, crush)
        this.master.disconnect()
        this.master.connect(this.crusher).connect(this.output)
      } else this.crusher.port.postMessage(crush)
    } else if (this.crusher) {
      this.master.disconnect()
      this.crusher.disconnect()
      this.crusher = null
      this.master.connect(this.output)
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

  /** Live note from the MIDI keyboard or computer keyboard; `drums` plays SoundFont notes on the drum channel. */
  liveNoteOn(instrument: Instrument, pitch: number, velocity: number, drums = false): void {
    void this.ctx.resume()
    this.liveNoteOff(instrument, pitch, drums)
    if (instrument.kind === 'soundfont' && drums) {
      this.synth!.noteOn(DRUM_CHANNEL, pitch, velocity)
    } else if (instrument.kind === 'soundfont') {
      if (this.liveProgram !== instrument.program) {
        this.synth!.programChange(LIVE_CHANNEL, instrument.program)
        this.liveProgram = instrument.program
      }
      this.synth!.noteOn(LIVE_CHANNEL, pitch, velocity)
    } else if (instrument.kind === 'synth') {
      send(this.liveSynthFor(instrument.patch), { type: 'on', pitch, velocity })
    } else {
      const piece = instrument.pieces.find((p) => p.note === pitch)
      if (piece) send(this.liveSynthFor(piece.patch), { type: 'on', pitch: piece.pitch, velocity })
    }
  }

  liveNoteOff(instrument: Instrument, pitch: number, drums = false): void {
    if (instrument.kind === 'soundfont') this.synth!.noteOff(drums ? DRUM_CHANNEL : LIVE_CHANNEL, pitch)
    else if (this.liveSynth) {
      const piece = instrument.kind === 'synthkit' ? instrument.pieces.find((p) => p.note === pitch) : undefined
      send(this.liveSynth, { type: 'off', pitch: piece ? piece.pitch : pitch })
    }
  }

  /** One metronome click at context time `t`; the first beat of a bar is higher. */
  private click(t: number, accent: boolean): OscillatorNode {
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.frequency.value = accent ? 1500 : 1000
    gain.gain.setValueAtTime(0.3, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
    osc.connect(gain).connect(this.master)
    osc.start(t)
    osc.stop(t + 0.06)
    return osc
  }

  /**
   * Metronome clicks; the first click of each bar is accented. `firstBeatInBar`
   * says where in the bar the first click falls. Returns a stop function.
   */
  scheduleClicks(startTime: number, secondsPerClick: number, count: number, clicksPerBar: number, firstBeatInBar = 0): () => void {
    const oscillators: OscillatorNode[] = []
    for (let i = 0; i < count; i++) oscillators.push(this.click(startTime + i * secondsPerClick, (i + firstBeatInBar) % clicksPerBar === 0))
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
    return this.startBuffer(buffer, this.master, onEnded, when)
  }

  /**
   * Plays a rendered sound effect next to the song, as a game does: as loud as
   * it is exported, and not through the song's master bitcrusher. Returns a stop function.
   */
  playEffect(buffer: AudioBuffer, onEnded?: () => void): () => void {
    return this.startBuffer(buffer, this.output, onEnded, 0)
  }

  private startBuffer(buffer: AudioBuffer, output: AudioNode, onEnded: (() => void) | undefined, when: number): () => void {
    void this.ctx.resume()
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(output)
    source.onended = () => onEnded?.()
    source.start(when)
    return () => source.stop()
  }
}
