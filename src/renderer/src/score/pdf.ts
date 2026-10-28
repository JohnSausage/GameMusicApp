// The PDF export: the score on A4 pages, as in the page view. alphaTab draws
// the score once more, off screen, at 100 % and black on white; its blocks are
// cloned onto pages made for printing (.print-root, shown only in print), and
// the main process prints the window to a PDF.
import type { Song } from '../model/song'
import type { StaveMode } from '../project/layout'
import { createApi, drawTabRests, setScoreColors } from './ScoreView'
import { PAGE_HEIGHT, PAGE_MARGIN_X, PAGE_WIDTH, pageMetrics, pageNumber, paginate, toView } from './pages'
import { songToAlphaTab } from './toAlphaTab'

/**
 * The score (the given tracks, by index) as a PDF of A4 pages. Outside the
 * app (in a browser) it opens the browser's print dialog and returns null.
 */
export async function scorePdf(song: Song, staveMode: StaveMode, tracks: number[]): Promise<Uint8Array | null> {
  const host = document.createElement('div')
  host.style.cssText = `position: fixed; left: -100000px; top: 0; width: ${PAGE_WIDTH}px`
  document.body.appendChild(host)
  const api = createApi(host)
  const root = document.createElement('div')
  root.className = 'print-root'
  const title = document.title
  try {
    setScoreColors(api.settings, 'light')
    api.settings.display.padding = [PAGE_MARGIN_X, 0]
    // Every block is needed, not only the ones on screen.
    api.settings.core.enableLazyLoading = false
    api.updateSettings()
    const converted = songToAlphaTab(song, api.settings, staveMode === 'tab')
    await new Promise<void>((resolve, reject) => {
      api.postRenderFinished.on(resolve)
      api.error.on(reject)
      api.renderScore(converted.score, tracks)
    })

    const surface = host.querySelector<HTMLElement>('.at-surface')
    if (!surface) throw new Error('The score was not drawn.')
    const elements = ([...surface.children] as HTMLElement[]).sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
    const blocks = elements.map((element) => ({ top: parseFloat(element.style.top) || 0, height: parseFloat(element.style.height) || 0 }))
    const metrics = pageMetrics(1, 0)
    const layout = paginate(blocks, metrics)
    const pages = Array.from({ length: layout.pageCount }, (_, page) => {
      const sheet = document.createElement('div')
      sheet.className = 'print-page'
      // alphaTab's classes: its music font is set for blocks inside them.
      const music = document.createElement('div')
      music.className = surface.className
      music.style.cssText = 'position: absolute; inset: 0'
      sheet.appendChild(music)
      const number = pageNumber(layout, page)
      if (number) {
        const label = document.createElement('span')
        label.className = 'score-page-number'
        label.textContent = number
        label.style.bottom = `${metrics.marginBottom / 2}px`
        sheet.appendChild(label)
      }
      root.appendChild(sheet)
      return music
    })
    // Puts an element on its page; `top` is where it is on all pages one below the other.
    const putOnPage = (element: HTMLElement, top: number): void => {
      const page = Math.min(layout.pageCount - 1, Math.floor(top / PAGE_HEIGHT))
      element.style.top = `${top - page * PAGE_HEIGHT}px`
      pages[page].appendChild(element)
    }
    elements.forEach((element, i) => {
      const slice = layout.slices[i]
      putOnPage(element.cloneNode(true) as HTMLElement, slice.from + slice.delta)
    })
    if (staveMode !== 'tab') {
      const rests = document.createElement('div')
      drawTabRests(rests, api, converted, song, (y) => toView(layout, y))
      for (const rest of [...rests.children] as HTMLElement[]) putOnPage(rest, parseFloat(rest.style.top))
    }

    document.body.appendChild(root)
    await document.fonts.ready
    if (!window.gameMusicApp) {
      window.print()
      return null
    }
    // The PDF's title.
    document.title = song.title
    return await window.gameMusicApp.printPdf()
  } finally {
    document.title = title
    root.remove()
    api.destroy()
    host.remove()
  }
}
