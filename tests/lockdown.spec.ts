/**
 * Pre-publication lockdown, end to end on the local dev server: a signed-in
 * non-owner account cannot spend the owner's credits through the browser
 * integrations proxy, and the local-assistant agent surface is not mounted.
 * The Reccer flow that legitimately uses these integrations (question
 * generation, assembly, invite/completion mail) runs server-side and is
 * covered by reccer.spec.ts.
 *
 * Needs the "Outsider C" test account (see reccer.spec.ts).
 */
import { test, expect, findTestAccountByName } from 'deepspace/testing'

const NAME = 'Outsider C'
const haveAccount = (() => {
  try { return !!findTestAccountByName(NAME) } catch { return false }
})()
test.skip(!haveAccount, `Needs a test account named ${NAME}.`)

test('signed-in non-owner is refused on owner-billed integrations and the agent surface', async ({ users }) => {
  const [outsider] = await users([NAME])
  const page = outsider.page
  await page.goto('/home')
  const statuses = await page.evaluate(async () => {
    const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
    const { token } = (await t.json()) as { token?: string }
    if (!token) return { token: false }
    const hit = async (path: string, body?: unknown) =>
      (await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      })).status
    return {
      token: true,
      anthropic: await hit('/api/integrations/anthropic/chat-completion', {
        model: 'claude-haiku-5-5', max_tokens: 1, messages: [{ role: 'user', content: 'x' }],
      }),
      email: await hit('/api/integrations/email/send', {
        to: 'outsider-c@deepspace.test', subject: 'lockdown probe', text: 'must not send',
      }),
      agentTools: await hit('/_deepspace/agent/browser/tools'),
      agentQuery: await hit('/_deepspace/agent/browser/tools/records_query', { input: { collection: 'answers' } }),
      // Server actions still work for the same account (refused on data it does not own, not on auth).
      action: (await fetch('/api/actions/listMyRequests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: '{}',
      })).status,
    }
  })
  expect(statuses).toEqual({ token: true, anthropic: 403, email: 403, agentTools: 404, agentQuery: 404, action: 200 })
})
