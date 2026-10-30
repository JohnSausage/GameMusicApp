// The master level meter (REQUIREMENTS.md PLAY-06) and the audio output device
// (PLAY-10): helpers that don't need Web Audio, and the output remembered on
// this computer.
import { readPref, writePref } from '../prefs'

/** Lowest level shown on the meter, in dBFS. */
export const METER_FLOOR_DB = -48
/** A peak this close to full scale counts as clipping. */
export const CLIP_LEVEL = 0.999

/** The highest absolute sample. */
export function peakOf(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i])
    if (value > peak) peak = value
  }
  return peak
}

/** Decibels relative to full scale; -Infinity for silence. */
export const toDecibels = (peak: number): number => (peak > 0 ? 20 * Math.log10(peak) : -Infinity)

/** Where a peak is on the meter, 0 (the floor or quieter) to 1 (full scale or louder). */
export function meterPosition(peak: number): number {
  return Math.max(0, Math.min(1, (toDecibels(peak) - METER_FLOOR_DB) / -METER_FLOOR_DB))
}

const OUTPUT_PREF = 'outputDevice'

/** The audio output picked (PLAY-10); '' = the system's default. */
export const savedOutputDevice = (): string => readPref(OUTPUT_PREF, '')

export const saveOutputDevice = (deviceId: string): void => writePref(OUTPUT_PREF, deviceId)

export async function listOutputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== '')
}
