# Writeup draft (fill in from what actually happened; keep it short)

**Live:** https://<name>.app.space   **Repo:** <url>

## What I built
Reccer: AI assisted, not AI generated letters of recommendation. A student sets up a request with their programs and due dates; their recommender gets an email invite, signs in with their own account, and answers a short interview by typing or dictation. Reccer turns the answers into a draft made of the recommender's own words, checks in code that nothing was invented, and lets them edit and export to text, PDF, or Word. The student gets status updates, never the letter.

## DeepSpace features and integrations
**Platform features:** auth (Google or GitHub), records, server actions holding every permission check, per-user ownership, deploy.
**Integrations:**
- `<LLM endpoint>`, called twice: once to write neutral interview questions, once to clean up and order answers. Both outputs are validated by my code; both fall back to non-LLM paths; both are capped per request and behind sign-in.
- `email/send`: the invite to the recommender, and a status-only notice to the student.
**Left out on purpose:** payments, presence, collaborative editing, messaging, Google Workspace, search. None improves a letter (see `docs/DECISIONS.md`).

## Main tradeoff
<one paragraph, from DECISIONS.md: constrained assembly plus a deterministic claim check, over fluent generation.>

## What the agents did
- **Claude (claude.ai), stage 1, in a sandbox without network access:** designed the architecture; wrote the SDK-free core (question layers, leading-question validator, prompts, assembly, claim check, exports, invite tokens), all server-action logic and permission rules against a test runtime, 25 tests, and first drafts of the pages; rendered two pages in a headless browser. It could not install the SDK, so the SDK adapter, schemas, and client transport were marked unverified.
- **firstmate + Opus, stage 2:** <what they did: scaffold, verified integrations, implemented the adapter and schemas, routing, deploy. Pull from AGENT_LOG.md.>

## What I verified or changed myself
- <e.g. ran the two-account acceptance tests on the deployed URL: results>
- <e.g. checked the student could not reach answers or drafts by URL>
- <e.g. caught and fixed: …>
- <decisions I made: invite design instead of shared credentials; neutral questions with facts kept in memoryJog; …>

## Unfinished, and what I would do next
<from HANDOFF.md section 5, plus anything cut tonight>
