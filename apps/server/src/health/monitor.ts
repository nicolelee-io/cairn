import type { HealthProblemId, NotifyTestResult, ServerHealth } from '@cairn/shared'
import type { Alert } from './notify.ts'

/** A problem that is still there is repeated at most this often. */
export const REMIND_EVERY_MS = 24 * 60 * 60 * 1000

const TITLES: Record<HealthProblemId, string> = {
  backup: 'Cairn backup problem',
  database: 'Cairn database problem',
}

interface Deps {
  /** Whether alerts are switched on right now (read each time, so Settings takes effect at once). */
  enabled: () => boolean
  check: (now: number) => ServerHealth
  send: (alert: Alert) => Promise<NotifyTestResult>
}

/**
 * Turns health checks into messages: one when a problem starts, a reminder a day later if it is
 * still there, and one when it clears. Nothing in between, so a steady problem isn't a stream.
 * State lives in memory: after a restart a problem still there is announced once more, which is
 * the safe way round. A message that fails to send isn't counted, so the next check retries it.
 * Turning alerts off forgets everything, so turning them on reports what is wrong already.
 */
export function healthMonitor({ enabled, check, send }: Deps) {
  const active = new Map<HealthProblemId, number>() // when it was last announced
  return {
    async tick(now = Date.now()) {
      if (!enabled()) {
        active.clear()
        return
      }
      const health = check(now)
      const current = new Map(health.problems.map((p) => [p.id, p.message]))
      for (const [id, message] of current) {
        const last = active.get(id)
        if (last !== undefined && now - last < REMIND_EVERY_MS) continue
        const sent = await send({
          title: TITLES[id],
          message: last === undefined ? message : `Still not fixed: ${message}`,
          priority: id === 'backup' ? 4 : 5,
          tags: ['warning'],
        })
        if (sent.ok) active.set(id, now)
      }
      for (const id of [...active.keys()]) {
        if (current.has(id)) continue
        const sent = await send({
          title: `${TITLES[id]}: resolved`,
          message: 'The problem is fixed.',
          priority: 2,
          tags: ['white_check_mark'],
        })
        if (sent.ok) active.delete(id)
      }
    },
  }
}
