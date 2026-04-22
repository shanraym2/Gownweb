// app/admin/utils/useRoleGuard.js
//
// Centralized client-side RBAC hook.
//
// Usage:
//   const { user, ready } = useRoleGuard(['admin', 'staff'], '/login')
//   if (!ready) return null
//
// Props:
//   allowedRoles  — string[]  roles that may access this page
//   redirectTo    — string    path to redirect to on failure (default '/login')
//
// Returns:
//   { user, ready }
//   `ready` is false while the check is in flight or while redirecting.
//   Never render protected content until ready === true.

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser } from './authClient'

/**
 * @param {string[]} allowedRoles
 * @param {string}   [redirectTo='/login']
 * @returns {{ user: object|null, ready: boolean }}
 */
export function useRoleGuard(allowedRoles = [], redirectTo = '/login') {
  const router  = useRouter()
  const [user,  setUser ] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const u = getCurrentUser()

    if (!u || !allowedRoles.includes(u.role)) {
      router.replace(redirectTo)
      // keep ready=false so the caller renders nothing while navigating
      return
    }

    setUser(u)
    setReady(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // ^ intentionally empty — we only want this to run once on mount.
  //   router / allowedRoles are stable references in Next.js App Router.

  return { user, ready }
}