/**
 * Reccer end to end on the local dev server, three real (test) accounts:
 * student -> invite -> recommender claims across a simulated sign-in round
 * trip -> interview -> draft, plus the permission checks from
 * docs/ACCEPTANCE_TESTS.md (student never reads answers/drafts, the invite
 * token never reaches the student, a second account cannot reuse the link).
 *
 * Run: npx deepspace test run tests/reccer.spec.ts
 * Needs test accounts named "Student A", "Recommender B", "Outsider C"
 * (npx deepspace test accounts create --email <x>@deepspace.test --name "<Name>" --password-stdin).
 *
 * Mail: under `deepspace dev`/`test`, mail to @deepspace.test is captured by the
 * dev outbox (src/server/dev-outbox.ts), readable only by its recipient.
 * The LLM is real (anthropic/chat-completion, owner-billed): one question
 * generation and one assembly per run, no loops. Either outcome is accepted,
 * because generation and assembly both fall back by design.
 */
import { test, expect, findTestAccountByName, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'

const NAMES = ['Student A', 'Recommender B', 'Outsider C']
const haveAccounts = NAMES.every((n) => {
  try { return !!findTestAccountByName(n) } catch { return false }
})
test.skip(!haveAccounts, `Needs test accounts named ${NAMES.join(', ')} (found ${loadAllTestAccounts().length}).`)

type Wire = { success: boolean; data?: any; error?: string; code?: string }

/** Call a server action exactly the way src/lib/api.ts does, as the page's signed-in user. */
async function call(page: Page, name: string, input: unknown = {}): Promise<Wire> {
  return page.evaluate(async ([n, i]) => {
    const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
    const { token } = (await t.json()) as { token?: string }
    const r = await fetch(`/api/actions/${n}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(i),
    })
    return r.json()
  }, [name, input] as const)
}

type Mail = { to: string; subject: string; text: string; html?: string; replyTo?: string }
async function outbox(page: Page): Promise<Mail[]> {
  return page.evaluate(async () => {
    const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
    const { token } = (await t.json()) as { token?: string }
    const r = await fetch('/api/dev/outbox', { headers: { Authorization: `Bearer ${token}` } })
    return ((await r.json()) as { data: Mail[] }).data
  })
}

const LONG = (s: string) =>
  `${s} She took ownership of the work from the first week and kept everyone informed. ` +
  'When a deadline moved up, she reorganized the plan herself and still delivered on time.'

test('student to recommender, with permission checks', async ({ users }) => {
  test.setTimeout(240_000)
  const [student, rec, outsider] = await users(NAMES)
  const run = `__test-${Date.now()}__`

  // ---- Student: intake -> questions -> invite (UI) ----
  const s = student.page
  await s.goto('/student/new')
  await s.getByLabel('Your full name').fill(`Jordan Rivera ${run}`)
  await s.getByLabel("Recommender's name").fill('Dr. Morgan Lee')
  await s.getByLabel("Recommender's email").fill(rec.email)
  await s.getByLabel('How you know them').fill('My supervisor at my research internship')
  await s.getByLabel('Background they might want to look up').fill('Built the lab sample tracker in summer 2025.')
  await s.getByLabel('A note to your recommender').fill('Thank you for doing this! <b>Not bold</b>')
  await s.getByLabel('School').fill('Northfield University')
  await s.getByLabel('Program', { exact: true }).fill('MS in Data Science')
  await s.getByLabel('Letter due').fill('2026-12-15')
  await s.getByRole('button', { name: 'Create questions' }).click()
  await expect(s.getByRole('heading', { name: 'Review the questions' })).toBeVisible({ timeout: 120_000 })
  await s.getByRole('button', { name: 'Send invite' }).click()
  await expect(s.getByRole('heading', { name: /Invite sent to/ })).toBeVisible({ timeout: 60_000 })

  const mine = await call(s, 'listMyRequests')
  expect(mine.success).toBe(true)
  const req = mine.data.find((r: any) => r.status === 'invited' && r.recommenderName === 'Dr. Morgan Lee')
  expect(req).toBeTruthy()
  const requestId: string = req.requestId
  // The student's status view carries no token and no content.
  expect(JSON.stringify(mine.data)).not.toMatch(/token|answers|assembly/i)
  // The student cannot read the recommender's mail.
  expect((await outbox(s)).some((m) => m.to === rec.email.toLowerCase())).toBe(false)

  // ---- Invite email -> token ----
  const r = rec.page
  await r.goto('/home')
  const invite = (await outbox(r)).filter((m) => m.text.includes('/recommender/claim?token=')).pop()
  expect(invite, 'invite email captured for the recommender').toBeTruthy()
  const token = invite!.text.match(/claim\?token=([A-Za-z0-9_-]+)/)![1]
  expect(invite!.text).toContain('Northfield University')
  // HTML alongside text: a button to the same link, the note quoted and escaped, replies to the student.
  expect(invite!.html).toContain('Start your letter')
  expect(invite!.html).toContain(`claim?token=${token}`)
  expect(invite!.text).toContain('A note from Jordan Rivera')
  expect(invite!.text).toContain('> Thank you for doing this! <b>Not bold</b>')
  expect(invite!.html).toContain('Thank you for doing this! &lt;b&gt;Not bold&lt;/b&gt;')
  expect(invite!.replyTo?.toLowerCase()).toBe(student.email.toLowerCase())

  // The student's own account is refused, even holding the link.
  const selfClaim = await call(s, 'claimInvite', { token })
  expect(selfClaim).toMatchObject({ success: false, code: 'forbidden' })

  // ---- Recommender: token survives the sign-in round trip ----
  const session = await rec.context.cookies()
  await rec.context.clearCookies()
  await r.goto(`/recommender/claim?token=${token}`)
  await expect(r.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible({ timeout: 30_000 })
  // OAuth returns with a session cookie and always lands on /home (src/server/http-routes.ts).
  await rec.context.addCookies(session)
  await r.goto('/home')
  await expect(r).toHaveURL(/\/recommender\/interview\?id=/, { timeout: 30_000 })
  expect(new URL(r.url()).searchParams.get('id')).toBe(requestId)

  // ---- Outsider: a second account cannot reuse the claimed link ----
  const o = outsider.page
  await o.goto('/home')
  expect(await call(o, 'claimInvite', { token })).toMatchObject({ success: false, code: 'conflict' })
  expect(await call(o, 'getInterview', { requestId })).toMatchObject({ success: false, code: 'forbidden' })
  expect(await call(o, 'getDraft', { requestId })).toMatchObject({ success: false, code: 'forbidden' })

  // ---- Recommender: interview (UI) ----
  const iv = await call(r, 'getInterview', { requestId })
  const generated = iv.data.questions.filter((q: any) => q.source === 'generated').length
  console.log(`[reccer.spec] questions: ${iv.data.questions.length}, generated by the model: ${generated}`)
  await expect(r.locator('p.question')).toBeVisible({ timeout: 30_000 })
  await expect(r.getByText('Thank you for doing this! <b>Not bold</b>')).toBeVisible()
  expect(JSON.stringify(iv.data.questions)).not.toContain('Thank you for doing this')
  const answer = r.locator('#answer')
  await answer.fill(LONG('I supervised Jordan for ten weeks on our lab data team.'))
  await r.getByRole('button', { name: 'Save and continue' }).click()
  await expect(r.getByText('Question 2 of')).toBeVisible()
  await answer.fill(LONG('Jordan rebuilt our sample tracker so the whole lab could use it.'))
  await r.getByRole('button', { name: 'Save and continue' }).click()
  await expect(r.getByText('Question 3 of')).toBeVisible()
  await r.getByRole('button', { name: 'Jump to the last question' }).click()
  await answer.fill(LONG('I recommend Jordan without reservation.'))
  await r.getByRole('button', { name: 'Finish and build draft' }).click()
  await expect(r).toHaveURL(/\/recommender\/draft\?id=/, { timeout: 120_000 })
  await expect(r.getByRole('heading', { name: 'Your draft' })).toBeVisible({ timeout: 60_000 })
  await expect(r.getByText('I recommend Jordan Rivera')).toBeVisible()

  const draft = await call(r, 'getDraft', { requestId })
  expect(draft.success).toBe(true)
  expect(['llm', 'deterministic']).toContain(draft.data.assembly.mode)
  console.log(`[reccer.spec] assembly mode: ${draft.data.assembly.mode}, flags: ${draft.data.flags.length}`)

  // ---- Student: status only, never content ----
  expect(await call(s, 'getInterview', { requestId })).toMatchObject({ success: false, code: 'forbidden' })
  expect(await call(s, 'getDraft', { requestId })).toMatchObject({ success: false, code: 'forbidden' })
  expect(await call(s, 'saveEdit', { requestId, paragraph: 0, sentence: 0, text: 'x' })).toMatchObject({ success: false, code: 'forbidden' })
  const after = await call(s, 'listMyRequests')
  expect(after.data.find((x: any) => x.requestId === requestId).status).toBe('finished')
  const done = (await outbox(s)).filter((m) => m.to === student.email.toLowerCase()).pop()
  expect(done, 'completion email captured for the student').toBeTruthy()
  expect(done!.text).not.toContain('sample tracker')
  expect(done!.html).toBeTruthy()
  expect(done!.html).not.toContain('sample tracker')
  expect(done!.replyTo).toBeFalsy()

  // Anonymous callers get nothing.
  const anon = await r.request.post('/api/actions/listMyRequests', { data: {} })
  expect(anon.status()).toBe(401)
})

/**
 * Stage 2 paths: reopen and edit a saved request, resend and cancel the invite,
 * the student's status view, and the deadline-reminder job through the real
 * cron path (buildCronContext -> RecordRoom) via the dev-only trigger.
 * One real question generation; no assembly.
 */
test('reopen and edit, resend and cancel, reminders', async ({ users }) => {
  test.setTimeout(240_000)
  const [student, rec] = await users(NAMES.slice(0, 2))
  const run = `__test-${Date.now()}__`
  const recName = `Dr. Casey Park ${run}`
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10) // inside the 7-day window

  // ---- Create with a typo in the recommender's email ----
  const s = student.page
  await s.goto('/student/new')
  await s.getByLabel('Your full name').fill('Riley Chen')
  await s.getByLabel("Recommender's name").fill(recName)
  await s.getByLabel("Recommender's email").fill(`typo-${Date.now()}@deepspace.test`)
  await s.getByLabel('How you know them').fill('My advisor for my senior thesis')
  await s.getByLabel('Background they might want to look up').fill('Thesis on river sediment sensors.')
  await s.getByLabel('School').fill('Eastlake University')
  await s.getByLabel('Program', { exact: true }).fill('MS in Environmental Data')
  await s.getByLabel('Letter due').fill(soon)
  await s.getByRole('button', { name: 'Create questions' }).click()
  await expect(s.getByRole('heading', { name: 'Review the questions' })).toBeVisible({ timeout: 120_000 })
  await expect(s).toHaveURL(/\/student\/new\?id=/)
  const requestId = new URL(s.url()).searchParams.get('id')!

  // ---- Reopen from the home page and fix the email (contact fixes keep the questions) ----
  await s.goto('/student')
  await s.locator('li', { hasText: run }).getByRole('link', { name: 'Review and send' }).click()
  await expect(s.getByRole('heading', { name: 'Review the questions' })).toBeVisible({ timeout: 30_000 })
  await s.getByRole('button', { name: 'Edit details' }).click()
  await expect(s.getByLabel('Your full name')).toHaveValue('Riley Chen')
  await s.getByLabel("Recommender's email").fill(rec.email)
  await s.getByRole('button', { name: 'Save and review questions' }).click()
  await expect(s.getByRole('heading', { name: 'Review the questions' })).toBeVisible({ timeout: 30_000 })
  const reopened = await call(s, 'getMyRequestIntake', { requestId })
  expect(reopened.success).toBe(true)
  expect(reopened.data.intake.recommenderEmail).toBe(rec.email)
  expect(reopened.data.questionsStale).toBe(false)
  expect(JSON.stringify(reopened.data)).not.toMatch(/tokenHash|claimedEmail|assembly/)
  // Nobody else can read or edit it.
  await rec.page.goto('/home')
  expect(await call(rec.page, 'getMyRequestIntake', { requestId })).toMatchObject({ success: false, code: 'forbidden' })
  expect(await call(rec.page, 'updateIntake', { requestId, intake: reopened.data.intake })).toMatchObject({ success: false, code: 'forbidden' })

  // ---- Send, then resend: the first link is superseded ----
  await s.getByRole('button', { name: 'Send invite' }).click()
  await expect(s.getByRole('heading', { name: /Invite sent to/ })).toBeVisible({ timeout: 60_000 })
  await expect(s.getByText(/not opened yet/)).toBeVisible()
  const invites = async () => (await outbox(rec.page)).filter((m) => m.text.includes('/recommender/claim?token=') && m.text.includes('Eastlake University'))
  const first = (await invites()).pop()!.text.match(/claim\?token=([A-Za-z0-9_-]+)/)![1]
  await s.getByRole('button', { name: 'Resend invite' }).click()
  await expect.poll(async () => (await invites()).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
  const second = (await invites()).pop()!.text.match(/claim\?token=([A-Za-z0-9_-]+)/)![1]
  expect(second).not.toBe(first)
  const superseded = await call(rec.page, 'claimInvite', { token: first })
  expect(superseded).toMatchObject({ success: false, code: 'invalid' })
  expect(superseded.error).toMatch(/newer invite/)

  // ---- Cancel: the live link stops working and the request unlocks ----
  s.once('dialog', (d) => d.accept())
  await s.getByRole('button', { name: 'Cancel invite' }).click()
  await expect(s.getByRole('heading', { name: 'Review the questions' })).toBeVisible({ timeout: 30_000 })
  const cancelled = await call(rec.page, 'claimInvite', { token: second })
  expect(cancelled).toMatchObject({ success: false, code: 'invalid' })
  expect(cancelled.error).toMatch(/cancelled/)

  // ---- Send again; the recommender accepts; the student sees status only ----
  await s.getByRole('button', { name: 'Send invite' }).click()
  await expect(s.getByRole('heading', { name: /Invite sent to/ })).toBeVisible({ timeout: 60_000 })
  const third = (await invites()).pop()!.text.match(/claim\?token=([A-Za-z0-9_-]+)/)![1]
  expect(await call(rec.page, 'claimInvite', { token: third })).toMatchObject({ success: true, data: { requestId } })
  await s.goto('/student')
  await expect(s.locator('li', { hasText: run }).getByText(/^Accepted /)).toBeVisible({ timeout: 30_000 })
  const status = (await call(s, 'listMyRequests')).data.find((x: any) => x.requestId === requestId)
  expect(status.invite).toMatchObject({ claimed: true, sendCount: 3 })
  expect(JSON.stringify(status)).not.toContain(rec.email)

  // ---- Reminders through the real cron path (dev trigger; test inboxes only) ----
  const trigger = async (p: Page) => p.evaluate(async () => {
    const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
    const { token } = (await t.json()) as { token?: string }
    const r = await fetch('/api/dev/cron/deadline-reminders', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    return { status: r.status, body: await r.json() }
  })
  const fired = await trigger(s)
  expect(fired.status).toBe(200)
  const mineSent = fired.body.data.sent.filter((x: any) => x.requestId === requestId).map((x: any) => x.to).sort()
  expect(mineSent).toEqual(['recommender', 'student'])
  const toStudent = (await outbox(s)).filter((m) => m.subject.includes('status of your request') && m.subject.includes(run)).pop()
  expect(toStudent, 'status-only reminder for the student').toBeTruthy()
  expect(toStudent!.text).toContain('status update only')
  expect(toStudent!.text).not.toMatch(/token=/)
  const toRec = (await outbox(rec.page)).filter((m) => m.subject.startsWith('Reminder:') && m.text.includes(`/recommender/interview?id=${requestId}`)).pop()
  expect(toRec, 'nudge with a resume link for the recommender').toBeTruthy()
  expect(toRec!.html).toContain('Pick up where you left off')
  expect(toRec!.replyTo?.toLowerCase()).toBe(student.email.toLowerCase())
  // Same window again: nothing new for this request.
  const again = await trigger(s)
  expect(again.body.data.sent.filter((x: any) => x.requestId === requestId)).toEqual([])
})
