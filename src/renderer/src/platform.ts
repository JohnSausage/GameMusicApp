export interface RecentProject {
  path: string
  title: string
  openedAt: string
  missing?: boolean
}

/** Unsaved changes kept for crash recovery (PRJ-06), left behind by a run of the app that ended without saving them. */
export interface RecoveryEntry {
  id: string
  title: string
  /** The project file the changes belong to; null if it was never saved. */
  path: string | null
  /** When the copy was written: the last change. */
  savedAt: string
}

/** Copies of unsaved changes, by an id per open project. */
export interface RecoveryStore {
  /** Copies left behind by earlier runs, newest first. */
  list(): Promise<RecoveryEntry[]>
  read(id: string): Promise<Uint8Array>
  write(id: string, data: Uint8Array, title: string, path: string | null): Promise<void>
  clear(id: string): Promise<void>
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
  /** Saves files into a folder the user picks; returns the folder, or null if cancelled. */
  saveFiles(files: NamedFile[]): Promise<string | null>
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
  recovery: RecoveryStore
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

export interface NamedFile {
  name: string
  data: Uint8Array
}

/** Saves files into a folder the user picks (in a browser: downloads them). Returns where they went, or null if cancelled. */
export async function saveFiles(files: NamedFile[]): Promise<string | null> {
  if (window.gameMusicApp) return window.gameMusicApp.saveFiles(files)
  for (const file of files) await saveFile(file.name, file.data)
  return 'your downloads'
}
