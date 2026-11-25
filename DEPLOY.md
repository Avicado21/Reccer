# Deploying Reccer

Run these from **your own checkout** (the folder whose `origin` is the GitHub repo), after the
branch is merged and pushed. The app is already registered: `wrangler.toml` carries
`DEEPSPACE_APP_ID = "app_01M8AE4W9WV4VFCW5EZXKXCB0H"`, minted by `deepspace app init` under
your login. Nothing has been deployed or pushed to DeepSpace yet, so source authority is still
**unclaimed**. Your first deploy decides it permanently (see step 3).

Requirements: Node 22.15+, 24, or 26 and **npm 11.6+** (`npm -v`).

## 1. Get the code and check who you are

```bash
git pull
npm install
npx deepspace auth whoami --json      # must be your developer account (the app's owner)
# if not logged in:  npx deepspace auth login
```

## 2. Secrets: none needed

Reccer calls only platform integrations (`anthropic/chat-completion`, `email/send`), billed to
your DeepSpace credits through `src/integrations.ts`. It needs **no API keys**. Check that the store is empty:

```bash
npx deepspace secrets list
```

If a secret is ever needed, use `npx deepspace secrets set KEY --stdin` and never write `.dev.vars` by
hand. The CLI regenerates `.dev.vars` on every dev, test, and deploy run, and git ignores it.

## 3. Confirm the source authority before the first deploy

The first deploy from a checkout with a GitHub remote **claims that GitHub repository
permanently**. Without one, it claims DeepSpace source. There is no undo.

```bash
git remote -v                         # origin must be the GitHub repo you want to own the app
npx deepspace app source --json       # expect: unclaimed
npx deepspace status --json           # sourceInference: what this deploy will do
```

Do **not** run `npx deepspace push` before this first deploy, because that would claim DeepSpace source.

## 4. Test locally

```bash
npm run typecheck                     # strict tsc: core/logic/tests, then the whole app
npm test                              # 34 unit tests (core, actions, docx, adapter)
npx deepspace test accounts list --usable
npx deepspace test run e2e            # 12 Playwright tests incl. tests/reccer.spec.ts
```

`tests/reccer.spec.ts` needs test accounts named `Student A`, `Recommender B`, `Outsider C`.
They already exist on the machine that built this. Elsewhere, create them as follows (emails are global, so add a suffix):

```bash
openssl rand -base64 18 | npx deepspace test accounts create --email student-a-<suffix>@deepspace.test --name "Student A" --password-stdin
```

The spec makes one real question-generation call and one real assembly call (owner-billed). Mail to
`@deepspace.test` is held by the dev-only outbox instead of being sent.

## 5. Deploy

```bash
npx deepspace deploy
```

The app goes live at `https://reccer.app.space`.

## 6. Watch it

```bash
npx deepspace logs --follow --json    # every action logs "[action] <name> caller=<userId>"
npx deepspace releases
npx deepspace app usage
```

Then run `docs/ACCEPTANCE_TESTS.md` on the live URL with real accounts: a student, a
recommender, and a third account for the hijack checks. On the deployed app the dev outbox is off
(`ALLOW_DEBUG_ROUTES` is unset), so invites arrive as real email from
`DeepSpace Apps <notifications@updates.app.space>`.

## Known limitation to state in the writeup

An invite link can be claimed by **whoever signs in with it first**. The signed-in email does not
have to match the address the student entered. This is deliberate, so a recommender can sign in with a
different Google or GitHub account than the one the student knows. A forwarded link therefore works
for the person it was forwarded to. After the first claim, any other account is refused, and the
student's own account is always refused.
