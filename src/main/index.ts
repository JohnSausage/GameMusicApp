import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, dirname, join, normalize, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerPresetHandlers } from './presets'
import { confirmCloseWhenDirty, confirmDiscardChanges, ownRecoveryCopies, registerProjectHandlers } from './projects'
import { applyStartupSettings, registerSettingsHandlers } from './settings'

const here = dirname(fileURLToPath(import.meta.url))
const rendererDir = join(here, '../renderer')

// Start with --smoke-test to load the UI, print what rendered, and quit (exit code 1 on errors).
// Used to check that a production build (or packaged app) starts correctly.
const smokeTest = process.argv.includes('--smoke-test')

// The audio buffer size is read by Chromium at startup, so settings are applied before the app is ready.
const startupSettings = applyStartupSettings()

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

/**
 * Electron's relaunch helper runs from the AppImage's mount, which goes away
 * when this instance quits, so a small shell starts the AppImage file again
 * once this process has exited. It first closes the file descriptors it
 * inherited from Chromium; while it held them, this process could not exit.
 */
function relaunchAppImage(appImage: string): void {
  const script = [
    'for fd in /proc/$$/fd/*; do fd=${fd##*/}; [ "$fd" -gt 2 ] && eval "exec $fd>&-" 2>/dev/null; done',
    'while kill -0 "$0" 2>/dev/null; do sleep 0.2; done',
    'exec "$@"'
  ].join('\n')
  spawn('/bin/bash', ['-c', script, String(process.pid), appImage, ...process.argv.slice(1)], { detached: true, stdio: 'ignore' }).unref()
}

