// ADAPTER: DeepSpace SDK -> Runtime. The only file that touches server-side SDK APIs.
// Verified against node_modules/deepspace/dist/worker.d.ts (deepspace 0.44.2),
// src/server/action-routes.ts (the scaffold's action route), and
// `npx deepspace integrations info anthropic/chat-completion | email/send`.
//
// Facts this file relies on:
// - The scaffold route POST /api/actions/:name verifies the Bearer JWT
//   (resolveAuth -> verifyJwt) and refuses the call with 401 before any action
//   runs. ctx.userId is that verified subject; ctx.callerJwt is that same token.
// - ctx.params is the parsed JSON request body. It is input, never identity.
// - ctx.tools.* run RBAC-off ("X-App-Action: true"): every authorization check
//   is in logic.ts, which only sees the Runtime below.
// - Records are envelopes { recordId, data, createdBy, createdAt, updatedAt };
//   tools.update merges a patch; tools.query has no default limit for actions.
// - Booleans are stored as 0/1 and read back as numbers; nulls are omitted.
// - tools.integration returns { success, data } where data is the provider's
//   body directly (Anthropic Messages API shape for anthropic/chat-completion).

import type { ActionContext, ActionHandler, ActionResult, ActionTools, CronContext } from 'deepspace/worker'
import { buildCronContext, isAnonymousUserId, isTestAccountEmail } from 'deepspace/worker'
import * as L from './logic'
import type { Runtime, Coll, Row } from './logic'
import type { ChatMessage } from '../core/index'
import { LLM_ENDPOINT, LLM_MODEL, LLM_MAX_TOKENS, EMAIL_FROM } from '../integrations'
import { BOOLEAN_COLUMNS } from '../schemas/reccer-schemas'
import { captureDevMail } from '../server/dev-outbox'

/** The env fields the adapter reads. The worker's full Env satisfies this. */
export interface AdapterEnv {
  APP_NAME?: string
  /** Optional override for links in emails (local dev). Defaults to https://<APP_NAME>.app.space. */
  APP_URL?: string
  /** "true" only under `deepspace dev`/`test`; enables the dev outbox (src/server/dev-outbox.ts). */
  ALLOW_DEBUG_ROUTES?: string
}

type Envelope = { recordId: string; data: Record<string, unknown> }

/** Envelope -> flat Row, with stored 0/1 booleans turned back into booleans. */
export function unwrap(c: Coll, rec: Envelope): Row {
  const row: Row = { ...rec.data, id: rec.recordId }
  for (const col of BOOLEAN_COLUMNS[c] ?? []) {
    if (col in row) row[col] = row[col] === true || row[col] === 1 || row[col] === '1'
  }
  return row
}

/** Throw on a failed tool call. A unique-constraint hit is a user-visible conflict. */
function must<T>(r: ActionResult<T>, what: string): T {
  if (r.success) return r.data
  if (typeof r.error === 'string' && r.error.startsWith('Duplicate')) {
    throw new L.ActionError('conflict', 'That was saved at the same moment somewhere else. Reload and try again.')
  }
  throw new Error(`${what} failed: ${r.error}`)
}

/**
 * The email claim of the caller's JWT. Safe to read without re-verifying: the
 * action route verified exactly this token (Authorization: Bearer) before
 * calling the action, and refuses the call if it is missing.
 */
export function emailFromVerifiedJwt(jwt: string): string | null {
  try {
    const part = jwt.split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))))
    return typeof claims?.email === 'string' && claims.email ? claims.email : null
  } catch {
    return null
  }
}

async function callerEmail(ctx: ActionContext<AdapterEnv>): Promise<string | null> {
  const fromJwt = emailFromVerifiedJwt(ctx.callerJwt)
  if (fromJwt) return fromJwt
  // Fallback: the users row the SDK writes from the same verified session.
  const r = await ctx.tools.get('users', ctx.userId)
  const email = r.success ? r.data.record.data.email : null
  return typeof email === 'string' && email ? email : null
}

