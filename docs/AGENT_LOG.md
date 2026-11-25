# Agent log (stage 2)

One entry per step: commands run, what failed, what changed, what was verified and how.

## Lane 1: DeepSpace integration (2026-11-25)

Environment: macOS, Node 26.0.0, npm 11.12.1, create-deepspace 0.44.2, deepspace 0.44.2.
Scratch output (logs, scaffold copy, fetched docs) lives outside the repo.

### Step 0: environment and login

- `npx deepspace auth whoami --json` → `not_authenticated`. The scaffold's own next-steps say
  `dev start`, `test run`, `secrets`, and `deploy` register the app on first use, so local dev was
  raised as a decision instead of logging in.
- Decision (captain, via firstmate): the owner logged in. Local `dev start` and `test run` were
  allowed. Deploy, push, production secrets, and anything that latches source authority stayed
  forbidden.
- Captain's ask: use a medium-weight Sonnet model for both LLM calls (see step 3).

### Step 1: scaffold and move

- `npm create deepspace@latest -- reccer` was run in a scratch folder, not in the repo, so the
  repo's history stays intact.
- Commit "Move app/src into the DeepSpace scaffold layout" is a pure `git mv`, so the parallel lane
  merges by rename detection:
  `app/src/{actions,core,lib,styles,schemas.ts,integrations.ts}` → `src/`, and
  `app/src/pages/(app)/{student,recommender}` → `src/pages/(app)/(protected)/`. That folder is the
  scaffold's sign-in boundary, and route groups do not appear in URLs, so the routes stay
  `/student`, `/student/new`, `/recommender/{claim,interview,draft}`. Only import paths changed.
  `npm test` (25) and `npm run typecheck` passed at that commit.
- The scaffold was merged in (commit "Integrate the DeepSpace starter scaffold"). These files were
  merged rather than replaced: `package.json` (scaffold scripts plus Reccer's `test`, `typecheck`,
  `demo`; `docx`, `tsx`, `@types/node` added), `.gitignore`, `src/schemas.ts`,
  `src/integrations.ts`. The scaffold's `AGENTS.md`/`CLAUDE.md` were not added (project rule).
- `npm test` now means the Reccer unit tests (tsx). The scaffold's Playwright runner is
  `npm run test:deepspace` / `npx deepspace test run`. `npm run typecheck` runs both
  `tsconfig.core.json` and the app's `tsc --noEmit`.

### Step 2: SDK facts (installed package wins over docs)

Sources: `node_modules/deepspace/dist/{worker,schema,index}.d.ts` and `worker.js`, the
scaffold's `src/server/action-routes.ts`, `npx deepspace integrations list/info`, and
docs.deep.space `guides/server-actions`, `concepts/permissions`, `guides/testing`,
`guides/source-control`, `guides/external-apis`.

- **Action registration:** export `actions: Record<string, ActionHandler<Env>>` from
  `src/actions/index.ts`. They are served at `POST /api/actions/<name>`.
- **Identity:** the route verifies `Authorization: Bearer <jwt>` with `verifyJwt` and returns 401
  without it. `ctx.userId` is the verified subject and `ctx.callerJwt` is that same token. There is
  no email on the context, so it is read from the verified token's `email` claim, with the `users`
  row as fallback. Anonymous ids (`anon-…`) are treated as signed out.
- **Input:** `ctx.params` is the parsed JSON body.
- **Records:** `tools.get/query/create/update` all return `ActionResult`. Records are envelopes
  `{ recordId, data, createdBy, createdAt, updatedAt }`. `update` merges. `query` takes
  `{ where, orderBy, orderDir, limit }`, does equality only, and has no default limit for actions.
  The tools run RBAC-off, so every rule stays in `logic.ts`.
- **Storage (worker.js):** JSON columns round-trip parsed. Booleans are stored as 0/1 and read back
  as **numbers**. Null fields are **omitted** on read. Unknown fields are **silently dropped**, so
  `studentEmail` and `claimedEmail` (written by logic.ts) had to become columns. `uniqueOn` refuses
  a duplicate create with "Duplicate: …".
- **Permissions:** levels are `own`, `unclaimed-or-own`, `collaborator`, `team`, `access`,
  `published`, `shared`. None of them can express "rows whose request's recommenderUserId is the
  caller", so all five collections stay client-none (HANDOFF rule 2).
- **Client:** there is no web `callAction`. The documented call is `fetch('/api/actions/<name>')`
  with `Authorization: Bearer ${await getAuthToken()}` (from `deepspace`).
- **Sign-in redirect:** `/api/auth/oauth-complete` always lands on `/home`. The invite token
  would be lost (step 4).
