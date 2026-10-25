import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from 'electron'
import { writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
  await new Promise((resolve) => setTimeout(resolve, 4000))
  // alphaTab only renders into a visible, non-zero-size container: run headless with
  // --ozone-platform=headless --ozone-override-screen-size=1600,1000 (see package.json "smoke").
  const result = await win.webContents.executeJavaScript(`({
    title: document.title,
    scoreRender: document.querySelector('.info-line span')?.textContent ?? null,
    scoreParts: document.querySelector('.at-surface')?.children.length ?? 0,
    preloadBridge: typeof window.gameMusicApp?.saveFile === 'function',
    tabs: [...document.querySelectorAll('nav button')].map((b) => b.textContent)
  })`)
  const rendered = /\d+ ms/.test(result.scoreRender ?? '')
  console.log('SMOKE_TEST_RESULT ' + JSON.stringify({ ...result, errors }))
  app.exit(errors.length === 0 && rendered && result.preloadBridge ? 0 : 1)
}

app.whenReady().then(() => {
  serveRendererFiles()
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
