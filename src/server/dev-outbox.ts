/**
 * Dev-only outbox, so the local two-account test can follow the invite link.
 *
 * Active only when ALLOW_DEBUG_ROUTES === "true", which `deepspace dev` and
 * `deepspace test` set locally and a deploy does not. Even then it only holds
 * mail addressed to @deepspace.test test accounts (never real inboxes); all
 * other mail goes through email/send as usual.
 *
 * Reading follows the same rule a real inbox does: the verified caller sees
 * only messages addressed to their own verified email. So the student still
 * cannot read the recommender's invite (HANDOFF rule 4).
 */

export interface OutboxMessage { to: string; subject: string; text: string; html?: string; replyTo?: string; at: string }

const box: OutboxMessage[] = []
const MAX = 200

export function devOutboxEnabled(env: { ALLOW_DEBUG_ROUTES?: string } | undefined): boolean {
  return env?.ALLOW_DEBUG_ROUTES === 'true'
}

/** True when this message was captured instead of sent. */
export function captureDevMail(env: { ALLOW_DEBUG_ROUTES?: string } | undefined, msg: Omit<OutboxMessage, 'at'>): boolean {
  if (!devOutboxEnabled(env) || !msg.to.toLowerCase().endsWith('@deepspace.test')) return false
  box.push({ to: msg.to.toLowerCase(), subject: msg.subject, text: msg.text, html: msg.html, replyTo: msg.replyTo, at: new Date().toISOString() })
  if (box.length > MAX) box.splice(0, box.length - MAX)
  return true
}

/** Messages held for one recipient (lowercased email). */
export function devMailFor(email: string): OutboxMessage[] {
  return box.filter((m) => m.to === email.toLowerCase())
}
