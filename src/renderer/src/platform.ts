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

interface ElectronBridge {
  platform: string
  saveFile(defaultName: string, data: Uint8Array): Promise<string | null>
  projects: {
    listRecent(): Promise<RecentProject[]>
    recordRecent(path: string, title: string): Promise<void>
    removeRecent(path: string): Promise<void>
    open(path?: string): Promise<OpenedProject | null>
    save(data: Uint8Array, suggestedName: string, path?: string): Promise<string | null>
    setDirty(dirty: boolean): void
  }
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