- **LLM:** the catalog has `anthropic/chat-completion` ("via the Anthropic Messages API"). The
  body is `{ model, max_tokens, messages[{role: user|assistant, content}], system?, temperature? }`
  and the default model is `claude-opus-5-5`. **Chosen: `claude-sonnet-5-5`**, the medium-weight
  Sonnet the captain asked for, which is listed in the SDK's model catalog (`DEEPSPACE_AI_MODELS`).
  The catalog publishes no `outputSchema`, so the adapter reads Anthropic `content[]` text blocks
  (with an OpenAI-shape fallback). This was later confirmed live: both calls worked.
  `openai` billing was replaced by `anthropic`.
- **Email:** `email/send` takes `{ to, subject, text|html, from?, reply_to?, cc?, bcc? }`. The
  installed catalog says **"Any from value is ignored"**: mail comes from
  `DeepSpace Apps <notifications@updates.app.space>`. `from` is still sent, as the docs ask.
- **App id:** `vite build`, `vitest`, and `dev start` all refuse the `__APP_ID__` placeholder.
  `dev start` exits 2 with the action `deepspace app init` (placeholder in committed history).

### Step 3: schemas and adapter

- `src/schemas/reccer-schemas.ts`: requests, questionSets, invites, answers, drafts. Every role
  (`*`, viewer, member, admin) is denied read/create/update/delete. `uniqueOn` is set for
  questionSets.requestId, invites.tokenHash, answers.(requestId, questionId), and drafts.requestId.
  The scaffold's `users` and `settings` schemas are kept.
- `src/actions/deepspace.ts`: `runtimeFrom(ctx)` addresses the named collection on every call,
  unwraps envelopes (and turns 0/1 back into booleans), maps a duplicate-key error to `conflict`,
  treats "Record not found" as `null`, and builds the Anthropic body (system prompts go in
  `system`). `action()` maps `ActionError` to `{ success: false, code, error }` and logs other
  errors by message only.
- `src/lib/api.ts` uses the real transport, as above. A 401 maps to `unauthenticated`.
- `tests/adapter.test.ts` (9 tests) runs every action through the adapter against a fake
  `ActionTools` that follows the RecordRoom storage rules above.
- `logic.ts` and `core/` are **unchanged**.

### Step 4: pages, fonts, claim link

- `src/lib/claimReturn.ts` and `ClaimReturn` in `(app)/_layout.tsx`: while signed out on
  `/recommender/claim?token=…`, the token goes into this tab's `sessionStorage` (it expires after
  1 h and is used once). After sign-in, wherever the app lands, it navigates back to
  `/recommender/claim?token=…`, so the token is in the URL again.
  - Bug found and fixed before commit: remembering the token while signed in re-saved it after the
    claim page cleared it, which bounced the user from the interview back to the claim page. It is
    now remembered only while signed out.
- `index.html` loads Source Serif 4 and Public Sans and uses the light `paper` theme. There is a
  Reccer landing, a `/home` that routes students and recommenders, and a "My requests" nav item.
- `interview.tsx`: `useRef()` needs an initial value under React 19 types. This is the only page
  logic edit.

### Step 5: local verification

- `npx deepspace app init --json` → registered `app_01M8AE4W9WV4VFCW5EZXKXCB0H` (committed in
  `wrangler.toml`). No deploy and no push, and `app source` stays unclaimed.
- `npx deepspace dev start --port 5191`: up, with `.dev.vars` generated by the CLI.
- Test accounts were created with random passwords via `--password-stdin`: `Student A`
  (`student-a-7d5315@deepspace.test`; `student-a@` was taken globally), `Recommender B`, and
  `Outsider C`.
- Dev-only outbox (`src/server/dev-outbox.ts`, `GET /api/dev/outbox`): active only when
  `ALLOW_DEBUG_ROUTES === "true"` (set by `deepspace dev`/`test`, not on deploy), and only for
  `@deepspace.test` recipients. A caller sees only mail to their own verified email, so the student
  still cannot see the invite token.
- `npx deepspace test run tests/reccer.spec.ts`:
  - Run 1 failed in the spec itself (the recommender page was still on `about:blank` when it
    called fetch). Fixed by opening `/home` first.
  - Run 2 passed. Student UI: intake → questions → invite. The student's status has no token. The
    student cannot read the recommender's mail or claim the link. Recommender: claim URL while
    signed out → "Sign in to continue" → session cookie restored → `/home` → redirected to the
    interview for the right request. Outsider: claim `conflict`, interview/draft `forbidden`.
    Recommender UI: 3 answers → finish → draft page with "I recommend Jordan Rivera".
    Student: interview/draft/saveEdit `forbidden`, status `finished`, completion email has no
    answer text. Anonymous `POST /api/actions/listMyRequests` → 401.
  - Run 4: 19 questions, **12 generated by Sonnet** (they passed the leading-question validator).
    Assembly mode **`llm`**, with 1 claim-check flag. Both real LLM calls worked end to end.
