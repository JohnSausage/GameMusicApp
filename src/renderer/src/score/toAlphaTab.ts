import * as alphaTab from '@coderline/alphatab'
import type { NoteValue, Song } from '../model/song'

const { Automation, Bar, Beat, Clef, Duration, MasterBar, Note, Ottavia, Score, Track, Tuning, Voice } = alphaTab.model

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
 */
export function songToAlphaTab(song: Song, settings: alphaTab.Settings): ConvertedScore {
  const score = new Score()
  score.title = song.title
  const barCount = Math.max(1, ...song.tracks.map((t) => t.bars.length))

  for (let i = 0; i < barCount; i++) {
    const masterBar = new MasterBar()
    masterBar.timeSignatureNumerator = song.timeSignature[0]
    masterBar.timeSignatureDenominator = song.timeSignature[1]
    if (i === 0) masterBar.tempoAutomations.push(Automation.buildTempoAutomation(false, 0, song.tempo, 2))
    score.addMasterBar(masterBar)
  }

  const beats: alphaTab.model.Beat[][][] = []
  const refs = new Map<alphaTab.model.Beat, BeatRef>()

  song.tracks.forEach((track, trackIndex) => {
    const atTrack = new Track()
    atTrack.name = track.name
    atTrack.shortName = track.name.slice(0, 5)
    score.addTrack(atTrack)
    atTrack.ensureStaveCount(1)
    const staff = atTrack.staves[0]
    staff.showTablature = true
    staff.showStandardNotation = true
    staff.stringTuning = new Tuning('', [...track.tuning], false)

    const trackBeats: alphaTab.model.Beat[][] = []
    // Guitar is notated in treble clef, bass in bass clef, both an octave above how they sound.
    const clef = track.tuning.length <= 5 ? Clef.F4 : Clef.G2
    for (let barIndex = 0; barIndex < barCount; barIndex++) {
      const bar = new Bar()
      bar.clef = clef
      bar.clefOttava = Ottavia._8vb
      staff.addBar(bar)
      const voice = new Voice()
      bar.addVoice(voice)

      const sourceBeats = track.bars[barIndex]?.beats ?? [{ value: 1 as const, dotted: false, notes: [] }]
      const barBeats: alphaTab.model.Beat[] = []
      sourceBeats.forEach((source, beatIndex) => {
        const beat = new Beat()
        beat.isEmpty = false
        beat.duration = DURATIONS[source.value]
        beat.dots = source.dotted ? 1 : 0
        for (const n of source.notes) {
          const note = new Note()
          // alphaTab numbers strings from the lowest (1); we number from the highest.
          note.string = track.tuning.length - n.string + 1
          note.fret = n.fret
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
