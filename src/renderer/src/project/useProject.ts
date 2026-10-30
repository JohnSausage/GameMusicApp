import { useCallback, useEffect, useState } from 'react'
import { arrange, partSong, setPartBars, syncArrangement, type PartRef } from '../model/arrangement'
import { clampCursor, type Cursor, type EditResult } from '../model/edit'
import { EFFECT_CURSOR, effectSong, findEffect, setEffectSong } from '../model/effects'
import type { ProjectAudio, Song } from '../model/song'
import { hasVoices, swapVoices, unswapVoices } from '../model/voices'
import { lastLayout, rememberLayout, sameLayout, type Layout } from './layout'

const MAX_UNDO = 200

interface Snapshot {
  song: Song
  cursor: Cursor
}

interface ProjectState extends Snapshot {
  path: string | null
  /** Take audio by id. Not part of undo: takes are only ever added; saving drops unused ones. */
  audio: ProjectAudio
  /** The song as last saved or opened; differs from `song` when there are unsaved changes. */
  savedSong: Song | null
  /** Saved with the project, but not part of undo: changing the view isn't an edit. */
  layout: Layout
  savedLayout: Layout
  past: Snapshot[]
  future: Snapshot[]
  /** Consecutive edits with the same key (typing a title, two-digit frets) undo as one step. */
  lastMergeKey: string | null
  /** The part edited on its own in the arrangement, and the cursor in it. Not part of undo. */
  partEdit: (PartRef & { cursor: Cursor }) | null
  /** The sound effect edited, and the cursor in it. Not part of undo. */
  effectEdit: { id: string; cursor: Cursor } | null
}

export interface ApplyOptions {
  mergeKey?: string
}

export interface Project {
  song: Song
  cursor: Cursor
  path: string | null
  audio: ProjectAudio
  layout: Layout
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  /** Applies an edit; returns false when the edit wasn't possible. */
  apply: (result: EditResult | null, options?: ApplyOptions) => boolean
  /**
   * Applies an edit computed from the newest song and cursor, e.g. for MIDI notes
   * that arrive faster than the screen updates. `change` returns null for no edit.
   */
  update: (change: (song: Song, cursor: Cursor) => EditResult | null, options?: ApplyOptions) => void
  setCursor: (cursor: Cursor) => void
  /** Changes the layout (from the newest one when given a function). */
  setLayout: (change: Partial<Layout> | ((layout: Layout) => Partial<Layout>)) => void
  undo: () => void
  redo: () => void
  markSaved: (path: string, song: Song, layout: Layout) => void
  addTakeAudio: (id: string, samples: Float32Array) => void
  /**
   * The part edited on its own, as a project of its own: its song is just that
   * part (see partSong), with its own cursor. Its edits go into the part, as
   * edits of this project (one undo history). Null when no part is edited.
   */
  part: Project | null
  /** Which part `part` is. */
  editedPart: PartRef | null
  /** Picks the part to edit on its own, or none. */
  editPart: (ref: PartRef | null) => void
  /** The sound effect edited, as a project of its own like `part` (see effectSong). */
  effect: Project | null
  /** Which sound effect `effect` is, by id. */
  editedEffect: string | null
  editEffect: (id: string | null) => void
}

/** A piece of the song edited as a project of its own (a part, a sound effect): where its song and cursor are. */
interface Piece {
  /** Its song, or null when it is gone (e.g. deleted, or undone). */
  own: (s: ProjectState) => Song | null
  /** The project's song with the piece's edited song put back. */
  put: (s: ProjectState, edited: Song) => Song
  cursor: (s: ProjectState) => Cursor
  withCursor: (s: ProjectState, cursor: Cursor) => ProjectState
}

const partPiece: Piece = {
  own: (s) => (s.partEdit && partSong(s.song, s.partEdit)) || null,
  put: (s, edited) => setPartBars(s.song, s.partEdit!, edited.tracks[0].bars),
  cursor: (s) => s.partEdit!.cursor,
  withCursor: (s, cursor) => ({ ...s, partEdit: { ...s.partEdit!, cursor } })
}

