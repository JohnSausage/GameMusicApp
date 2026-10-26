import { useEffect } from 'react'

type Row = [keys: string[], what: string]

/** Keys of the tab editor, grouped (REQUIREMENTS.md EDIT-17 cheat sheet). "+" inside a key joins keys pressed together. */
const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: 'Move around',
    rows: [
      [['←', '→'], 'Previous / next beat'],
      [['↑', '↓'], 'String above / below (drums: kit piece)'],
      [['Ctrl+←', 'Ctrl+→'], 'Previous / next bar'],
      [['Ctrl+↑', 'Ctrl+↓'], 'Previous / next track']
    ]
  },
  {
    title: 'Notes',
    rows: [
      [['0', '…', '9'], 'Fret (two digits quickly for 10–24); drums: a hit'],
      [['X'], 'Drums: a hit'],
      [['+', '−'], 'Longer / shorter note'],
      [['.'], 'Dotted'],
      [['R'], 'Make the beat a rest'],
      [['Del'], 'Remove the note (on a rest: the rest)'],
      [['Shift+Del'], 'Remove the beat; the rest of the bar moves up']
    ]
  },
  {
    title: 'Techniques',
    rows: [
      [['T'], 'Hold the note before through this beat (tie)'],
      [['H'], 'Hammer-on / pull-off into the next note'],
      [['S'], 'Slide into the next note']
    ]
  },
  {
    title: 'Select, copy and bars',
    rows: [
      [['Shift+click'], 'Select from the cursor to there (or drag a box)'],
      [['Shift+←', 'Shift+→'], 'Grow the selection'],
      [['Ctrl+A'], 'Select the whole track'],
      [['Esc'], 'Clear the selection'],
      [['Ctrl+C', 'Ctrl+X', 'Ctrl+V'], 'Copy, cut, paste'],
      [['Ctrl+D'], 'Duplicate the bar'],
      [['Insert'], 'Insert a bar before this one'],
      [['Ctrl+Del'], 'Delete the bar']
    ]
  },
  {
    title: 'Play and view',
    rows: [
      [['Space'], 'Play from the cursor / stop'],
      [['L'], 'Loop on / off'],
      [['M'], 'Metronome on / off'],
      [['Ctrl++', 'Ctrl+−', 'Ctrl+0'], 'Zoom in, out, back to 100 % (also Ctrl+wheel)']
    ]
  },
  {
    title: 'Song',
    rows: [
      [['Ctrl+Z', 'Ctrl+Y'], 'Undo / redo'],
      [['Ctrl+S'], 'Save'],
      [['Ctrl+Shift+S'], 'Save as'],
      [['?'], 'This list']
    ]
  },
  {
    title: 'Drum grid',
    rows: [
      [['Click'], 'Add or remove a hit'],
      [['Shift+click'], 'Accent'],
      [['Alt+click'], 'Ghost note']
    ]
  }
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === '?') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal shortcuts-dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <button className="icon modal-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
        <h2>Keyboard shortcuts</h2>
        <div className="shortcut-groups">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <table>
                <tbody>
                  {group.rows.map(([keys, what]) => (
                    <tr key={what}>
                      <td>
                        {keys.map((key, i) => (
                          <span key={key}>
                            {i > 0 && ' '}
                            {key === '…' ? '…' : <kbd>{key}</kbd>}
                          </span>
                        ))}
                      </td>
                      <td>{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
