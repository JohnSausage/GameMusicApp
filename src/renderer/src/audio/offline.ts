import { MIDIControllers, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core'
import { effectSeconds, effectSong, finishEffectAudio, type EffectWavOptions } from '../model/effects'
import { audibleTracks, type Song, type SoundEffect } from '../model/song'
import { buildTimeline, exportFrameCount, notesBetween, type ExportEnding, type NoteEvent, type TimeRange } from '../model/timing'
import { createBitcrusher, createChipSynth, createTrackBus, crushActive, loadSynthWorklet } from './mixer'
import { BEND_RANGE, pitchWheelSteps } from './bends'
import { channelForTrack, loadSoundFont, panToMidi } from './soundfont'

const GATE = 0.92
const BLOCK = 128

interface MidiStep {
  frame: number
  /** Note-offs sort before note-ons on the same frame. */
  order: number
  apply: (synth: SpessaSynthProcessor) => void
}

/** Renders the SoundFont tracks' notes with SpessaSynth's processor directly in JS (no Web Audio). */
async function renderSoundFontTracks(song: Song, notes: NoteEvent[], sampleRate: number, frameCount: number): Promise<Float32Array<ArrayBuffer>[] | null> {
  const tracks = song.tracks.map((track, index) => ({ track, index })).filter(({ track }) => track.instrument.kind === 'soundfont')
  if (tracks.length === 0 || !notes.some((n) => song.tracks[n.trackIndex].instrument.kind === 'soundfont')) return null

  const synth = new SpessaSynthProcessor(sampleRate)
  await synth.processorInitialized
  synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(await loadSoundFont()), 'main')
  for (const { track, index } of tracks) {
    if (track.instrument.kind !== 'soundfont') continue
    const channel = channelForTrack(song, index)
    synth.programChange(channel, track.instrument.program)
    synth.controllerChange(channel, MIDIControllers.mainVolume, Math.round(track.volume * 127))
    synth.controllerChange(channel, MIDIControllers.pan, panToMidi(track.pan))
    // Pitch wheel range for hammer-ons and slides (RPN 0).
    synth.controllerChange(channel, MIDIControllers.registeredParameterMSB, 0)
    synth.controllerChange(channel, MIDIControllers.registeredParameterLSB, 0)
    synth.controllerChange(channel, MIDIControllers.dataEntryMSB, BEND_RANGE)
    synth.controllerChange(channel, MIDIControllers.dataEntryLSB, 0)
  }

  const steps: MidiStep[] = []
  for (const note of notes) {
    if (song.tracks[note.trackIndex].instrument.kind !== 'soundfont') continue
    const channel = channelForTrack(song, note.trackIndex)
    steps.push({ frame: Math.round(note.start * sampleRate), order: 1, apply: (s) => s.noteOn(channel, note.pitch, note.velocity) })
    steps.push({ frame: Math.round((note.start + note.duration * GATE) * sampleRate), order: 0, apply: (s) => s.noteOff(channel, note.pitch) })
    for (const wheel of pitchWheelSteps(note, note.start + note.duration * GATE)) {
      steps.push({ frame: Math.round(wheel.time * sampleRate), order: 0, apply: (s) => s.pitchWheel(channel, wheel.value) })
    }
  }
  steps.sort((a, b) => a.frame - b.frame || a.order - b.order)

  const left = new Float32Array(frameCount)
  const right = new Float32Array(frameCount)
  let position = 0
  const renderUntil = (frame: number): void => {
    while (position < frame) {
      const count = Math.min(BLOCK, frame - position)
      synth.process(left, right, position, count)
      position += count
    }
  }
  for (const step of steps) {
    renderUntil(Math.min(step.frame, frameCount))
    step.apply(synth)
  }
  renderUntil(frameCount)
  return [left, right]
}

export interface RenderOptions {
  /** Part of the song to render, in seconds (default: all of it). */
  range?: TimeRange
  /**
   * 'tail' lets notes ring out after the end; 'cut' ends exactly at the end of
   * the range with a short fade, so the file loops without a gap (EXP-05).
   */
  ending?: ExportEnding
}

