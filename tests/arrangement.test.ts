import { describe, expect, it } from 'vitest'
import {
  addSection,
  arrange,
  copyCellPart,
  deletePart,
  deleteUnusedParts,
  duplicateSection,
  moveSection,
  partColors,
  partStarts,
  placeSection,
  removeSection,
  renamePart,
  renameSection,
  resizeSection,
  setCellPart,
  setPartColor,
  syncArrangement,
  unusedParts,
  writeOut
} from '../src/renderer/src/model/arrangement'
import { addBars, addTrack, createSong, deleteBar, deleteTrack, edit, insertBarBefore, setFret, setSection, type Cursor, type EditResult } from '../src/renderer/src/model/edit'
import type { Song } from '../src/renderer/src/model/song'
import { parseProject, ProjectFileError, serializeProject } from '../src/renderer/src/project/projectFile'

const WHOLE = { value: 1, dotted: false } as const
const at = (bar: number, track = 0): Cursor => ({ track, bar, beat: 0, string: 1 })

/** Applies an edit the way the editor does: the arrangement follows it. */
function apply(song: Song, result: EditResult | null): Song {
  if (!result) throw new Error('the edit did nothing')
  return syncArrangement(song, result.song)
}

/** The fret on the first beat of each bar of a track, '-' for a rest. */
const frets = (song: Song, track = 0): (number | '-')[] => song.tracks[track].bars.map((bar) => bar.beats[0].notes[0]?.fret ?? '-')
const names = (song: Song): string[] => song.arrangement!.map((s) => s.name)
const lengths = (song: Song): number[] => song.arrangement!.map((s) => s.length)
const partOf = (song: Song, section: number, track = 0): string | undefined => song.arrangement![section].parts[song.tracks[track].id]
const partNames = (song: Song, track = 0): string[] => (song.tracks[track].parts ?? []).map((p) => p.name)

/** Guitar and a silent bass; Verse (bars 1–2), Chorus (3–4) and Verse 2 (5–6), the verses with the same notes. */
function written(): Song {
  let song = createSong({ title: 'Test', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: 6 })
  song = addTrack(song, at(0), 'bass').song
  song = setSection(song, at(0), 0, 'Verse').song
  song = setSection(song, at(0), 2, 'Chorus').song
  song = setSection(song, at(0), 4, 'Verse 2').song
  for (const [bar, fret] of [[0, 3], [1, 5], [2, 7], [4, 3], [5, 5]]) song = setFret(song, at(bar), fret, WHOLE)!.song
  return song
}

describe('arrange', () => {
  it('makes a section per section, and sections with the same notes share a part', () => {
    const song = arrange(written())
    expect(names(song)).toEqual(['Verse', 'Chorus', 'Verse 2'])
    expect(lengths(song)).toEqual([2, 2, 2])
    expect(partNames(song)).toEqual(['Verse', 'Chorus'])
    expect(partOf(song, 2)).toBe(partOf(song, 0))
    // The bass has no notes: no parts, silent everywhere.
    expect(song.tracks[1].parts).toEqual([])
    expect(song.arrangement!.every((s) => s.parts[song.tracks[1].id] === undefined)).toBe(true)
  })

  it('leaves the song sounding the same', () => {
    const before = written()
    const song = arrange(before)
    expect(song.tracks.map((t) => t.bars)).toEqual(before.tracks.map((t) => t.bars))
    expect(song.sections.map(({ bar, name }) => ({ bar, name }))).toEqual(before.sections)
    expect(song.sections.map((s) => s.id)).toEqual(song.arrangement!.map((s) => s.id))
  })

  it('puts bars before the first section in a section of their own', () => {
    let song = createSong({ title: 'Test', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: 4 })
    expect(names(arrange(song))).toEqual(['Section A'])
    song = setSection(song, at(0), 2, 'Chorus').song
    expect(names(arrange(song))).toEqual(['Start', 'Chorus'])
    expect(lengths(arrange(song))).toEqual([2, 2])
  })

  it('leaves an arranged song alone', () => {
    const song = arrange(written())
    expect(arrange(song)).toBe(song)
  })
})

