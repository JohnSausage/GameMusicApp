// Authentic mode (REQUIREMENTS.md SYN-36): the song plays as an old console
// could play it. A console has a few sound channels of each kind (the NES: two
// pulse, one triangle, one noise), and each plays one note at a time. Notes that
// would need more channels take one from the note that started first, as a
// console's sound driver does, and the song says where that happens.
import { audibleTracks, type Song } from './song'
import type { Waveform } from './synth'
import { barAtTime, type NoteEvent } from './timing'

export type ConsoleId = 'nes' | 'gameboy' | 'megadrive'
export type Channel = 'pulse' | 'triangle' | 'wave' | 'noise' | 'fm'

export interface Console {
  id: ConsoleId
  name: string
  /** How many notes of each kind it plays at once. */
  channels: Partial<Record<Channel, number>>
  /** The channel a waveform plays on; null if the console has none for it. */
  channelOf: (waveform: Waveform) => Channel | null
}

export const CONSOLES: Console[] = [
  { id: 'nes', name: 'NES', channels: { pulse: 2, triangle: 1, noise: 1 }, channelOf: (w) => (w === 'pulse' || w === 'triangle' || w === 'noise' ? w : null) },
  // The Game Boy's wave channel plays any short waveform: triangle, saw or sine.
  { id: 'gameboy', name: 'Game Boy', channels: { pulse: 2, wave: 1, noise: 1 }, channelOf: (w) => (w === 'pulse' || w === 'noise' ? w : w === 'fm' ? null : 'wave') },
  // Six FM channels, and the square waves and noise of its PSG chip.
  { id: 'megadrive', name: 'Mega Drive / Genesis', channels: { fm: 6, pulse: 3, noise: 1 }, channelOf: (w) => (w === 'fm' || w === 'pulse' || w === 'noise' ? w : null) }
]

export const CHANNEL_NAMES: Record<Channel, string> = { pulse: 'pulse', triangle: 'triangle', wave: 'wave', noise: 'noise', fm: 'FM' }

const WAVEFORM_NAMES: Record<Waveform, string> = { pulse: 'pulse', triangle: 'triangle', sawtooth: 'saw', sine: 'sine', noise: 'noise', fm: 'FM' }

/** The console the song is limited to, or null (no limits). */
export const consoleOf = (song: Song): Console | null => CONSOLES.find((c) => c.id === song.master?.console) ?? null

/** Something in the song the console can't play as it is. */
export type ConsoleProblem =
  /** More notes of a kind at once than the console has channels for: the first ones are cut short. */
  | { kind: 'channels'; bar: number; channel: Channel; notes: number }
  /** A track with a sound the console doesn't have (a SoundFont instrument, or e.g. a saw wave on the NES). It plays as it is. */
  | { kind: 'sound'; track: number; sound: string }

/** Notes that sound on one channel together: one note, or the chord of an arpeggio or a mono synth. */
interface ChannelUse {
  channel: Channel
  start: number
  end: number
  notes: NoteEvent[]
}

const EPSILON = 1e-6

/**
 * The notes as the console plays them: on each channel one note at a time. A
 * note that finds every channel of its kind busy takes the one whose note
 * started first, which ends there. Only tracks you hear take channels.
 */
