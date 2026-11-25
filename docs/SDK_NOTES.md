# DeepSpace notes (from docs.deep.space, read 2026-11-25; SDK 0.43.0 per docs)

Verify everything here against `node_modules/deepspace/dist/*.d.ts`; installed types win over these notes.

## Reading the docs
- Index: `https://docs.deep.space/llms.txt`. Any page as Markdown: append `.md`. Whole corpus: `llms-full.txt`.
- Pages to read for this app: `concepts/permissions`, `concepts/data-model`, `guides/server-actions`, `sdk-reference/worker/server-actions`, `sdk-reference/worker/auth`, `guides/external-apis`, `guides/secrets`, `guides/source-control`, `guides/testing`.

## Entry points
`deepspace` (React hooks, `integration` client), `deepspace/schema` (schemas, browser and worker safe), `deepspace/worker` (Durable Object rooms, server actions, AI helpers, cron), `deepspace/testing` (multi-user Playwright fixture).

## Operating sequence
1. `npx deepspace auth whoami --json` before anything that registers an app. The first `deploy`, `dev start`, `test run`, `push`, or `secrets` write mints the app id under the current login.
2. `npm create deepspace@latest <name>` needs **npm 11.6+**.
3. Source authority latches once, permanently. A deploy from a checkout with a GitHub remote claims GitHub; a first `deepspace push`, or a deploy without a remote, claims DeepSpace source.
4. `npx deepspace test run`, then `npx deepspace deploy`. Afterwards: `logs --follow --json`, `releases`, `app usage`.

## Rules that prevent expensive mistakes (from the official skill)
- Records are envelopes: fields live under `record.data`; `put(id, patch)` merges server-side.
- Data and auth hooks need the `(app)/` provider boundary. Top-level pages are static.
- Keep the scaffold's required `users` schema.
- Secrets go in `npx deepspace secrets`, never `.dev.vars` by hand.
- Caller identity comes only from a verified JWT.
- When a CLI command refuses: exit 1 means fix the cause; exit 2 means one step remains. Run the shipped `action` if there is one; if not, the choice belongs to the user.

## Integrations
- Call shape: `integration.post('<integration>/<endpoint>', body)` on the client; `tools.integration(...)` in server actions; `ctx.integrations.call(...)` in cron.
- Response: `{ success: true, data }` or `{ success: false, error, code, status, details, issues }`. Render `error`; branch on `code`.
- Discovery is free: `npx deepspace integrations list`, then `integrations info <endpoint>` for the exact input schema.
- Billing in `src/integrations.ts`: `developer` (owner pays, anonymous allowed) or `user` (caller pays, anonymous gets 401). Newer scaffolds refuse integrations not listed there.
- `email/send` must send from `<app-name>@app.space`; app subdomains are rejected.
- For streamed LLM output use `createDeepSpaceAI`. Reccer needs whole JSON responses, so the integration endpoint is the right tool.
- Tests: one call per endpoint per run, never in loops, and mock the external boundary with `page.route`.

## Verified against the installed SDK (deepspace 0.44.2, 2026-11-25)
Where these differ from the notes above, these win. Details and sources: `docs/AGENT_LOG.md`.
- Server actions: `export const actions: Record<string, ActionHandler<Env>>` in `src/actions/index.ts`, served at `POST /api/actions/<name>`. Context `{ userId, params, tools, env, callerJwt }`; the route verifies the Bearer JWT first. Web client: `fetch` with `Authorization: Bearer ${await getAuthToken()}`. There is no web `callAction`.
- `tools.get/query/create/update` return `ActionResult`; envelopes are `{ recordId, data, ... }`. Booleans read back as 0/1, nulls are omitted, unknown fields are dropped, `uniqueOn` refuses duplicates.
- LLM: `anthropic/chat-completion` (Anthropic Messages API body, `system` separate). Reccer uses `claude-sonnet-5-5`.
- `email/send`: "Any from value is ignored". Mail comes from `DeepSpace Apps <notifications@updates.app.space>`; use `reply_to` for replies.
- `vite build`, `vitest`, and `dev start` need a real app id: run `npx deepspace app init` once and commit `wrangler.toml`.
- OAuth sign-in always lands on `/home`; query strings on the page you signed in from are lost (Reccer restores the claim token itself).
- Test accounts: emails are global across developers; create with `--password-stdin`.
