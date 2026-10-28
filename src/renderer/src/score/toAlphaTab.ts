import * as alphaTab from '@coderline/alphatab'
import { partStarts } from '../model/arrangement'
import { strengthOf } from '../model/drums'
import type { NoteValue, Song } from '../model/song'
import { isStandardTuning, tuningPreset } from '../model/tuning'

const { AccentuationType, Automation, SlideOutType, Bar, Beat, Clef, Duration, MasterBar, Note, Ottavia, Score, Section, Track, Tuning, Voice } = alphaTab.model

export interface BeatRef {
  trackIndex: number
  barIndex: number
  beatIndex: number
}

export interface ConvertedScore {
  score: alphaTab.model.Score
  /** alphaTab beat for each of our beats: [track][bar][beat]. */
  beats: alphaTab.model.Beat[][][]
  /** Reverse lookup, used for click hit-testing. */
  refs: Map<alphaTab.model.Beat, BeatRef>
}

const DURATIONS: Record<NoteValue, alphaTab.model.Duration> = {
  1: Duration.Whole,
  2: Duration.Half,
  4: Duration.Quarter,
  8: Duration.Eighth,
  16: Duration.Sixteenth,
  32: Duration.ThirtySecond
}

/**
 * Builds an alphaTab score from our song model. Our model stays the source of
 * truth; this is regenerated after every edit (REQUIREMENTS.md §6.1).
 * With `tabOnly`, fretted tracks show just their tab and drum tracks a rhythm
 * (slash) line, so every track stays visible and clickable.
 */
export function songToAlphaTab(song: Song, settings: alphaTab.Settings, tabOnly = false): ConvertedScore {
  const score = new Score()
  score.title = song.title
  const barCount = Math.max(1, ...song.tracks.map((t) => t.bars.length))

  for (let i = 0; i < barCount; i++) {
    const masterBar = new MasterBar()
    masterBar.timeSignatureNumerator = song.timeSignature[0]
    masterBar.timeSignatureDenominator = song.timeSignature[1]
    if (i === 0) masterBar.tempoAutomations.push(Automation.buildTempoAutomation(false, 0, song.tempo, 2))
    const sectionName = song.sections.find((s) => s.bar === i)?.name
    if (sectionName) {
      masterBar.section = new Section()
      masterBar.section.text = sectionName
      masterBar.section.marker = ''
    }
    score.addMasterBar(masterBar)
  }

  const beats: alphaTab.model.Beat[][][] = []
  const refs = new Map<alphaTab.model.Beat, BeatRef>()
  // Part names over the bar where a part starts, by track and bar. A part played
  // only in the section it is named after needs none: the section name says it.
  const partLabels = new Map<string, string>()
  for (const start of partStarts(song)) if (start.uses > 1 || !start.sameName) partLabels.set(`${start.track}:${start.bar}`, start.name)

  // Tracks whose tuning is not listed under the title (alphaTab track index → false).
  const hiddenTunings = new Map<number, boolean>()
  score.stylesheet.perTrackDisplayTuning = hiddenTunings
  song.tracks.forEach((track, trackIndex) => {
    const atTrack = new Track()
    atTrack.name = track.name
    atTrack.shortName = track.name.slice(0, 5)
    score.addTrack(atTrack)
    atTrack.ensureStaveCount(1)
    const staff = atTrack.staves[0]
    // Drum tracks get a percussion staff; alphaTab draws each note by its General MIDI drum number.
    const drums = track.kind === 'drums'
    // Keys tracks have no tab: they always show notation, also in "tab only" view.
    const keys = track.kind === 'keys'
    staff.isPercussion = drums
    staff.showTablature = !drums && !keys
    staff.showStandardNotation = !tabOnly || keys
    staff.showSlash = drums && tabOnly
    if (!drums && !keys) {
      // A tuning other than standard is listed under the title; a capo is noted over the first bar.
      staff.stringTuning = new Tuning(tuningPreset(track.tuning)?.name ?? '', [...track.tuning], isStandardTuning(track.tuning))
      staff.capo = track.capo ?? 0
      if (isStandardTuning(track.tuning)) hiddenTunings.set(trackIndex, false)
    }

    const trackBeats: alphaTab.model.Beat[][] = []
    // Ties, hammer-ons and slides only link to the beat right before or after (as in playback).
    const flat = track.bars.flatMap((b) => b.beats)
    const fretBefore = (k: number, string: number): number | undefined => flat[k - 1]?.notes.find((m) => m.string === string)?.fret
    const fretAfter = (k: number, string: number): number | undefined => flat[k + 1]?.notes.find((m) => m.string === string)?.fret
    let k = -1
    // Guitar is notated in treble clef, bass in bass clef, both an octave above how they sound.
    // Keys are notated as they sound, in bass clef when most notes are below middle C.
    const keyPitches = keys ? flat.flatMap((b) => b.notes.map((n) => track.tuning[n.string - 1])) : []
    const lowKeys = keyPitches.length > 0 && keyPitches.reduce((sum, p) => sum + p, 0) / keyPitches.length < 60
    const clef = drums ? Clef.Neutral : keys ? (lowKeys ? Clef.F4 : Clef.G2) : track.tuning.length <= 5 ? Clef.F4 : Clef.G2
    for (let barIndex = 0; barIndex < barCount; barIndex++) {
      const bar = new Bar()
      bar.clef = clef
      bar.clefOttava = drums || keys ? Ottavia.Regular : Ottavia._8vb
      staff.addBar(bar)
      const voice = new Voice()
      bar.addVoice(voice)

      const sourceBeats = track.bars[barIndex]?.beats ?? [{ value: 1 as const, dotted: false, notes: [] }]
      const barBeats: alphaTab.model.Beat[] = []
      sourceBeats.forEach((source, beatIndex) => {
        k++
        const beat = new Beat()
        beat.isEmpty = false
        beat.duration = DURATIONS[source.value]
        beat.dots = source.dotted ? 1 : 0
        if (beatIndex === 0) beat.text = partLabels.get(`${trackIndex}:${barIndex}`) ?? null
        for (const n of source.notes) {
          const note = new Note()
          if (drums) {
            note.percussionArticulation = track.tuning[n.string - 1] + n.fret
            // Accents get ">", ghost notes parentheses.
            const strength = strengthOf(n.velocity)
            if (strength === 'accent') note.accentuated = AccentuationType.Normal
            note.isGhost = strength === 'ghost'
          } else if (keys) {
            const pitch = track.tuning[n.string - 1] + n.fret
            note.octave = Math.floor(pitch / 12)
            note.tone = pitch % 12
            note.isTieDestination = !!n.tie && fretBefore(k, n.string) === n.fret
          } else {
            // alphaTab numbers strings from the lowest (1); we number from the highest.
            note.string = track.tuning.length - n.string + 1
            note.fret = n.fret
            note.isTieDestination = !!n.tie && fretBefore(k, n.string) === n.fret
            const next = fretAfter(k, n.string)
            const legato = next !== undefined && next !== n.fret
            note.isHammerPullOrigin = !!n.hammer && legato
            if (n.slide && legato) note.slideOutType = SlideOutType.Legato
          }
          beat.addNote(note)
        }
        voice.addBeat(beat)
        barBeats.push(beat)
        refs.set(beat, { trackIndex, barIndex, beatIndex })
      })
      trackBeats.push(barBeats)
    }
    beats.push(trackBeats)
  })

  score.finish(settings)
  return { score, beats, refs }
}