/** Fade at a cut end, short enough not to be heard but long enough to avoid a click. */
const CUT_FADE_SECONDS = 0.005

/**
 * Offline WAV render. Synth tracks use the same chip synth worklet as live
 * playback, and muted tracks are left out, so export matches what you hear
 * (REQUIREMENTS.md PLAY-09, EXP-02, EXP-05).
 */
export async function renderSongOffline(song: Song, sampleRate = 48000, options: RenderOptions = {}): Promise<AudioBuffer> {
  const all = buildTimeline(song)
  const range = options.range ?? { start: 0, end: all.duration }
  const ending = options.ending ?? 'tail'
  const audible = audibleTracks(song)
  const timeline = { notes: notesBetween(all.notes, range.start, range.end).filter((n) => audible[n.trackIndex]) }
  const frameCount = Math.max(1, exportFrameCount(range, sampleRate, ending))
  const offline = new OfflineAudioContext(2, frameCount, sampleRate)
  await loadSynthWorklet(offline)
  const master = offline.createGain()
  master.gain.value = 0.9
  const crush = song.master ? { bits: song.master.crushBits, rate: song.master.crushRate } : undefined
  if (crushActive(crush)) master.connect(createBitcrusher(offline, crush)).connect(offline.destination)
  else master.connect(offline.destination)

  const soundFontAudio = await renderSoundFontTracks(song, timeline.notes, sampleRate, frameCount)
  if (soundFontAudio) {
    const buffer = offline.createBuffer(2, frameCount, sampleRate)
    buffer.copyToChannel(soundFontAudio[0], 0)
    buffer.copyToChannel(soundFontAudio[1], 1)
    const source = offline.createBufferSource()
    source.buffer = buffer
    source.connect(master)
    source.start(0)
  }

  // One chip synth per synth track (or per piece of a synth drum kit), with all its notes handed over up front.
  song.tracks.forEach((track, trackIndex) => {
    const instrument = track.instrument
    if (instrument.kind === 'soundfont' || !audible[trackIndex]) return
    const bus = createTrackBus(offline, master, track.volume, track.pan)
    const notes = timeline.notes.filter((n) => n.trackIndex === trackIndex)
    const toSynth = (pitch: (n: (typeof notes)[number]) => number) => (n: (typeof notes)[number]) => ({
      time: n.start,
      pitch: pitch(n),
      velocity: n.velocity,
      duration: n.duration * GATE,
      bends: n.bends
    })
    if (instrument.kind === 'synth') {
      createChipSynth(offline, instrument.patch, notes.map(toSynth((n) => n.pitch))).connect(bus)
      return
    }
    for (const piece of instrument.pieces) {
      const hits = notes.filter((n) => n.pitch === piece.note)
      if (hits.length > 0) createChipSynth(offline, piece.patch, hits.map(toSynth(() => piece.pitch))).connect(bus)
    }
  })

  const buffer = await offline.startRendering()
  if (ending === 'cut') fadeOut(buffer, CUT_FADE_SECONDS)
  return buffer
}

/** Rendered after a sound effect's last note: longer than any sound rings on (the longest release is 4 s). */
const EFFECT_TAIL_SECONDS = 5

/**
 * A sound effect's audio as it is exported: from its start until its sound has
 * faded (see finishEffectAudio). Null when it has no notes, or makes no sound.
 */
export async function renderEffect(effect: SoundEffect, sampleRate: number, options: EffectWavOptions): Promise<Float32Array[] | null> {
  const notesEnd = effectSeconds(effect)
  if (notesEnd === 0) return null
  const buffer = await renderSongOffline(effectSong(effect), sampleRate, { range: { start: 0, end: notesEnd + EFFECT_TAIL_SECONDS }, ending: 'cut' })
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
  return finishEffectAudio(channels, sampleRate, options)
}

/** Fades the last `seconds` of a buffer to silence. */
function fadeOut(buffer: AudioBuffer, seconds: number): void {
  const frames = Math.min(buffer.length, Math.round(seconds * buffer.sampleRate))
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < frames; i++) data[buffer.length - 1 - i] *= i / frames
  }
}
