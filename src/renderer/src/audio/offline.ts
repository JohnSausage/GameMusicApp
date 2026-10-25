import { MIDIControllers, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core'
import type { Song } from '../model/song'
import { buildTimeline } from '../model/timing'
import { createBitcrusher, createChipSynth, createTrackBus, crushActive, loadSynthWorklet } from './mixer'
import { channelForTrack, loadSoundFont, panToMidi } from './soundfont'

const GATE = 0.92
const BLOCK = 128

interface MidiStep {
  frame: number
  /** Note-offs sort before note-ons on the same frame. */
  order: number
  apply: (synth: SpessaSynthProcessor) => void
}

/** Renders the SoundFont tracks with SpessaSynth's processor directly in JS (no Web Audio). */
async function renderSoundFontTracks(song: Song, sampleRate: number, frameCount: number): Promise<Float32Array<ArrayBuffer>[] | null> {
  const tracks = song.tracks.map((track, index) => ({ track, index })).filter(({ track }) => track.instrument.kind === 'soundfont')
  if (tracks.length === 0) return null

  const synth = new SpessaSynthProcessor(sampleRate)
  await synth.processorInitialized
  synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(await loadSoundFont()), 'main')
  for (const { track, index } of tracks) {
    if (track.instrument.kind !== 'soundfont') continue
    const channel = channelForTrack(index)
    synth.programChange(channel, track.instrument.program)
    synth.controllerChange(channel, MIDIControllers.mainVolume, Math.round(track.volume * 127))
    synth.controllerChange(channel, MIDIControllers.pan, panToMidi(track.pan))
  }

  const steps: MidiStep[] = []
  for (const note of buildTimeline(song).notes) {
    if (song.tracks[note.trackIndex].instrument.kind !== 'soundfont') continue
    const channel = channelForTrack(note.trackIndex)
    steps.push({ frame: Math.round(note.start * sampleRate), order: 1, apply: (s) => s.noteOn(channel, note.pitch, note.velocity) })
    steps.push({ frame: Math.round((note.start + note.duration * GATE) * sampleRate), order: 0, apply: (s) => s.noteOff(channel, note.pitch) })
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

/**
 * Offline WAV render. Synth tracks use the same chip synth worklet as live
 * playback, so export matches what you hear (REQUIREMENTS.md PLAY-09).
 */
export async function renderSongOffline(song: Song, sampleRate = 48000, tailSeconds = 1.5): Promise<AudioBuffer> {
  const timeline = buildTimeline(song)
  const frameCount = Math.ceil((timeline.duration + tailSeconds) * sampleRate)
  const offline = new OfflineAudioContext(2, frameCount, sampleRate)
  await loadSynthWorklet(offline)
  const master = offline.createGain()
  master.gain.value = 0.9
  const crush = song.master ? { bits: song.master.crushBits, rate: song.master.crushRate } : undefined
  if (crushActive(crush)) master.connect(createBitcrusher(offline, crush)).connect(offline.destination)
  else master.connect(offline.destination)

  const soundFontAudio = await renderSoundFontTracks(song, sampleRate, frameCount)
  if (soundFontAudio) {
    const buffer = offline.createBuffer(2, frameCount, sampleRate)
    buffer.copyToChannel(soundFontAudio[0], 0)
    buffer.copyToChannel(soundFontAudio[1], 1)
    const source = offline.createBufferSource()
    source.buffer = buffer
    source.connect(master)
    source.start(0)
  }

  // One chip synth per synth track, with all its notes handed over up front.
  song.tracks.forEach((track, trackIndex) => {
    if (track.instrument.kind !== 'synth') return
    const notes = timeline.notes
      .filter((n) => n.trackIndex === trackIndex)
      .map((n) => ({ time: n.start, pitch: n.pitch, velocity: n.velocity, duration: n.duration * GATE }))
    createChipSynth(offline, track.instrument.patch, notes).connect(createTrackBus(offline, master, track.volume, track.pan))
  })

  return offline.startRendering()
}
