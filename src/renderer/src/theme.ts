// Light or dark look of the whole app, the score included. The choice is kept
// per computer; "system" follows the operating system's setting and changes with it.
import { useSyncExternalStore } from 'react'
import { readPref, writePref } from './prefs'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const THEME_CHOICES: { value: ThemeChoice; label: string; title: string }[] = [
  { value: 'light', label: 'Light', title: 'Light mode: dark notes on white' },
  { value: 'dark', label: 'Dark', title: 'Dark mode: light notes on a dark background' },
  { value: 'system', label: 'System', title: 'Light or dark, as set in the operating system' }
]

const THEME_KEY = 'theme'
const listeners = new Set<() => void>()
const systemDark = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function readChoice(): ThemeChoice {
  const value = readPref<unknown>(THEME_KEY, 'system')
  return value === 'light' || value === 'dark' ? value : 'system'
}

let choice = readChoice()

export function themeChoice(): ThemeChoice {
  return choice
}

/** The theme in use: the choice, or the system's when following it. */
export function currentTheme(): Theme {
  return choice === 'system' ? (systemDark?.matches ? 'dark' : 'light') : choice
}

/** Sets `data-theme` on the page, which switches the CSS colors. */
function apply(): void {
  document.documentElement.dataset.theme = currentTheme()
  listeners.forEach((listener) => listener())
}

export function setThemeChoice(next: ThemeChoice): void {
  choice = next
  writePref(THEME_KEY, next)
  apply()
}

/** Call once at startup, before the first render. */
export function initTheme(): void {
  systemDark?.addEventListener('change', () => choice === 'system' && apply())
  apply()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme)
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, themeChoice)
}