describe('writeOut', () => {
  it('repeats a part shorter than its section and cuts off a longer one', () => {
    const song = structuredClone(arrange(written()))
    song.arrangement![0].length = 1
    song.arrangement![1].length = 5
    const out = writeOut(song)
    expect(frets(out)).toEqual([3, 7, '-', 7, '-', 7, 3, 5])
    expect(frets(out, 1)).toEqual(Array(8).fill('-'))
    expect(out.sections.map((s) => s.bar)).toEqual([0, 1, 6])
  })
})

describe('syncArrangement', () => {
  it('a change in a repeated part changes every section that plays it', () => {
    const before = arrange(written())
    const song = apply(before, setFret(before, at(5), 9, WHOLE))
    expect(frets(song)).toEqual([3, 9, 7, '-', 3, 9])
    expect(partNames(song)).toEqual(['Verse', 'Chorus'])
  })

  it('a change in a section of its own stays there', () => {
    const before = arrange(written())
    const song = apply(before, setFret(before, at(3), 12, WHOLE))
    expect(frets(song)).toEqual([3, 5, 7, 12, 3, 5])
  })

  it('notes in a silent section become a new part, named after the section', () => {
    const before = arrange(written())
    const song = apply(before, setFret(before, at(2, 1), 2, WHOLE))
    expect(partNames(song, 1)).toEqual(['Chorus'])
    expect(partOf(song, 1, 1)).toBe(song.tracks[1].parts![0].id)
    expect(partOf(song, 0, 1)).toBeUndefined()
    expect(frets(song, 1)).toEqual(['-', '-', 2, '-', '-', '-'])
  })

  it('a change in a repeat of a shorter part goes into the part', () => {
    const arranged = arrange(written())
    // The 2-bar chorus plays twice in a 4-bar section.
    const before = apply(arranged, edit(arranged, at(0), (d) => void (d.arrangement![1].length = 4)))
    expect(frets(before)).toEqual([3, 5, 7, '-', 7, '-', 3, 5])
    const song = apply(before, setFret(before, at(4), 12, WHOLE))
    expect(frets(song)).toEqual([3, 5, 12, '-', 12, '-', 3, 5])
  })

  it('a section that gets longer gets its own copy of a part it shares', () => {
    const before = arrange(written())
    const song = apply(before, insertBarBefore(before, at(5)))
    expect(lengths(song)).toEqual([2, 2, 3])
    expect(frets(song)).toEqual([3, 5, 7, '-', 3, '-', 5])
    expect(partNames(song)).toEqual(['Verse', 'Chorus', 'Verse 2'])
    expect(partOf(song, 0)).toBe(partOf(before, 0))
    expect(partOf(song, 2)).not.toBe(partOf(song, 0))
  })

  it('a section with a part of its own keeps it when it gets longer or shorter', () => {
    const before = arrange(written())
    const longer = apply(before, insertBarBefore(before, at(3)))
    expect(lengths(longer)).toEqual([2, 3, 2])
    expect(partOf(longer, 1)).toBe(partOf(before, 1))
    expect(longer.tracks[0].parts![1].bars).toHaveLength(3)
    const shorter = apply(before, deleteBar(before, at(3)))
    expect(lengths(shorter)).toEqual([2, 1, 2])
    expect(frets(shorter)).toEqual([3, 5, 7, 3, 5])
  })

  it('a section that gets shorter leaves the part it shares as it was', () => {
    const before = arrange(written())
    const song = apply(before, deleteBar(before, at(1)))
    expect(lengths(song)).toEqual([1, 2, 2])
    expect(frets(song)).toEqual([3, 7, '-', 3, 5])
  })

  it('a new section marker splits a section', () => {
    const before = arrange(written())
    const song = apply(before, setSection(before, at(3), 3, 'Bridge'))
    expect(names(song)).toEqual(['Verse', 'Chorus', 'Bridge', 'Verse 2'])
    expect(lengths(song)).toEqual([2, 1, 1, 2])
    expect(partOf(song, 1)).toBe(partOf(before, 1))
    // Bar 4 is empty, so the bridge starts out silent.
    expect(partOf(song, 2)).toBeUndefined()
    expect(frets(song)).toEqual([3, 5, 7, '-', 3, 5])
  })

  it('removing a section marker joins its bars to the section before', () => {
    const before = arrange(written())
    const song = apply(before, setSection(before, at(2), 2, null))
    expect(names(song)).toEqual(['Verse', 'Verse 2'])
    expect(lengths(song)).toEqual([4, 2])
    expect(frets(song)).toEqual([3, 5, 7, '-', 3, 5])
    // The verse part stays as the second verse plays it; the chorus part is kept, but no section plays it.
    expect(partOf(song, 1)).toBe(partOf(before, 0))
    expect(unusedParts(song).map((u) => u.part.name)).toEqual(['Chorus'])
  })

  it('renaming a section keeps it', () => {
    const before = arrange(written())
    const song = apply(before, setSection(before, at(2), 2, 'Refrain'))
    expect(names(song)).toEqual(['Verse', 'Refrain', 'Verse 2'])
    expect(song.arrangement![1].id).toBe(before.arrangement![1].id)
    expect(partOf(song, 1)).toBe(partOf(before, 1))
  })

  it('bars added after a repeated part start a new section', () => {
    const before = arrange(written())
    const song = apply(before, addBars(before, at(0), 2))
    expect(names(song)).toEqual(['Verse', 'Chorus', 'Verse 2', 'Section D'])
    expect(lengths(song)).toEqual([2, 2, 2, 2])
    expect(frets(song)).toEqual([3, 5, 7, '-', 3, 5, '-', '-'])
  })

  it('bars added after a part of its own make that section longer', () => {
    let before = createSong({ title: 'Test', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: 2 })
    before = arrange(setFret(before, at(0), 3, WHOLE)!.song)
    const song = apply(before, addBars(before, at(0), 2))
    expect(lengths(song)).toEqual([4])
    expect(song.tracks[0].parts![0].bars).toHaveLength(4)
  })

  it('an edit of the arrangement is written out', () => {
    const before = arrange(written())
    const song = apply(before, edit(before, at(0), (d) => void d.arrangement!.reverse()))
    expect(names(song)).toEqual(['Verse 2', 'Chorus', 'Verse'])
    expect(frets(song)).toEqual([3, 5, 7, '-', 3, 5])
    expect(song.sections.map((s) => s.name)).toEqual(['Verse 2', 'Chorus', 'Verse'])
  })

  it('new tracks start silent, and a deleted track leaves the arrangement', () => {
    const before = arrange(written())
    const added = apply(before, addTrack(before, at(0), 'keys'))
    expect(added.tracks[2].parts ?? []).toEqual([])
    expect(added.arrangement!.every((s) => s.parts[added.tracks[2].id] === undefined)).toBe(true)
    const deleted = apply(before, deleteTrack(before, at(0), 0))
    expect(deleted.arrangement!.every((s) => Object.keys(s.parts).length === 0)).toBe(true)
    expect(names(deleted)).toEqual(['Verse', 'Chorus', 'Verse 2'])
  })
})

