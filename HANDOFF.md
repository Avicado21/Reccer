# Reccer: handoff (start here)

**Reccer: AI assisted, not AI generated letters of recommendation.**
A student sets up a request; their recommender answers a short interview by voice or typing; Reccer turns the answers into a draft letter made of the recommender's own words, checks in code that nothing was invented, and lets them edit and export.

**Deadline:** DeepSpace build exercise submission, **Wednesday Nov 25, 2026, 11:59 PM ET.** Submit by about 10 PM to leave a buffer.

Owner: Avi (Avinash Kottakota). Stage 1 was built in a sandbox with no network, so the DeepSpace SDK was never installed. Read the status table before touching anything.

---

## 1. Status

| Area | Status | How it was checked |
|---|---|---|
| `app/src/core/` (question bank, leading-question validator, prompts, assembly, claim check, letters, form answers, invite tokens, emails, exports) | **Done, tested** | 13 unit tests, strict `tsc` |
| `app/src/actions/logic.ts` (every server action and every permission rule) | **Done, tested** | 12 tests against an in-memory runtime, including the full student-to-recommender path |
| `.docx` export | **Done, tested** | Generates a valid Word file in Node; browser path uses `Packer.toBlob` |
| Recommender pages (interview, draft) | **Renders** | Bundled with React and a mocked API, rendered in headless Chromium, zero console errors. See `docs/screenshots/` |
| Student pages (home, new request), claim page | **Parses**, not rendered | esbuild syntax check only |
| `app/src/actions/deepspace.ts` (SDK adapter) | **UNVERIFIED** | Written from docs excerpts. Every `SDK-VERIFY` line is a guess |
| `app/src/schemas.ts` | **UNVERIFIED** | States intent; must be translated into real SDK schema syntax |
| `app/src/lib/api.ts` (client transport) | **UNVERIFIED** | Placeholder `fetch`; replace with the SDK's server-action client |
| Routing, auth boundary, `_layout.tsx` | **Not started** | Use the scaffold's |
| Deploy | **Not started** | |

`grep -rn "SDK-VERIFY" app/` lists every unverified spot.

## 2. Architecture in one paragraph

All behavior lives in two SDK-free layers: `core/` (pure functions) and `actions/logic.ts` (server actions written against a small `Runtime` interface: `userId`, `db.get/find/create/put`, `llm`, `email`). The SDK touches the app in exactly three files: `actions/deepspace.ts` (server adapter), `lib/api.ts` (client transport), and `schemas.ts`. So finishing this is mostly "implement the adapter," and the tested logic does not change.

```
student pages ─┐                       ┌─ core/ (pure, tested)
recommender ───┼─ lib/api.ts ─▶ actions/deepspace.ts ─▶ actions/logic.ts ─┤
pages          │   (SDK-VERIFY)     (SDK-VERIFY adapter)       (tested)     └─ Runtime: db, llm, email
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

**Step 2: drop in the code (15 min).** Copy `app/src/core`, `app/src/actions`, `app/src/lib`, `app/src/styles`, `app/src/integrations.ts` into the scaffold's `src/`. Merge, do not replace, the scaffold's `src/integrations.ts`. Copy `tests/` and `fixtures/` and make `npm test` pass in the new repo (add `tsx` and `docx` as deps).

**Step 3: verify SDK facts (30 min). Read, don't guess.**
- `npx deepspace integrations list`, then `integrations info openai/chat-completion` (or the catalog's Claude endpoint) and `integrations info email/send`. Fix `LLM_ENDPOINT`, `LLM_MODEL`, and the request/response shapes in `deepspace.ts`.
- `ls node_modules/deepspace/dist/*.d.ts` and read the server-actions, records, schemas, and worker-auth types. Docs index: `https://docs.deep.space/llms.txt`; any page as Markdown by appending `.md`.

**Step 4: implement the adapter (1–1.5 h).** Translate `schemas.ts` into real schemas (keep the scaffold's `users` schema). Implement `runtimeFrom()` in `deepspace.ts`: identity from the verified JWT, record access (unwrap `record.data` envelopes there), `llm`, `email`. Register the actions. Replace `invoke` in `lib/api.ts`.

**Step 5: wire pages (45 min).** Move pages into the scaffold's routing under `src/pages/(app)/` so they sit inside the auth boundary. Load the fonts listed in `styles/reccer.css`. Make `/recommender/claim?token=` survive the sign-in redirect (the token must still be in the URL after OAuth).

**Step 6: two-account verification (45 min).** Run `docs/ACCEPTANCE_TESTS.md` with two real accounts (student and recommender) on the deployed URL, plus a third account for the hijack checks. Add a `deepspace/testing` multi-user spec if time allows. Check `npx deepspace logs --follow --json` while doing it.

**Step 7: writeup and submit (30 min).** Fill `docs/WRITEUP_DRAFT.md` with what actually happened. Submit: live URL, repo, writeup.

## 5. Known gaps (fine to leave, list them in the writeup)

- The student cannot reopen a saved intake to edit it (there is no student-readable intake action yet). Add `getMyRequestIntake` (owner only, intake + questions, no answers) if time allows.
- Status updates on the student page use 15-second polling, not realtime, because of rule 2.
- File uploads (resume PDF) are not built; the fact sheet is pasted text.
- Deadline reminder emails (cron) are not built.
- The deterministic fallback draft keeps the recommender's grammar mostly as spoken; the LLM path is what polishes it.
- The proper-noun check is heuristic (capitalized, not sentence-initial). It can false-positive on capitalized common words; that only produces a flag the recommender can dismiss by editing, never a silent change.

## 6. Commands (in this folder)

```bash
npm install            # tsx, typescript, docx, @types/node
npm test               # 25 tests: core + actions + docx
npm run typecheck      # strict tsc over core, logic, fixtures, tests
npm run demo           # end-to-end on fictional data -> demo-output/
```

`tsconfig.core.json` is portable; it needs only the devDependencies in `package.json`.

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
| `app/src/` | The app code (see status table) |
| `tests/`, `fixtures/`, `scripts/` | Tests, fictional data, demo and UI-preview harness |