export function fitToConsole(song: Song, notes: NoteEvent[], console: Console): { notes: NoteEvent[]; problems: ConsoleProblem[] } {
  const audible = audibleTracks(song)
  const copies = notes.map((n) => ({ ...n }))
  const uses: ChannelUse[] = []
  const problems: ConsoleProblem[] = []
  song.tracks.forEach((track, t) => {
    if (!audible[t]) return
    const instrument = track.instrument
    const own = copies.filter((n) => n.trackIndex === t).sort((a, b) => a.start - b.start)
    if (instrument.kind === 'soundfont') {
      if (own.length > 0) problems.push({ kind: 'sound', track: t, sound: 'a SoundFont instrument' })
      return
    }
    if (instrument.kind === 'synth') {
      const channel = console.channelOf(instrument.patch.waveform)
      if (!channel) {
        if (own.length > 0) problems.push({ kind: 'sound', track: t, sound: `a ${WAVEFORM_NAMES[instrument.patch.waveform]} wave` })
        return
      }
      // An arpeggio or a mono synth plays its notes on one channel.
      const oneVoice = instrument.patch.arpRate > 0 || instrument.patch.mono
      for (const note of own) {
        const last = uses.at(-1)
        const end = note.start + note.duration
        if (oneVoice && last?.notes[0].trackIndex === t && note.start < last.end - EPSILON) {
          last.notes.push(note)
          last.end = Math.max(last.end, end)
        } else uses.push({ channel, start: note.start, end, notes: [note] })
      }
      return
    }
    const missing = new Set<string>()
    for (const note of own) {
      const piece = instrument.pieces.find((p) => p.note === note.pitch)
      if (!piece) continue
      const channel = console.channelOf(piece.patch.waveform)
      if (channel) uses.push({ channel, start: note.start, end: note.start + note.duration, notes: [note] })
      else missing.add(WAVEFORM_NAMES[piece.patch.waveform])
    }
    for (const wave of missing) problems.push({ kind: 'sound', track: t, sound: `drums with a ${wave} wave` })
  })

  const dropped = new Set<NoteEvent>()
  const busy = new Map<Channel, ChannelUse[]>()
  const crowded = new Map<string, ConsoleProblem & { kind: 'channels' }>()
  for (const use of [...uses].sort((a, b) => a.start - b.start)) {
    const playing = (busy.get(use.channel) ?? []).filter((u) => u.end > use.start + EPSILON)
    const limit = console.channels[use.channel] ?? 0
    if (playing.length > 0 && playing.length >= limit) {
      const bar = barAtTime(song, use.start)
      const key = `${bar}:${use.channel}`
      const before = crowded.get(key)
      if (!before || before.notes < playing.length + 1) crowded.set(key, { kind: 'channels', bar, channel: use.channel, notes: playing.length + 1 })
      // The note that started first gives its channel up.
      const taken = playing.shift()!
      for (const note of taken.notes) {
        if (note.start >= use.start - EPSILON) dropped.add(note)
        else {
          note.duration = Math.min(note.duration, use.start - note.start)
          if (note.bends) note.bends = note.bends.filter((b) => b.time < use.start)
        }
      }
      taken.end = use.start
    }
    playing.push(use)
    busy.set(use.channel, playing)
  }
  problems.push(...[...crowded.values()].sort((a, b) => a.bar - b.bar))
  return { notes: copies.filter((n) => !dropped.has(n)), problems }
}

/** What the console can't play as it is; none without a console. */
export function consoleProblems(song: Song, notes: NoteEvent[]): ConsoleProblem[] {
  const console = consoleOf(song)
  return console ? fitToConsole(song, notes, console).problems : []
}

/** The notes as the song's console plays them (all of them without one). */
export function consoleNotes(song: Song, notes: NoteEvent[]): NoteEvent[] {
  const console = consoleOf(song)
  return console ? fitToConsole(song, notes, console).notes : notes
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/**
 * The warning above the score: what the bar at the cursor needs, else how many
 * bars need more channels and the first of them, and the sounds the console doesn't have.
 */
export function consoleSummary(song: Song, console: Console, problems: ConsoleProblem[], bar: number): { text: string; firstBar: number | null } {
  const crowded = problems.filter((p) => p.kind === 'channels')
  const here = crowded.filter((p) => p.bar === bar)
  const bars = [...new Set(crowded.map((p) => p.bar))]
  const parts: string[] = []
  let firstBar: number | null = null
  if (here.length > 0) {
    const needs = here.map((p) => `${p.notes} ${CHANNEL_NAMES[p.channel]} notes`).join(' and ')
    const has = here.map((p) => count(console.channels[p.channel] ?? 0, `${CHANNEL_NAMES[p.channel]} channel`)).join(' and ')
    const more = bars.length > 1 ? ` ${count(bars.length - 1, 'more bar')} too.` : ''
    parts.push(`Bar ${bar + 1} has ${needs} at once; the ${console.name} has ${has}, so the notes that started first are cut short.${more}`)
  } else if (bars.length > 0) {
    firstBar = bars[0]
    parts.push(`${count(bars.length, 'bar')} ${bars.length === 1 ? 'has' : 'have'} more notes at once than the ${console.name} has channels for; the notes that started first are cut short.`)
  }
  const sounds = problems.filter((p) => p.kind === 'sound')
  if (sounds.length > 0) {
    const list = sounds.map((p) => `“${song.tracks[p.track].name}” plays ${p.sound}`).join(', ')
    parts.push(`${list}, which the ${console.name} doesn’t have; ${sounds.length === 1 ? 'it plays' : 'they play'} as ${sounds.length === 1 ? 'it is' : 'they are'}.`)
  }
  return { text: parts.join(' '), firstBar }
}
