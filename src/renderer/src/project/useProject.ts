import { useCallback, useState } from 'react'
import { clampCursor, type Cursor, type EditResult } from '../model/edit'
import type { Song } from '../model/song'

const MAX_UNDO = 200

interface Snapshot {
  song: Song
  cursor: Cursor
}

interface ProjectState extends Snapshot {
  path: string | null
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
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  /** Applies an edit; returns false when the edit wasn't possible. */
  apply: (result: EditResult | null, options?: ApplyOptions) => boolean
  setCursor: (cursor: Cursor) => void
  undo: () => void
  redo: () => void
  markSaved: (path: string, song: Song) => void
}

const START_CURSOR: Cursor = { track: 0, bar: 0, beat: 0, string: 1 }

/** Holds the open project with undo/redo (EDIT-05). */
export function useProject(): {
  project: Project | null
  openProject: (song: Song, path: string | null, saved: boolean) => void
  closeProject: () => void
} {
  const [state, setState] = useState<ProjectState | null>(null)

  const openProject = useCallback((song: Song, path: string | null, saved: boolean) => {
    setState({ song, cursor: START_CURSOR, path, savedSong: saved ? song : null, past: [], future: [], lastMergeKey: null })
  }, [])

  const closeProject = useCallback(() => setState(null), [])

  if (!state) return { project: null, openProject, closeProject }

  const apply = (result: EditResult | null, options: ApplyOptions = {}): boolean => {
    if (!result) return false
    setState((s) => {
      if (!s) return s
      const merge = options.mergeKey !== undefined && options.mergeKey === s.lastMergeKey && s.past.length > 0
      const past = merge ? s.past : [...s.past, { song: s.song, cursor: s.cursor }].slice(-MAX_UNDO)
      return { ...s, song: result.song, cursor: result.cursor, past, future: [], lastMergeKey: options.mergeKey ?? null }
    })
    return true
  }

  const project: Project = {
    song: state.song,
    cursor: state.cursor,
    path: state.path,
    dirty: state.song !== state.savedSong,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    apply,
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
    markSaved: (path, song) => setState((s) => (s ? { ...s, path, savedSong: song } : s))
  }
  return { project, openProject, closeProject }
}
