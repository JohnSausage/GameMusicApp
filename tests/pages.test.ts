import { describe, expect, it } from 'vitest'
import { pageMetrics, pageNumber, pageTop, paginate, PAGE_HEIGHT, PAGE_MARGIN_BOTTOM, PAGE_MARGIN_TOP, toSurface, toView } from '../src/renderer/src/score/pages'

// A title and lines of music as alphaTab draws them, one below the other.
const title = { top: 0, height: 50 }
const line = (n: number): { top: number; height: number } => ({ top: 50 + n * 300, height: 300 })

describe('the score on pages', () => {
  const metrics = pageMetrics(1)
  // 1123 high, music from 50 to 1059: the title and three lines fit on a page.
  const layout = paginate([title, line(0), line(1), line(2), line(3), line(4)], metrics)

  it('puts lines on a page until the next one does not fit', () => {
    expect(layout.slices.map((s) => s.page)).toEqual([0, 0, 0, 0, 1, 1])
    expect(layout.pageCount).toBe(2)
    expect(layout.height).toBe(2 * PAGE_HEIGHT + metrics.gap)
    // The first line of page 2 starts at its top margin.
    expect(toView(layout, line(3).top)).toBe(pageTop(layout, 1) + PAGE_MARGIN_TOP)
    // Nothing goes into the bottom margin.
    for (const slice of layout.slices) expect(slice.to + slice.delta - pageTop(layout, slice.page)).toBeLessThanOrEqual(PAGE_HEIGHT - PAGE_MARGIN_BOTTOM)
  })

  it('gives a line higher than a page a page of its own', () => {
    const tall = paginate([title, { top: 50, height: 2000 }, { top: 2050, height: 100 }], metrics)
    expect(tall.slices.map((s) => s.page)).toEqual([0, 1, 2])
    expect(paginate([{ top: 0, height: 2000 }], metrics).pageCount).toBe(1)
  })

  it('converts between the long sheet and the pages', () => {
    for (const y of [0, 49, 120, 700, line(3).top + 10, line(4).top + 299]) expect(toSurface(layout, toView(layout, y))).toBe(y)
    // Margins and the gap between pages are no part of the score.
    expect(toSurface(layout, 10)).toBeNull()
    expect(toSurface(layout, PAGE_HEIGHT + metrics.gap / 2)).toBeNull()
  })

  it('moves the ends of a rectangle dragged from a margin into the music', () => {
    const gap = PAGE_HEIGHT + metrics.gap / 2
    expect(toSurface(layout, gap, 'down')).toBe(line(3).top)
    expect(toSurface(layout, gap, 'up')).toBe(line(2).top + 300)
    expect(toSurface(layout, 10, 'down')).toBe(0)
    expect(toSurface(layout, layout.height, 'up')).toBe(line(4).top + 300)
  })

  it('scales with the zoom, and printed pages have no gap', () => {
    const half = paginate([title, line(0)], pageMetrics(0.5))
    expect(half.metrics.pageHeight).toBe(PAGE_HEIGHT / 2)
    expect(toView(half, 0)).toBe(PAGE_MARGIN_TOP / 2)
    const printed = paginate([title, line(0), line(1), line(2), line(3)], pageMetrics(1, 0))
    expect(printed.height).toBe(2 * PAGE_HEIGHT)
    expect(pageTop(printed, 1)).toBe(PAGE_HEIGHT)
  })

  it('numbers pages only when there is more than one', () => {
    expect(pageNumber(layout, 1)).toBe('2 / 2')
    expect(pageNumber(paginate([title, line(0)], metrics), 0)).toBeNull()
  })
})
