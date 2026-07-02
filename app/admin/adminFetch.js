// app/admin/adminFetch.js
// Shared fetch wrapper for all admin API calls.
// Automatically attaches X-Admin-Secret and X-Actor-Email headers.

import { getAdminSecret } from './adminSecret'
import { getCurrentUser } from '../utils/authClient'

export function adminFetch(url, options = {}) {
  const secret = getAdminSecret()
  const user   = getCurrentUser()

  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Admin-Secret': secret || '',
      'X-Actor-Email':  user?.email || '',
    },
  })
}