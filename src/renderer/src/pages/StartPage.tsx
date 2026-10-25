import { useEffect, useState } from 'react'
import type { NewSongOptions } from '../model/edit'
import type { TrackKind } from '../model/song'
import type { RecentProject } from '../platform'
import type { ProjectStorage } from '../project/storage'

interface Props {
  storage: ProjectStorage
  error: string
  onCreate: (options: NewSongOptions) => void
  onOpen: (path?: string) => void
  onOpenDemo: () => void
}

const TIME_SIGNATURES: [number, number][] = [
  [4, 4],
  [3, 4],
  [2, 4],
  [6, 8]
]

function fileName(path: string): string {
  if (path.startsWith('browser:')) return 'Stored in this browser'
  return path.split(/[\\/]/).pop() ?? path
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  const today = new Date().toDateString() === date.toDateString()
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return today ? `Today, ${time}` : `${date.toLocaleDateString()}, ${time}`
}

function NewProjectForm({ onCreate, onCancel }: { onCreate: (options: NewSongOptions) => void; onCancel: () => void }): React.JSX.Element {
  const [title, setTitle] = useState('Untitled')
  const [tempo, setTempo] = useState(120)
  const [signature, setSignature] = useState(0)
  const [firstTrack, setFirstTrack] = useState<TrackKind>('guitar')

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    onCreate({ title: title.trim() || 'Untitled', tempo: Math.min(400, Math.max(20, tempo || 120)), timeSignature: TIME_SIGNATURES[signature], firstTrack })
  }

  return (
    <form className="card new-project" onSubmit={submit}>
      <h3>New project</h3>
      <div className="form-row">
        <label>
          Title
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
        <label>
          Tempo (BPM)
          <input type="number" min={20} max={400} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} />
        </label>
        <label>
          Time signature
          <select value={signature} onChange={(e) => setSignature(Number(e.target.value))}>
            {TIME_SIGNATURES.map(([beats, unit], i) => (
              <option key={i} value={i}>{beats}/{unit}</option>
            ))}
          </select>
        </label>
        <label>
          First track
          <select value={firstTrack} onChange={(e) => setFirstTrack(e.target.value as TrackKind)}>
            <option value="guitar">Guitar</option>
            <option value="bass">Bass</option>
          </select>
        </label>
      </div>
      <div className="toolbar">
        <button type="submit" className="active">Create</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export function StartPage({ storage, error, onCreate, onOpen, onOpenDemo }: Props): React.JSX.Element {
  const [recent, setRecent] = useState<RecentProject[] | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = (): void => {
    void storage.listRecent().then(setRecent)
  }
  useEffect(refresh, [storage])

  const remove = async (path: string): Promise<void> => {
    await storage.removeRecent(path)
    refresh()
  }

  return (
    <div className="start-page">
      <header className="start-header">
        <h1>GameMusicApp</h1>
        <p className="muted">Compose game music on guitar.</p>
      </header>

      <div className="toolbar">
        <button className="active" onClick={() => setCreating(true)}>New project</button>
        <button onClick={() => onOpen()}>Open project…</button>
        <button onClick={onOpenDemo}>Open demo song</button>
      </div>
      {creating && <NewProjectForm onCreate={(options) => onCreate(options)} onCancel={() => setCreating(false)} />}
      {error && <p className="warning">{error}</p>}

      <h2>Recent projects</h2>
      {recent === null ? null : recent.length === 0 ? (
        <p className="muted">No projects yet. Create one, or open the demo song to try the editor.</p>
      ) : (
        <ul className="recent-list">
          {recent.map((project) => (
            <li key={project.path}>
              <button className="recent-item" disabled={project.missing} onClick={() => onOpen(project.path)} title={project.path}>
                <strong>{project.title}</strong>
                <span className="muted">{project.missing ? 'File not found' : fileName(project.path)}</span>
                <span className="muted">{formatDate(project.openedAt)}</span>
              </button>
              <button className="icon" title="Remove from list" aria-label={`Remove ${project.title} from the list`} onClick={() => void remove(project.path)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

