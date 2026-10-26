// Spike only: the small Sonivox GM SoundFont that ships with alphaTab (Apache-2.0).
// It is low-fidelity and its README describes a mixed origin, so the real app
// should switch to GeneralUser GS or FluidR3_GM (REQUIREMENTS.md NFR-54).
import sonivoxUrl from '@coderline/alphatab/soundfont/sonivox.sf2?url'
import type { Song } from '../model/song'

let soundFont: Promise<ArrayBuffer> | null = null

/** Returns a fresh copy each time: the worklet synth takes ownership of (detaches) the buffer it gets. */
export async function loadSoundFont(): Promise<ArrayBuffer> {
  soundFont ??= fetch(sonivoxUrl).then((response) => {
    if (!response.ok) throw new Error(`Could not load SoundFont (${response.status})`)
    return response.arrayBuffer()
  })
  return (await soundFont).slice(0)
}

/** MIDI channel for a track: drum tracks use the General MIDI drum channel 9, the others count up and skip it. */
export function channelForTrack(song: Song, trackIndex: number): number {
  if (song.tracks[trackIndex].kind === 'drums') return 9
  const melodic = song.tracks.slice(0, trackIndex).filter((t) => t.kind !== 'drums').length
  return melodic < 9 ? melodic : melodic + 1
}

export function panToMidi(pan: number): number {
  return Math.round((pan + 1) * 63.5)
}
