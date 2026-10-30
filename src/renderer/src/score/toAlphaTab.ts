import * as alphaTab from '@coderline/alphatab'
import { partStarts } from '../model/arrangement'
import { strengthOf } from '../model/drums'
import { songKey } from '../model/keySignature'
import { repeatAt } from '../model/repeats'
import { timeSignatureAt, type Beat as SongBeat, type NoteValue, type Song } from '../model/song'
import { isStandardTuning, tuningPreset } from '../model/tuning'
import { hasVoices } from '../model/voices'

const { AccentuationType, Automation, SlideOutType, Bar, Beat, BendPoint, BendType, Clef, Duration, KeySignatureType, MasterBar, Note, Ottavia, Score, Section, Track, Tuning, Voice } = alphaTab.model

export interface BeatRef {
  trackIndex: number
  barIndex: number
  beatIndex: number
}

export interface ConvertedScore {
  score: alphaTab.model.Score
  /** alphaTab beat for each of our beats (of the voice edited): [track][bar][beat]. */
  beats: alphaTab.model.Beat[][][]
  /** Reverse lookup, used for click hit-testing: only the beats of the voice edited. */
  refs: Map<alphaTab.model.Beat, BeatRef>
}

const DURATIONS: Record<NoteValue, alphaTab.model.Duration> = {
  1: Duration.Whole,
  2: Duration.Half,
  4: Duration.Quarter,
  8: Duration.Eighth,
  16: Duration.Sixteenth,
  32: Duration.ThirtySecond,
  64: Duration.SixtyFourth
}

/**
 * Builds an alphaTab score from our song model. Our model stays the source of
 * truth; this is regenerated after every edit (REQUIREMENTS.md §6.1).
 * With `tabOnly`, fretted tracks show just their tab and drum tracks a rhythm
 * (slash) line, so every track stays visible and clickable. With `secondVoice`,
 * the song is one from swapVoices(), edited in the second voice (EDIT-15): its
 * `beats` are drawn as the second voice, stems down, and are the ones mapped.
 */
