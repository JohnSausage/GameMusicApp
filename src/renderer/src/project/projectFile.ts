// The .gmsong project file (REQUIREMENTS.md PRJ-02, PRJ-07): a zip archive with
// song.json and one audio/<take id>.wav per recorded or imported take.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { decodeWav16, encodeWav16 } from '../audio/wav'
import { fixPartColors, PART_COLORS, writeOut } from '../model/arrangement'
import { MASTER_DEFAULTS, NOTE_VALUES, type Bar, type Instrument, type MasterSettings, type ProjectAudio, type Song, type TakeInfo, type Track } from '../model/song'
import { normalizePatch, PATCH_LIMITS } from '../model/synth'
import { MAX_CAPO } from '../model/tuning'
import { checkLayout, type Layout } from './layout'

export const PROJECT_EXTENSION = 'gmsong'
/** 1: song only. 2: adds takes (song.takes + audio files). 3: full synth patches, master effects, retro originals. */
export const FORMAT_VERSION = 3

interface ProjectJson {
  app: 'GameMusicApp'
  formatVersion: number
  savedAt: string
  song: Song
  /** How the editor was laid out (Tab only, zoom, …). Not in files saved before it was added. */
  layout?: Layout
}

export interface ProjectData {
  song: Song
  audio: Map<string, Float32Array>
  /** Undefined when the file has no layout. */
  layout?: Layout
}

export class ProjectFileError extends Error {}

const takeFile = (id: string): string => `audio/${id}.wav`

/** Takes without audio are left out, so the file never refers to missing audio. */
export function serializeProject(song: Song, audio: ProjectAudio = new Map(), layout?: Layout): Uint8Array {
  const takes = song.takes.filter((t) => audio.has(t.id))
  const json: ProjectJson = { app: 'GameMusicApp', formatVersion: FORMAT_VERSION, savedAt: new Date().toISOString(), song: { ...song, takes }, ...(layout && { layout }) }
  const files: Zippable = { 'song.json': strToU8(JSON.stringify(json, null, 2)) }
  for (const take of takes) files[takeFile(take.id)] = [encodeWav16([audio.get(take.id)!], take.sampleRate), { level: 1 }]
  return zipSync(files)
}

export function parseProject(data: Uint8Array): ProjectData {
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

  const song = checkSong(json.song)
  const audio = new Map<string, Float32Array>()
  for (const take of song.takes) {
    const file = files[takeFile(take.id)]
    if (!file) continue
    try {
      audio.set(take.id, decodeWav16(file).channels[0])
    } catch {
      throw new ProjectFileError(`The project file is damaged: the audio of take "${take.name}" can't be read.`)
    }
  }
  // A take whose audio file is missing can't be played or transcribed, so it is dropped.
  return { song: { ...song, takes: song.takes.filter((t) => audio.has(t.id)) }, audio, ...(json.layout !== undefined && { layout: checkLayout(json.layout) }) }
}

function fail(detail: string): never {
  throw new ProjectFileError(`The project file is damaged: ${detail}.`)
}

const isInt = (v: unknown): v is number => Number.isInteger(v)

function checkTakes(value: unknown): TakeInfo[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail('invalid take list')
  for (const take of value as TakeInfo[]) {
    if (typeof take.id !== 'string' || !/^[\w-]+$/.test(take.id) || typeof take.name !== 'string') fail('a take has no valid id or name')
    if (!isInt(take.sampleRate) || take.sampleRate <= 0 || typeof take.tempo !== 'number' || typeof take.firstDownbeat !== 'number') {
      fail(`take "${take.name}" has invalid timing`)
    }
  }
  return value as TakeInfo[]
}

function checkInstrument(value: unknown, where: string): Instrument {
  const instrument = value as Instrument
  if (instrument?.kind === 'soundfont' && isInt(instrument.program) && instrument.program >= 0 && instrument.program <= 127) return instrument
  // Synth patches from older files only had a few settings; the rest get defaults.
  if (instrument?.kind === 'synth') return { kind: 'synth', patch: normalizePatch(instrument.patch) }
  if (instrument?.kind === 'synthkit' && Array.isArray(instrument.pieces)) {
    return {
      kind: 'synthkit',
      pieces: instrument.pieces.map((piece) => {
        if (!isInt(piece?.note) || !isInt(piece.pitch)) fail(`${where} has an invalid drum sound`)
        return { note: piece.note, pitch: piece.pitch, patch: normalizePatch(piece.patch) }
      })
    }
  }
  fail(`${where} has no valid instrument`)
}

