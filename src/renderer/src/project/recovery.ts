// Crash recovery (REQUIREMENTS.md PRJ-06): while the open project has unsaved
// changes, a copy of it is kept outside the project file, written a moment
// after the changes. Saving, or closing without saving, removes the copy. A
// copy that is still there when the app starts again (it crashed, was killed
// or the computer went off) is offered on the start page.
import { useEffect, useRef } from 'react'
import { serializeProject } from './projectFile'
import type { ProjectStorage } from './storage'
import type { Project } from './useProject'

/** The copy is written once changes pause for this long… */
export const RECOVERY_DELAY_MS = 2000
/** …or after this long of changes without a pause. */
export const RECOVERY_MAX_WAIT_MS = 15000

/** How long to wait before writing the copy, with changes waiting since `pendingSince`. */
export function recoveryWait(pendingSince: number, now: number): number {
  return Math.max(0, Math.min(RECOVERY_DELAY_MS, pendingSince + RECOVERY_MAX_WAIT_MS - now))
}

/** Keeps the copy of the project's unsaved changes under `id`, and removes it when there are none. */
export function useRecoveryCopy(storage: ProjectStorage, project: Project | null, id: string): void {
  /** When the changes not in the copy yet began. */
  const pendingSince = useRef<number | null>(null)
  const dirty = project?.dirty ?? false
  const song = project?.song
  const layout = project?.layout
  const audio = project?.audio
  const path = project?.path ?? null

  useEffect(() => {
    if (!dirty || !song || !layout || !audio) {
      pendingSince.current = null
      void storage.recovery.clear(id)
      return
    }
    const now = Date.now()
    pendingSince.current ??= now
    const timer = window.setTimeout(() => {
      pendingSince.current = null
      storage.recovery.write(id, serializeProject(song, audio, layout), song.title, path).catch((error) => console.warn('Could not keep a recovery copy:', error))
    }, recoveryWait(pendingSince.current, now))
    return () => window.clearTimeout(timer)
  }, [storage, id, dirty, song, layout, audio, path])
}
