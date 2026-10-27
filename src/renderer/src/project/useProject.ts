import { useCallback, useState } from 'react'
import { clampCursor, type Cursor, type EditResult } from '../model/edit'
import type { ProjectAudio, Song } from '../model/song'

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
  past: Snapshot[]
  future: Snapshot[]
  /** Consecutive edits with the same key (typing a title, two-digit frets) undo as one step. */
  lastMergeKey: string | null
}

export interface ApplyOptions {
  mergeKey?: string
}

export interface Project {
  song: Song
  cursor: Cursor
  path: string | null
  audio: ProjectAudio
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
  undo: () => void
  redo: () => void
  markSaved: (path: string, song: Song) => void
  addTakeAudio: (id: string, samples: Float32Array) => void
}

const START_CURSOR: Cursor = { track: 0, bar: 0, beat: 0, string: 1 }

/** Holds the open project with undo/redo (EDIT-05). */
export function useProject(): {
  project: Project | null
  openProject: (song: Song, path: string | null, saved: boolean, audio?: ProjectAudio) => void
  closeProject: () => void
} {
  const [state, setState] = useState<ProjectState | null>(null)

  const openProject = useCallback((song: Song, path: string | null, saved: boolean, audio: ProjectAudio = new Map()) => {
    setState({ song, cursor: START_CURSOR, path, audio, savedSong: saved ? song : null, past: [], future: [], lastMergeKey: null })
  }, [])

  const closeProject = useCallback(() => setState(null), [])

  if (!state) return { project: null, openProject, closeProject }

  const applyTo = (s: ProjectState, result: EditResult, options: ApplyOptions): ProjectState => {
    const merge = options.mergeKey !== undefined && options.mergeKey === s.lastMergeKey && s.past.length > 0
    const past = merge ? s.past : [...s.past, { song: s.song, cursor: s.cursor }].slice(-MAX_UNDO)
    return { ...s, song: result.song, cursor: result.cursor, past, future: [], lastMergeKey: options.mergeKey ?? null }
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
    dirty: state.song !== state.savedSong,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    apply,
    update,
    setCursor: (cursor) => setState((s) => (s ? { ...s, cursor: clampCursor(s.song, cursor), lastMergeKey: null } : s)),
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
    markSaved: (path, song) => setState((s) => (s ? { ...s, path, savedSong: song } : s)),
    addTakeAudio: (id, samples) => setState((s) => (s ? { ...s, audio: new Map(s.audio).set(id, samples) } : s))
  }
  return { project, openProject, closeProject }
}
