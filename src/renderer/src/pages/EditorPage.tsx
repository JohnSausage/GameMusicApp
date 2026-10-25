import { useState } from 'react'
import type { GetEngine } from '../App'
import type { Take } from '../audio/recorder'
import { updateSong } from '../model/edit'
import { MidiPanel } from '../panels/MidiPanel'
import { RecordPanel } from '../panels/RecordPanel'
import { TabEditor } from '../panels/TabEditor'
import { TranscriptionPanel } from '../panels/TranscriptionPanel'
import type { Project } from '../project/useProject'

const TABS = ['Tab editor', 'Record & import', 'MIDI keyboard', 'Transcription lab'] as const
type Tab = (typeof TABS)[number]

interface Props {
  project: Project
  getEngine: GetEngine
  saveStatus: string
  onSave: (saveAs: boolean) => void
  onHome: () => void
  take: Take | null
  onTake: (take: Take) => void
}

export function EditorPage({ project, getEngine, saveStatus, onSave, onHome, take, onTake }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('Tab editor')
  const { song, cursor } = project

  const useInLab = (t: Take): void => {
    onTake(t)
    setTab('Transcription lab')
  }

  return (
    <div className="app">
      <header className="editor-header">
        <button onClick={onHome} title="Back to the start page">⌂ Home</button>
        <input
          className="song-title"
          value={song.title}
          aria-label="Song title"
          onChange={(e) => project.apply(updateSong(song, cursor, { title: e.target.value }), { mergeKey: 'title' })}
        />
        <label className="inline">
          Tempo
          <input
            type="number"
            min={20}
            max={400}
            value={song.tempo}
            onChange={(e) => {
              const tempo = Number(e.target.value)
              if (tempo >= 20 && tempo <= 400) project.apply(updateSong(song, cursor, { tempo }), { mergeKey: 'tempo' })
            }}
          />
        </label>
        <span className="muted" title="Time signature">{song.timeSignature.join('/')}</span>
        <button onClick={() => onSave(false)} title="Save (Ctrl+S)">Save</button>
        <button onClick={() => onSave(true)} title="Save as (Ctrl+Shift+S)">Save as…</button>
        <button onClick={project.undo} disabled={!project.canUndo} title="Undo (Ctrl+Z)">↶</button>
        <button onClick={project.redo} disabled={!project.canRedo} title="Redo (Ctrl+Y)">↷</button>
        <span className="muted small">{saveStatus || (project.dirty ? 'Unsaved changes' : project.path ? 'Saved' : '')}</span>
        <nav>
          {TABS.map((t) => (
            <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'Tab editor' && <TabEditor project={project} getEngine={getEngine} />}
        {tab === 'Record & import' && <RecordPanel getEngine={getEngine} take={take} onTake={onTake} onUseInLab={useInLab} />}
        {tab === 'MIDI keyboard' && <MidiPanel getEngine={getEngine} />}
        {tab === 'Transcription lab' && <TranscriptionPanel getEngine={getEngine} take={take} onTake={onTake} />}
      </main>
    </div>
  )
}
