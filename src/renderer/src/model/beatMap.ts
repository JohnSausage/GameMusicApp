import { sectionRanges, type BarRange } from './edit'
import { uniqueFileNames } from './fileNames'
import type { Song } from './song'
import { exportFilePrefix, type Stem } from './stems'
import { barSeconds, EXPORT_TAIL_SECONDS, exportFrameCount, type ExportEnding } from './timing'

/**
 * The beat map (REQUIREMENTS.md EXP-11): a JSON file next to exported WAV files
 * with the tempo, the time signature and where the sections are, in seconds and
 * bars, so a game can follow the music. unity/GameMusicPlayer.cs reads it
 * (its BeatMapData has the same fields).
 */
export interface BeatMap {
  format: 'GameMusicApp beat map'
  version: number
  title: string
  /** The part of the song in the files: null for all of it, else e.g. "Chorus" or "bars 5-8". */
  range: string | null
  /** The song's bar the files start with, counted from 1. */
  firstBar: number
  tempo: number
  timeSignature: [number, number]
  /** A beat is a note of the time signature's lower number (a quarter in 4/4, an eighth in 6/8). */
  beatsPerBar: number
  secondsPerBeat: number
  secondsPerBar: number
  bars: number
  /** How long the music is, without the ring-out. */
  seconds: number
  /** True when the files end exactly at the end of the music, to loop. */
  loops: boolean
  /** How long the files go on after the music to let notes ring out (0 when they loop). */
  tailSeconds: number
  sampleRate: number
  /** Samples per channel in each file. */
  samples: number
  /** The sections in the files; bars count from 0, the files' first bar. */
  sections: { name: string; bar: number; bars: number; start: number; end: number }[]
  /** The mix's file, if it was exported. */
  mix: string | null
  /** The stems' files, with their tracks. */
  stems: { file: string; name: string; tracks: string[] }[]
}

export const BEAT_MAP_VERSION = 1

/** Seconds without the float noise of the sums (to the microsecond). */
const round = (seconds: number): number => Math.round(seconds * 1e6) / 1e6

export interface BeatMapFiles {
  sampleRate: number
  ending: ExportEnding
  mix: string | null
  stems: Stem[]
}

/** The beat map of an exported range of the song and its files. */
export function beatMap(song: Song, range: BarRange & { name: string | null }, files: BeatMapFiles): BeatMap {
  const bar = barSeconds(song)
  const [beatsPerBar] = song.timeSignature
  const seconds = { start: range.start * bar, end: range.end * bar }
  const sections = sectionRanges(song)
    .filter((s) => s.end > range.start && s.start < range.end)
    .map((s) => {
      const start = Math.max(s.start, range.start) - range.start
      const end = Math.min(s.end, range.end) - range.start
      return { name: s.name, bar: start, bars: end - start, start: round(start * bar), end: round(end * bar) }
    })
  return {
    format: 'GameMusicApp beat map',
    version: BEAT_MAP_VERSION,
    title: song.title,
    range: range.name,
    firstBar: range.start + 1,
    tempo: song.tempo,
    timeSignature: [song.timeSignature[0], song.timeSignature[1]],
    beatsPerBar,
    secondsPerBeat: round(bar / beatsPerBar),
    secondsPerBar: round(bar),
    bars: range.end - range.start,
    seconds: round(seconds.end - seconds.start),
    loops: files.ending === 'cut',
    tailSeconds: files.ending === 'tail' ? EXPORT_TAIL_SECONDS : 0,
    sampleRate: files.sampleRate,
    samples: exportFrameCount(seconds, files.sampleRate, files.ending),
    sections,
    mix: files.mix,
    stems: files.stems.map((stem) => ({ file: stem.fileName, name: stem.name, tracks: stem.trackIndexes.map((i) => song.tracks[i].name) }))
  }
}

/** The beat map's file name, next to the mix: "Title.json" or "Title - Section.json". */
export function beatMapFileName(song: Song, rangeName: string | null): string {
  return uniqueFileNames([exportFilePrefix(song, rangeName)], 'Song', '.json')[0]
}

/** The beat map as the file's text. */
export function beatMapJson(map: BeatMap): string {
  return `${JSON.stringify(map, null, 2)}\n`
}
