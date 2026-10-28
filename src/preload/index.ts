import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('gameMusicApp', {
  platform: process.platform,
  saveFile: (defaultName: string, data: Uint8Array): Promise<string | null> =>
    ipcRenderer.invoke('save-file', defaultName, data),
  saveFiles: (files: { name: string; data: Uint8Array }[]): Promise<string | null> => ipcRenderer.invoke('save-files', files),
  printPdf: (): Promise<Uint8Array> => ipcRenderer.invoke('print-pdf'),
  projects: {
    listRecent: () => ipcRenderer.invoke('projects:list-recent'),
    recordRecent: (path: string, title: string) => ipcRenderer.invoke('projects:record-recent', path, title),
    removeRecent: (path: string) => ipcRenderer.invoke('projects:remove-recent', path),
    open: (path?: string) => ipcRenderer.invoke('projects:open', path),
    save: (data: Uint8Array, suggestedName: string, path?: string) => ipcRenderer.invoke('projects:save', data, suggestedName, path),
    setDirty: (dirty: boolean) => ipcRenderer.send('projects:set-dirty', dirty)
  },
  recovery: {
    list: () => ipcRenderer.invoke('recovery:list'),
    read: (id: string) => ipcRenderer.invoke('recovery:read', id),
    write: (id: string, data: Uint8Array, title: string, path: string | null) => ipcRenderer.invoke('recovery:write', id, data, title, path),
    clear: (id: string) => ipcRenderer.invoke('recovery:clear', id)
  },
  presets: {
    list: () => ipcRenderer.invoke('presets:list'),
    save: (name: string, text: string) => ipcRenderer.invoke('presets:save', name, text),
    remove: (id: string) => ipcRenderer.invoke('presets:delete', id)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: object) => ipcRenderer.invoke('settings:set', patch)
  },
  restart: (): Promise<boolean> => ipcRenderer.invoke('app:restart')
})
