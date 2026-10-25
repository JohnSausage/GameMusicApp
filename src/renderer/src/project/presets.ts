// Instrument preset files (.gminst) and the personal preset library (SYN-11, SYN-12).
import { normalizePatch, type SynthPatch } from '../model/synth'

export const PRESET_EXTENSION = 'gminst'

export interface UserPreset {
  id: string
  patch: SynthPatch
}

interface PresetJson {
  app: 'GameMusicApp'
  type: 'instrument'
  formatVersion: 1
  patch: SynthPatch
}

export function serializePreset(patch: SynthPatch): string {
  const json: PresetJson = { app: 'GameMusicApp', type: 'instrument', formatVersion: 1, patch }
  return JSON.stringify(json, null, 2)
}

/** Reads a .gminst file; unknown or missing settings fall back to defaults. */
export function parsePreset(text: string): SynthPatch {
  let json: Partial<PresetJson>
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('This is not an instrument file.')
  }
  if (json.app !== 'GameMusicApp' || json.type !== 'instrument' || !json.patch) throw new Error('This is not an instrument file.')
  return normalizePatch(json.patch)
}

export interface PresetStore {
  list(): Promise<UserPreset[]>
  save(patch: SynthPatch): Promise<void>
  remove(id: string): Promise<void>
}

function electronPresets(): PresetStore {
  const presets = window.gameMusicApp!.presets
  return {
    list: async () => {
      const files = await presets.list()
      return files.flatMap(({ id, text }) => {
        try {
          return [{ id, patch: parsePreset(text) }]
        } catch {
          return [] // skip damaged files instead of hiding the whole library
        }
      })
    },
    save: async (patch) => {
      await presets.save(patch.name, serializePreset(patch))
    },
    remove: (id) => presets.remove(id)
  }
}

const STORAGE_KEY = 'gma.presets'

/** Browser preview only: presets live in localStorage. */
function browserPresets(): PresetStore {
  const read = (): UserPreset[] => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  const write = (list: UserPreset[]): void => localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  return {
    list: async () => read().map((p) => ({ id: p.id, patch: normalizePatch(p.patch) })),
    save: async (patch) => write([...read(), { id: crypto.randomUUID(), patch }]),
    remove: async (id) => write(read().filter((p) => p.id !== id))
  }
}

export function createPresetStore(): PresetStore {
  return window.gameMusicApp ? electronPresets() : browserPresets()
}
