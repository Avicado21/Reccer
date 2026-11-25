/**
 * Dev-only routes (404 unless ALLOW_DEBUG_ROUTES === "true", which `deepspace dev`/`test` set and a deploy does not):
 * - GET  /api/dev/outbox: the dev outbox (./dev-outbox.ts) for the verified caller's own email only.
 * - POST /api/dev/cron/deadline-reminders: runs the daily reminder task now, so the e2e spec can
 *   exercise the real cron path (buildCronContext -> RecordRoom). Callable only by a verified
 *   @deepspace.test account, and it emails only @deepspace.test recipients.
 */

import type { Hono } from 'hono'
import type { VerifyResult } from 'deepspace/worker'
import { isTestAccountEmail } from 'deepspace/worker'
import { runDeadlineReminders } from '../actions/deepspace.js'
import type { AppContext, Env } from '../../worker.js'
import { devMailFor, devOutboxEnabled } from './dev-outbox.js'

type ResolveAuth = (req: Request, env: Env) => Promise<VerifyResult | null>

export function registerDevOutboxRoute(app: Hono<AppContext>, resolveAuth: ResolveAuth): void {
  app.get('/api/dev/outbox', async (c) => {
    if (!devOutboxEnabled(c.env)) return c.json({ error: 'not_found' }, 404)
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'unauthorized' }, 401)
    const email = typeof auth.claims.email === 'string' ? auth.claims.email.toLowerCase() : ''
    if (!email) return c.json({ success: true, data: [] })
    return c.json({ success: true, data: devMailFor(email) })
  })

  app.post('/api/dev/cron/deadline-reminders', async (c) => {
    if (!devOutboxEnabled(c.env)) return c.json({ error: 'not_found' }, 404)
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'unauthorized' }, 401)
    if (!isTestAccountEmail(typeof auth.claims.email === 'string' ? auth.claims.email : null)) return c.json({ error: 'forbidden' }, 403)
    const res = await runDeadlineReminders(c.env, { testRecipientsOnly: true })
    return c.json({ success: true, data: res })
  })
}