- `npx deepspace test run e2e`: **12/12 pass** (scaffold smoke, api, collab, plus reccer).
- `npm test`: 34/34. `npm run typecheck`: clean. `npx eslint .`: clean.

Observed, not fixed (lane 2 / pages): the interview's 1.2 s autosave timer can fire one more
`saveAnswer` after `finishInterview`. It is harmless (the answer is already saved and the draft is
already built), but the answer and the draft can differ if the recommender types during that
window.

### Step 6: deploy handoff

- `DEPLOY.md` has the exact commands the owner runs from their own checkout: whoami, secrets (none
  needed), source-authority check, tests, deploy, logs.
- Spend during verification: four question generations and three assemblies on owner credits
  (`claude-sonnet-5-5`). No real email was sent; the dev outbox held it all.

## Lane 2: product hardening and features (firstmate + Opus, Nov 25)
Scope: SDK-free layers only (`core/`, `actions/logic.ts`, pages, `lib/useDictation.ts`, tests, docs), plus new method signatures in `lib/api.ts`. Lane 1 owns the adapter, schemas, and transport.

- **Fixes, each with a regression test (`tests/regressions.test.ts`):** stable sentence ids, with edits and flags keyed by them and kept across a re-finish (dropped edits quoted in notes); the draft page uses ids instead of matching text; `claimInvite` writes, re-reads, and repairs, tested with forced interleaving (the test fails on the stage 1 code: both claims succeeded); autosave bound to its question (`core/autosave.ts`); ranking words judged in context.
- **Features (`tests/features.test.ts`):** `getMyRequestIntake`, `updateIntake`, `cancelInvite`, capped resend, invite status in `listMyRequests`, advisory checks on edits, `remindersDue` plus `sendDeadlineReminders`.
- **Verified:** `npm test` 49/49, `npm run typecheck` clean, `npm run demo` runs. Pages typechecked under strict `tsc` with React 18 types, then bundled against the real `logic.ts` on the in-memory runtime and driven in headless Chromium: new request to invite; reopen, edit, cancel, resend; autosave across fast question switches (one save per question, each to its own id); editing the second of two identical sentences; advisory notes and undo. Zero console errors. That harness lives outside the repo.
- **Found while driving the pages:** the request form had no pronouns field, so saving a reopened request dropped `pronouns`, marked the questions stale, and cost an LLM generation. Fixed: the form has the field, and saves are built on the loaded intake.
- **Not done here:** schema columns and action registration (listed in HANDOFF section 5 for lane 1), the cron wiring, deploy.

### Lane 2, integration step (after lane 1 landed on main at 20639a7)
- Rebased onto main with directory-rename detection: the core and logic changes moved cleanly to `src/`; pages, `api.ts`, and docs were resolved by hand (lane 1's import depths and real transport kept, lane 2's page logic and signatures kept).
- Registered `getMyRequestIntake`, `updateIntake`, `cancelInvite` in `src/actions/deepspace.ts`. Added the stage 2 columns to `src/schemas/reccer-schemas.ts`. The RecordRoom drops undeclared fields, so the adapter test fake now does too.
- Cron, verified in `deepspace/dist/worker.d.ts` and `worker.js` 0.44.2: `CronTask { name, schedule, timezone }`, `buildCronContext(env, ownerUserId, roomId)` with `records.query/create/update` over the same RBAC-off tools API (query accepts `recordId` in `where`; no default limit; 5,000-row scan cap) and `integrations.call` billed through `APP_OWNER_JWT`. `src/cron.ts` runs `deadline-reminders` daily at 09:00 America/New_York; `cronRuntime()` is the only Runtime with `system: true`.
- Dev-only trigger `POST /api/dev/cron/deadline-reminders`: 404 unless `ALLOW_DEBUG_ROUTES === "true"`, caller must be a verified `@deepspace.test` account, and only `@deepspace.test` recipients are emailed.
- The status page heading reads "Invite sent to …" while the invite is open, so lane 1's spec runs unchanged.
- `tests/reccer.spec.ts` gained a second flow: reopen from the home page, edit the email, send, resend (the old link says a newer invite was sent), cancel (the link says cancelled; the request unlocks), resend and claim, the student's home shows "Accepted", then the reminder trigger (student and recommender both reminded through the real cron path, nothing the second time).
- Lane 1's note about the 1.2 s autosave firing after `finishInterview` is fixed by the autosaver: finishing flushes and clears the pending save first.
- Verified: `npm test` 64/64; `npm run typecheck` clean (core, then the whole app); `npx eslint .` clean; `npm run build` ok; `npm run validate` ok; `npx deepspace test run e2e` 13/13. Run 1 of the Reccer spec failed in the spec itself (an action called from the recommender's page before it had navigated), fixed in the spec.
- Spend: three Reccer spec runs, about six question generations and three assemblies on owner credits (`claude-sonnet-5-5`). No real email; the dev outbox held it all. No deploy, no push, no secrets.
