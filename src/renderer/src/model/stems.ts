import type { Cursor, EditResult } from './edit'
import { uniqueFileNames } from './fileNames'
import type { Song, Track } from './song'
import { buildTimeline, notesBetween, type TimeRange } from './timing'

/**
 * Stems (REQUIREMENTS.md EXP-09): a WAV file per track or group of tracks, all
 * the same length, to play together as layers in a game. A stem is rendered from
 * the song with only its tracks heard, so it sounds as they do in the mix.
 */

export interface Stem {
  /** Its name, from its first track (see stemName). */
  name: string
  /** Its tracks, in song order. */
  trackIndexes: number[]
  fileName: string
}

/** The stem a track goes into: its stem name, or else its own name. */
export function stemName(track: Track, index: number): string {
  return track.stem?.trim() || track.name.trim() || `Track ${index + 1}`
}

/** The prefix of the exported files: "Title" or "Title - Section". The mix is saved as it. */
const filePrefix = (song: Song, rangeName: string | null): string => [song.title.trim() || 'Song', rangeName].filter(Boolean).join(' - ')

/**
 * The picked tracks as stems: tracks with the same stem name (also only by upper
 * and lower case) share one file, "Title - Stem.wav" or "Title - Section - Stem.wav".
 * With `withMix`, the mix's file name ("Title.wav") comes first, and no stem takes it.
 */
export function stemsOf(song: Song, rangeName: string | null, trackIndexes: number[], withMix = false): { stems: Stem[]; mixFileName: string | null } {
  const groups = new Map<string, number[]>()
  for (const index of trackIndexes) {
    const key = stemName(song.tracks[index], index).toLowerCase()
    groups.set(key, [...(groups.get(key) ?? []), index])
  }
  const prefix = filePrefix(song, rangeName)
  const grouped = [...groups.values()].map((indexes) => ({ name: stemName(song.tracks[indexes[0]], indexes[0]), trackIndexes: indexes }))
  const names = uniqueFileNames([...(withMix ? [prefix] : []), ...grouped.map((stem) => `${prefix} - ${stem.name}`)], 'Stem', '.wav')
  const stems = grouped.map((stem, i) => ({ ...stem, fileName: names[i + (withMix ? 1 : 0)] }))
  return { stems, mixFileName: withMix ? names[0] : null }
}

/** The song with only some tracks heard: their sound, volume and pan stay, the others are muted. */
export function stemSong(song: Song, trackIndexes: number[]): Song {
  return { ...song, tracks: song.tracks.map((track, i) => ({ ...track, mute: !trackIndexes.includes(i), solo: false })) }
}

/** Which tracks start notes in a range of the song (in seconds), as rendered in an export. */
export function tracksWithNotes(song: Song, range: TimeRange): boolean[] {
  const playing = new Set(notesBetween(buildTimeline(song).notes, range.start, range.end).map((n) => n.trackIndex))
  return song.tracks.map((_, i) => playing.has(i))
}

/** Puts a track into the stem with this name; an empty name gives it its own, named after it. */
export function setStemName(song: Song, cursor: Cursor, trackIndex: number, name: string): EditResult | null {
  if (!song.tracks[trackIndex]) return null
  const tracks = song.tracks.map((track, i) => {
    if (i !== trackIndex) return track
    const { stem: _, ...rest } = track
    return name.trim() ? { ...rest, stem: name } : rest
  })
  return { song: { ...song, tracks }, cursor }
}
