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
  setTimeout(() => fail('timeout: the smoke test did not finish within 120 s'), 120000)
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message)
  })
  win.webContents.on('did-fail-load', (_event, code, description, url) => fail(`did-fail-load ${code} ${description} ${url}`))
  win.webContents.on('render-process-gone', (_event, details) => fail(`renderer gone: ${details.reason}`))
  await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
  // Start page → most recent project (or the demo song if there is none) → editor with a rendered score
  // → import a generated WAV in the record/import dialog and transcribe it with Basic Pitch.
  // alphaTab only renders into a visible, non-zero-size container: run headless with
  // --ozone-platform=headless --ozone-override-screen-size=1600,1000 (see package.json "smoke").
  const result = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const waitFor = async (check, ms) => { for (let t = 0; t < ms && !check(); t += 100) await sleep(100) }
    const button = (text, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text))
    await sleep(1500)
    const startPage = document.querySelector('.start-page') !== null
    const recent = [...document.querySelectorAll('.recent-item:not(:disabled)')]
    ;(recent[0] ?? button('demo song'))?.click()
    await sleep(3000)
    const editor = document.querySelector('.info-line span')?.textContent ?? null
    const scoreRenderMs = document.querySelector('.score-scroll')?.dataset.renderMs ?? null

    // Three plucked notes (A3, C4, E4), half a second apart, as a 16-bit WAV.
    const rate = 22050
    const samples = new Float32Array(rate * 3)
    ;[57, 60, 64].forEach((pitch, n) => {
      const frequency = 440 * 2 ** ((pitch - 69) / 12)
      const start = Math.round((0.5 + n * 0.5) * rate)
      for (let i = start; i < start + rate / 2; i++) {
        const t = (i - start) / rate
        let v = 0
        for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * frequency * h * t) / h
        samples[i] += 0.3 * Math.exp(-3 * t) * v
      }
    })
    const wav = new DataView(new ArrayBuffer(44 + samples.length * 2))
    const text = (offset, value) => [...value].forEach((c, i) => wav.setUint8(offset + i, c.charCodeAt(0)))
    text(0, 'RIFF'); wav.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVEfmt ')
    wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, rate, true)
    wav.setUint32(28, rate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); text(36, 'data'); wav.setUint32(40, samples.length * 2, true)
    samples.forEach((v, i) => wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true))

    button('Record / import')?.click()
    await sleep(300)
    const input = document.querySelector('.modal input[type=file]')
    const files = new DataTransfer()
    files.items.add(new File([wav.buffer], 'smoke.wav', { type: 'audio/wav' }))
    if (input) { input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true })) }
    await waitFor(() => document.querySelector('.waveform canvas'), 5000)
    const modal = document.querySelector('.modal')
    if (modal) button('Transcribe', modal)?.click()
    await waitFor(() => document.querySelector('.modal h2')?.textContent.includes('Check') || document.querySelector('.modal .dialog-error'), 90000)
    const transcription = document.querySelector('.modal .dialog-error')?.textContent ?? document.querySelector('.modal p.muted.small')?.textContent ?? null

    return {
      title: document.title,
      startPage,
      opened: recent.length > 0 ? 'recent project' : 'demo song',
      editor,
      scoreRenderMs,
      transcription,
      preloadBridge: typeof window.gameMusicApp?.projects?.listRecent === 'function'
    }
  })()`)
  const transcribed = /^[1-9]\d* notes? in/.test(result.transcription ?? '')
  const passed = errors.length === 0 && result.startPage && result.scoreRenderMs !== null && result.preloadBridge && transcribed
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
