/**
 * Names made safe for files, with an extension, and numbered when two would be
 * the same (also only by upper and lower case, as on Windows and macOS).
 */
export function uniqueFileNames(names: string[], fallback: string, extension: string): string[] {
  const taken = new Set<string>()
  return names.map((name) => {
    const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').trim().replace(/\.+$/, '') || fallback
    let unique = base
    for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${base} ${n}`
    taken.add(unique.toLowerCase())
    return `${unique}${extension}`
  })
}
