import { useSyncExternalStore } from 'react'

/**
 * Whether the last API call got an answer from the server. `api()` reports into it (a network error
 * or a gateway 502/503/504 means down; any other response means up), and the shell shows a banner
 * while it is down.
 */
/** A reply from the gateway in front of the app (or from the tunnel) saying the app didn't answer. */
export const isGatewayDown = (status: number) =>
  status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 530)

let down = false
const listeners = new Set<() => void>()

export function reportServer(isDown: boolean) {
  if (down === isDown) return
  down = isDown
  listeners.forEach((l) => l())
}

/** The same, outside React. */
export const isServerDown = () => down

export function useServerDown() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => down,
  )
}
