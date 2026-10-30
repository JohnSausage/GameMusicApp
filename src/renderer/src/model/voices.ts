// A second voice (REQUIREMENTS.md EDIT-15): another rhythm on the same staff,
// e.g. a bass line under a melody. A bar keeps it in `voice2`. The editor works
// on it by swapping it into `beats` (swapVoices), so every edit works on either
// voice, and swaps the edited song back (unswapVoices).
import { beatTicks, restsFor, type Cursor } from './edit'
import type { Bar, Beat, Song, Track } from './song'

/** Guitar, bass and keys tracks can have a second voice; drum tracks have one. */
export const hasVoices = (track: Pick<Track, 'kind'>): boolean => track.kind !== 'drums'

const ticksOf = (beats: Beat[]): number => beats.reduce((sum, b) => sum + beatTicks(b), 0)
const withNotes = (beats: Beat[] | undefined): beats is Beat[] => !!beats?.some((b) => b.notes.length > 0)

/** A bar's second voice: rests through the bar where it has none. */
export const secondVoice = (bar: Bar): Beat[] => bar.voice2 ?? restsFor(ticksOf(bar.beats))

/** The bar with `voice2` as its second voice; one without notes is left out. */
export function withSecondVoice(bar: Bar, voice2: Beat[] | undefined): Bar {
  const { voice2: _, ...rest } = bar
  return withNotes(voice2) ? { ...rest, voice2 } : rest
}

/** The beats of both voices of a bar, e.g. to change all its notes. */
export const allBeats = (bar: Bar): Beat[] => (bar.voice2 ? [...bar.beats, ...bar.voice2] : bar.beats)

const swapBar = (bar: Bar): Bar => ({ ...bar, beats: secondVoice(bar), voice2: bar.beats })
const unswapBar = (bar: Bar): Bar => withSecondVoice({ ...bar, beats: secondVoice(bar) }, bar.beats)

/** The song with `change` applied to every bar (also of parts) of the tracks that have voices. */
function mapBars(song: Song, change: (bar: Bar) => Bar): Song {
  return {
    ...song,
    tracks: song.tracks.map((track) =>
      hasVoices(track)
        ? { ...track, bars: track.bars.map(change), ...(track.parts && { parts: track.parts.map((part) => ({ ...part, bars: part.bars.map(change) })) }) }
        : track
    )
  }
}

const swapped = new WeakMap<Song, Song>()

/**
 * The song with the voices of every bar swapped: the second voice in `beats`
 * (rests where a bar has none), the first in `voice2`. The editor works on it in
 * the second voice. The same song gives the same object, so the score isn't
 * drawn again for nothing.
 */
export function swapVoices(song: Song): Song {
  let result = swapped.get(song)
  if (!result) {
    result = mapBars(song, swapBar)
    swapped.set(song, result)
  }
  return result
}

/** A song from swapVoices() (e.g. edited) with its voices back in their places. */
export const unswapVoices = (song: Song): Song => mapBars(song, unswapBar)

/** Applies a change of bars to both voices: `change` gets the bars' first voices, then their second ones. */
export function bothVoices(bars: Bar[], change: (bars: Bar[]) => Bar[]): Bar[] {
  const first = change(bars.map((bar) => ({ beats: bar.beats })))
  if (!bars.some((bar) => bar.voice2)) return first
  const second = change(bars.map((bar) => ({ beats: secondVoice(bar) })))
  return first.map((bar, i) => withSecondVoice(bar, second[i]?.beats))
}

/** The cursor in the other voice of its bar, on the beat sounding at the same time. Null on a drum track. */
export function otherVoice(song: Song, c: Cursor): Cursor | null {
  if (!hasVoices(song.tracks[c.track])) return null
  const bar = song.tracks[c.track].bars[c.bar]
  const [from, to] = c.voice === 2 ? [secondVoice(bar), bar.beats] : [bar.beats, secondVoice(bar)]
  const tick = ticksOf(from.slice(0, c.beat))
  let beat = 0
  for (let i = 0, start = 0; i < to.length && start <= tick; start += beatTicks(to[i]), i++) beat = i
  const { voice: _, ...cursor } = c
  return c.voice === 2 ? { ...cursor, beat } : { ...cursor, beat, voice: 2 }
}