/** Anthropic Messages API: system prompts go in `system`, the rest in `messages`. */
export function anthropicBody(messages: ChatMessage[]) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  return {
    model: LLM_MODEL,
    max_tokens: LLM_MAX_TOKENS,
    ...(system ? { system } : {}),
    messages: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
  }
}

/** Text out of an Anthropic Messages response ({ content: [{ type: 'text', text }] }). */
export function completionText(data: unknown): string | null {
  const d = data as { content?: unknown; choices?: { message?: { content?: unknown } }[] } | null
  if (Array.isArray(d?.content)) {
    const text = d.content
      .filter((b): b is { type: string; text: string } => !!b && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string')
      .map((b) => b.text)
      .join('')
    return text || null
  }
  // Defensive: an OpenAI-shaped body if the proxy ever normalizes responses.
  const alt = d?.choices?.[0]?.message?.content
  return typeof alt === 'string' && alt ? alt : null
}

export function runtimeFrom(ctx: ActionContext<AdapterEnv>, userEmail: string | null): Runtime {
  const tools: ActionTools = ctx.tools
  const env = ctx.env ?? {}
  // Identity: ONLY the verified JWT subject the route put on ctx. Anonymous
  // session ids are treated as signed out, so they can spend nothing.
  const userId = ctx.userId && !isAnonymousUserId(ctx.userId) ? ctx.userId : null
  return {
    userId,
    userEmail: userId ? userEmail : null,
    now: () => new Date(),
    appUrl: (env.APP_URL || `https://${env.APP_NAME || 'reccer'}.app.space`).replace(/\/+$/, ''),
    db: {
      async get(c: Coll, id: string) {
        if (!id || typeof id !== 'string') return null
        const r = await tools.get(c, id)
        if (!r.success) {
          if (typeof r.error === 'string' && r.error.startsWith('Record not found')) return null
          throw new Error(`get ${c} failed: ${r.error}`)
        }
        return unwrap(c, r.data.record)
      },
      async find(c: Coll, where: Record<string, unknown>) {
        const r = must(await tools.query(c, { where }), `query ${c}`)
        return r.records.map((rec) => unwrap(c, rec))
      },
      async create(c: Coll, data: Record<string, unknown>) {
        return must(await tools.create(c, data), `create ${c}`).recordId
      },
      async put(c: Coll, id: string, patch: Record<string, unknown>) {
        must(await tools.update(c, id, patch), `update ${c}`)
      },
    },
    async llm(messages) {
      const r = await tools.integration(LLM_ENDPOINT, anthropicBody(messages))
      if (!r.success) return { ok: false, error: r.error || 'the model is unavailable' }
      const text = completionText(r.data)
      return text ? { ok: true, text } : { ok: false, error: 'empty completion' }
    },
    async email({ to, subject, text }) {
      // Local dev only: mail to @deepspace.test accounts is held for the recipient instead of sent.
      if (captureDevMail(env, { to, subject, text })) return { ok: true }
      const r = await tools.integration('email/send', { from: EMAIL_FROM, to, subject, text })
      return r.success ? { ok: true } : { ok: false, error: r.error }
    },
  }
}

/** Wrap a logic function as an ActionHandler; ActionError becomes { success: false, code, error }. */
export function action<I>(fn: (rt: Runtime, input: I) => Promise<unknown>): ActionHandler<AdapterEnv> {
  return async (ctx) => {
    try {
      const rt = runtimeFrom(ctx, ctx.userId && !isAnonymousUserId(ctx.userId) ? await callerEmail(ctx) : null)
      const input = (ctx.params && typeof ctx.params === 'object' ? ctx.params : {}) as I
      return { success: true, data: await fn(rt, input) }
    } catch (e) {
      if (e instanceof L.ActionError) return { success: false, code: e.code, error: e.message }
      console.error('[reccer] action failed', e instanceof Error ? e.message : String(e))
      return { success: false, code: 'internal', error: 'Something went wrong on our side. Try again.' }
    }
  }
}

export const reccerActions: Record<string, ActionHandler<AdapterEnv>> = {
  createRequest: action(L.createRequest),
  generateQuestions: action(L.generateQuestions),
  removeQuestion: action(L.removeQuestion),
  sendInvite: action(L.sendInvite), // also the resend path
  cancelInvite: action(L.cancelInvite),
  listMyRequests: action((rt) => L.listMyRequests(rt)),
  getMyRequestIntake: action(L.getMyRequestIntake),
  updateIntake: action(L.updateIntake),
  claimInvite: action(L.claimInvite),
  getInterview: action(L.getInterview),
  saveAnswer: action(L.saveAnswer),
  finishInterview: action(L.finishInterview),
  getDraft: action(L.getDraft),
  saveEdit: action(L.saveEdit),
}

// ---------- scheduled job (src/cron.ts) ----------
// sendDeadlineReminders is deliberately NOT in reccerActions: it reads every
// request, so only the scheduler may run it. The cron Runtime below is the only
// place `system: true` is ever set.

/** The env fields the scheduled job needs, beyond what buildCronContext reads. */
export interface CronAdapterEnv extends AdapterEnv {
  DEEPSPACE_APP_ID: string
  OWNER_USER_ID: string
}

/**
 * Runtime for the scheduled job, over the SDK's CronContext. Records go to the
 * same RecordRoom the actions use (`app:<DEEPSPACE_APP_ID>`, as in
 * src/server/action-routes.ts) through the same RBAC-off tools API, so rows
 * unwrap exactly as they do for actions. Email is billed to the owner via
 * APP_OWNER_JWT. There is no caller, no LLM, and no single-record get.
 */
export function cronRuntime(cron: CronContext, env: AdapterEnv): Runtime {
  const records = (rows: unknown[], c: Coll) => rows.map((rec) => unwrap(c, rec as Envelope))
  return {
    userId: null,
    userEmail: null,
    system: true,
    now: () => new Date(),
    appUrl: (env.APP_URL || `https://${env.APP_NAME || 'reccer'}.app.space`).replace(/\/+$/, ''),
    db: {
      async get(c: Coll, id: string) {
        // CronContext has no get; look the row up by id instead.
        if (!id || typeof id !== 'string') return null
        return records(await cron.records.query(c, { where: { recordId: id }, limit: 1 }), c)[0] ?? null
      },
      async find(c: Coll, where: Record<string, unknown>) {
        return records(await cron.records.query(c, { where }), c)
      },
      async create(c: Coll, data: Record<string, unknown>) {
        const r = (await cron.records.create(c, data)) as { recordId?: string } | null
        if (!r?.recordId) throw new Error(`create ${c} returned no recordId`)
        return r.recordId
      },
      async put(c: Coll, id: string, patch: Record<string, unknown>) {
        await cron.records.update(c, id, patch)
      },
    },
    async llm() {
      return { ok: false, error: 'the model is not used by scheduled jobs' }
    },
    async email({ to, subject, text }) {
      if (captureDevMail(env, { to, subject, text })) return { ok: true }
      try {
        await cron.integrations.call('email/send', { from: EMAIL_FROM, to, subject, text })
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}

/** The same Runtime, but mail to anyone outside @deepspace.test is skipped (reported as failed, so never marked sent). */
export function testRecipientsOnly(rt: Runtime): Runtime {
  return { ...rt, email: async (m) => (isTestAccountEmail(m.to) ? rt.email(m) : { ok: false, error: 'skipped: not a test address (dev trigger)' }) }
}

/**
 * Entry point for the daily reminder task. Returns a content-free summary, safe to log.
 * `testRecipientsOnly` (the dev trigger in src/server/dev-outbox-route.ts) skips any
 * recipient outside @deepspace.test, unmarked, so a manual dev run never reaches a real inbox.
 */
export async function runDeadlineReminders(
  env: CronAdapterEnv & Parameters<typeof buildCronContext>[0],
  opts: { testRecipientsOnly?: boolean } = {},
) {
  const cron = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
  const base = cronRuntime(cron, env)
  const res = await L.sendDeadlineReminders(opts.testRecipientsOnly ? testRecipientsOnly(base) : base)
  console.log('[reccer] deadline reminders', JSON.stringify({ checked: res.checked, sent: res.sent.length, failed: res.failed.length }))
  return res
}
