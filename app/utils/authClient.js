'use client'

import { clearAllCarts } from './cartClient'
import { isRealName, passwordMeetsRules } from './authValidation'

const USERS_KEY = 'jce_users'
const CURRENT_USER_KEY = 'jce_current_user'

function safeGetItem(key) {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(key)
}

function safeSetItem(key, value) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, value)
}

export function loadUsers() {
  try {
    const raw = safeGetItem(USERS_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function saveUsers(users) {
  safeSetItem(USERS_KEY, JSON.stringify(users))
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isStrongPassword(password) {
  return passwordMeetsRules(password)
}

async function hashPassword(password) {
  if (typeof window === 'undefined' || !window.crypto?.subtle) return String(password || '')
  const data = new TextEncoder().encode(String(password || ''))
  const digest = await window.crypto.subtle.digest('SHA-256', data)
  const bytes = Array.from(new Uint8Array(digest))
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ─── NEW: fetch role from server ──────────────────────────────────────────────
// Calls /api/check-role which compares against ADMIN_EMAIL env var.
// Falls back to 'customer' on any error so auth never breaks.
async function fetchRoleFromServer(email) {
  try {
    const res = await fetch(`/api/check-role?email=${encodeURIComponent(email)}`)
    const data = await res.json()
    return data.ok ? (data.role ?? 'customer') : 'customer'
  } catch {
    return 'customer'
  }
}

export async function registerUser({ name, email, password }) {
  const cleanName = String(name || '').trim()
  const cleanEmail = normalizeEmail(email)
  const cleanPassword = String(password || '')

  const normalizedName = cleanName.replace(/\s+/g, ' ').trim()
  if (!isRealName(normalizedName)) {
    return {
      ok: false,
      error:
        'Use your real name: letters only, spaces between words. Hyphens and apostrophes are OK (e.g. O\'Brien). No numbers or symbols.',
    }
  }
  if (!isValidEmail(cleanEmail)) {
    return { ok: false, error: 'Please enter a valid email address.' }
  }
  if (!isStrongPassword(cleanPassword)) {
    return { ok: false, error: 'Password must be at least 8 characters and include letters and numbers.' }
  }

  const users = loadUsers()
  const existing = users.find((u) => normalizeEmail(u.email) === cleanEmail)
  if (existing) {
    return { ok: false, error: 'An account with this email already exists.' }
  }

  const passwordHash = await hashPassword(cleanPassword)

  // FIX 1: resolve role from server so admin email is tagged correctly at signup
  const role = await fetchRoleFromServer(cleanEmail)

  const newUser = {
    id: Date.now(),
    name: normalizedName,
    email: cleanEmail,
    passwordHash,
    role, // FIX 2: persist role on the user record so loginUser can read it later
  }

  const updated = [...users, newUser]
  saveUsers(updated)

  const session = { id: newUser.id, name: newUser.name, email: newUser.email, role }
  safeSetItem(CURRENT_USER_KEY, JSON.stringify(session))
  return { ok: true, user: newUser }
}

/** Check email + password without creating a session (use before sending login OTP). */
export async function verifyLoginCredentials({ email, password }) {
  const cleanEmail = normalizeEmail(email)
  const cleanPassword = String(password || '')
  if (!isValidEmail(cleanEmail)) {
    return { ok: false, error: 'Invalid email or password.' }
  }

  const users = loadUsers()
  const passwordHash = await hashPassword(cleanPassword)
  const match = users.find((u) => {
    const userEmail = normalizeEmail(u.email)
    const storedHash = u.passwordHash || ''
    const storedPlain = u.password || ''
    return userEmail === cleanEmail && (storedHash === passwordHash || storedPlain === cleanPassword)
  })

  if (!match) {
    return { ok: false, error: 'Invalid email or password.' }
  }
  return { ok: true }
}

export async function loginUser({ email, password }) {
  const check = await verifyLoginCredentials({ email, password })
  if (!check.ok) return check

  const users = loadUsers()
  const cleanEmail = normalizeEmail(email)
  const match = users.find((u) => normalizeEmail(u.email) === cleanEmail)
  if (!match) return { ok: false, error: 'Invalid email or password.' }

  // FIX 3: always re-sync role from server on login so ADMIN_EMAIL changes
  // take effect immediately without re-registering
  const role = await fetchRoleFromServer(cleanEmail)

  // FIX 4: persist the refreshed role back onto the stored user record
  if (role !== match.role) {
    const updatedUsers = users.map((u) =>
      normalizeEmail(u.email) === cleanEmail ? { ...u, role } : u
    )
    saveUsers(updatedUsers)
  }

  const session = { id: match.id, name: match.name, email: match.email, role }
  safeSetItem(CURRENT_USER_KEY, JSON.stringify(session))
  return { ok: true, user: { ...match, role } }
}

/** Reset an existing user's password (client-side localStorage update). */
export async function resetUserPassword({ email, password }) {
  const cleanEmail = normalizeEmail(email)
  const cleanPassword = String(password || '')

  if (!isValidEmail(cleanEmail)) {
    return { ok: false, error: 'Please enter a valid email address.' }
  }
  if (!isStrongPassword(cleanPassword)) {
    return { ok: false, error: 'Password must be at least 8 characters and include letters and numbers.' }
  }

  const users = loadUsers()
  const idx = users.findIndex((u) => normalizeEmail(u.email) === cleanEmail)
  if (idx === -1) {
    return { ok: false, error: 'No account found with this email.' }
  }

  const passwordHash = await hashPassword(cleanPassword)
  const updatedUser = { ...users[idx], passwordHash }
  const updated = [...users]
  updated[idx] = updatedUser
  saveUsers(updated)

  const session = {
    id: updatedUser.id,
    name: updatedUser.name,
    email: updatedUser.email,
    role: updatedUser.role || 'customer',
  }
  safeSetItem(CURRENT_USER_KEY, JSON.stringify(session))

  return { ok: true, user: updatedUser }
}

export function getCurrentUser() {
  try {
    const raw = safeGetItem(CURRENT_USER_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function setCurrentUserRole(role) {
  const user = getCurrentUser()
  if (!user) return
  safeSetItem(CURRENT_USER_KEY, JSON.stringify({ ...user, role: role || 'customer' }))
}

export function logoutUser() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(CURRENT_USER_KEY)
}

/** Clears all registered users, current session, and all carts (this browser only). */
export function resetAllUsers() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(USERS_KEY)
  window.localStorage.removeItem(CURRENT_USER_KEY)
  clearAllCarts()
}

export async function updateUser({ name, email, password } = {}) {
  const current = getCurrentUser()
  if (!current) return { ok: false, error: 'Not logged in.' }

  const users = loadUsers()
  const idx = users.findIndex((u) => normalizeEmail(u.email) === normalizeEmail(current.email))
  if (idx === -1) return { ok: false, error: 'User not found.' }

  const updates = {}

  if (name !== undefined) {
    const cleanName = String(name).trim().replace(/\s+/g, ' ')
    if (!isRealName(cleanName)) {
      return {
        ok: false,
        error: "Use your real name: letters only, spaces, hyphens, and apostrophes.",
      }
    }
    updates.name = cleanName
  }

  if (email !== undefined) {
    const cleanEmail = normalizeEmail(email)
    if (!isValidEmail(cleanEmail)) {
      return { ok: false, error: 'Please enter a valid email address.' }
    }
    const taken = users.some(
      (u, i) => i !== idx && normalizeEmail(u.email) === cleanEmail
    )
    if (taken) return { ok: false, error: 'That email is already in use.' }
    updates.email = cleanEmail
  }

  if (password !== undefined && password !== '') {
    if (!isStrongPassword(String(password))) {
      return { ok: false, error: 'Password must be at least 8 characters and include letters and numbers.' }
    }
    updates.passwordHash = await hashPassword(String(password))
  }

  const updatedUser = { ...users[idx], ...updates }
  const updatedList = [...users]
  updatedList[idx] = updatedUser
  saveUsers(updatedList)

  const session = {
    id: updatedUser.id,
    name: updatedUser.name,
    email: updatedUser.email,
    role: updatedUser.role || 'customer',
  }
  safeSetItem(CURRENT_USER_KEY, JSON.stringify(session))

  return { ok: true, user: updatedUser }
}

// ─── One-time repair for existing accounts ────────────────────────────────────
/**
 * Call this once in your root layout (useEffect).
 * Silently re-syncs the logged-in user's role from the server.
 * Fixes any existing account that was registered before this patch.
 *
 * Usage in layout.js:
 *   import { syncCurrentUserRole } from '@/utils/authClient'
 *   useEffect(() => { syncCurrentUserRole() }, [])
 */
export async function syncCurrentUserRole() {
  const raw = safeGetItem(CURRENT_USER_KEY)
  if (!raw) return

  let current
  try { current = JSON.parse(raw) } catch { return }
  if (!current?.email) return

  const role = await fetchRoleFromServer(current.email)
  if (role === current.role) return // already correct

  // Update session
  safeSetItem(CURRENT_USER_KEY, JSON.stringify({ ...current, role }))

  // Update stored user record too
  const users = loadUsers()
  const updated = users.map((u) =>
    normalizeEmail(u.email) === normalizeEmail(current.email) ? { ...u, role } : u
  )
  saveUsers(updated)
}