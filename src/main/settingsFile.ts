// App settings kept in settings.json in the user data folder (REQUIREMENTS.md SET-01).
// No Electron imports here, so this part can be unit-tested.

/** Audio buffer: 'low' for live playing (smaller buffer), 'standard' for Chromium's default. */
export type AudioLatency = 'low' | 'standard'

export interface AppSettings {
  audioLatency: AudioLatency
}

/** Audio buffer size in sample frames per setting (Chromium's --audio-buffer-size); null keeps the default (512 on Linux). */
export const AUDIO_BUFFER_FRAMES: Record<AudioLatency, number | null> = { low: 256, standard: null }

/** Low latency by default on Linux, where it was measured (30 ms instead of 50 ms key → sound). */
export function defaultSettings(platform: string): AppSettings {
  return { audioLatency: platform === 'linux' ? 'low' : 'standard' }
}

/** Reads settings.json; unknown or broken values fall back to the defaults. */
export function parseSettings(text: string | null, platform: string): AppSettings {
  const settings = defaultSettings(platform)
  if (text === null) return settings
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return settings
    const { audioLatency } = value as Record<string, unknown>
    if (audioLatency === 'low' || audioLatency === 'standard') settings.audioLatency = audioLatency
  } catch {
    // A broken file is replaced on the next save.
  }
  return settings
}

/** Checks a settings change sent by the renderer. */
export function validSettingsPatch(patch: unknown): Partial<AppSettings> | null {
  if (typeof patch !== 'object' || patch === null) return null
  const { audioLatency } = patch as Record<string, unknown>
  if (audioLatency !== 'low' && audioLatency !== 'standard') return null
  return { audioLatency }
}
