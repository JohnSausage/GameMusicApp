import { uniqueFileNames } from './fileNames'
import type { Song } from './song'
import { buildTimeline, notesBetween, type TimeRange } from './timing'

/**
 * Stems (REQUIREMENTS.md EXP-09): one WAV file per track, all the same length,
 * to play together as layers in a game. A stem is rendered from the song with
 * only its track heard, so it sounds as that track does in the mix.
 */

/** The song with only one track heard: its sound, volume and pan stay, the others are muted. */
export function stemSong(song: Song, trackIndex: number): Song {
  return { ...song, tracks: song.tracks.map((track, i) => ({ ...track, mute: i !== trackIndex, solo: false })) }
}

/** Which tracks start notes in a range of the song (in seconds), as rendered in an export. */
export function tracksWithNotes(song: Song, range: TimeRange): boolean[] {
  const playing = new Set(notesBetween(buildTimeline(song).notes, range.start, range.end).map((n) => n.trackIndex))
  return song.tracks.map((_, i) => playing.has(i))
}

/** The stems' WAV file names, "Title - Track.wav" or "Title - Section - Track.wav", safe for files and each its own. */
export function stemFileNames(song: Song, rangeName: string | null, trackIndexes: number[]): string[] {
  const prefix = [song.title.trim() || 'Song', rangeName].filter(Boolean).join(' - ')
  return uniqueFileNames(
    trackIndexes.map((i) => `${prefix} - ${song.tracks[i].name.trim() || `Track ${i + 1}`}`),
    'Stem',
    '.wav'
  )
}
