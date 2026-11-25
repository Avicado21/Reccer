// Keeps /recommender/claim?token=... alive across the OAuth sign-in round trip.
//
// Why: the scaffold's social sign-in (src/server/http-routes.ts) always lands a
// freshly signed-in user on /home, so the invite token in the URL is lost.
// Fix: while signed out on the claim page, remember the token in this tab's
// sessionStorage (same origin, same tab, cleared when the tab closes; never
// sent to the server). After sign-in, wherever the app lands, put the token
// back in the URL by navigating to /recommender/claim?token=<token>.

export const CLAIM_PATH = '/recommender/claim'
const KEY = 'reccer.pendingClaim'
const MAX_AGE_MS = 60 * 60 * 1000 // a sign-in round trip, not a long-lived store

interface Pending { token: string; at: number }

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function store(): StorageLike | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}

/** On any app page: if this is a claim URL with a token, remember it. */
export function rememberClaimToken(pathname: string, search: string, s: StorageLike | null = store(), now = Date.now()): void {
  if (!s || pathname.replace(/\/+$/, '') !== CLAIM_PATH) return
  const token = new URLSearchParams(search).get('token')
  if (token) s.setItem(KEY, JSON.stringify({ token, at: now } satisfies Pending))
}

/** Signed in and not on the claim page: the URL to return to, if a fresh token is pending. Consumes it. */
export function pendingClaimUrl(pathname: string, s: StorageLike | null = store(), now = Date.now()): string | null {
  if (!s || pathname.replace(/\/+$/, '') === CLAIM_PATH) return null
  const raw = s.getItem(KEY)
  if (!raw) return null
  s.removeItem(KEY)
  try {
    const p = JSON.parse(raw) as Pending
    if (typeof p?.token !== 'string' || !p.token || typeof p.at !== 'number' || now - p.at > MAX_AGE_MS) return null
    return `${CLAIM_PATH}?token=${encodeURIComponent(p.token)}`
  } catch {
    return null
  }
}

/** Called by the claim page once it has the token in hand and is signed in. */
export function clearPendingClaim(s: StorageLike | null = store()): void {
  s?.removeItem(KEY)
}