function checkMaster(value: unknown): MasterSettings | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { crushBits, crushRate } = value as Partial<MasterSettings>
  const clamp = (v: unknown, [min, max]: [number, number], fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback)
  return { crushBits: clamp(crushBits, PATCH_LIMITS.crushBits, MASTER_DEFAULTS.crushBits), crushRate: clamp(crushRate, PATCH_LIMITS.crushRate, MASTER_DEFAULTS.crushRate) }
}

function checkBars(bars: Bar[], track: Track, where: string): void {
  bars.forEach((bar, b) => {
    if (!Array.isArray(bar.beats) || bar.beats.length === 0) fail(`${where}, bar ${b + 1} has no beats`)
    for (const beat of bar.beats) {
      if (!NOTE_VALUES.includes(beat.value) || typeof beat.dotted !== 'boolean' || !Array.isArray(beat.notes)) {
        fail(`${where}, bar ${b + 1} has an invalid beat`)
      }
      for (const note of beat.notes) {
        if (!isInt(note.string) || note.string < 1 || note.string > track.tuning.length || !isInt(note.fret) || note.fret < 0) {
          fail(`${where}, bar ${b + 1} has an invalid note`)
        }
        if ([note.tie, note.hammer, note.slide].some((flag) => flag !== undefined && typeof flag !== 'boolean')) {
          fail(`${where}, bar ${b + 1} has a note with invalid techniques`)
        }
      }
    }
  })
}

function checkParts(track: Track, t: number): void {
  if (!Array.isArray(track.parts)) fail(`track ${t + 1} has an invalid part list`)
  for (const part of track.parts) {
    if (typeof part?.id !== 'string' || typeof part.name !== 'string') fail(`track ${t + 1} has a part without a valid id or name`)
    if (!Array.isArray(part.bars) || part.bars.length === 0) fail(`part "${part.name}" of track ${t + 1} has no bars`)
    // A color the app doesn't know is dropped; the part gets one by its place.
    if (part.color !== undefined && !(isInt(part.color) && part.color >= 0 && part.color < PART_COLORS)) delete part.color
    checkBars(part.bars, track, `part "${part.name}" of track ${t + 1}`)
  }
}

function checkArrangement(song: Song): void {
  if (!Array.isArray(song.arrangement)) fail('invalid arrangement')
  for (const section of song.arrangement) {
    if (typeof section?.id !== 'string' || typeof section.name !== 'string') fail('a section has no valid id or name')
    if (!isInt(section.length) || section.length < 1) fail(`section "${section.name}" has an invalid length`)
    if (!section.parts || typeof section.parts !== 'object') fail(`section "${section.name}" has an invalid part list`)
    for (const [trackId, partId] of Object.entries(section.parts)) {
      const track = song.tracks.find((t) => t.id === trackId)
      if (!track?.parts?.some((p) => p.id === partId)) fail(`section "${section.name}" plays a part that doesn't exist`)
    }
  }
}

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
    if (track.kind !== undefined && track.kind !== 'drums' && track.kind !== 'keys') fail(`track ${t + 1} has an unknown kind`)
    if (track.capo !== undefined && (track.kind !== undefined || !isInt(track.capo) || track.capo < 0 || track.capo > MAX_CAPO)) fail(`track ${t + 1} has an invalid capo`)
    if ((track.mute !== undefined && typeof track.mute !== 'boolean') || (track.solo !== undefined && typeof track.solo !== 'boolean')) {
      fail(`track ${t + 1} has invalid mute/solo settings`)
    }
    track.instrument = checkInstrument(track.instrument, `track ${t + 1}`)
    if (track.originalInstrument !== undefined) track.originalInstrument = checkInstrument(track.originalInstrument, `track ${t + 1} (original sound)`)
    if (!Array.isArray(track.bars) || track.bars.length !== bars) fail(`track ${t + 1} has the wrong number of bars`)
    checkBars(track.bars, track, `track ${t + 1}`)
    if (track.parts !== undefined) checkParts(track, t)
  })
  if (song.arrangement !== undefined) checkArrangement(song)
  fixPartColors(song)
  const checked = { ...song, sections: Array.isArray(song.sections) ? song.sections : [], takes: checkTakes(song.takes), master: checkMaster(song.master) }
  // The arrangement is what counts; the bars written out in the file are for reading it without one.
  return writeOut(checked)
}

/** File name for a new project, from its title. */
export function suggestedFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Untitled'
  return `${safe}.${PROJECT_EXTENSION}`
}
