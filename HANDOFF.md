# Reccer: handoff (start here)

**Reccer: AI assisted, not AI generated letters of recommendation.**
A student sets up a request; their recommender answers a short interview by voice or typing; Reccer turns the answers into a draft letter made of the recommender's own words, checks in code that nothing was invented, and lets them edit and export.

**Deadline:** DeepSpace build exercise submission, **Wednesday Nov 25, 2026, 11:59 PM ET.** Submit by about 10 PM to leave a buffer.

Owner: Avi (Avinash Kottakota). Stage 1 was built in a sandbox with no network, so the DeepSpace SDK was never installed. Read the status table before touching anything.

---

## 1. Status

| Area | Status | How it was checked |
|---|---|---|
| `src/core/` (question bank, leading-question validator, prompts, assembly, sentence ids, claim check, letters, form answers, invite tokens, emails, reminders, autosave) | **Done, tested** | `tests/core.test.ts`, `regressions.test.ts`, `features.test.ts`; strict `tsc` |
| `src/actions/logic.ts` (every server action and every permission rule) | **Done, tested** | Against an in-memory runtime: the full student-to-recommender path, a forced concurrent double claim, edit preservation across re-finish, intake edit, invite cancel and resend, reminders. 64 unit tests in all |
| `.docx` export | **Done, tested** | Generates a valid Word file in Node; browser path uses `Packer.toBlob` |
| `src/actions/deepspace.ts` (SDK adapter) | **Done, verified locally** | Checked against installed deepspace 0.44.2 types; 15 adapter tests (fake drops undeclared fields, as the RecordRoom does); real Anthropic + record calls under `deepspace test run` |
| `src/schemas.ts`, `src/schemas/reccer-schemas.ts` | **Done** | Real `CollectionSchema`s, all client-none; scaffold `users` kept; stage 2 columns added (section 5) |
| `src/lib/api.ts` (client transport) | **Done, verified locally** | `POST /api/actions/<name>` with `getAuthToken()` bearer |
| Pages, routing, auth boundary, fonts | **Done, verified locally** | Under `src/pages/(app)/(protected)/`; three-account Playwright run (`tests/reccer.spec.ts`), plus a second flow: reopen and edit, resend, cancel, status, reminders. Lane 2 pages also driven in headless Chromium against the real `logic.ts` (reopen and edit, cancel and resend, autosave across question switches, duplicate-sentence edits, advisory notes) |
| Claim link across sign-in | **Done, verified locally** | `src/lib/claimReturn.ts`; simulated OAuth return in `tests/reccer.spec.ts` |
| App registration | **Done** | `app_01M8AE4W9WV4VFCW5EZXKXCB0H` in `wrangler.toml` (`deepspace app init`) |
| Deadline reminders | **Done, verified locally** | Daily cron task (`src/cron.ts`); run through the real `buildCronContext` path by the dev trigger in `tests/reccer.spec.ts`; see section 5 |
| Deploy | **Not started** | Owner runs `DEPLOY.md` from their own checkout; source authority still unclaimed |

What was run and found is in `docs/AGENT_LOG.md`.

## 2. Architecture in one paragraph

All behavior lives in two SDK-free layers: `core/` (pure functions) and `actions/logic.ts` (server actions written against a small `Runtime` interface: `userId`, `system`, `db.get/find/create/put`, `llm`, `email`). The SDK touches the app in exactly three files: `actions/deepspace.ts` (server adapter), `lib/api.ts` (client transport), and `schemas.ts`. So finishing this is mostly "implement the adapter," and the tested logic does not change.

```
student pages ─┐                       ┌─ core/ (pure, tested)
recommender ───┼─ lib/api.ts ─▶ actions/deepspace.ts ─▶ actions/logic.ts ─┤
pages          │   (transport)      (SDK adapter)              (tested)     └─ Runtime: db, llm, email
```

## 3. Hard rules (do not break these while finishing)

1. **The student never reads answers, drafts, or letters.** Enforced in `logic.ts` (`asRecommender`) and covered by tests. Do not add any student-readable path to that data.
2. **All collections are client-none until proven otherwise.** Only relax one if the permissions docs prove the SDK supports row-level rules ("rows where recommenderUserId == caller"). Role-level "signed-in can read" would leak every letter.
3. **Caller identity comes only from the verified JWT.** Never from the request body, URL, or headers.
4. **The invite token is never returned to the student**, and is stored only as a SHA-256 hash.
5. **Fixed questions (F1–F7 and FIT*) are never LLM-written**, and the student cannot remove them.
6. **The claim check stays deterministic.** Do not replace it with an LLM call.
7. **LLM calls stay capped** (`MAX_GENERATIONS`, `MAX_ASSEMBLIES` in `integrations.ts`) and behind sign-in. Do not switch billing modes to make a test pass.
8. **Secrets go in `npx deepspace secrets`.** Never in `.dev.vars`, commits, or logs.
9. **Demo data stays fictional** (`fixtures/demo.ts`). Do not put real people's letters, Avi's real details, or any CIC/employer material in the repo or deployed app.
10. **If a test in `tests/` fails after your change, fix your change, not the test**, unless Avi agrees the rule changed.

