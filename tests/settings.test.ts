import { describe, expect, it } from 'vitest'
import { AUDIO_BUFFER_FRAMES, defaultSettings, parseSettings, validSettingsPatch } from '../src/main/settingsFile'

describe('app settings', () => {
  it('use low audio latency by default on Linux only', () => {
    expect(defaultSettings('linux')).toEqual({ audioLatency: 'low' })
    expect(defaultSettings('win32')).toEqual({ audioLatency: 'standard' })
    expect(AUDIO_BUFFER_FRAMES).toEqual({ low: 256, standard: null })
  })

  it('read saved settings and fall back to defaults for anything broken', () => {
    expect(parseSettings(null, 'linux')).toEqual({ audioLatency: 'low' })
    expect(parseSettings('{"audioLatency":"standard"}', 'linux')).toEqual({ audioLatency: 'standard' })
    expect(parseSettings('{"audioLatency":"low"}', 'win32')).toEqual({ audioLatency: 'low' })
    expect(parseSettings('{"audioLatency":"turbo"}', 'linux')).toEqual({ audioLatency: 'low' })
    expect(parseSettings('not json', 'win32')).toEqual({ audioLatency: 'standard' })
    expect(parseSettings('null', 'linux')).toEqual({ audioLatency: 'low' })
  })

  it('accept only valid changes from the renderer', () => {
    expect(validSettingsPatch({ audioLatency: 'standard' })).toEqual({ audioLatency: 'standard' })
    expect(validSettingsPatch({ audioLatency: 128 })).toBeNull()
    expect(validSettingsPatch('low')).toBeNull()
    expect(validSettingsPatch(null)).toBeNull()
  })
})
