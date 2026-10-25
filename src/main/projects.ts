// Project files on disk and the recent-projects list (REQUIREMENTS.md PRJ-01/02/06).
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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
}

/** Asks before closing a window whose project has unsaved changes. */
export function confirmCloseWhenDirty(win: BrowserWindow): void {
  const id = win.webContents.id
  win.on('close', (event) => {
    if (!dirtyContents.has(id)) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Cancel', 'Close without saving'],
      defaultId: 0,
      cancelId: 0,
      title: 'Unsaved changes',
      message: 'This project has unsaved changes.',
      detail: 'Close GameMusicApp and lose them?'
    })
    if (choice === 0) event.preventDefault()
    else dirtyContents.delete(id)
  })
}