async function runSmokeTest(win: BrowserWindow): Promise<void> {
  const errors: string[] = []
  const fail = (reason: string): void => {
    console.log('SMOKE_TEST_RESULT ' + JSON.stringify({ errors: [...errors, reason] }))
    ownRecoveryCopies().discard()
    app.exit(1)
  }
  setTimeout(() => fail('timeout: the smoke test did not finish within 120 s'), 120000)
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message)
  })
  win.webContents.on('did-fail-load', (_event, code, description, url) => fail(`did-fail-load ${code} ${description} ${url}`))
  win.webContents.on('render-process-gone', (_event, details) => fail(`renderer gone: ${details.reason}`))
  await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
  // Exports are kept here instead of being saved (no save dialog in the smoke test).
  const saved: { name: string; data: Buffer }[] = []
  ipcMain.removeHandler('save-file')
  ipcMain.handle('save-file', (_event, defaultName: string, data: Uint8Array) => {
    saved.push({ name: defaultName, data: Buffer.from(data) })
    return `(smoke test) ${defaultName}`
  })
  ipcMain.removeHandler('save-files')
  ipcMain.handle('save-files', (_event, files: { name: string; data: Uint8Array }[]) => {
    for (const file of files) saved.push({ name: file.name, data: Buffer.from(file.data) })
    return '(smoke test folder)'
  })
  // Start page → most recent project (or the demo song if there is none) → editor with a rendered score
  // → add drums with a pattern → the arrangement → a sound effect exported as WAV → retro sounds and playback → import a generated WAV in the record/import dialog and transcribe it with Basic Pitch.
  // alphaTab only renders into a visible, non-zero-size container: run headless with
  // --ozone-platform=headless --ozone-override-screen-size=1600,1000 (see package.json "smoke").
  const result = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const waitFor = async (check, ms) => { for (let t = 0; t < ms && !check(); t += 100) await sleep(100) }
    const button = (text, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text))
    await sleep(1500)
    const startPage = document.querySelector('.start-page') !== null
    const theme = document.documentElement.dataset.theme ?? null
    const recent = [...document.querySelectorAll('.recent-item:not(.recovery-item):not(:disabled)')]
    ;(recent[0] ?? button('demo song'))?.click()
    await sleep(3000)
    // The project may have been saved with the Arrangement tab open.
    const viewTab = (name) => [...document.querySelectorAll('.view-tab')].find((b) => b.textContent === name)
    if (!viewTab('Score')?.classList.contains('current')) {
      viewTab('Score')?.click()
      await sleep(1500)
    }
    const editor = document.querySelector('.status-bar .cursor-info')?.textContent ?? null
    const scoreRenderMs = document.querySelector('.score-scroll')?.dataset.renderMs ?? null

    // The eye on the first track card leaves it out of the score, and shows it again.
    const eye = () => document.querySelector('.track-card .icon.show')
    const staves = () => document.querySelector('.score-scroll')?.dataset.renderMs
    eye()?.click()
    await sleep(1000)
    const hiddenTrack = { hidden: eye()?.getAttribute('aria-pressed') === 'false', rendered: staves() !== undefined }
    eye()?.click()
    await sleep(1000)
    hiddenTrack.shownAgain = eye()?.getAttribute('aria-pressed') === 'true'

    // The tuning dialog of the first guitar or bass track: Drop D with a capo, then undone.
    const tuning = { before: document.querySelector('.tuning-button')?.textContent ?? null }
    document.querySelector('.tuning-button')?.click()
    await sleep(300)
    const presetSelect = document.querySelector('.tuning-dialog select')
    const dropD = [...(presetSelect?.options ?? [])].find((o) => o.textContent.startsWith('Drop D'))
    if (presetSelect && dropD) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(presetSelect, dropD.value)
      presetSelect.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const capoSelect = document.querySelectorAll('.tuning-dialog select')[1]
    if (capoSelect) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(capoSelect, '2')
      capoSelect.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await sleep(100)
    const tuningDialog = document.querySelector('.tuning-dialog')
    if (tuningDialog) button('Apply', tuningDialog)?.click()
    await sleep(1000)
    tuning.after = document.querySelector('.tuning-button')?.textContent ?? null
    document.querySelector('button[aria-label="Undo"]')?.click()
    await sleep(1000)
    tuning.undone = document.querySelector('.tuning-button')?.textContent === tuning.before

    // The page view: the score on A4 pages, then back; and the score as a PDF of those pages.
    const pagesToggle = (name) => button(name, document.querySelector('.segmented[aria-label="Pages"]') ?? document)?.click()
    pagesToggle('Pages')
    await sleep(1500)
    const pageView = { pages: document.querySelectorAll('.score-page').length }
    pagesToggle('Screen')
    await sleep(1000)
    pageView.screenAgain = document.querySelectorAll('.score-page').length === 0
    document.querySelector('.editor-header .menu-button[title="Export"]')?.click()
    await sleep(200)
    ;[...document.querySelectorAll('.menu-list [role=menuitem]')].find((item) => item.textContent.startsWith('PDF'))?.click()
    await waitFor(() => /PDF saved|PDF could not/.test(document.querySelector('.status-bar .status')?.textContent ?? ''), 15000)
    pageView.pdfMessage = document.querySelector('.status-bar .status')?.textContent ?? null

    // A drum track with a starter pattern from the drum grid.
    button('+ Drums')?.click()
    await sleep(500)
    const pattern = document.querySelector('.drum-grid select[aria-label="Starter pattern"]')
    if (pattern) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(pattern, '0')
      pattern.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await sleep(500)
    const drumHits = document.querySelectorAll('.drum-cell:not(.off)').length

    // A keys track shows its piano roll.
    button('+ Keys')?.click()
    await sleep(500)
    const pianoRoll = document.querySelector('.piano-roll .roll-grid') !== null

    // The Arrangement tab: the section grid, and a section duplicated as a repeat.
    viewTab('Arrangement')?.click()
    await sleep(500)
    const sectionsBefore = document.querySelectorAll('.arr-section').length
    const arrangementView = document.querySelector('.arrangement')
    if (arrangementView) button('Duplicate', arrangementView)?.click()
    await sleep(300)
    const paletteParts = document.querySelectorAll('.arr-chip').length
    // "+" in the palette: a new empty part, edited under the grid.
    document.querySelector('.arr-chip-add')?.click()
    await sleep(500)
    const arrangement = {
      sections: sectionsBefore,
      afterDuplicate: document.querySelectorAll('.arr-section').length,
      cells: document.querySelectorAll('.arr-cell').length,
      paletteParts,
      newPart: document.querySelectorAll('.arr-chip').length === paletteParts + 1,
      partScore: document.querySelector('.arr-part-editor .score-scroll') !== null
    }
    // "Duplicate" over the part: a copy to build a variation on.
    const partHead = document.querySelector('.arr-part-head')
    if (partHead) button('Duplicate', partHead)?.click()
    await sleep(500)
    arrangement.duplicated = document.querySelectorAll('.arr-chip').length === paletteParts + 2

    // The Sound effects tab: a new effect with a note from its piano roll, exported with the others as WAV files.
    viewTab('Sound effects')?.click()
    await sleep(500)
    const effectList = () => document.querySelector('.effect-list') ?? document
    const effectCount = document.querySelectorAll('.effect-card').length
    button('+ New effect', effectList())?.click()
    await sleep(1000)
    const rollGrid = document.querySelector('.effect-editor .roll-grid')
    if (rollGrid) {
      const rect = rollGrid.getBoundingClientRect()
      const at = { clientX: rect.left + 2, clientY: rect.top + rect.height / 2, bubbles: true, pointerId: 1, button: 0, isPrimary: true, pointerType: 'mouse' }
      rollGrid.dispatchEvent(new PointerEvent('pointerdown', at))
      rollGrid.dispatchEvent(new PointerEvent('pointerup', at))
    }
    await sleep(500)
    const effects = {
      added: document.querySelectorAll('.effect-card').length === effectCount + 1,
      name: document.querySelector('.effect-name-input')?.value ?? null,
      length: document.querySelector('.effect-card.selected .effect-length')?.textContent ?? null
    }
    button('Export WAV…', effectList())?.click()
    await sleep(300)
    const effectDialog = document.querySelector('.export-dialog')
    if (effectDialog) button('Export…', effectDialog)?.click()
    await waitFor(() => !document.querySelector('.export-dialog'), 15000)
    effects.message = document.querySelector('.effect-head .status')?.textContent ?? null
    viewTab('Score')?.click()
    await sleep(1500)

    // The sound window of the first track: sound categories, and its sounds as tiles.
    document.querySelector('.track-card .sound-button')?.click()
    await sleep(300)
    const soundWindow = { categories: document.querySelectorAll('.sound-category').length, sounds: document.querySelectorAll('.sound-tile').length }
    document.querySelector('.instrument-editor .modal-close')?.click()
    await sleep(200)

    // Retro sounds + a second of looped playback: loads the chip synth worklet and SoundFont synth.
    button('Make it retro')?.click()
    await sleep(300)
    const retroSounds = [...document.querySelectorAll('.track-card .track-sound')].map((s) => (s.tagName === 'SELECT' ? s.selectedOptions[0]?.textContent : s.textContent))
    // Play with loop and metronome on, then switch them off again.
    const header = document.querySelector('.editor-header')
    const toggleLoopAndMetronome = () => ['Loop', 'Metronome'].forEach((name) => header?.querySelector('button[aria-label="' + name + '"]')?.click())
    toggleLoopAndMetronome()
    header?.querySelector('.transport-play')?.click()
    await sleep(1500)
    const playing = header?.querySelector('.transport-play')?.textContent?.includes('Stop') ?? false
    header?.querySelector('.transport-play')?.click()
    toggleLoopAndMetronome()

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

    header?.querySelector('.record-button')?.click()
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
      theme,
      opened: recent.length > 0 ? 'recent project' : 'demo song',
      editor,
      scoreRenderMs,
      drumHits,
      pianoRoll,
      hiddenTrack,
      tuning,
      pageView,
      arrangement,
      effects,
      soundWindow,
      retroSounds,
      playing,
      transcription,
      preloadBridge: typeof window.gameMusicApp?.projects?.listRecent === 'function' && typeof window.gameMusicApp?.settings?.get === 'function',
      audioSettings: await window.gameMusicApp?.settings?.get(),
      audioBaseLatencyMs: Math.round(new AudioContext({ latencyHint: 'interactive' }).baseLatency * 10000) / 10
    }
  })()`)
  const transcribed = /^[1-9]\d* notes? in/.test(result.transcription ?? '')
  const pdf = saved.find((file) => file.name.endsWith('.pdf'))?.data
  // The PDF is kept in the temp folder, to look at.
  const pdfFile = join(app.getPath('temp'), 'GameMusicApp-smoke-test.pdf')
  if (pdf) await writeFile(pdfFile, pdf)
  result.pageView.pdf = pdf ? { file: pdfFile, bytes: pdf.length, header: pdf.subarray(0, 5).toString('latin1'), pages: pdf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g)?.length ?? 0 } : null
  // The new sound effect's WAV file: mono, ending soon after its note.
  const effectWav = saved.find((file) => file.name === `${result.effects.name}.wav`)?.data
  result.effects.wav = effectWav
    ? { header: effectWav.subarray(0, 4).toString('latin1'), channels: effectWav.readUInt16LE(22), seconds: effectWav.readUInt32LE(40) / 2 / effectWav.readUInt16LE(22) / effectWav.readUInt32LE(24) }
    : null
  // The edits above are unsaved, so a recovery copy is kept; the smoke test throws it away again.
  const recovery = ownRecoveryCopies()
  result.recoveryCopy = recovery.files.length === 1 && existsSync(recovery.files[0])
  recovery.discard()
  result.recoveryCopyRemoved = !existsSync(recovery.files[0] ?? '')
  const passed =
    errors.length === 0 && result.recoveryCopy && result.recoveryCopyRemoved && result.startPage && result.theme !== null && result.scoreRenderMs !== null && result.preloadBridge && result.drumHits > 0 && result.pianoRoll && result.hiddenTrack.hidden && result.hiddenTrack.shownAgain && result.tuning.after?.includes('Drop D · capo 2') && result.tuning.undone && result.pageView.pages > 0 && result.pageView.screenAgain && result.pageView.pdf?.header === '%PDF-' && result.pageView.pdf.pages > 0 && result.arrangement.cells > 0 && result.arrangement.paletteParts > 0 && result.arrangement.afterDuplicate === result.arrangement.sections + 1 && result.arrangement.newPart && result.arrangement.partScore && result.arrangement.duplicated && result.effects.added && result.effects.wav?.header === 'RIFF' && result.effects.wav.channels === 1 && result.effects.wav.seconds > 0 && result.effects.wav.seconds < 2 && result.soundWindow.categories >= 17 && result.playing && transcribed
  console.log('SMOKE_TEST_RESULT ' + JSON.stringify({ ...result, userData: app.getPath('userData'), errors }))
  app.exit(passed ? 0 : 1)
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  serveRendererFiles()
  registerProjectHandlers()
  registerPresetHandlers()
  registerSettingsHandlers(startupSettings)
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

  // Several files into a folder the user picks, e.g. the sound effects; files with the same names are replaced.
  let lastFolder: string | undefined
  ipcMain.handle('save-files', async (_event, files: { name: string; data: Uint8Array }[]) => {
    const result = await dialog.showOpenDialog({
      title: 'Export into this folder',
      buttonLabel: 'Export here',
      defaultPath: lastFolder,
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    })
    const folder = result.filePaths[0]
    if (result.canceled || !folder) return null
    for (const file of files) await writeFile(join(folder, basename(file.name)), file.data)
    lastFolder = folder
    return folder
  })

  // The PDF export: the renderer has put the pages for printing in place (see score/pdf.ts); they set their own size.
  ipcMain.handle('print-pdf', (event) =>
    event.sender.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
  )

  // Restarts the app, e.g. to apply the audio latency setting (asks first if there are unsaved changes).
  ipcMain.handle('app:restart', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !confirmDiscardChanges(win, 'Restart GameMusicApp and lose them?', 'Restart without saving')) return false
    if (process.env.APPIMAGE) {
      relaunchAppImage(process.env.APPIMAGE)
    } else {
      app.relaunch()
    }
    app.quit()
    return true
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
