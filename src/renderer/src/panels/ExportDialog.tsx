import { Fragment, useEffect, useState } from 'react'
import { renderSongOffline } from '../audio/offline'
import { audioBufferToWav16 } from '../audio/wav'
import { beatMap, beatMapFileName, beatMapJson } from '../model/beatMap'
import { sectionRanges, type BarRange } from '../model/edit'
import { audibleTracks, barCount, type Song } from '../model/song'
import { mixFileName, stemName, stemsOf, stemSong, tracksWithNotes, type Stem } from '../model/stems'
import { barSeconds, EXPORT_TAIL_SECONDS, exportFrameCount, type ExportEnding } from '../model/timing'
import { saveFile, saveFiles, type NamedFile } from '../platform'
import { readPref, writePref } from '../prefs'

interface Props {
  song: Song
  /** Bars of the selection, or of the bar at the cursor. */
  bars: BarRange
  /** Section the cursor is in, if any. */
  section: string | null
  /** Puts a track into the stem with this name (empty: its own). An edit of the song, saved with it. */
  onStemName: (trackIndex: number, name: string) => void
  onClose: (message?: string) => void
}

const RATES = [48000, 44100]

/** Remembered for the next export: the mix or stems, the mix next to the stems, and a beat map with them. */
interface Settings {
  stems: boolean
  withMix: boolean
  withBeatMap: boolean
}

const SETTINGS_KEY = 'wavExport'
const DEFAULT_SETTINGS: Settings = { stems: false, withMix: false, withBeatMap: false }