const effectPiece: Piece = {
  own: (s) => {
    const effect = s.effectEdit && findEffect(s.song, s.effectEdit.id)
    return effect ? effectSong(effect) : null
  },
  put: (s, edited) => setEffectSong(s.song, s.effectEdit!.id, edited),
  cursor: (s) => s.effectEdit!.cursor,
  withCursor: (s, cursor) => ({ ...s, effectEdit: { ...s.effectEdit!, cursor } })
}

const START_CURSOR: Cursor = { track: 0, bar: 0, beat: 0, string: 1 }

/** Holds the open project with undo/redo (EDIT-05). */
export function useProject(): {
  project: Project | null
  /** Without a layout (new projects, older files) the project gets the one used last. */
  openProject: (song: Song, path: string | null, saved: boolean, audio?: ProjectAudio, layout?: Layout) => void
  closeProject: () => void
} {
  const [state, setState] = useState<ProjectState | null>(null)

  const openProject = useCallback((opened: Song, path: string | null, saved: boolean, audio: ProjectAudio = new Map(), layout: Layout = lastLayout()) => {
    // Songs from before the arrangement get one, from their sections.
    const song = arrange(opened)
    setState({ song, cursor: START_CURSOR, path, audio, savedSong: saved ? song : null, layout, savedLayout: layout, past: [], future: [], lastMergeKey: null, partEdit: null, effectEdit: null })
  }, [])

  const closeProject = useCallback(() => setState(null), [])

  const layout = state?.layout
  useEffect(() => {
    if (layout) rememberLayout(layout)
  }, [layout])

  if (!state) return { project: null, openProject, closeProject }

  const applyTo = (s: ProjectState, result: EditResult, options: ApplyOptions): ProjectState => {
    const merge = options.mergeKey !== undefined && options.mergeKey === s.lastMergeKey && s.past.length > 0
    const past = merge ? s.past : [...s.past, { song: s.song, cursor: s.cursor }].slice(-MAX_UNDO)
    // Changed bars go back into their parts, and every repeat of a part follows. Edits of sound effects leave the tracks as they are.
    const song = result.song.tracks === s.song.tracks ? result.song : syncArrangement(s.song, result.song)
    return { ...s, song, cursor: result.cursor, past, future: [], lastMergeKey: options.mergeKey ?? null }
  }

  /** An edit of a piece edited on its own: it goes into the piece (one undo history), its cursor stays with the piece. */
  const applyToPiece = (piece: Piece, s: ProjectState, result: EditResult, options: ApplyOptions): ProjectState => {
    if (!piece.own(s)) return s
    return piece.withCursor(applyTo(s, { song: piece.put(s, result.song), cursor: s.cursor }, options), result.cursor)
  }

  const apply = (result: EditResult | null, options: ApplyOptions = {}): boolean => {
    if (!result) return false
    setState((s) => (s ? applyTo(s, result, options) : s))
    return true
  }

  const update = (change: (song: Song, cursor: Cursor) => EditResult | null, options: ApplyOptions = {}): void => {
    setState((s) => {
      const result = s ? change(s.song, s.cursor) : null
      return s && result ? applyTo(s, result, options) : s
    })
  }

  const project: Project = {
    song: state.song,
    cursor: state.cursor,
    path: state.path,
    audio: state.audio,
    layout: state.layout,
    dirty: state.song !== state.savedSong || !sameLayout(state.layout, state.savedLayout),
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    apply,
    update,
    setCursor: (cursor) => setState((s) => (s ? { ...s, cursor: clampCursor(s.song, cursor), lastMergeKey: null } : s)),
    setLayout: (change) => setState((s) => (s ? { ...s, layout: { ...s.layout, ...(typeof change === 'function' ? change(s.layout) : change) } } : s)),
    undo: () =>
      setState((s) => {
        const previous = s?.past.at(-1)
        if (!s || !previous) return s
        return { ...s, ...previous, past: s.past.slice(0, -1), future: [{ song: s.song, cursor: s.cursor }, ...s.future], lastMergeKey: null }
      }),
    redo: () =>
      setState((s) => {
        const next = s?.future[0]
        if (!s || !next) return s
        return { ...s, ...next, past: [...s.past, { song: s.song, cursor: s.cursor }], future: s.future.slice(1), lastMergeKey: null }
      }),
    markSaved: (path, song, layout) => setState((s) => (s ? { ...s, path, savedSong: song, savedLayout: layout } : s)),
    addTakeAudio: (id, samples) => setState((s) => (s ? { ...s, audio: new Map(s.audio).set(id, samples) } : s)),
    part: null,
    editedPart: null,
    editPart: (ref) =>
      setState((s) => {
        if (!s) return s
        if (!ref) return { ...s, partEdit: null }
        // The same part again keeps its cursor.
        const same = s.partEdit?.trackId === ref.trackId && s.partEdit.partId === ref.partId
        return same ? s : { ...s, partEdit: { ...ref, cursor: START_CURSOR }, lastMergeKey: null }
      }),
    effect: null,
    editedEffect: null,
    editEffect: (id) =>
      setState((s) => {
        if (!s || s.effectEdit?.id === id) return s
        return { ...s, effectEdit: id === null ? null : { id, cursor: EFFECT_CURSOR }, lastMergeKey: null }
      })
  }

  /** A piece as a project of its own: its song and cursor, with its edits going into the piece. */
  const pieceProject = (piece: Piece): Project | null => {
    const song = piece.own(state)
    if (!song) return null
    return {
      ...project,
      song,
      cursor: clampCursor(song, piece.cursor(state)),
      apply: (result, options = {}) => {
        if (!result) return false
        setState((s) => (s ? applyToPiece(piece, s, result, options) : s))
        return true
      },
      update: (change, options = {}) =>
        setState((s) => {
          const own = s && piece.own(s)
          const result = own ? change(own, clampCursor(own, piece.cursor(s!))) : null
          return s && result ? applyToPiece(piece, s, result, options) : s
        }),
      setCursor: (cursor) =>
        setState((s) => {
          const own = s && piece.own(s)
          return s && own ? { ...piece.withCursor(s, clampCursor(own, cursor)), lastMergeKey: null } : s
        })
    }
  }

  project.part = pieceProject(partPiece)
  if (project.part) project.editedPart = { trackId: state.partEdit!.trackId, partId: state.partEdit!.partId }
  project.effect = pieceProject(effectPiece)
  if (project.effect) project.editedEffect = state.effectEdit!.id
  return { project, openProject, closeProject }
}

