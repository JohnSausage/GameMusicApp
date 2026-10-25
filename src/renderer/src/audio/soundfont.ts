// Spike only: the small Sonivox GM SoundFont that ships with alphaTab (Apache-2.0).
// It is low-fidelity and its README describes a mixed origin, so the real app
// should switch to GeneralUser GS or FluidR3_GM (REQUIREMENTS.md NFR-54).
import sonivoxUrl from '@coderline/alphatab/soundfont/sonivox.sf2?url'

let soundFont: Promise<ArrayBuffer> | null = null

/** Returns a fresh copy each time: the worklet synth takes ownership of (detaches) the buffer it gets. */
export async function loadSoundFont(): Promise<ArrayBuffer> {
  soundFont ??= fetch(sonivoxUrl).then((response) => {
    if (!response.ok) throw new Error(`Could not load SoundFont (${response.status})`)
    return response.arrayBuffer()
  })
  return (await soundFont).slice(0)
}

/** MIDI channel for a track; channel 9 is reserved for drums in General MIDI. */
export function channelForTrack(trackIndex: number): number {
  return trackIndex < 9 ? trackIndex : trackIndex + 1
}

export function panToMidi(pan: number): number {
  return Math.round((pan + 1) * 63.5)
}