export function songToAlphaTab(song: Song, settings: alphaTab.Settings, tabOnly = false, secondVoice = false): ConvertedScore {
  const score = new Score()
  score.title = song.title
  // Shown under the title as "Music by …".
  score.music = song.author ?? ''
  const key = songKey(song)
  const barCount = Math.max(1, ...song.tracks.map((t) => t.bars.length))

  for (let i = 0; i < barCount; i++) {
    const masterBar = new MasterBar()
    // alphaTab shows a time signature where it changes, and a tempo where one is set.
    const [beats, unit] = timeSignatureAt(song, i)
    masterBar.timeSignatureNumerator = beats
    masterBar.timeSignatureDenominator = unit
    const tempo = i === 0 ? song.tempo : song.changes?.find((c) => c.bar === i)?.tempo
    if (tempo !== undefined) masterBar.tempoAutomations.push(Automation.buildTempoAutomation(false, 0, tempo, 2))
    // Repeat signs and endings (EDIT-14): an ending is a bit per time through (bit 0 = the first).
    const repeat = repeatAt(song, i)
    masterBar.isRepeatStart = !!repeat?.start
    masterBar.repeatCount = repeat?.times ?? 0
    masterBar.alternateEndings = (repeat?.ending ?? []).reduce((bits, n) => bits | (1 << (n - 1)), 0)
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
    // The beats edited are ours; the other voice is drawn with them. alphaTab's first voice has its stems up, the second down.
    const swapped = secondVoice && hasVoices(track)
    // A bar past the track's end is a whole rest.
    const rest: SongBeat[] = [{ value: 1, dotted: false, notes: [] }]
    const edited = Array.from({ length: barCount }, (_, i) => track.bars[i]?.beats ?? rest)
    const other = Array.from({ length: barCount }, (_, i) => track.bars[i]?.voice2)
    const [first, second] = swapped ? [other.map((v) => v ?? rest), edited] : [edited, other]
    const twoVoices = second.some((v) => v)
    // Guitar is notated in treble clef, bass in bass clef, both an octave above how they sound.
    // Keys are notated as they sound, in bass clef when most notes are below middle C.
    const keyPitches = keys ? track.bars.flatMap((b) => [...b.beats, ...(b.voice2 ?? [])].flatMap((beat) => beat.notes.map((n) => track.tuning[n.string - 1]))) : []
    const lowKeys = keyPitches.length > 0 && keyPitches.reduce((sum, p) => sum + p, 0) / keyPitches.length < 60
    const clef = drums ? Clef.Neutral : keys ? (lowKeys ? Clef.F4 : Clef.G2) : track.tuning.length <= 5 ? Clef.F4 : Clef.G2

    /** A voice's beats, bar by bar, as alphaTab beats. Ties, hammer-ons and slides only link to the beat right before or after (as in playback). */
    const convert = (voiceBars: (SongBeat[] | undefined)[], mapped: boolean, labelled: boolean): (alphaTab.model.Beat[] | null)[] => {
      const flat = voiceBars.flatMap((b) => b ?? [])
      const fretBefore = (k: number, string: number): number | undefined => flat[k - 1]?.notes.find((m) => m.string === string)?.fret
      const fretAfter = (k: number, string: number): number | undefined => flat[k + 1]?.notes.find((m) => m.string === string)?.fret
      let k = -1
      return Array.from({ length: barCount }, (_, barIndex) => {
        const sourceBeats = voiceBars[barIndex]
        if (!sourceBeats) return null
        return sourceBeats.map((source, beatIndex) => {
          k++
          const beat = new Beat()
          beat.isEmpty = false
          beat.duration = DURATIONS[source.value]
          beat.dots = source.dotted ? 1 : 0
          // Triplets: three in the time of two; alphaTab draws the bracket with the 3 over each group.
          if (source.triplet) {
            beat.tupletNumerator = 3
            beat.tupletDenominator = 2
          }
          if (beatIndex === 0 && labelled) beat.text = partLabels.get(`${trackIndex}:${barIndex}`) ?? null
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
              // Bend arrows, in quarter tones over the note (0–60): up, or up and back down.
              if (n.bend) {
                const up = n.bend * 2
                note.bendType = n.bendRelease ? BendType.BendRelease : BendType.Bend
                const points = n.bendRelease ? [[0, 0], [15, up], [30, up], [45, 0], [60, 0]] : [[0, 0], [15, up], [60, up]]
                for (const [offset, value] of points) note.addBendPoint(new BendPoint(offset, value))
              }
              note.isPalmMute = !!n.palmMute
              note.isDead = !!n.dead
            }
            beat.addNote(note)
          }
          if (mapped) refs.set(beat, { trackIndex, barIndex, beatIndex })
          return beat
        })
      })
    }
    const firstBeats = convert(first, !swapped, true)
    const secondBeats = twoVoices ? convert(second, swapped, false) : []

    for (let barIndex = 0; barIndex < barCount; barIndex++) {
      const bar = new Bar()
      bar.clef = clef
      bar.clefOttava = drums || keys ? Ottavia.Regular : Ottavia._8vb
      // Drums have no key; the other staves show the song's sharps or flats, and alphaTab writes the notes in that key.
      if (!drums) {
        bar.keySignature = key.fifths as alphaTab.model.KeySignature
        bar.keySignatureType = key.minor ? KeySignatureType.Minor : KeySignatureType.Major
      }
      staff.addBar(bar)
      for (const voiceBeats of twoVoices ? [firstBeats[barIndex], secondBeats[barIndex]] : [firstBeats[barIndex]]) {
        const voice = new Voice()
        bar.addVoice(voice)
        // A bar without a second voice gets an empty one: alphaTab gives every bar of a staff the same voices.
        if (voiceBeats) for (const beat of voiceBeats) voice.addBeat(beat)
        else {
          const empty = new Beat()
          empty.isEmpty = true
          voice.addBeat(empty)
        }
      }
      trackBeats.push((swapped ? secondBeats : firstBeats)[barIndex]!)
    }
    beats.push(trackBeats)
  })

  score.finish(settings)
  return { score, beats, refs }
}
