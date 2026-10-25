// The personal instrument library (REQUIREMENTS.md SYN-11): one .gminst file per
// preset in the app's settings folder, e.g. ~/.config/GameMusicApp/presets/.
import { app, ipcMain } from 'electron'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const EXTENSION = '.gminst'

function presetsDir(): string {
  return join(app.getPath('userData'), 'presets')
}

/** A preset id is its file name; only plain names are accepted so nothing outside the folder is touched. */
function presetPath(id: string): string {
  if (!/^[\w ()+.-]+\.gminst$/.test(id) || id.includes('..')) throw new Error('Invalid preset id')
  return join(presetsDir(), id)
}

function fileNameFor(name: string, taken: Set<string>): string {
  const base = name.replace(/[^\w ()+-]+/g, '').trim() || 'Instrument'
  let candidate = `${base}${EXTENSION}`
  for (let i = 2; taken.has(candidate); i++) candidate = `${base} ${i}${EXTENSION}`
  return candidate
}

export function registerPresetHandlers(): void {
  /** Returns [{ id, text }]; the renderer parses and checks the content. */
  ipcMain.handle('presets:list', async () => {
    await mkdir(presetsDir(), { recursive: true })
    const files = (await readdir(presetsDir())).filter((f) => f.endsWith(EXTENSION)).sort((a, b) => a.localeCompare(b))
    return Promise.all(files.map(async (id) => ({ id, text: await readFile(presetPath(id), 'utf8') })))
  })

  ipcMain.handle('presets:save', async (_event, name: string, text: string) => {
    await mkdir(presetsDir(), { recursive: true })
    const id = fileNameFor(name, new Set(await readdir(presetsDir())))
    const temp = `${presetPath(id)}.tmp`
    await writeFile(temp, text)
    await rename(temp, presetPath(id))
    return id
  })

  ipcMain.handle('presets:delete', async (_event, id: string) => {
    await unlink(presetPath(id))
  })
}
