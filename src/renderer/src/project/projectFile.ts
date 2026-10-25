// The .gmsong project file (REQUIREMENTS.md PRJ-02, PRJ-07): a zip archive with
// song.json inside. Recorded takes will be added to the archive later.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { NOTE_VALUES, type Song } from '../model/song'

export const PROJECT_EXTENSION = 'gmsong'
export const FORMAT_VERSION = 1

interface ProjectJson {
  app: 'GameMusicApp'
  formatVersion: number
  savedAt: string
  song: Song
}

export class ProjectFileError extends Error {}

export function serializeProject(song: Song): Uint8Array {
  const json: ProjectJson = { app: 'GameMusicApp', formatVersion: FORMAT_VERSION, savedAt: new Date().toISOString(), song }
  return zipSync({ 'song.json': strToU8(JSON.stringify(json, null, 2)) })
}

export function parseProject(data: Uint8Array): Song {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  } catch {
    throw new ProjectFileError('This is not a GameMusicApp project file.')
  }
  const entry = files['song.json']
  if (!entry) throw new ProjectFileError('This is not a GameMusicApp project file (song.json is missing).')

  let json: Partial<ProjectJson>
  try {
    json = JSON.parse(strFromU8(entry))
  } catch {
    throw new ProjectFileError('The project file is damaged (song.json is not valid JSON).')
  }
  if (json.app !== 'GameMusicApp' || typeof json.formatVersion !== 'number') {
    throw new ProjectFileError('This is not a GameMusicApp project file.')
  }
  if (json.formatVersion > FORMAT_VERSION) {
    throw new ProjectFileError('This project was saved by a newer version of GameMusicApp. Please update the app to open it.')
  }
  return checkSong(json.song)
}

function fail(detail: string): never {
  throw new ProjectFileError(`The project file is damaged: ${detail}.`)
}

const isInt = (v: unknown): v is number => Number.isInteger(v)

/** Checks the structure we rely on, so a damaged file fails here instead of crashing the editor. */
function checkSong(value: unknown): Song {
  const song = value as Song
  if (!song || typeof song !== 'object') fail('no song data')
  if (typeof song.title !== 'string') fail('missing title')
  if (typeof song.tempo !== 'number' || song.tempo < 20 || song.tempo > 400) fail('invalid tempo')
  if (!Array.isArray(song.timeSignature) || song.timeSignature.length !== 2 || !song.timeSignature.every(isInt)) fail('invalid time signature')
  if (!Array.isArray(song.tracks) || song.tracks.length === 0) fail('no tracks')

  const bars = song.tracks[0].bars?.length
  song.tracks.forEach((track, t) => {
    if (typeof track.name !== 'string' || !Array.isArray(track.tuning) || !track.tuning.every(isInt)) fail(`track ${t + 1} is invalid`)
    if (track.instrument?.kind !== 'soundfont' && track.instrument?.kind !== 'synth') fail(`track ${t + 1} has no instrument`)
    if (!Array.isArray(track.bars) || track.bars.length !== bars) fail(`track ${t + 1} has the wrong number of bars`)
    track.bars.forEach((bar, b) => {
      if (!Array.isArray(bar.beats) || bar.beats.length === 0) fail(`track ${t + 1}, bar ${b + 1} has no beats`)
      for (const beat of bar.beats) {
        if (!NOTE_VALUES.includes(beat.value) || typeof beat.dotted !== 'boolean' || !Array.isArray(beat.notes)) {
          fail(`track ${t + 1}, bar ${b + 1} has an invalid beat`)
        }
        for (const note of beat.notes) {
          if (!isInt(note.string) || note.string < 1 || note.string > track.tuning.length || !isInt(note.fret) || note.fret < 0) {
            fail(`track ${t + 1}, bar ${b + 1} has an invalid note`)
          }
        }
      }
    })
  })
  return { ...song, sections: Array.isArray(song.sections) ? song.sections : [] }
}

/** File name for a new project, from its title. */
export function suggestedFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Untitled'
  return `${safe}.${PROJECT_EXTENSION}`
}
