/**
 * Integration Billing Config
 *
 * Configure who pays for each integration's API calls.
 *
 * - 'developer': The app owner pays (default).
 * - 'user': The calling user pays.
 *
 * Browser proxy (`/api/integrations/:name/:endpoint`): a 'developer'
 * integration is SERVER-ONLY unless it sets `browser: true`. Server actions
 * (`tools.integration`) and cron (`cron.integrations.call`) never go through
 * that proxy, so they are unaffected. Without this, any signed-in account
 * could spend the owner's credits directly, bypassing the app's own caps.
 * 'user' integrations bill the caller and stay reachable from the browser.
 *
 * Browser-exposed integrations require a signed-in caller. Set
 * `anonymous: true` on a `browser: true` 'developer' integration to let
 * signed-out visitors call it too — the owner then pays for anyone who can
 * reach the app.
 *
 * Integrations not listed here default to 'developer', server-only.
 *
 * IMPORTANT: any integration backed by per-user connected accounts (Google,
 * Composio) must be 'user' — the api-worker resolves the account from the
 * JWT subject. With 'developer' the app owner's JWT is forwarded, so every
 * signed-in user connects and acts on the app owner's account. Server code
 * that acts for a user in the background (e.g. a cron job) uses
 * `callComposio(env, ..., { asUser })` from 'deepspace/worker' instead.
 */

export const integrations: Record<
  string,
  { billing: 'developer' | 'user'; browser?: boolean; anonymous?: boolean }
> = {
  // Scaffold defaults (unused by Reccer, kept so per-user accounts never bill the owner).
  google: { billing: 'user' },
  composio: { billing: 'user' },
  // Reccer. Owner pays, server-only (no `browser`): every call is made by a
  // server action behind sign-in and capped per request (MAX_GENERATIONS,
  // MAX_ASSEMBLIES), or by the reminder cron. No Reccer page calls the proxy.
  anthropic: { billing: 'developer' },
  email: { billing: 'developer' },
}

/**
 * May the browser proxy forward this integration at all? 'user' billing bills
 * the caller; 'developer' billing needs an explicit `browser: true` opt-in.
 * Unlisted integrations default to 'developer', so they are refused.
 */
export function browserMayCall(name: string): boolean {
  const config = Object.hasOwn(integrations, name) ? integrations[name] : undefined
  if (!config) return false
  return config.billing === 'user' || config.browser === true
}

// Verified with `npx deepspace integrations info anthropic/chat-completion`
// (2026-11-25): Anthropic Messages API body { model, max_tokens, messages
// [{ role: user|assistant, content }], system?, temperature? }; default model
// claude-opus-5-5. Sonnet 5.5 is in the SDK's model catalog and is the
// cost/quality middle for two short, JSON-only calls per letter.
export const LLM_ENDPOINT = 'anthropic/chat-completion'
export const LLM_MODEL = 'claude-sonnet-5-5'
export const LLM_MAX_TOKENS = 4096
// `npx deepspace integrations info email/send`: "Send a transactional email from
// DeepSpace Apps <notifications@updates.app.space>. Any from value is ignored".
// Sent anyway because the docs page still lists `from`; it must be <app-name>@app.space.
export const EMAIL_FROM = 'Reccer <reccer@app.space>'
export const MAX_GENERATIONS = 3
export const MAX_ASSEMBLIES = 3
export const INVITE_TTL_DAYS = 30