describe('arrangement edits', () => {
  const sectionId = (song: Song, i: number): string => song.arrangement![i].id

  it('picks the part a track plays in a section, or none', () => {
    const before = arrange(written())
    const guitar = before.tracks[0].id
    const silent = apply(before, setCellPart(before, at(0), sectionId(before, 0), guitar, null))
    expect(frets(silent)).toEqual(['-', '-', 7, '-', 3, 5])
    const chorus = apply(silent, setCellPart(silent, at(0), sectionId(silent, 0), guitar, partOf(silent, 1)!))
    expect(frets(chorus)).toEqual([7, '-', 7, '-', 3, 5])
    expect(setCellPart(chorus, at(0), sectionId(chorus, 0), guitar, 'missing')).toBeNull()
  })

  it('gives a section its own copy of a part, so changes stay there', () => {
    const before = arrange(written())
    const copied = apply(before, copyCellPart(before, at(0), sectionId(before, 2), before.tracks[0].id))
    expect(partNames(copied)).toEqual(['Verse', 'Chorus', 'Verse 2'])
    expect(partOf(copied, 2)).not.toBe(partOf(copied, 0))
    const song = apply(copied, setFret(copied, at(5), 9, WHOLE))
    expect(frets(song)).toEqual([3, 5, 7, '-', 3, 9])
  })

  it('renames parts and sections', () => {
    const before = arrange(written())
    const song = apply(before, renamePart(before, at(0), before.tracks[0].id, partOf(before, 0)!, 'Theme A'))
    expect(partStarts(song).map((s) => s.name)).toEqual(['Theme A', 'Chorus', 'Theme A'])
    const renamed = apply(song, renameSection(song, at(0), sectionId(song, 1), 'Refrain'))
    expect(renamed.sections.map((s) => s.name)).toEqual(['Verse', 'Refrain', 'Verse 2'])
  })

  it('a longer section repeats its parts, a shorter one cuts them off, and the parts stay the same', () => {
    const before = arrange(written())
    const longer = apply(before, resizeSection(before, at(0), sectionId(before, 1), 5))
    expect(frets(longer)).toEqual([3, 5, 7, '-', 7, '-', 7, 3, 5])
    expect(longer.tracks[0].parts![1].bars).toHaveLength(2)
    const shorter = apply(longer, resizeSection(longer, at(0), sectionId(longer, 0), 1))
    expect(frets(shorter)).toEqual([3, 7, '-', 7, '-', 7, 3, 5])
    // The verse part keeps its second bar, which the second verse still plays.
    expect(shorter.tracks[0].parts![0].bars).toHaveLength(2)
    expect(resizeSection(shorter, at(0), sectionId(shorter, 0), 0)).toBeNull()
  })

  it('adds an empty section at the end, with the cursor on it', () => {
    const before = arrange(written())
    const result = addSection(before, at(0))!
    const song = apply(before, result)
    expect(names(song)).toEqual(['Verse', 'Chorus', 'Verse 2', 'Section D'])
    expect(frets(song)).toEqual([3, 5, 7, '-', 3, 5, '-', '-', '-', '-'])
    expect(result.cursor.bar).toBe(6)
  })

  it('duplicates a section as a repeat that plays the same parts', () => {
    const before = arrange(written())
    const result = duplicateSection(before, at(0), sectionId(before, 1))!
    const song = apply(before, result)
    expect(names(song)).toEqual(['Verse', 'Chorus', 'Chorus', 'Verse 2'])
    expect(result.cursor.bar).toBe(4)
    const edited = apply(song, setFret(song, at(4), 12, WHOLE))
    expect(frets(edited)).toEqual([3, 5, 12, '-', 12, '-', 3, 5])
  })

  it('moves and removes sections; removed parts stay until deleted', () => {
    const before = arrange(written())
    const moved = apply(before, moveSection(before, at(0), sectionId(before, 2), -1))
    expect(names(moved)).toEqual(['Verse', 'Verse 2', 'Chorus'])
    expect(moveSection(moved, at(0), sectionId(moved, 0), -1)).toBeNull()

    const removed = apply(moved, removeSection(moved, at(0), sectionId(moved, 2)))
    expect(names(removed)).toEqual(['Verse', 'Verse 2'])
    expect(frets(removed)).toEqual([3, 5, 3, 5])
    expect(unusedParts(removed).map((u) => u.part.name)).toEqual(['Chorus'])
    const cleaned = apply(removed, deleteUnusedParts(removed, at(0)))
    expect(partNames(cleaned)).toEqual(['Verse'])
    expect(deleteUnusedParts(cleaned, at(0))).toBeNull()

    const one = apply(cleaned, removeSection(cleaned, at(0), sectionId(cleaned, 1)))
    expect(removeSection(one, at(0), sectionId(one, 0))).toBeNull()
  })
})

