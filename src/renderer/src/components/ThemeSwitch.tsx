import { setThemeChoice, THEME_CHOICES, useThemeChoice } from '../theme'

/** Light, dark, or as the operating system is set. */
export function ThemeSwitch(): React.JSX.Element {
  const choice = useThemeChoice()
  return (
    <div className="segmented theme-switch" role="group" aria-label="Light or dark mode">
      {THEME_CHOICES.map((t) => (
        <button key={t.value} className={choice === t.value ? 'active' : ''} aria-pressed={choice === t.value} title={t.title} onClick={() => setThemeChoice(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}
