import type { Server } from 'node:http'
import type { ServerType } from '@hono/node-server'

/**
 * What `docker stop` (SIGTERM) and Ctrl+C (SIGINT) do: stop taking connections, let in-flight
 * requests finish, then run `onClosed` (close SQLite, so the WAL is flushed) and exit 0. A request
 * still running after `forceAfterMs` exits 1 instead, before docker's SIGKILL at 10s.
 */
export function shutdownHandler(
  server: ServerType,
  onClosed: () => void,
  {
    exit = (code: number): void => process.exit(code),
    forceAfterMs = 8000,
  }: { exit?: (code: number) => void; forceAfterMs?: number } = {},
) {
  let started = false
  return () => {
    if (started) return // a second signal while closing changes nothing
    started = true
    server.close(() => {
      onClosed()
      exit(0)
    })
    // Idle keep-alive connections must not hold close() open (Node 19+ does this in close() too).
    ;(server as Server).closeIdleConnections()
    setTimeout(() => exit(1), forceAfterMs).unref()
  }
}
