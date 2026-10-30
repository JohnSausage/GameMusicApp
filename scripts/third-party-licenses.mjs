// Writes THIRD_PARTY_LICENSES (REQUIREMENTS.md NFR-53): the license of every
// package that ends up in the app, and of the fonts, sounds and model files the
// app uses from them. The packages are found from a build of the renderer with
// source maps (the main process and preload use only Node and Electron).
// Run it with `npm run licenses` after adding or updating a dependency.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = path.resolve(import.meta.dirname, '..')
const OUTPUT = path.join(root, 'THIRD_PARTY_LICENSES')
const WIDTH = 79

/** What the packages' own files don't say about files the app uses from them, by the path it imports. */
const NOTES = {
  '@coderline/alphatab/soundfont/sonivox.sf2':
    'soundfont/sonivox.sf2: "SONiVOX EAS GM Wavetable Ver. 2.10" by Sonic Network\n' +
    'Inc., from https://musical-artifacts.com/artifacts/1517, licensed under the\n' +
    'Creative Commons Attribution 3.0 license\n' +
    '(https://creativecommons.org/licenses/by/3.0/).'
}

const MIT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

const BSD_3_CLAUSE = `Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`

const LICENSE_FILE = /^(licen[cs]e|copying|notice)|OFL\.txt$/i

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
const words = (text) => text.replace(/\s+/g, ' ').trim()
const rule = (char) => char.repeat(WIDTH)

/** Builds the renderer with source maps; returns the directory of the build. */
async function buildRenderer() {
  const outDir = mkdtempSync(path.join(tmpdir(), 'licenses-'))
  await build({ configFile: path.join(root, 'vite.web.config.ts'), logLevel: 'error', build: { outDir, emptyOutDir: true, sourcemap: true } })
  return outDir
}

/** The packages in the build, by name: their directory and the files of theirs it contains. */
function bundledPackages(outDir) {
  const packages = new Map()
  for (const file of readdirSync(outDir, { recursive: true })) {
    if (!file.endsWith('.map')) continue
    for (const source of JSON.parse(read(path.join(outDir, file))).sources) {
      const at = source.indexOf('node_modules/')
      if (at < 0) continue
      // node_modules/a/node_modules/@scope/b/file.js: the innermost package, b.
      const parts = source.slice(at).split('/')
      let dir = [root]
      let name = ''
      let i = 0
      while (parts[i] === 'node_modules') {
        const length = parts[i + 1].startsWith('@') ? 2 : 1
        name = parts.slice(i + 1, i + 1 + length).join('/')
        dir.push('node_modules', ...name.split('/'))
        i += 1 + length
      }
      // Source maps of prebuilt packages can point to where they were built: then it is the one installed here.
      let packageDir = path.join(...dir)
      if (!existsSync(path.join(packageDir, 'package.json'))) packageDir = path.join(root, 'node_modules', name)
      const entry = packages.get(name) ?? { dir: packageDir, files: new Set() }
      entry.files.add(path.join(packageDir, ...parts.slice(i)))
      packages.set(name, entry)
    }
  }
  return packages
}

/**
 * The packages the app's code imports, by name, with the files it imports from
 * them as URLs (fonts, sounds, models). Also the ones that leave nothing of
 * their own in the build (@tensorflow/tfjs only gathers its parts).
 */
function importedPackages() {
  const packages = new Map()
  const sources = path.join(root, 'src')
  for (const file of readdirSync(sources, { recursive: true })) {
    if (!/\.tsx?$/.test(file)) continue
    for (const [, specifier] of read(path.join(sources, file)).matchAll(/from '([^'.][^']*)'/g)) {
      if (specifier.startsWith('node:') || specifier === 'electron') continue
      const name = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
      const assets = packages.get(name) ?? []
      const asset = specifier.endsWith('?url') && specifier.slice(0, -'?url'.length)
      if (asset && !assets.includes(asset)) assets.push(asset)
      packages.set(name, assets)
    }
  }
  return packages
}

const sourceUrl = (pkg, name) => {
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  if (!repository) return pkg.homepage ?? `https://www.npmjs.com/package/${name}`
  return repository.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '')
}