/** WAV export of the whole song, a section or a bar range, as the mix or one file per track (REQUIREMENTS.md EXP-01…05, EXP-09). */
export function ExportDialog({ song, bars, section, onStemName, onClose }: Props): React.JSX.Element {
  const sections = sectionRanges(song)
  const total = barCount(song)
  const [choice, setChoice] = useState<string>(() => {
    const index = sections.findIndex((s) => s.name === section)
    return bars.end - bars.start > 1 ? 'bars' : index >= 0 ? `section:${index}` : 'song'
  })
  const [from, setFrom] = useState(bars.start + 1)
  const [to, setTo] = useState(bars.end)
  const [rate, setRate] = useState(48000)
  /** Until chosen by hand: ring out for the whole song, cut (loopable) for parts of it. */
  const [ending, setEnding] = useState<ExportEnding | null>(null)
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...readPref<Partial<Settings>>(SETTINGS_KEY, {}) }))
  const { stems, withMix, withBeatMap } = settings
  const change = (next: Partial<Settings>): void => setSettings((s) => ({ ...s, ...next }))
  /** The tracks picked for stems, by id; until changed by hand: the ones heard in the mix that play in the range. */
  const [picked, setPicked] = useState<Set<string> | null>(null)
  /** What the export is doing ("Rendering 2 of 5…"), or null. */
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const range: BarRange & { name: string | null } =
    choice === 'song'
      ? { start: 0, end: total, name: null }
      : choice === 'bars'
        ? { start: Math.min(from, to) - 1, end: Math.max(from, to), name: from === to ? `bar ${from}` : `bars ${Math.min(from, to)}-${Math.max(from, to)}` }
        : sections[Number(choice.slice(8))]
  const end: ExportEnding = ending ?? (choice === 'song' ? 'tail' : 'cut')
  const seconds = { start: range.start * barSeconds(song), end: range.end * barSeconds(song) }
  const frames = exportFrameCount(seconds, rate, end)
  const barsValid = choice !== 'bars' || (from >= 1 && to >= 1 && from <= total && to <= total)
  const heard = audibleTracks(song)
  const silent = song.tracks.filter((_, i) => !heard[i]).map((t) => t.name)
  const playing = tracksWithNotes(song, seconds)
  const pickedIds = picked ?? new Set(song.tracks.filter((_, i) => heard[i] && playing[i]).map((t) => t.id))
  const stemTracks = song.tracks.flatMap((track, i) => (pickedIds.has(track.id) ? [i] : []))
  const planned = stemsOf(song, range.name, stemTracks, withMix)
  /** The files of a stem export, with the tracks of stems that join several. */
  const stemFiles = [
    ...(planned.mixFileName ? [{ name: planned.mixFileName, note: 'the mix' }] : []),
    ...planned.stems.map((stem) => ({ name: stem.fileName, note: stem.trackIndexes.length > 1 ? stem.trackIndexes.map((i) => song.tracks[i].name).join(' + ') : null })),
    ...(withBeatMap ? [{ name: beatMapFileName(song, range.name), note: 'beat map' }] : [])
  ]
  /** The beat map of the exported files. */
  const beatMapFile = (mix: string | null, stemList: Stem[]): NamedFile => ({
    name: beatMapFileName(song, range.name),
    data: new TextEncoder().encode(beatMapJson(beatMap(song, range, { sampleRate: rate, ending: end, mix, stems: stemList })))
  })
  const pick = (id: string, on: boolean): void => {
    const next = new Set(pickedIds)
    if (on) next.add(id)
    else next.delete(id)
    setPicked(next)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const exportWav = async (): Promise<void> => {
    setBusy('Rendering…')
    setError('')
    try {
      const buffer = await renderSongOffline(song, rate, { range: seconds, ending: end })
      writePref(SETTINGS_KEY, settings)
      if (withBeatMap) {
        // The WAV and its beat map belong together: into a folder.
        const mix = mixFileName(song, range.name)
        const where = await saveFiles([{ name: mix, data: audioBufferToWav16(buffer) }, beatMapFile(mix, [])])
        if (where) onClose(`WAV and beat map saved in ${where}.`)
        else setBusy(null)
        return
      }
      const name = range.name ? `${song.title} - ${range.name}` : song.title
      const path = await saveFile(`${name}.wav`, audioBufferToWav16(buffer))
      if (path) onClose(`WAV saved: ${path}`)
      else setBusy(null)
    } catch (e) {
      setError(`WAV export failed: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(null)
    }
  }

  /** Each stem (and the mix, if wanted), all the same length, into a folder. */
  const exportStems = async (): Promise<void> => {
    setError('')
    try {
      const renders = [
        ...(planned.mixFileName ? [{ fileName: planned.mixFileName, song }] : []),
        ...planned.stems.map((stem) => ({ fileName: stem.fileName, song: stemSong(song, stem.trackIndexes) }))
      ]
      const files: NamedFile[] = []
      for (const [n, render] of renders.entries()) {
        setBusy(`Rendering ${n + 1} of ${renders.length}…`)
        const buffer = await renderSongOffline(render.song, rate, { range: seconds, ending: end })
        files.push({ name: render.fileName, data: audioBufferToWav16(buffer) })
      }
      if (withBeatMap) files.push(beatMapFile(planned.mixFileName, planned.stems))
      writePref(SETTINGS_KEY, settings)
      setBusy('Saving…')
      const where = await saveFiles(files)
      const count = planned.stems.length
      const saved = [`${count} ${count === 1 ? 'stem' : 'stems'}`, ...(planned.mixFileName ? ['the mix'] : []), ...(withBeatMap ? ['the beat map'] : [])]
      if (where) onClose(`${saved.length > 1 ? `${saved.slice(0, -1).join(', ')} and ${saved.at(-1)}` : saved[0]} saved in ${where}.`)
      else setBusy(null)
    } catch (e) {
      setError(`WAV export failed: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(null)
    }
  }

  const barCountText = (n: number): string => `${n} ${n === 1 ? 'bar' : 'bars'}`
  const close = (): void => {
    if (!busy) onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal export-dialog" role="dialog" aria-modal="true" aria-label="Export WAV">
        <button className="icon modal-close" aria-label="Close" title="Close (Esc)" onClick={close} disabled={busy !== null}>
          ×
        </button>
        <h2>Export WAV</h2>

        <div className="form-row">
          <label>
            What
            <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="What to export">
              <option value="song">Whole song ({barCountText(total)})</option>
              {sections.map((s, i) => (
                <option key={`${s.name}-${s.start}`} value={`section:${i}`}>
                  Section “{s.name}” (bars {s.start + 1}–{s.end})
                </option>
              ))}
              <option value="bars">Bars…</option>
            </select>
          </label>
          {choice === 'bars' && (
            <>
              <label>
                From bar
                <input type="number" min={1} max={total} value={from} onChange={(e) => setFrom(Number(e.target.value))} />
              </label>
              <label>
                To bar
                <input type="number" min={1} max={total} value={to} onChange={(e) => setTo(Number(e.target.value))} />
              </label>
            </>
          )}
          <label>
            Sample rate
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              {RATES.map((r) => (
                <option key={r} value={r}>{r / 1000} kHz, 16-bit</option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="choice-group">
          <legend>Files</legend>
          <label className="checkbox">
            <input type="radio" name="files" checked={!stems} onChange={() => change({ stems: false })} />
            <span>
              <strong>The mix,</strong> one file with every track you hear.
            </span>
          </label>
          <label className="checkbox">
            <input type="radio" name="files" checked={stems} onChange={() => change({ stems: true })} />
            <span>
              <strong>One file per track or group of tracks (stems),</strong> into a folder you choose. They are all exactly the same length, so in Unity they play together in sync: one
              AudioSource each, started at the same time, and fade a layer in or out (e.g. the drums when a fight starts). Files there with the same names are replaced,
              so exporting again updates them in your game.
            </span>
          </label>
          <label className="checkbox beat-map-option">
            <input type="checkbox" checked={withBeatMap} onChange={(e) => change({ withBeatMap: e.target.checked })} />
            <span>
              <strong>Also a beat map (JSON)</strong> with the tempo, the time signature and where the sections are, in seconds and bars, for game scripts that follow
              the music (e.g. Export → Unity player script).{!stems && ' The WAV and the beat map go into a folder you choose.'}
            </span>
          </label>
        </fieldset>

        {stems && (
          <fieldset className="choice-group stem-tracks">
            <legend>Tracks and their stems</legend>
            {song.tracks.map((track, i) => (
              <div key={track.id} className="stem-track">
                <label className="checkbox">
                  <input type="checkbox" checked={pickedIds.has(track.id)} onChange={(e) => pick(track.id, e.target.checked)} />
                  <span>
                    {track.name}
                    {!heard[i] ? <span className="muted"> · muted</span> : !playing[i] && <span className="muted"> · no notes here</span>}
                  </span>
                </label>
                <input
                  className="stem-name"
                  value={track.stem ?? ''}
                  placeholder={stemName({ ...track, stem: undefined }, i)}
                  disabled={!pickedIds.has(track.id)}
                  aria-label={`Stem of ${track.name}`}
                  title="The stem this track goes into. Tracks with the same stem name share one file; empty: its own, named after the track. Saved with the project."
                  onChange={(e) => onStemName(i, e.target.value)}
                />
              </div>
            ))}
            <p className="muted small stem-help">Tracks with the same stem name go into one file, e.g. “Rhythm” for the drums and the bass.</p>
            <label className="checkbox stem-mix">
              <input type="checkbox" checked={withMix} onChange={(e) => change({ withMix: e.target.checked })} />
              <span>
                <strong>Also the mix</strong> of every track you hear, in the same folder.
              </span>
            </label>
          </fieldset>
        )}

        <fieldset className="choice-group">
          <legend>Ending</legend>
          <label className="checkbox">
            <input type="radio" name="ending" checked={end === 'cut'} onChange={() => setEnding('cut')} />
            <span>
              <strong>Cut at the end, for looping.</strong> Ends exactly at the last bar line with a tiny fade, so it loops without a gap (in Unity: tick <em>Loop</em> on
              the AudioSource). Notes still ringing at the end are cut off.
            </span>
          </label>
          <label className="checkbox">
            <input type="radio" name="ending" checked={end === 'tail'} onChange={() => setEnding('tail')} />
            <span>
              <strong>Let notes ring out.</strong> Adds {EXPORT_TAIL_SECONDS} s after the last bar, e.g. for a song that plays once.
            </span>
          </label>
        </fieldset>

        <p className="muted small">
          {barCountText(range.end - range.start)} · {(seconds.end - seconds.start).toFixed(2)} s{end === 'tail' ? ` + ${EXPORT_TAIL_SECONDS} s` : ''} · {frames.toLocaleString('en-US')} samples per
          channel, stereo
          {stems
            ? stemFiles.length > 0 && (
                <>
                  {' '}
                  · Files:{' '}
                  {stemFiles.map((file, i) => (
                    <Fragment key={file.name}>
                      {i > 0 && ', '}
                      <span className="stem-file">{file.name}</span>
                      {file.note && ` (${file.note})`}
                    </Fragment>
                  ))}
                </>
              )
            : (
                <>
                  {silent.length > 0 && <> · Muted, left out: {silent.join(', ')}</>}
                  {withBeatMap && (
                    <>
                      {' '}
                      · Files: <span className="stem-file">{mixFileName(song, range.name)}</span>, <span className="stem-file">{beatMapFileName(song, range.name)}</span> (beat map)
                    </>
                  )}
                </>
              )}
        </p>
        {error && <p className="warning dialog-error">{error}</p>}

        <div className="toolbar dialog-actions">
          <span className="spacer" />
          <button onClick={close} disabled={busy !== null}>Cancel</button>
          <button
            className="active"
            disabled={busy !== null || !barsValid || (stems && stemTracks.length === 0)}
            title={stems && stemTracks.length === 0 ? 'Tick the tracks to export' : undefined}
            onClick={() => void (stems ? exportStems() : exportWav())}
          >
            {busy ?? 'Export…'}
          </button>
        </div>
      </div>
    </div>
  )
}
