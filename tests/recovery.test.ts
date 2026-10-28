import { describe, expect, it } from 'vitest'
import { RECOVERY_DELAY_MS, RECOVERY_MAX_WAIT_MS, recoveryWait } from '../src/renderer/src/project/recovery'

describe('recovery copies', () => {
  it('are written once changes pause, and at the latest after a while of changes without a pause', () => {
    expect(recoveryWait(1000, 1000)).toBe(RECOVERY_DELAY_MS)
    // Still changing 10 s later: the copy waits for the pause, but not past the longest wait.
    expect(recoveryWait(0, 10_000)).toBe(RECOVERY_DELAY_MS)
    expect(recoveryWait(0, RECOVERY_MAX_WAIT_MS - 500)).toBe(500)
    expect(recoveryWait(0, RECOVERY_MAX_WAIT_MS + 3000)).toBe(0)
  })
})
