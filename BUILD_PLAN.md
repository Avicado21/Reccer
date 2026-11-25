# Reccer build plan

## Must-work path (the demo)
1. Student signs in, enters recommender, relationship, fact sheet, and programs (each with a due date).
2. Reccer builds the question set: fixed questions + generated middle (LLM call 1, validated) or the default bank.
3. Student reviews, removes questions that do not fit, sends the invite.
4. Recommender gets an email with programs and due dates, signs in with their own account, claims the invite.
5. Recommender answers one question at a time (typing, device dictation, or the Dictate button). Each answer autosaves.
6. Finish: LLM call 2 assembles only; the deterministic claim check runs; the draft opens.
7. Recommender clicks sentences to see the source answer, rewrites any flagged ones, then copies, saves as PDF, or downloads a Word file.
8. Student gets a status-only email and sees "Your recommender has a draft."

## Stage 1: done in the sandbox (Claude, claude.ai)
- [x] Domain types, three-layer question bank (fixed, fit-per-program, default middle)
- [x] Leading-question validator for generated questions
- [x] Prompts for LLM call 1 (questions) and call 2 (assembly, JSON with per-sentence sources)
- [x] Assembly validation, deterministic fallback assembly, per-program letters, form answers
- [x] Claim check: numbers, names, ranking words, heavy rewrites, unused answers
- [x] Invite tokens (hashed at rest), invite and completion emails
- [x] Exports: plain text, print-to-PDF HTML, .docx
- [x] All server-action logic and permission rules against a `Runtime` interface
- [x] 25 tests, strict typecheck, end-to-end demo, rendered UI check of interview and draft
- [x] Pages for student home, new request, claim, interview, draft (SDK calls isolated in `lib/api.ts`)

## Stage 2: firstmate + Opus (see HANDOFF.md section 4 for the ordered steps)
- [ ] Scaffold, empty deploy, source authority chosen
- [ ] Verify integrations with `integrations info`; fix endpoint names and shapes
- [ ] Real schemas; adapter `runtimeFrom()`; action registration; client transport
- [ ] Routing and auth boundary; token survives sign-in redirect
- [ ] Two-account acceptance tests on the deployed URL
- [ ] Writeup and submit

## Nice to have, in this order (only after stage 2 is deployed and tested)
1. `getMyRequestIntake` so students can reopen and edit a saved intake
2. `deepspace/testing` multi-user Playwright spec for the student-cannot-read rule
3. Resume upload via file storage (recommender read-only)
4. Deadline reminder email via a scheduled job, a few days before the earliest due date
5. Realtime status (only if row-level read rules are confirmed)

## Timeline for Nov 25 (ET)
| By | Milestone |
|---|---|
| +1 h from start | Scaffolded, empty app deployed, code copied, `npm test` green in the new repo |
| +3 h | Adapter working locally: create request through finish, on one account plus a second browser profile |
| +4 h | Deployed; acceptance tests passing |
| ~9 PM | Feature freeze; writeup |
| ~10 PM | Submitted |
