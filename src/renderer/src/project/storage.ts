import type { OpenedProject, RecentProject } from '../platform'
import { PROJECT_EXTENSION } from './projectFile'

/** Where projects are read from and written to. */
export interface ProjectStorage {
  listRecent(): Promise<RecentProject[]>
  /** Without a path, lets the user pick a file. */
  open(path?: string): Promise<OpenedProject | null>
  /** Without a path ("Save as" / first save), lets the user choose where. Returns the path, or null if cancelled. */
  save(data: Uint8Array, suggestedName: string, path?: string): Promise<string | null>
  recordRecent(path: string, title: string): Promise<void>
  removeRecent(path: string): Promise<void>
  setDirty(dirty: boolean): void
}

/** Files on disk, through the Electron main process. */
function electronStorage(): ProjectStorage {
  const projects = window.gameMusicApp!.projects
  return {
    listRecent: () => projects.listRecent(),
    open: (path) => projects.open(path),
    save: (data, name, path) => projects.save(data, name, path),
    recordRecent: (path, title) => projects.recordRecent(path, title),
    removeRecent: (path) => projects.removeRecent(path),
    setDirty: (dirty) => projects.setDirty(dirty)
  }
}

const RECENT_KEY = 'gma.recent'
const PROJECT_KEY = (path: string): string => `gma.project:${path}`

function toBase64(data: Uint8Array): string {
  let text = ''
  for (let i = 0; i < data.length; i += 0x8000) text += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(text)
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `.${PROJECT_EXTENSION}`
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/**
 * Browser preview only (npm run dev:web): projects live in localStorage, and
 * "Open…" imports a .gmsong file from disk.
 */
function browserStorage(): ProjectStorage {
  const readRecent = (): RecentProject[] => JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  const writeRecent = (list: RecentProject[]): void => localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 15)))
  const store = (path: string, data: Uint8Array): void => localStorage.setItem(PROJECT_KEY(path), toBase64(data))

  return {
    listRecent: async () => readRecent().map((r) => ({ ...r, missing: localStorage.getItem(PROJECT_KEY(r.path)) === null })),
    open: async (path) => {
      if (path) {
        const stored = localStorage.getItem(PROJECT_KEY(path))
        return stored === null ? null : { path, data: fromBase64(stored) }
      }
      const file = await pickFile()
      if (!file) return null
      const opened = { path: `browser:${crypto.randomUUID()}`, data: new Uint8Array(await file.arrayBuffer()) }
      store(opened.path, opened.data)
      return opened
    },
    save: async (data, _name, path) => {
      const target = path ?? `browser:${crypto.randomUUID()}`
      store(target, data)
      return target
    },
    recordRecent: async (path, title) => writeRecent([{ path, title, openedAt: new Date().toISOString() }, ...readRecent().filter((r) => r.path !== path)]),
    removeRecent: async (path) => writeRecent(readRecent().filter((r) => r.path !== path)),
    setDirty: (dirty) => {
      window.onbeforeunload = dirty ? (event) => event.preventDefault() : null
    }
  }
}

export function createStorage(): ProjectStorage {
  return window.gameMusicApp ? electronStorage() : browserStorage()
}
