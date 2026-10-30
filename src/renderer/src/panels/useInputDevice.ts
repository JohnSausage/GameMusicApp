import { useCallback, useEffect, useState } from 'react'
import { listInputDevices } from '../audio/recorder'
import { readPref, writePref } from '../prefs'

const PREF_KEY = 'recordInput'

export interface InputDevice {
  devices: MediaDeviceInfo[]
  /** The input picked for recording and the tuner; '' = the default one. */
  deviceId: string
  setDeviceId: (id: string) => void
  /** Lists the inputs again: their names show once the app may use one. */
  refresh: () => void
}

/** The audio inputs, and the one picked (remembered on this computer, shared by recording and the tuner). */
export function useInputDevice(): InputDevice {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [picked, setPicked] = useState(() => readPref(PREF_KEY, ''))
  const refresh = useCallback(() => void listInputDevices().then(setDevices), [])
  useEffect(refresh, [refresh])
  const setDeviceId = (id: string): void => {
    setPicked(id)
    writePref(PREF_KEY, id)
  }
  // An input that's gone (unplugged) gives way to the default one. Before access is granted, inputs are listed without IDs.
  const listed = devices.filter((d) => d.deviceId)
  const deviceId = picked === '' || listed.length === 0 || listed.some((d) => d.deviceId === picked) ? picked : ''
  return { devices: listed, deviceId, setDeviceId, refresh }
}
