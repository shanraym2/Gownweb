'use client'

const CURRENT_USER_KEY = 'jce_current_user'

let handling401 = false

/**
 * Call this whenever an authenticated fetch comes back with res.status === 401.
 * Returns true if it acted on the failure (caller should stop / not fall back silently),
 * false if it's a no-op (e.g. guest, or a 401 already being handled).
 *
 * Deliberately does NOT fire for guests: if there's no jce_current_user in
 * localStorage, a 401 just means "not logged in", not "session expired" —
 * redirecting would be wrong and would loop guests into /login for no reason.
 */
export function handleAuthFailure(status) {
  if (status !== 401) return false
  if (typeof window === 'undefined') return false
  if (handling401) return true // a redirect is already in flight — swallow duplicates

  const hadSession = !!window.localStorage.getItem(CURRENT_USER_KEY)
  if (!hadSession) return false

  handling401 = true
  window.localStorage.removeItem(CURRENT_USER_KEY)
  window.location.href = '/login'
  return true
}