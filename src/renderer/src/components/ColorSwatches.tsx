import { PART_COLOR_NAMES, PART_COLORS } from '../model/arrangement'

/** Sets --part to a part color (see --part-0 … in styles.css), for an element and what it holds. */
export const partColor = (color: number): React.CSSProperties => ({ '--part': `var(--part-${color})` }) as React.CSSProperties

interface Props {
  /** The color picked, or null for none. */
  value: number | null
  onChange: (color: number | null) => void
  /** Accessible name of the group, e.g. "Part color". */
  label: string
  /** Tooltip of the colors, e.g. what gets the color. */
  title: string
  /** Offers "No color" too, before the colors. */
  none?: boolean
}

/** A row of the part colors to pick one from (parts in the arrangement, sound effects). */
export function ColorSwatches({ value, onChange, label, title, none = false }: Props): React.JSX.Element {
  return (
    <div className="arr-swatches" role="group" aria-label={label}>
      {none && (
        <button className={`arr-swatch none ${value === null ? 'current' : ''}`} aria-label="No color" aria-pressed={value === null} title="No color" onClick={() => onChange(null)} />
      )}
      {Array.from({ length: PART_COLORS }, (_, color) => (
        <button
          key={color}
          className={`arr-swatch ${color === value ? 'current' : ''}`}
          style={partColor(color)}
          aria-label={PART_COLOR_NAMES[color]}
          aria-pressed={color === value}
          title={`${PART_COLOR_NAMES[color]}: ${title}`}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}
