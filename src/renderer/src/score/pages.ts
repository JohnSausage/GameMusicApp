// The score on A4 pages. alphaTab draws the score as one long sheet, made of
// blocks stacked from top to bottom: the title, then one block per line of
// music (a "system"). The page view moves these blocks onto pages, never
// cutting one in half. The score's own coordinates (alphaTab's bounds) stay as
// they were; toView() and toSurface() convert between them and the pages.

/** A4 at 96 px per inch, the CSS pixel size of a page at 100 % zoom. */
export const PAGE_WIDTH = 794
export const PAGE_HEIGHT = 1123
/** Room on the page around the music, in pixels at 100 % zoom. */
export const PAGE_MARGIN_X = 50
export const PAGE_MARGIN_TOP = 50
export const PAGE_MARGIN_BOTTOM = 64
/** Space between pages in the page view. */
export const PAGE_GAP = 24

export interface PageMetrics {
  pageHeight: number
  /** Space between one page and the next (0 when printed). */
  gap: number
  marginTop: number
  marginBottom: number
}

/** The page metrics at a zoom level; printed pages have no gap. */
export function pageMetrics(zoom: number, gap = PAGE_GAP): PageMetrics {
  return { pageHeight: PAGE_HEIGHT * zoom, gap: gap * zoom, marginTop: PAGE_MARGIN_TOP * zoom, marginBottom: PAGE_MARGIN_BOTTOM * zoom }
}

/** A block of the score as alphaTab drew it: where it starts on the long sheet, and how high it is. */
export interface Block {
  top: number
  height: number
}

/** Where a block went: its range on the long sheet, moved down by `delta`, on page `page`. */
export interface PageSlice {
  from: number
  to: number
  delta: number
  page: number
}

export interface PageLayout {
  /** One slice per block, in order. */
  slices: PageSlice[]
  pageCount: number
  /** Height of all pages, with the gaps between them. */
  height: number
  metrics: PageMetrics
}

/**
 * Puts blocks (in order from top to bottom) onto pages: a block that doesn't
 * fit on the rest of a page starts the next one. A block higher than a page
 * gets a page of its own.
 */
export function paginate(blocks: Block[], metrics: PageMetrics): PageLayout {
  const { pageHeight, gap, marginTop, marginBottom } = metrics
  const bottom = pageHeight - marginBottom
  const slices: PageSlice[] = []
  let page = 0
  let y = marginTop
  for (const block of blocks) {
    if (y + block.height > bottom && y > marginTop) {
      page++
      y = marginTop
    }
    const top = page * (pageHeight + gap) + y
    slices.push({ from: block.top, to: block.top + block.height, delta: top - block.top, page })
    y += block.height
  }
  const pageCount = page + 1
  return { slices, pageCount, height: pageCount * pageHeight + (pageCount - 1) * gap, metrics }
}

/** Where a point of the long sheet is on the pages. */
export function toView(layout: PageLayout, y: number): number {
  const slice = layout.slices.findLast((s) => s.from <= y) ?? layout.slices[0]
  return slice ? y + slice.delta : y
}

/**
 * Where a point on the pages is on the long sheet; null in a margin or between
 * pages. With `snap`, a point outside the music goes to the start of the next
 * block ('down') or the end of the block before ('up'), e.g. for a dragged rectangle.
 */
export function toSurface(layout: PageLayout, y: number, snap?: 'down' | 'up'): number | null {
  const slice = layout.slices.find((s) => y >= s.from + s.delta && y < s.to + s.delta)
  if (slice) return y - slice.delta
  if (snap === 'down') return layout.slices.find((s) => s.from + s.delta > y)?.from ?? layout.slices.at(-1)?.to ?? null
  if (snap === 'up') return layout.slices.findLast((s) => s.to + s.delta <= y)?.to ?? layout.slices[0]?.from ?? null
  return null
}

/** Top of a page in the page view. */
export const pageTop = (layout: PageLayout, page: number): number => page * (layout.metrics.pageHeight + layout.metrics.gap)

/**
 * Moves alphaTab's blocks (the children of its .at-surface) onto pages, and
 * makes the surface as high as the pages. Returns where everything went.
 */
export function layOutPages(surface: HTMLElement, metrics: PageMetrics): PageLayout {
  const elements = ([...surface.children] as HTMLElement[]).sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
  const blocks = elements.map((element) => ({ top: parseFloat(element.style.top) || 0, height: parseFloat(element.style.height) || element.offsetHeight }))
  const layout = paginate(blocks, metrics)
  elements.forEach((element, i) => {
    element.style.top = `${blocks[i].top + layout.slices[i].delta}px`
  })
  surface.style.height = `${layout.height}px`
  return layout
}

/** Page number under a page, when there is more than one. */
export function pageNumber(layout: PageLayout, page: number): string | null {
  return layout.pageCount > 1 ? `${page + 1} / ${layout.pageCount}` : null
}
