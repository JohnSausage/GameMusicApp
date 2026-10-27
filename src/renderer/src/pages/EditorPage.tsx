import { useCallback, useState } from 'react'
import type { GetEngine } from '../App'
import { HomeIcon, MenuIcon, RedoIcon, UndoIcon } from '../components/icons'
import { Menu } from '../components/Menu'
import { updateSong } from '../model/edit'
import { MidiPanel } from '../panels/MidiPanel'
import { ShortcutsDialog } from '../panels/ShortcutsDialog'
import { TabEditor } from '../panels/TabEditor'
import type { Project } from '../project/useProject'
import { setThemeChoice, THEME_CHOICES, useThemeChoice } from '../theme'

type Page = 'editor' | 'midi'

/** Places in the top bar that the tab editor fills with its own controls (transport, record, export). */
export interface HeaderSlots {
  transport: HTMLElement | null
  actions: HTMLElement | null
}

interface Props {
  project: Project
  getEngine: GetEngine
  saveStatus: string
  onSave: (saveAs: boolean) => void
  onHome: () => void
}

export function EditorPage({ project, getEngine, saveStatus, onSave, onHome }: Props): React.JSX.Element {
  const [page, setPage] = useState<Page>('editor')
  const themeChoice = useThemeChoice()
  const [shortcuts, setShortcuts] = useState(false)
  const [transport, setTransport] = useState<HTMLElement | null>(null)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  const { song, cursor } = project
  const showShortcuts = useCallback(() => setShortcuts(true), [])

  return (
    <div className="app">
      <header className="editor-header">
        <button className="icon-button" onClick={onHome} title="Back to the start page" aria-label="Back to the start page">
          <HomeIcon />
        </button>
        <input
          className="song-title"
          value={song.title}
          aria-label="Song title"
          title="Song title"
          onChange={(e) => project.apply(updateSong(song, cursor, { title: e.target.value }), { mergeKey: 'title' })}
        />
        <label className="tempo" title="Tempo in beats per minute">
          <span aria-hidden="true">♩ =</span>
          <input
            type="number"
            min={20}
            max={400}
            value={song.tempo}
            aria-label="Tempo"
            onChange={(e) => {
              const tempo = Number(e.target.value)
              if (tempo >= 20 && tempo <= 400) project.apply(updateSong(song, cursor, { tempo }), { mergeKey: 'tempo' })
            }}
          />
        </label>
        <span className="muted" title="Time signature">{song.timeSignature.join('/')}</span>

        {page === 'editor' ? (
          <div className="header-group" ref={setTransport} />
        ) : (
          <button onClick={() => setPage('editor')}>← Back to the tab editor</button>
        )}

        <span className="spacer" />
        {saveStatus && <span className="muted small">{saveStatus}</span>}
        <div className="segmented">
          <button className="icon-button" onClick={project.undo} disabled={!project.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
            <UndoIcon />
          </button>
          <button className="icon-button" onClick={project.redo} disabled={!project.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
            <RedoIcon />
          </button>
        </div>
        {page === 'editor' && <div className="header-group" ref={setActions} />}
        <button
          className={`save-button ${project.dirty ? 'dirty' : ''}`}
          onClick={() => onSave(false)}
          title={project.dirty ? 'Save (Ctrl+S) – there are unsaved changes' : 'Save (Ctrl+S)'}
        >
          Save
        </button>
        <Menu
          label={<MenuIcon />}
          title="More"
          align="right"
          chevron={false}
          className="icon-menu"
          items={[
            { label: 'Save as…', shortcut: 'Ctrl+Shift+S', onSelect: () => onSave(true) },
            'separator',
            { label: 'MIDI keyboard and audio latency', onSelect: () => setPage('midi') },
            { label: 'Keyboard shortcuts', shortcut: '?', onSelect: showShortcuts },
            'separator',
            ...THEME_CHOICES.map((t) => ({ label: `${t.label} mode`, title: t.title, checked: themeChoice === t.value, onSelect: () => setThemeChoice(t.value) })),
            'separator',
            { label: 'Start page', onSelect: onHome }
          ]}
        />
      </header>
      <main>
        {page === 'editor' && <TabEditor project={project} getEngine={getEngine} headerSlots={{ transport, actions }} onShowShortcuts={showShortcuts} />}
        {page === 'midi' && <MidiPanel getEngine={getEngine} />}
      </main>
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </div>
  )
}
