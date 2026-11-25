# Kickoff prompt for the coding agent

Paste this as the first message, with the repo folder open.

---

You are finishing **Reccer**, a DeepSpace app, for a build exercise due tonight (Nov 25, 2026, 11:59 PM ET). Read `HANDOFF.md` fully before doing anything, then `docs/PRODUCT_SPEC.md` and `docs/SDK_NOTES.md`.

Your job is HANDOFF.md section 4, steps 0 through 6, in order. Most of the logic is already written and tested; your main work is the SDK adapter (`app/src/actions/deepspace.ts`), real schemas (`app/src/schemas.ts`), the client transport (`app/src/lib/api.ts`), and routing.

Working rules:
- Follow HANDOFF.md section 3 (hard rules) exactly. Treat them as requirements, not suggestions.
- Read the DeepSpace docs and the installed `.d.ts` files before writing SDK code. Fetch `https://docs.deep.space/llms.txt`, then 1–2 pages as Markdown (append `.md`). Run `npx deepspace integrations info <endpoint>` before any integration call. Never guess an API shape; if the docs and types disagree, the installed types win.
- Do not modify `app/src/core/` or `app/src/actions/logic.ts` unless a test proves a bug. If you must, add or update a test in the same change.
- Run `npm test` after every change. All tests must stay green.
- Before every step that registers, deploys, pushes, or changes source authority, stop and tell me what you are about to run and why.
- When a CLI command refuses, branch on its `code` and run its `action` if one is shipped. If no action is shipped, stop and ask me.
- Keep a running log in `docs/AGENT_LOG.md`: each step, the commands you ran, what failed, and what you changed. I will use it for the writeup.
- At the end of each step, give me a short summary: what works, what you verified and how, what is still unverified.

Start with step 0. Do not begin step 1 until I confirm `auth whoami` shows the right account.
