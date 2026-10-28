// Project files on disk and the recent-projects list (REQUIREMENTS.md PRJ-01/02/06).
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { rmSync } from 'node:fs'
import { access, mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const EXTENSION = 'gmsong'
const FILTERS = [{ name: 'GameMusicApp project', extensions: [EXTENSION] }]
const MAX_RECENT = 15

interface RecentProject {
  path: string
  title: string
  openedAt: string
  missing?: boolean
}

/** Default folder for new projects: ~/Documents/GameMusicApp. */
function projectsDir(): string {
  return join(app.getPath('documents'), 'GameMusicApp')
}

function recentFile(): string {
  return join(app.getPath('userData'), 'recent-projects.json')
}

/** Writes to a temp file first, so a crash mid-write never leaves a half-written project (NFR-30). */
async function writeAtomically(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, data)
  await rename(temp, path)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readRecent(): Promise<RecentProject[]> {
  try {
    const list = JSON.parse(await readFile(recentFile(), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function writeRecent(list: RecentProject[]): Promise<void> {
  await writeAtomically(recentFile(), JSON.stringify(list.slice(0, MAX_RECENT), null, 2))
}

const windowOf = (event: IpcMainInvokeEvent): BrowserWindow => BrowserWindow.fromWebContents(event.sender)!

/** Web contents with unsaved changes, reported by the renderer. */
const dirtyContents = new Set<number>()

export function registerProjectHandlers(): void {
  ipcMain.handle('projects:list-recent', async () =>
    Promise.all((await readRecent()).map(async (r) => ({ ...r, missing: !(await exists(r.path)) })))
  )

  ipcMain.handle('projects:record-recent', async (_event, path: string, title: string) => {
    const list = (await readRecent()).filter((r) => r.path !== path)
    list.unshift({ path, title, openedAt: new Date().toISOString() })
    await writeRecent(list)
  })

  ipcMain.handle('projects:remove-recent', async (_event, path: string) => {
    await writeRecent((await readRecent()).filter((r) => r.path !== path))
  })

  // Without a path, asks with a file dialog. A given path must come from the recent list,
  // so the renderer can't read arbitrary files.
  ipcMain.handle('projects:open', async (event, path?: string) => {
    let target = path
    if (target) {
      if (!(await readRecent()).some((r) => r.path === target)) throw new Error('This project is not in the recent list.')
    } else {
      const result = await dialog.showOpenDialog(windowOf(event), { filters: FILTERS, properties: ['openFile'], defaultPath: projectsDir() })
      if (result.canceled || !result.filePaths[0]) return null
      target = result.filePaths[0]
    }
    return { path: target, data: new Uint8Array(await readFile(target)) }
  })

  // Without a path ("Save as" or first save), asks where to save.
  ipcMain.handle('projects:save', async (event, data: Uint8Array, suggestedName: string, path?: string) => {
    let target = path
    if (!target) {
      await mkdir(projectsDir(), { recursive: true })
      const result = await dialog.showSaveDialog(windowOf(event), { defaultPath: join(projectsDir(), suggestedName), filters: FILTERS })
      if (result.canceled || !result.filePath) return null
      target = result.filePath.endsWith(`.${EXTENSION}`) ? result.filePath : `${result.filePath}.${EXTENSION}`
    }
    await writeAtomically(target, data)
    return target
  })

  ipcMain.on('projects:set-dirty', (event, dirty: boolean) => {
    if (dirty) dirtyContents.add(event.sender.id)
    else dirtyContents.delete(event.sender.id)
  })

  ipcMain.handle('recovery:list', () => listRecovery())
  ipcMain.handle('recovery:read', async (_event, id: string) => new Uint8Array(await readFile(recoveryFile(id, 'gmsong'))))
  ipcMain.handle('recovery:write', (event, id: string, data: Uint8Array, title: string, path: string | null) => {
    const file = recoveryFile(id, 'gmsong')
    if (discardedRecovery.has(id)) return
    ownedRecovery.set(event.sender.id, id)
    const meta: RecoveryMeta = { title, path, savedAt: new Date().toISOString(), pid: process.pid }
    return queued(id, async () => {
      // A copy discarded while this one was on its way stays discarded.
      if (discardedRecovery.has(id)) return
      await writeAtomically(file, data)
      await writeAtomically(recoveryFile(id, 'json'), JSON.stringify(meta, null, 2))
    })
  })
  ipcMain.handle('recovery:clear', (event, id: string) => {
    if (ownedRecovery.get(event.sender.id) === id) ownedRecovery.delete(event.sender.id)
    return queued(id, () => deleteRecovery(id))
  })
  // Copies of projects open right now are touched now and then, so another instance of the app leaves them alone.
  setInterval(() => {
    for (const id of ownedRecovery.values()) {
      const now = new Date()
      utimes(recoveryFile(id, 'gmsong'), now, now).catch(() => {})
    }
  }, HEARTBEAT_MS).unref()
}

// ---------------------------------------------------------------- recovery copies (PRJ-06)
// While a project has unsaved changes, the renderer keeps a copy of it in
// userData/recovery (see project/recovery.ts). Saving or closing without saving
// removes it; a copy still there later (the app crashed or was killed) is
// offered on the start page.

interface RecoveryMeta {
  title: string
  /** The project file the changes belong to; null if it was never saved. */
  path: string | null
  savedAt: string
  /** The app process that wrote it. */
  pid: number
}

const HEARTBEAT_MS = 30_000
const RECOVERY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function recoveryFile(id: string, extension: 'gmsong' | 'json'): string {
  if (!RECOVERY_ID.test(id)) throw new Error('Invalid recovery copy.')
  return join(app.getPath('userData'), 'recovery', `${id}.${extension}`)
}

/** The copy each window keeps, by web contents id. */
const ownedRecovery = new Map<number, string>()
/** Copies of changes the user chose to lose: not written again. */
const discardedRecovery = new Set<string>()
/** Writes and deletes of a copy run one after the other. */
const recoveryQueue = new Map<string, Promise<unknown>>()

function queued(id: string, task: () => Promise<void>): Promise<void> {
  const run = (recoveryQueue.get(id) ?? Promise.resolve()).then(task, task)
  recoveryQueue.set(id, run.catch(() => {}))
  return run
}

async function deleteRecovery(id: string): Promise<void> {
  await rm(recoveryFile(id, 'json'), { force: true })
  await rm(recoveryFile(id, 'gmsong'), { force: true })
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Copies left behind, newest first. A copy whose app still runs (and keeps touching it) is not left behind. */
async function listRecovery(): Promise<{ id: string; title: string; path: string | null; savedAt: string }[]> {
  let names: string[]
  try {
    names = await readdir(join(app.getPath('userData'), 'recovery'))
  } catch {
    return []
  }
  const owned = new Set(ownedRecovery.values())
  const entries = await Promise.all(
    names.map(async (name) => {
      const id = name.replace(/\.json$/, '')
      if (id === name || !RECOVERY_ID.test(id) || owned.has(id)) return null
      try {
        const meta = JSON.parse(await readFile(recoveryFile(id, 'json'), 'utf8')) as RecoveryMeta
        const { mtimeMs } = await stat(recoveryFile(id, 'gmsong'))
        if (meta.pid !== process.pid && isRunning(meta.pid) && Date.now() - mtimeMs < 3 * HEARTBEAT_MS) return null
        return { id, title: String(meta.title), path: typeof meta.path === 'string' ? meta.path : null, savedAt: String(meta.savedAt) }
      } catch {
        return null
      }
    })
  )
  return entries.filter((e) => e !== null).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

/** Removes a window's copy right away (its changes are being thrown away), and keeps it from being written again. */
function discardRecoveryOf(contentsId: number): void {
  const id = ownedRecovery.get(contentsId)
  if (!id) return
  ownedRecovery.delete(contentsId)
  discardedRecovery.add(id)
  for (const extension of ['json', 'gmsong'] as const) rmSync(recoveryFile(id, extension), { force: true })
}

/** The copies this run of the app keeps (for the smoke test), and removing them. */
export function ownRecoveryCopies(): { files: string[]; discard: () => void } {
  return {
    files: [...ownedRecovery.values()].map((id) => recoveryFile(id, 'gmsong')),
    discard: () => [...ownedRecovery.keys()].forEach(discardRecoveryOf)
  }
}

/**
 * If the window's project has unsaved changes, asks whether to go on and lose
 * them. Returns true when it's fine to go on (nothing unsaved, or confirmed).
 */
export function confirmDiscardChanges(win: BrowserWindow, detail: string, goOn: string): boolean {
  const id = win.webContents.id
  if (!dirtyContents.has(id)) return true
  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: ['Cancel', goOn],
    defaultId: 0,
    cancelId: 0,
    title: 'Unsaved changes',
    message: 'This project has unsaved changes.',
    detail
  })
  if (choice === 0) return false
  dirtyContents.delete(id)
  discardRecoveryOf(id)
  return true
}

/** Asks before closing a window whose project has unsaved changes. */
export function confirmCloseWhenDirty(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (!confirmDiscardChanges(win, 'Close GameMusicApp and lose them?', 'Close without saving')) event.preventDefault()
  })
}