## 4. Finish plan, in order

Stop and deploy at the end of each step if time is short; each step leaves a working app.

**Step 0: environment (15 min).** Node per the DeepSpace installation docs, **npm 11.6+** (npm 10 can crash on the scaffold). `npx deepspace auth whoami --json`, then log in as Avi if needed, *before* any command that registers an app.

**Step 1: scaffold and deploy empty (20 min).** `npm create deepspace@latest reccer`, then `npx deepspace deploy` immediately to catch deploy problems early. Choose the source authority deliberately: if the repo will live on GitHub, add the GitHub remote **before the first deploy** (the first deploy latches the source authority permanently; see the source-control docs).

**Step 2: drop in the code (15 min).** Copy `src/core`, `src/actions`, `src/lib`, `src/styles`, `src/integrations.ts` into the scaffold's `src/`. Merge, do not replace, the scaffold's `src/integrations.ts`. Copy `tests/` and `fixtures/` and make `npm test` pass in the new repo (add `tsx` and `docx` as deps).

**Step 3: verify SDK facts (30 min). Read, don't guess.**
- `npx deepspace integrations list`, then `integrations info openai/chat-completion` (or the catalog's Claude endpoint) and `integrations info email/send`. Fix `LLM_ENDPOINT`, `LLM_MODEL`, and the request/response shapes in `deepspace.ts`.
- `ls node_modules/deepspace/dist/*.d.ts` and read the server-actions, records, schemas, and worker-auth types. Docs index: `https://docs.deep.space/llms.txt`; any page as Markdown by appending `.md`.

**Step 4: implement the adapter (1–1.5 h).** Translate `schemas.ts` into real schemas (keep the scaffold's `users` schema), including the stage 2 columns (section 5). Implement `runtimeFrom()` in `deepspace.ts`: identity from the verified JWT, record access (unwrap `record.data` envelopes there), `llm`, `email`. Register the actions. Replace `invoke` in `lib/api.ts`.

**Step 5: wire pages (45 min).** Move pages into the scaffold's routing under `src/pages/(app)/` so they sit inside the auth boundary. Load the fonts listed in `styles/reccer.css`. Make `/recommender/claim?token=` survive the sign-in redirect (the token must still be in the URL after OAuth).

**Step 6: two-account verification (45 min).** Run `docs/ACCEPTANCE_TESTS.md` with two real accounts (student and recommender) on the deployed URL, plus a third account for the hijack checks. Add a `deepspace/testing` multi-user spec if time allows. Check `npx deepspace logs --follow --json` while doing it.

**Step 7: writeup and submit (30 min).** Fill `docs/WRITEUP_DRAFT.md` with what actually happened. Submit: live URL, repo, writeup.

## 5. Known gaps (fine to leave, list them in the writeup)

- **A forwarded invite link can be claimed by whoever holds it.** This is deliberate: recommenders often sign in with a different address than the one the student typed, so Reccer does not require the login email to match. The consequence is that a student with a second Google or GitHub account could claim their own invite and read the answers. Reccer refuses the student's own account and allows one claim per invite, but it cannot tell that two accounts belong to the same person. Documented, not prevented.
- **Re-finishing an LLM draft drops most edits.** Edits are kept only where the sentence comes out the same. The deterministic draft is stable, so its edits survive unless the answer changed; the LLM usually rewords, so most edits drop on a re-run. Every dropped edit is quoted back in the draft's notes so the recommender can paste it again.
- **The claim race is narrowed, not closed.** The SDK has no conditional write, so `claimInvite` writes, re-reads, and repairs the request so exactly one account ends up the recommender (tested with forced interleaving). A `uniqueOn` claims collection would close it fully; see below.
- **Deadline reminders run daily from cron, verified locally only.** The schedule fires only once deployed; locally the dev trigger runs the same code path. See below.
- **Reminders to a recommender who has not opened the invite carry no link.** Only the hash of the token is stored, and the cron deliberately does not mint a new claim link. The email points to the original invite email; the student can resend. If that link has expired, only the student is reminded (to resend), and the recommender's reminder waits for a working link.
- Status updates on the student page use 15-second polling, not realtime, because of rule 2.
- File uploads (resume PDF) are not built; the fact sheet is pasted text.
- The deterministic fallback draft keeps the recommender's grammar mostly as spoken; the LLM path is what polishes it.
- The proper-noun check is heuristic (capitalized, not sentence-initial). It can false-positive on capitalized common words; that only produces a flag the recommender can dismiss by editing, never a silent change.
- The ranking-phrase patterns are heuristic too. A ranking phrased in an unusual way can slip past, and the always-ranking words still flag in ordinary uses ("a rare bug"). Both directions only add or omit a flag; neither changes the letter.

### Stage 2 wiring (done; how it fits together)

**Client actions** registered in `src/actions/deepspace.ts`, all through the same `action()` wrapper and the real transport in `src/lib/api.ts`: `getMyRequestIntake`, `updateIntake`, `cancelInvite`; resend is `sendInvite` again. `saveEdit` takes `{ requestId, sentenceId, text }` (positions are still accepted).

**Deadline reminders run as a DeepSpace cron task.** `src/cron.ts` declares `deadline-reminders`, daily at 09:00 America/New_York (`CronTask`, verified in `deepspace/dist/worker.d.ts`); `worker.ts`'s `AppCronRoom` runs it. The task calls `runDeadlineReminders(env)` in `deepspace.ts`, which builds the SDK's `CronContext` on the same RecordRoom the actions use (`app:<DEEPSPACE_APP_ID>`), wraps it in a `Runtime` with `system: true` (the only place that is ever set), and calls `L.sendDeadlineReminders`. Email from cron is billed to the owner through `APP_OWNER_JWT`. The function is not a client action, and it refuses any runtime without `system`. It logs a content-free `{ checked, sent, failed }`.

**Manual run in dev:** `POST /api/dev/cron/deadline-reminders` (`src/server/dev-outbox-route.ts`) runs the same task now. It returns 404 unless `ALLOW_DEBUG_ROUTES === "true"` (set by `deepspace dev`/`test`, never on deploy), needs a verified `@deepspace.test` caller, and emails only `@deepspace.test` recipients; everyone else is skipped and left unmarked. `tests/reccer.spec.ts` uses it. A deployed app has no manual trigger; the CronRoom's own admin monitor (`useCronMonitor`) is the SDK's way to watch or trigger runs there.

**Conditional write for claims:** the SDK's action tools have no conditional update or transaction (`create/update/remove/deleteWhere/get/query` only), so `claimInvite` keeps its write, re-read, and repair. The one atomic primitive is `uniqueOn`: a `claims` collection unique on `requestId` would turn the claim into a true compare-and-set. That is the next step if the window matters.

**Schema columns added by stage 2**, in `src/schemas/reccer-schemas.ts` (the RecordRoom silently drops undeclared fields; `tests/adapter.test.ts` now fakes that, so a missing column fails a test):

| Collection | Column | Type | Written by |
|---|---|---|---|
| `requests` | `remindersSent` | json (string[]) | `sendDeadlineReminders` |
| `questionSets` | `stale` | boolean | `updateIntake`, `generateQuestions` |
| `invites` | `sentAt`, `cancelledAt`, `replacedAt` | datetime | `sendInvite`, `cancelInvite` |
| `drafts` | `notes` | json (string[]) | `finishInterview` |
| `drafts` | `edits` | json, keyed by sentence id | `saveEdit` |

**Scale limit:** the reminder scan queries `requests` by `status` with no paging. The RecordRoom scans at most 5,000 rows per call, which is far above this app's size; past it, page by `offset`.

## 6. Commands (in this folder)

```bash
npm install            # tsx, typescript, docx, @types/node
npm test               # 64 tests: core, actions, docx, adapter, regressions, features
npm run typecheck      # strict tsc over core, logic, fixtures, tests; then the whole app
npm run demo           # end-to-end on fictional data -> demo-output/
```

`tsconfig.core.json` covers the SDK-free code and tests. `npx deepspace test run e2e` runs the Playwright specs (13, including the two Reccer flows in `tests/reccer.spec.ts`).

## 7. Files

| Path | What it is |
|---|---|
| `BUILD_PLAN.md` | The whole plan: stage 1 (done here) and stage 2 (yours) |
| `FIRSTMATE_PROMPT.md` | Paste-ready kickoff prompt for the coding agent |
| `docs/PRODUCT_SPEC.md` | Flow, roles, permission matrix, data model, question layers |
| `docs/DECISIONS.md` | Tradeoffs and why; feeds the writeup |
| `docs/SDK_NOTES.md` | DeepSpace facts and gotchas gathered from the docs |
| `docs/ACCEPTANCE_TESTS.md` | Manual two-account test script for the deployed app |
| `docs/WRITEUP_DRAFT.md` | Submission writeup skeleton |
| `docs/screenshots/` | Rendered interview and draft pages |
| `src/`, `worker.ts`, `wrangler.toml` | The DeepSpace app (see status table) |
| `DEPLOY.md` | Exact commands for the first deploy from the owner's checkout |
| `tests/`, `fixtures/`, `scripts/` | Tests, fictional data, demo and UI-preview harness |
