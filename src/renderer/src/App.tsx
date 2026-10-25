import { useCallback, useRef, useState } from 'react'
import { AudioEngine } from './audio/engine'
import type { Take } from './audio/recorder'
import { MidiPanel } from './panels/MidiPanel'
import { RecordPanel } from './panels/RecordPanel'
import { ScorePanel } from './panels/ScorePanel'
import { TranscriptionPanel } from './panels/TranscriptionPanel'
import { isElectron } from './platform'

const TABS = ['Score & playback', 'Record & import', 'MIDI keyboard', 'Transcription lab'] as const
type Tab = (typeof TABS)[number]

export type GetEngine = () => Promise<AudioEngine>

export function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('Score & playback')
  const [take, setTake] = useState<Take | null>(null)
  const engine = useRef<Promise<AudioEngine> | null>(null)

  // Created on first use: browsers only start audio after a user gesture.
  const getEngine = useCallback<GetEngine>(() => (engine.current ??= AudioEngine.create()), [])

  const useInLab = (t: Take): void => {
    setTake(t)
    setTab('Transcription lab')
  }

  return (
    <div className="app">
      <header>
        <h1>GameMusicApp</h1>
        <span className="badge">M0 tech spike</span>
        <span className="muted">{isElectron ? `Electron · ${window.gameMusicApp!.platform}` : 'Browser preview'}</span>
        <nav>
          {TABS.map((t) => (
            <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'Score & playback' && <ScorePanel getEngine={getEngine} />}
        {tab === 'Record & import' && <RecordPanel getEngine={getEngine} take={take} onTake={setTake} onUseInLab={useInLab} />}
        {tab === 'MIDI keyboard' && <MidiPanel getEngine={getEngine} />}
        {tab === 'Transcription lab' && <TranscriptionPanel getEngine={getEngine} take={take} onTake={setTake} />}
      </main>
    </div>
  )
}
