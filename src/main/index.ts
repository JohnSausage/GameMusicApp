import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session } from 'electron'
import { writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { confirmCloseWhenDirty, registerProjectHandlers } from './projects'

const here = dirname(fileURLToPath(import.meta.url))
const rendererDir = join(here, '../renderer')

// Start with --smoke-test to load the UI, print what rendered, and quit (exit code 1 on errors).
// Used to check that a production build (or packaged app) starts correctly.
const smokeTest = process.argv.includes('--smoke-test')

// The production UI is served from app://bundle/ instead of file:// so that
// fetch(), AudioWorklets and getUserMedia behave like on a normal secure origin.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

const ALLOWED_PERMISSIONS = new Set(['media', 'midi', 'midiSysex'])

function serveRendererFiles(): void {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url)
    const filePath = normalize(join(rendererDir, decodeURIComponent(pathname)))
    if (!filePath.startsWith(rendererDir + sep)) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    title: 'GameMusicApp',
    webPreferences: {
      preload: join(here, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadURL('app://bundle/index.html')
  }
  // There's no app menu (its shortcuts would swallow Ctrl+Z etc.), so F12 opens DevTools.
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
  })
  confirmCloseWhenDirty(win)
  return win
}

async function runSmokeTest(win: BrowserWindow): Promise<void> {
  const errors: string[] = []
  const fail = (reason: string): void => {
    console.log('SMOKE_TEST_RESULT ' + JSON.stringify({ errors: [...errors, reason] }))
    app.exit(1)
  }
  setTimeout(() => fail('timeout: page did not finish loading within 30 s'), 30000)
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message)
  })
  win.webContents.on('did-fail-load', (_event, code, description, url) => fail(`did-fail-load ${code} ${description} ${url}`))
  win.webContents.on('render-process-gone', (_event, details) => fail(`renderer gone: ${details.reason}`))
  await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
  // Start page → most recent project (or the demo song if there is none) → editor with a rendered score.
  // alphaTab only renders into a visible, non-zero-size container: run headless with
  // --ozone-platform=headless --ozone-override-screen-size=1600,1000 (see package.json "smoke").
  const result = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    await sleep(1500)
    const startPage = document.querySelector('.start-page') !== null
    const recent = [...document.querySelectorAll('.recent-item:not(:disabled)')]
    const demo = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('demo song'))
    ;(recent[0] ?? demo)?.click()
    await sleep(3000)
    return {
      title: document.title,
      startPage,
      opened: recent.length > 0 ? 'recent project' : 'demo song',
      editor: document.querySelector('.info-line')?.textContent ?? null,
      scoreRenderMs: document.querySelector('.score-scroll')?.dataset.renderMs ?? null,
      preloadBridge: typeof window.gameMusicApp?.projects?.listRecent === 'function'
    }
  })()`)
  const passed = errors.length === 0 && result.startPage && result.scoreRenderMs !== null && result.preloadBridge
  console.log('SMOKE_TEST_RESULT ' + JSON.stringify({ ...result, userData: app.getPath('userData'), errors }))
  app.exit(passed ? 0 : 1)
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  serveRendererFiles()
  registerProjectHandlers()
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => ALLOWED_PERMISSIONS.has(permission))

  ipcMain.handle('save-file', async (_event, defaultName: string, data: Uint8Array) => {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, data)
    return result.filePath
  })

  const win = createWindow()
  if (smokeTest) void runSmokeTest(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
