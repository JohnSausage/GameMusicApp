export interface RecentProject {
  path: string
  title: string
  openedAt: string
  missing?: boolean
}

export interface OpenedProject {
  path: string
  data: Uint8Array
}

export type AudioLatency = 'low' | 'standard'

export interface AppSettings {
  audioLatency: AudioLatency
}

/** Saved settings, the ones the app started with (applied at startup), and the defaults. */
export interface SettingsState {
  saved: AppSettings
  active: AppSettings
  defaults: AppSettings
}

interface ElectronBridge {
  platform: string
  saveFile(defaultName: string, data: Uint8Array): Promise<string | null>
  /** The window printed to a PDF (A4); what is printed is set by print CSS. */
  printPdf(): Promise<Uint8Array>
  projects: {
    listRecent(): Promise<RecentProject[]>
    recordRecent(path: string, title: string): Promise<void>
    removeRecent(path: string): Promise<void>
    open(path?: string): Promise<OpenedProject | null>
    save(data: Uint8Array, suggestedName: string, path?: string): Promise<string | null>
    setDirty(dirty: boolean): void
  }
  presets: {
    list(): Promise<{ id: string; text: string }[]>
    save(name: string, text: string): Promise<string>
    remove(id: string): Promise<void>
  }
  settings: {
    get(): Promise<SettingsState>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  /** Restarts the app; false if the user chose to keep unsaved changes. */
  restart(): Promise<boolean>
}

declare global {
  interface Window {
    gameMusicApp?: ElectronBridge
  }
}

export const isElectron = window.gameMusicApp !== undefined

/** Saves a file via the native dialog in Electron, or as a download in a browser. */
export async function saveFile(defaultName: string, data: Uint8Array): Promise<string | null> {
  if (window.gameMusicApp) return window.gameMusicApp.saveFile(defaultName, data)
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>]))
  const link = document.createElement('a')
  link.href = url
  link.download = defaultName
  link.click()
  URL.revokeObjectURL(url)
  return defaultName
}
