import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { addBars, createSong } from '../src/renderer/src/model/edit'
import { createDemoSong } from '../src/renderer/src/model/song'
import { FORMAT_VERSION, parseProject, ProjectFileError, serializeProject, suggestedFileName } from '../src/renderer/src/project/projectFile'

const zipJson = (json: unknown): Uint8Array => zipSync({ 'song.json': strToU8(JSON.stringify(json)) })

describe('project file', () => {
  it('round-trips a song', () => {
    const song = addBars(createDemoSong(), { track: 0, bar: 0, beat: 0, string: 1 }, 4, 'Chorus').song
    expect(parseProject(serializeProject(song))).toEqual(song)
  })

  it('opens files without sections (older format) with an empty section list', () => {
    const { sections: _, ...song } = createSong({ title: 'Old', tempo: 90, timeSignature: [3, 4], firstTrack: 'bass' })
    expect(parseProject(zipJson({ app: 'GameMusicApp', formatVersion: 1, song })).sections).toEqual([])
  })

  it('rejects files that are not projects', () => {
    expect(() => parseProject(new Uint8Array([1, 2, 3]))).toThrow(ProjectFileError)
    expect(() => parseProject(zipSync({ 'other.txt': strToU8('hi') }))).toThrow('song.json is missing')
    expect(() => parseProject(zipJson({ app: 'SomethingElse', formatVersion: 1 }))).toThrow('not a GameMusicApp project')
  })

  it('rejects files from a newer app version', () => {
    expect(() => parseProject(zipJson({ app: 'GameMusicApp', formatVersion: FORMAT_VERSION + 1, song: createDemoSong() }))).toThrow('newer version')
  })

  it('explains what is damaged', () => {
    const song = createDemoSong()
    song.tracks[1].bars.pop()
    expect(() => parseProject(zipJson({ app: 'GameMusicApp', formatVersion: 1, song }))).toThrow('track 2 has the wrong number of bars')

    const badNote = createDemoSong()
    badNote.tracks[0].bars[0].beats[0].notes[0].string = 9
    expect(() => parseProject(zipJson({ app: 'GameMusicApp', formatVersion: 1, song: badNote }))).toThrow('track 1, bar 1 has an invalid note')
  })

  it('suggests a safe file name from the title', () => {
    expect(suggestedFileName('Boss: Phase 2?')).toBe('Boss Phase 2.gmsong')
    expect(suggestedFileName('  ')).toBe('Untitled.gmsong')
  })
})
