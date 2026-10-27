import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioEngine } from './audio/engine'
import { createSong, type NewSongOptions } from './model/edit'
import { createDemoSong } from './model/song'
import { EditorPage } from './pages/EditorPage'
import { StartPage } from './pages/StartPage'
import { parseProject, ProjectFileError, serializeProject, suggestedFileName } from './project/projectFile'
import { createStorage } from './project/storage'
import { useProject } from './project/useProject'

export type GetEngine = () => Promise<AudioEngine>

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function App(): React.JSX.Element {
  const storage = useMemo(createStorage, [])
  const { project, openProject, closeProject } = useProject()
  const [startError, setStartError] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const engine = useRef<Promise<AudioEngine> | null>(null)

  // Created on first use: browsers only start audio after a user gesture.
  const getEngine = useCallback<GetEngine>(() => (engine.current ??= AudioEngine.create()), [])

  const dirty = project?.dirty ?? false
  const title = project?.song.title
  useEffect(() => storage.setDirty(dirty), [storage, dirty])
  useEffect(() => {
    document.title = title === undefined ? 'GameMusicApp' : `${title}${dirty ? ' •' : ''} – GameMusicApp`
  }, [title, dirty])

  useEffect(() => {
    if (!saveStatus) return
    const timer = window.setTimeout(() => setSaveStatus(''), 4000)
    return () => window.clearTimeout(timer)
  }, [saveStatus])

  const open = async (path?: string): Promise<void> => {
    setStartError('')
    try {
      const opened = await storage.open(path)
      if (!opened) return
      const { song, audio, layout } = parseProject(opened.data)
      await storage.recordRecent(opened.path, song.title)
      openProject(song, opened.path, true, audio, layout)
    } catch (error) {
      setStartError(error instanceof ProjectFileError ? error.message : `Could not open the project: ${errorText(error)}`)
    }
  }

  const create = (options: NewSongOptions): void => openProject(createSong(options), null, false)

  const save = async (saveAs: boolean): Promise<void> => {
    if (!project) return
    const { song, layout } = project
    try {
      const path = await storage.save(serializeProject(song, project.audio, layout), suggestedFileName(song.title), saveAs ? undefined : (project.path ?? undefined))
      if (!path) return
      project.markSaved(path, song, layout)
      await storage.recordRecent(path, song.title)
      setSaveStatus(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
    } catch (error) {
      setSaveStatus(`Save failed: ${errorText(error)}`)
    }
  }

  const goHome = (): void => {
    if (project?.dirty && !window.confirm('This project has unsaved changes. Close it without saving?')) return
    closeProject()
  }

  // Global shortcuts. Undo/redo are left to text fields while typing in them.
  useEffect(() => {
    if (!project) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      const target = event.target
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      if (key === 's') {
        event.preventDefault()
        void save(event.shiftKey)
      } else if (typing) {
        return
      } else if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        project.undo()
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault()
        project.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!project) {
    return <StartPage storage={storage} error={startError} onCreate={create} onOpen={(path) => void open(path)} onOpenDemo={() => openProject(createDemoSong(), null, true)} />
  }
  return (
    <EditorPage
      project={project}
      getEngine={getEngine}
      saveStatus={saveStatus}
      onSave={(saveAs) => void save(saveAs)}
      onHome={goHome}
    />
  )
}
