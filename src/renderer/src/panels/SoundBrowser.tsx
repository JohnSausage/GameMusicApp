import { useState } from 'react'
import { GM_FAMILIES, type Instrument } from '../model/song'
import { FACTORY_PRESETS, type SynthPatch, type Waveform } from '../model/synth'
import { PRESET_EXTENSION, type UserPreset } from '../project/presets'

/** A category of the browser: the built-in 8-bit or FM presets, your own, or a General MIDI family (by index). */
type Category = 'synth' | 'fm' | 'mine' | number

const WAVEFORM_NAMES: Record<Waveform, string> = { pulse: 'Pulse', triangle: 'Triangle', sawtooth: 'Saw', sine: 'Sine', noise: 'Noise', fm: 'FM' }

const CHIP_PRESETS = FACTORY_PRESETS.filter((p) => p.waveform !== 'fm')
const FM_PRESETS = FACTORY_PRESETS.filter((p) => p.waveform === 'fm')

/** The category the sound is in, so the browser opens there. */
function categoryOf(instrument: Instrument, userPresets: UserPreset[]): Category {
  if (instrument.kind === 'soundfont') return Math.floor(instrument.program / 8)
  if (instrument.kind === 'synth' && !FACTORY_PRESETS.some((p) => p.name === instrument.patch.name) && userPresets.some((p) => p.patch.name === instrument.patch.name)) {
    return 'mine'
  }
  return instrument.kind === 'synth' && instrument.patch.waveform === 'fm' ? 'fm' : 'synth'
}

interface Props {
  instrument: Instrument
  userPresets: UserPreset[]
  onChoose: (instrument: Instrument) => void
  onDeletePreset: (preset: UserPreset) => void
  onImportPreset: (file: File) => void
}

/** Sounds for guitar, bass and keys tracks, arranged by category: 8-bit synth presets and the General MIDI families. */
export function SoundBrowser({ instrument, userPresets, onChoose, onDeletePreset, onImportPreset }: Props): React.JSX.Element {
  const [category, setCategory] = useState<Category>(() => categoryOf(instrument, userPresets))
  const current = categoryOf(instrument, userPresets)
  const shown = category === 'mine' && userPresets.length === 0 ? 'synth' : category

  const categoryButton = (value: Category, label: string): React.JSX.Element => (
    <button
      key={String(value)}
      className={`sound-category ${shown === value ? 'active' : ''} ${current === value ? 'current' : ''}`}
      aria-pressed={shown === value}
      title={current === value ? 'The track’s sound is in here' : undefined}
      onClick={() => setCategory(value)}
    >
      {label}
    </button>
  )

  const synthTile = (patch: SynthPatch, key: string, preset?: UserPreset): React.JSX.Element => {
    const active = instrument.kind === 'synth' && instrument.patch.name === patch.name
    return (
      <div key={key} className={`sound-tile-wrap ${active ? 'active' : ''}`}>
        <button className={`sound-tile ${active ? 'active' : ''}`} aria-pressed={active} onClick={() => onChoose({ kind: 'synth', patch: { ...patch } })}>
          {patch.name}
          <small>{WAVEFORM_NAMES[patch.waveform]}</small>
        </button>
        {preset && (
          <button className="icon sound-tile-delete" title="Delete this preset" aria-label={`Delete ${patch.name}`} onClick={() => onDeletePreset(preset)}>
            ×
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="sound-browser">
      <div className="sound-categories" role="group" aria-label="Sound categories">
        <span className="sound-group-label">Synth</span>
        <div className="sound-group">
          {categoryButton('synth', '8-bit')}
          {categoryButton('fm', 'FM (16-bit)')}
          {userPresets.length > 0 && categoryButton('mine', 'My presets')}
        </div>
        <span className="sound-group-label">Instruments</span>
        <div className="sound-group">{GM_FAMILIES.map((family, f) => categoryButton(f, family.name))}</div>
      </div>
      <div className="sound-tiles" role="group" aria-label="Sounds">
        {shown === 'synth' && CHIP_PRESETS.map((patch) => synthTile(patch, `factory:${patch.name}`))}
        {shown === 'fm' && FM_PRESETS.map((patch) => synthTile(patch, `factory:${patch.name}`))}
        {shown === 'mine' && userPresets.map((preset) => synthTile(preset.patch, preset.id, preset))}
        {typeof shown === 'number' &&
          GM_FAMILIES[shown].sounds.map((name, i) => {
            const program = shown * 8 + i
            const active = instrument.kind === 'soundfont' && instrument.program === program
            return (
              <button key={name} className={`sound-tile ${active ? 'active' : ''}`} aria-pressed={active} onClick={() => onChoose({ kind: 'soundfont', program })}>
                {name}
              </button>
            )
          })}
        {(shown === 'synth' || shown === 'fm' || shown === 'mine') && (
          <label className="file-button sound-tile import-tile" title={`Load a .${PRESET_EXTENSION} sound file, e.g. one a friend sent you`}>
            Import .{PRESET_EXTENSION}…
            <input
              type="file"
              accept={`.${PRESET_EXTENSION},application/json`}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) onImportPreset(file)
              }}
            />
          </label>
        )}
      </div>
    </div>
  )
}
