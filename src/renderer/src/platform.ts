interface ElectronBridge {
  platform: string
  saveFile(defaultName: string, data: Uint8Array): Promise<string | null>
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
