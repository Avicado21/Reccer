# Reccer

**AI assisted, not AI generated letters of recommendation.** Built on [DeepSpace](https://deep.space) for the DeepSpace build exercise.

A student sets up a request with their programs and due dates. Their recommender is invited by email, signs in with their own account, and answers a short interview by typing or dictation. Reccer turns the answers into a draft letter made of the recommender's own words, checks in code that nothing was invented, and lets them edit and export. The student sees status only.

**Start here:** [`HANDOFF.md`](HANDOFF.md).

## How it is built
- `src/core/`: pure TypeScript, no SDK. The question bank, the leading-question validator, the LLM prompts, assembly, the claim check, letters, exports, invite tokens.
- `src/actions/logic.ts`: every server action and permission rule, written against a small `Runtime` interface so it is testable without the SDK.
- `src/actions/deepspace.ts`, `src/schemas.ts` (+ `src/schemas/reccer-schemas.ts`), `src/lib/api.ts`: the Reccer files that touch the DeepSpace SDK. The rest of the shell (`worker.ts`, `src/server/`, `src/pages/(app)/_layout.tsx`) is the DeepSpace starter scaffold.
- Deploying: [`DEPLOY.md`](DEPLOY.md).

```bash
npm install && npm test   # 64 tests
npm run demo              # end-to-end on fictional data -> demo-output/
```

## AI use disclosure
This project was built with AI coding tools, as the exercise allows.

- **Stage 1 (design and first build): Claude (Anthropic), in claude.ai,** directed by Avinash Kottakota. Claude wrote the architecture, the SDK-free core, the server-action logic and permission rules, the tests, the page drafts, and these docs. It worked in a sandbox with no network access, so it could not install the DeepSpace SDK; the three SDK-facing files were left marked `SDK-VERIFY`.
- **Stage 2 (SDK integration, refactoring, testing, deploy): firstmate and Claude Opus,** directed by Avinash Kottakota. See `docs/AGENT_LOG.md`.
- **Product decisions by Avinash Kottakota:** the idea and the original voice-interview kit it grew from, the student-to-recommender flow, programs and due dates on the invite, LLM-generated questions with a separate assembly step, and export formats.

All demo data is fictional.