/** The first comment in the package's bundled files that names a copyright holder, without its comment marks. */
function copyrightComment(files) {
  for (const file of [...files].sort()) {
    if (!existsSync(file)) continue
    const comment = read(file).match(/^\s*\/\*([\s\S]*?)\*\//)?.[1]
    if (!comment || !/copyright/i.test(comment)) continue
    return comment
      .split('\n')
      .map((line) => line.replace(/^\s*\*? ?/, '').trimEnd())
      .filter((line) => !/^(@license|@preserve|=+)$/.test(line))
      .join('\n')
      .trim()
  }
  return null
}

/** A license file as it is meant to be read: without the build template parts some have (alphaTab's header). */
const licenseText = (file) =>
  read(file)
    .split('\n')
    .filter((line) => !line.includes('<%') && !/^\s*@(license|preserve)\s*$/.test(line))
    .join('\n')
    .trim()

const APACHE_NOTE = 'Licensed under the Apache License, Version 2.0; its text is at the end of this\nfile.'

const isApache = (text) => /^\s*Apache License\s+Version 2\.0, January 2004/.test(text) && text.includes('END OF TERMS AND CONDITIONS')

async function main() {
  const outDir = await buildRenderer()
  let packages
  try {
    packages = bundledPackages(outDir)
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
  const assets = importedPackages()
  for (const name of assets.keys()) {
    if (packages.has(name)) continue
    const dir = path.join(root, 'node_modules', name)
    const pkg = JSON.parse(read(path.join(dir, 'package.json')))
    packages.set(name, { dir, files: new Set([path.join(dir, pkg.module ?? pkg.main ?? 'index.js')]) })
  }

  let apache = null
  const shown = new Map()
  const rows = []
  const sections = []
  let integrated = false
  for (const name of [...packages.keys()].sort()) {
    const { dir, files } = packages.get(name)
    const pkg = JSON.parse(read(path.join(dir, 'package.json')))
    const license = typeof pkg.license === 'string' ? pkg.license : (pkg.licenses ?? []).map((l) => l.type).join(' OR ')
    rows.push([name, pkg.version, license])
    const body = []
    const used = (assets.get(name) ?? []).map((specifier) => specifier.slice(name.length + 1))
    if (used.length > 0) body.push(['The app also uses these files from it:', ...used.map((file) => `  ${file}`)].join('\n'))

    const texts = readdirSync(dir)
      .filter((f) => LICENSE_FILE.test(f))
      .sort()
      .map((f) => licenseText(path.join(dir, f)))
    for (const text of texts) {
      if (isApache(text)) {
        apache ??= text
        if (words(text) === words(apache)) {
          body.push(APACHE_NOTE)
          continue
        }
      }
      const same = shown.get(words(text))
      if (same) body.push(`The same license text as ${same} (above).`)
      else {
        shown.set(words(text), name)
        body.push(text)
      }
      if (text.includes('Integrated Libraries')) integrated = true
    }
    if (texts.length === 0) {
      // No license file: the license is stated in the source files.
      const comment = copyrightComment(files)
      if (!comment) throw new Error(`${name}: no license file, and no copyright notice in its files. Add its license to NOTES.`)
      body.push(comment)
      const ids = license.split(/\s+(?:AND|OR)\s+/).map((id) => id.replace(/[()]/g, ''))
      if (ids.includes('Apache-2.0')) body.push(comment.includes('Apache License') ? 'The text of the Apache License 2.0 is at the end of this file.' : APACHE_NOTE)
      if (ids.includes('MIT') && !comment.includes('Permission is hereby granted')) body.push(`Parts of it are licensed under the MIT license:\n\n${MIT}`)
      if (ids.some((id) => id !== 'Apache-2.0' && id !== 'MIT')) throw new Error(`${name}: license ${license} has no text here. Add it to NOTES.`)
    }
    // Licenses next to the files the app uses (the music font's), and what is known about the others.
    for (const specifier of assets.get(name) ?? []) {
      const folder = path.dirname(fileURLToPath(import.meta.resolve(specifier)))
      for (const f of readdirSync(folder).filter((f) => LICENSE_FILE.test(f)).sort()) {
        const text = licenseText(path.join(folder, f))
        if (shown.has(words(text))) continue
        shown.set(words(text), name)
        body.push(`${path.relative(dir, path.join(folder, f))}:\n\n${text}`)
      }
      if (NOTES[specifier]) body.push(NOTES[specifier])
    }
    sections.push([rule('='), `${name} ${pkg.version} (${license})`, sourceUrl(pkg, name), rule('='), '', body.join('\n\n'), ''].join('\n'))
  }
  if (!apache) throw new Error('No Apache License text found in the packages.')

  const electron = JSON.parse(read(path.join(root, 'node_modules', 'electron', 'package.json')))
  const nameWidth = Math.max('Package'.length, ...rows.map(([name]) => name.length)) + 2
  const versionWidth = Math.max('Version'.length, ...rows.map(([, version]) => version.length)) + 2
  const table = rows.map(([name, version, license]) => `${name.padEnd(nameWidth)}${version.padEnd(versionWidth)}${license}`)
  const appendix = [[rule('='), 'Apache License 2.0', rule('='), '', apache].join('\n')]
  if (integrated) {
    appendix.push([rule('='), 'MIT License', '(for the libraries alphaTab integrates, with their copyrights listed there)', rule('='), '', MIT].join('\n'))
    appendix.push([rule('='), 'BSD 3-Clause License', '(for libvorbis, in alphaTab, with its copyright listed there)', rule('='), '', BSD_3_CLAUSE].join('\n'))
  }

  const text = [
    'THIRD-PARTY LICENSES',
    '====================',
    '',
    'GameMusicApp contains the open-source software listed here. Its licenses allow',
    'it to be redistributed with the app; their notices and texts follow.',
    '',
    'This file is written by `npm run licenses` (scripts/third-party-licenses.mjs)',
    "from the packages in the app's build. Run it again after adding or updating a",
    'dependency.',
    '',
    `${'Package'.padEnd(nameWidth)}${'Version'.padEnd(versionWidth)}License`,
    `${'-'.repeat(nameWidth - 2)}  ${'-'.repeat(versionWidth - 2)}  ${'-'.repeat(17)}`,
    ...table,
    '',
    `The app runs on Electron ${electron.version} (${electron.license}). The licenses of Electron, of Chromium`,
    'and of the libraries in them come with the app, in LICENSE.electron.txt and',
    'LICENSES.chromium.html.',
    '',
    '',
    ...sections,
    '',
    appendix.join('\n\n\n'),
    ''
  ].join('\n')
  writeFileSync(OUTPUT, text)
  console.log(`Wrote ${path.relative(root, OUTPUT)}: ${rows.length} packages.`)
}

await main()
