/** GET /api/dev/outbox: the dev outbox (./dev-outbox.ts) for the verified caller's own email only. */

import type { Hono } from 'hono'
import type { VerifyResult } from 'deepspace/worker'
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
}
