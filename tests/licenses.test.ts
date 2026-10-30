import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const licenses = readFileSync(path.join(root, 'THIRD_PARTY_LICENSES'), 'utf8')

/** The packages the app's code imports (not Node's or Electron's own modules). */
function importedPackages(): string[] {
  const packages = new Set<string>()
  const sources = path.join(root, 'src')
  for (const file of readdirSync(sources, { recursive: true, encoding: 'utf8' })) {
    if (!/\.tsx?$/.test(file)) continue
    for (const [, specifier] of readFileSync(path.join(sources, file), 'utf8').matchAll(/from '([^'.][^']*)'/g)) {
      if (specifier.startsWith('node:') || specifier === 'electron') continue
      packages.add(specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/'))
    }
  }
  return [...packages].sort()
}

describe('THIRD_PARTY_LICENSES (REQUIREMENTS.md NFR-53)', () => {
  it('lists every package the app imports, in the version installed (else run npm run licenses)', () => {
    const packages = importedPackages()
    expect(packages).toContain('@coderline/alphatab')
    for (const name of packages) {
      const { version } = JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'))
      expect(licenses, name).toMatch(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} +${version.replace(/\./g, '\\.')} `, 'm'))
    }
  })

  it('credits the music font and the soundfont', () => {
    expect(licenses).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(licenses).toContain('Sonic Network Inc.')
  })
})