/**
 * The project as the editor works on it in the second voice (EDIT-15), when the
 * cursor is there: its song with the voices swapped (see swapVoices), so every
 * edit works on the second voice; edits are swapped back, and the cursor stays in
 * the second voice. Otherwise the project itself.
 */
export function voiceProject(project: Project): Project {
  if (project.cursor.voice !== 2) return project
  const own = (song: Song, edited: Song, swapped: Song): Song => (edited === swapped ? song : unswapVoices(edited))
  const inVoice = (song: Song, cursor: Cursor): Cursor => (hasVoices(song.tracks[cursor.track] ?? {}) ? { ...cursor, voice: 2 } : cursor)
  const back = (song: Song, result: EditResult | null): EditResult | null => {
    if (!result) return null
    const edited = own(song, result.song, swapVoices(song))
    return { song: edited, cursor: inVoice(edited, result.cursor) }
  }
  const { voice: _, ...cursor } = project.cursor
  return {
    ...project,
    song: swapVoices(project.song),
    cursor,
    apply: (result, options) => project.apply(back(project.song, result), options),
    update: (change, options) =>
      project.update((song, c) => {
        const { voice: _, ...at } = c
        return back(song, change(swapVoices(song), at))
      }, options),
    setCursor: (c) => project.setCursor(inVoice(project.song, c))
  }
}
