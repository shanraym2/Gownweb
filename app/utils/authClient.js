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
  const newUser = {
    id: Date.now(),
    name: normalizedName,
    email: cleanEmail,
    passwordHash,
  }

  const updated = [...users, newUser]
  saveUsers(updated)
  const session = { id: newUser.id, name: newUser.name, email: newUser.email, role: 'customer' }
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

  const session = { id: match.id, name: match.name, email: match.email, role: match.role || 'customer' }
  safeSetItem(CURRENT_USER_KEY, JSON.stringify(session))
  return { ok: true, user: match }
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

  // Log the user in right after reset.
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