describe('dragging sections and parts', () => {
  const sectionId = (song: Song, i: number): string => song.arrangement![i].id

  it('places a section anywhere in the row', () => {
    const before = arrange(written())
    const first = apply(before, placeSection(before, at(0), sectionId(before, 2), 0))
    expect(names(first)).toEqual(['Verse 2', 'Verse', 'Chorus'])
    const last = apply(before, placeSection(before, at(0), sectionId(before, 0), 3))
    expect(names(last)).toEqual(['Chorus', 'Verse 2', 'Verse'])
    expect(frets(last)).toEqual([7, '-', 3, 5, 3, 5])
    // Dropped next to itself: nothing changes.
    expect(placeSection(before, at(0), sectionId(before, 1), 1)).toBeNull()
    expect(placeSection(before, at(0), sectionId(before, 1), 2)).toBeNull()
  })

  it('deletes a part only when no section plays it', () => {
    const before = arrange(written())
    const guitar = before.tracks[0].id
    expect(deletePart(before, at(0), guitar, partOf(before, 1)!)).toBeNull()
    const silent = apply(before, setCellPart(before, at(0), sectionId(before, 1), guitar, null))
    const song = apply(silent, deletePart(silent, at(0), guitar, partOf(before, 1)!))
    expect(partNames(song)).toEqual(['Verse'])
  })
})

