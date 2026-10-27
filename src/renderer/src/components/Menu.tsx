import { useEffect, useRef, useState } from 'react'
import { ChevronDownIcon } from './icons'

export type MenuItem =
  | {
      label: string
      /** Shown on the right, e.g. "Ctrl+C". */
      shortcut?: string
      title?: string
      disabled?: boolean
      /** One of a set of choices: shows a check mark when true. */
      checked?: boolean
      onSelect: () => void
    }
  | 'separator'

interface Props {
  /** Button content. */
  label: React.ReactNode
  /** Accessible name and tooltip of the button. */
  title: string
  items: MenuItem[]
  /** Open to the left edge of the button (default) or align to its right edge. */
  align?: 'left' | 'right'
  className?: string
  /** Hide the small arrow, e.g. for an icon-only menu button. */
  chevron?: boolean
}

/** A button that opens a list of commands. Arrow keys move, Enter picks, Esc or a click outside closes. */
export function Menu({ label, title, items, align = 'left', className = '', chevron = true }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    listRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!open) return
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      setOpen(false)
      rootRef.current?.querySelector<HTMLButtonElement>('.menu-button')?.focus()
    } else if (event.key === 'ArrowDown') buttons[(index + 1) % buttons.length]?.focus()
    else if (event.key === 'ArrowUp') buttons[(index - 1 + buttons.length) % buttons.length]?.focus()
    else if (event.key === 'Tab') setOpen(false)
    else return
    // Keep keys inside the menu, e.g. away from the tab editor's shortcuts.
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div ref={rootRef} className={`menu ${className}`} onKeyDown={onKeyDown}>
      <button className={`menu-button ${open ? 'open' : ''}`} title={title} aria-label={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
        {chevron && <ChevronDownIcon />}
      </button>
      {open && (
        <div ref={listRef} className={`menu-list ${align}`} role="menu" aria-label={title}>
          {items.map((item, i) =>
            item === 'separator' ? (
              <div key={`sep-${i}`} className="menu-separator" role="separator" />
            ) : (
              <button
                key={item.label}
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked}
                title={item.title}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                <span>
                  {item.checked !== undefined && <span className="menu-check">{item.checked ? '✓' : ''}</span>}
                  {item.label}
                </span>
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
