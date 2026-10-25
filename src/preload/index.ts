import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('gameMusicApp', {
  platform: process.platform,
  saveFile: (defaultName: string, data: Uint8Array): Promise<string | null> =>
    ipcRenderer.invoke('save-file', defaultName, data)
})