describe('part colors', () => {
  it('gives new parts the color used least, so parts of different tracks differ', () => {
    let song = written()
    song = setFret(song, at(0, 1), 2, WHOLE)!.song
    song = arrange(song)
    const colors = song.tracks.flatMap((t) => (t.parts ?? []).map((p) => p.color))
    expect(colors).toEqual([0, 1, 2])
    const copied = apply(song, copyCellPart(song, at(0), song.arrangement![2].id, song.tracks[0].id))
    expect(copied.tracks[0].parts!.at(-1)!.color).toBe(3)
  })

  it('changes a part’s color', () => {
    const before = arrange(written())
    const song = apply(before, setPartColor(before, at(0), before.tracks[0].id, partOf(before, 0)!, 6))
    expect(partColors(song).get(partOf(song, 0)!)).toBe(6)
    expect(setPartColor(song, at(0), song.tracks[0].id, partOf(song, 0)!, 8)).toBeNull()
  })

  it('keeps the colors of parts saved without one when other parts go', () => {
    const song = structuredClone(arrange(written()))
    for (const part of song.tracks[0].parts!) delete part.color
    song.tracks[0].parts![1].color = 99
    const loaded = parseProject(serializeProject(song)).song
    // The unknown color is dropped, and both parts get the color they were shown in.
    expect(loaded.tracks[0].parts!.map((p) => p.color)).toEqual([0, 1])
  })
})

describe('partStarts', () => {
  it('says where each part starts, and how often it plays', () => {
    const starts = partStarts(arrange(written()))
    expect(starts).toEqual([
      { track: 0, bar: 0, name: 'Verse', uses: 2, sameName: true },
      { track: 0, bar: 2, name: 'Chorus', uses: 1, sameName: true },
      { track: 0, bar: 4, name: 'Verse', uses: 2, sameName: false }
    ])
  })
})

describe('project file', () => {
  it('keeps the arrangement', () => {
    const song = arrange(written())
    const loaded = parseProject(serializeProject(song)).song
    expect(loaded.arrangement).toEqual(song.arrangement)
    expect(loaded.tracks.map((t) => t.parts)).toEqual(song.tracks.map((t) => t.parts))
    expect(loaded.tracks.map((t) => t.bars)).toEqual(song.tracks.map((t) => t.bars))
  })

  it('refuses a section that plays a part that does not exist', () => {
    const song = structuredClone(arrange(written()))
    song.arrangement![1].parts[song.tracks[0].id] = 'missing'
    expect(() => parseProject(serializeProject(song))).toThrow(ProjectFileError)
  })
})
