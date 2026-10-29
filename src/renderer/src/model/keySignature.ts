// The song's key signature (REQUIREMENTS.md PRJ-03): how many sharps or flats
// the score shows, and whether the key is major or minor. Notes are stored as
// frets and pitches, so the key changes only how they are written, not how they sound.
import type { KeySignature, Song } from './song'

export type { KeySignature }

export const C_MAJOR: KeySignature = { fifths: 0, minor: false }

/** Key signatures go from 7 flats (−7) to 7 sharps (7). */
export const MAX_FIFTHS = 7

const MAJOR_TONICS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
const MINOR_TONICS = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#']

export function songKey(song: Pick<Song, 'key'>): KeySignature {
  return song.key ?? C_MAJOR
}

/** The key's tonic, e.g. "Bb" or "F#". */
export function keyTonic(key: KeySignature): string {
  return (key.minor ? MINOR_TONICS : MAJOR_TONICS)[key.fifths + MAX_FIFTHS]
}

/** E.g. "G major" or "D minor". */
export function keyName(key: KeySignature): string {
  return `${keyTonic(key).replace('b', '♭').replace('#', '♯')} ${key.minor ? 'minor' : 'major'}`
}

/** E.g. "no sharps or flats", "1 sharp" or "3 flats". */
export function keyAccidentals(key: KeySignature): string {
  const count = Math.abs(key.fifths)
  if (count === 0) return 'no sharps or flats'
  return `${count} ${key.fifths > 0 ? 'sharp' : 'flat'}${count > 1 ? 's' : ''}`
}

/** Every key signature, flats first: the 15 major keys, then the 15 minor ones. */
export const ALL_KEYS: KeySignature[] = [false, true].flatMap((minor) => Array.from({ length: 2 * MAX_FIFTHS + 1 }, (_, i) => ({ fifths: i - MAX_FIFTHS, minor })))

export const sameKey = (a: KeySignature, b: KeySignature): boolean => a.fifths === b.fifths && a.minor === b.minor

/** Pitch class of the key's tonic: 0 = C … 11 = B. */
const tonicClass = (key: KeySignature): number => (((key.fifths * 7 + (key.minor ? 9 : 0)) % 12) + 12) % 12

/**
 * The key a semitone shift moves to, written with as few sharps or flats as
 * possible; between two equal ones (F♯ or G♭ major), flats if the key had flats.
 */
export function transposeKey(key: KeySignature, semitones: number): KeySignature {
  const target = (((tonicClass(key) + semitones) % 12) + 12) % 12
  const candidates = ALL_KEYS.filter((k) => k.minor === key.minor && tonicClass(k) === target)
  candidates.sort((a, b) => Math.abs(a.fifths) - Math.abs(b.fifths) || (key.fifths < 0 ? a.fifths - b.fifths : b.fifths - a.fifths))
  return candidates[0]
}

/** Whether notes in this key are named with flats (B♭ rather than A♯). */
export const usesFlats = (key: KeySignature): boolean => key.fifths < 0

/**
 * Semitones that move music written in `from` to `to` (the smallest shift,
 * −5 to +6), by their sharps and flats: C major → G major is −5, and keys with
 * the same signature (C major, A minor) are 0.
 */
export function keyShift(from: KeySignature, to: KeySignature): number {
  const up = ((((to.fifths - from.fifths) * 7) % 12) + 12) % 12
  return up > 6 ? up - 12 : up
}
