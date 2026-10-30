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
      [['/'], 'Triplet: three notes in the time of two'],
      [['R'], 'Make the beat a rest'],
      [['Del'], 'Remove the note (on a rest: the rest)'],
      [['Shift+Del'], 'Remove the beat; the rest of the bar moves up'],
      [['Alt+↑', 'Alt+↓'], 'Transpose the selection (or the beat) a semitone up / down; Edit → Transpose… for more'],
      [['Shift+↑', 'Shift+↓'], 'Move the note to the string above / below, keeping its pitch']
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
      [['Ctrl+Tab'], 'Next tab: Score, Arrangement, Sound effects (Ctrl+Shift+Tab goes back)'],
      [['Ctrl++', 'Ctrl+−', 'Ctrl+0'], 'Zoom in, out, back to 100 % (also Ctrl+wheel)']
    ]
  },
  {
    title: 'Arrangement',
    rows: [
      [['←', '→'], 'Previous / next section'],
      [['↑', '↓'], 'Track above / below'],
      [['Alt+←', 'Alt+→'], 'Move the section earlier / later'],
      [['Ctrl+D'], 'Duplicate the section (a repeat with the same parts)'],
      [['Ctrl+Del'], 'Delete the section'],
      [['Del'], 'Make the track silent in this section'],
      [['Enter'], 'Edit the selected part under the grid'],
      [['Esc'], 'In the part under the grid: back to the grid'],
      [['Double-click'], 'Show the section in the score, with all tracks'],
      [['Drag a part'], 'Onto a section of its track (from the grid or the palette): play it there too'],
      [['Drag a section'], 'By its name: move it; by its right edge: change its length'],
      [['Esc'], 'Cancel a drag']
    ]
  },
  {
    title: 'Sound effects',
    rows: [
      [['1', '…', '9'], 'Play sound effect 1–9 of the list, also over the song (start the song with ▶ at the top)'],
      [['Space'], 'Play the picked sound effect from the cursor / stop']
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
    title: 'Keys and MIDI keyboard',
    rows: [
      [['Drag'], 'Piano roll: draw a note'],
      [['Click'], 'Piano roll: remove a note'],
      [['Space'], 'While recording MIDI: stop the recording'],
      [['MIDI keys'], 'With Step input on: enter notes at the cursor (chords: together)']
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
