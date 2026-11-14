import { Hono } from 'hono'
import { DayKeySchema, InsightsRangeSchema, MonthKeySchema } from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import { badRequest, reposFor } from './util.ts'

/** The client names the day ("today" in the account's zone) so the server needs no clock rules. */
export function insightRoutes(db: Db) {
  const r = new Hono<AuthEnv>()

  r.get('/stats', (c) => {
    const today = DayKeySchema.safeParse(c.req.query('today'))
    const range = InsightsRangeSchema.safeParse(c.req.query('range') ?? 'all')
    if (!today.success || !range.success) return badRequest(c)
    return c.json(reposFor(db, c).insights.stats(today.data, range.data))
  })

  r.get('/month', (c) => {
    const month = MonthKeySchema.safeParse(c.req.query('month'))
    if (!month.success) return badRequest(c)
    return c.json(reposFor(db, c).insights.month(month.data, c.req.query('journalId') || undefined))
  })

  r.get('/first-month', (c) => {
    const insights = reposFor(db, c).insights
    const journalId = c.req.query('journalId') || undefined
    return c.json({
      month: insights.firstMonth(journalId),
      lastMonth: insights.lastMonth(journalId),
    })
  })

  r.get('/months', (c) =>
    c.json({
      months: reposFor(db, c).insights.monthsWithEntries(c.req.query('journalId') || undefined),
    }),
  )

  r.get('/details', (c) => {
    const today = DayKeySchema.safeParse(c.req.query('today'))
    if (!today.success) return badRequest(c)
    return c.json(
      reposFor(db, c).insights.details(today.data, c.req.query('journalId') || undefined),
    )
  })

  r.get('/day', (c) => {
    const date = DayKeySchema.safeParse(c.req.query('date'))
    if (!date.success) return badRequest(c)
    return c.json(reposFor(db, c).insights.day(date.data, c.req.query('journalId') || undefined))
  })

  r.get('/on-this-day', (c) => {
    const date = DayKeySchema.safeParse(c.req.query('date'))
    if (!date.success) return badRequest(c)
    return c.json(reposFor(db, c).insights.onThisDay(date.data))
  })

  return r
}
