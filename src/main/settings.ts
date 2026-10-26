import { app, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AUDIO_BUFFER_FRAMES, defaultSettings, parseSettings, validSettingsPatch, type AppSettings } from './settingsFile'

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

function readSettings(): AppSettings {
  let text: string | null = null
  try {
    text = readFileSync(settingsPath(), 'utf8')
  } catch {
    // No settings saved yet.
  }
  return parseSettings(text, process.platform)
}

/**
 * Applies the settings that Chromium only reads at startup (the audio buffer
 * size), so it must run before the app is ready. Returns what is in effect.
 */
export function applyStartupSettings(): AppSettings {
  const settings = readSettings()
  const frames = AUDIO_BUFFER_FRAMES[settings.audioLatency]
  if (frames !== null) app.commandLine.appendSwitch('audio-buffer-size', String(frames))
  return settings
}

/** `active` are the settings the app started with; saved changes apply after a restart. */
export function registerSettingsHandlers(active: AppSettings): void {
  ipcMain.handle('settings:get', () => ({ saved: readSettings(), active, defaults: defaultSettings(process.platform) }))

  ipcMain.handle('settings:set', async (_event, patch: unknown) => {
    const change = validSettingsPatch(patch)
    if (!change) throw new Error('Invalid settings')
    const settings = { ...readSettings(), ...change }
    const file = settingsPath()
    await mkdir(dirname(file), { recursive: true })
    await writeFile(`${file}.tmp`, JSON.stringify(settings, null, 2))
    await rename(`${file}.tmp`, file)
    return settings
  })
}
