// Small per-computer UI preferences (zoom, minimized panels). They live in
// localStorage, which can be unavailable; the app then simply uses the defaults.

export function readPref<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : (JSON.parse(value) as T)
  } catch {
    return fallback
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Not remembered then; everything still works.
  }
}
