export function midiToFrequency(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12)
}
