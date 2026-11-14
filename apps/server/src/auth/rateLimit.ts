/** Fixed-window failure counter. In-memory is fine: one process, and a restart just resets it. */
export class FailureLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private max: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}

  /** Seconds until allowed again, or 0 if not limited. */
  retryAfter(key: string): number {
    const h = this.hits.get(key)
    if (!h || h.resetAt <= this.now() || h.count < this.max) return 0
    return Math.ceil((h.resetAt - this.now()) / 1000)
  }

  fail(key: string) {
    const now = this.now()
    if (this.hits.size > 1000) {
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k)
    }
    const h = this.hits.get(key)
    if (!h || h.resetAt <= now) this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
    else h.count++
  }

  reset(key: string) {
    this.hits.delete(key)
  }
}

const WINDOW_MS = 15 * 60 * 1000

/**
 * The sign-in limiters, shared by login, the current-password check and Manage users (an admin
 * reset or re-enable lifts the user's lockout). Per-IP is the tight limit; per-username is loose so
 * someone hammering the name can't lock the owner out for long, yet still caps online guessing at a
 * few dozen tries per window.
 */
export function loginLimits(now: () => number = Date.now) {
  return {
    byIp: new FailureLimiter(8, WINDOW_MS, now),
    byUser: new FailureLimiter(30, WINDOW_MS, now),
  }
}
export type LoginLimits = ReturnType<typeof loginLimits>
