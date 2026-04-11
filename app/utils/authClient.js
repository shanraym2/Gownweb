'use client'

import { clearAllCarts } from './cartClient'
import { isRealName, passwordMeetsRules } from './authValidation'

const CURRENT_USER_KEY = 'jce_current_user'

function safeGetItem(key) {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(key)
}

function safeSetItem(key, value) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, value)
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

// ─── Register ────────────────────────────────────────────────────────────────

export async function registerUser({ firstName, lastName, email, password }) {
  const cleanFirst = String(firstName || '').trim()
  const cleanLast  = String(lastName  || '').trim()
  const cleanEmail = normalizeEmail(email)
  const cleanPass  = String(password  || '')

  if (!isRealName(cleanFirst) || !isRealName(cleanLast)) {
    return { ok: false, error: "Use your real name: letters only, spaces, hyphens, and apostrophes." }
  }
  if (!isValidEmail(cleanEmail)) {
    return { ok: false, error: 'Please enter a valid email address.' }
  }
  if (!isStrongPassword(cleanPass)) {
    return { ok: false, error: 'Password must be at least 8 characters and include letters and numbers.' }
  }

  try {
    const res  = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: cleanFirst, lastName: cleanLast, email: cleanEmail, password: cleanPass }),
    })
    const data = await res.json()
    if (!data.ok) return { ok: false, error: data.error || 'Unable to create account.' }

    safeSetItem(CURRENT_USER_KEY, JSON.stringify(data.user))
    return { ok: true, user: data.user }
  } catch {
    return { ok: false, error: 'Unable to connect. Please try again.' }
  }
}

// ─── Verify credentials (used before sending login OTP) ──────────────────────

export async function verifyLoginCredentials({ email, password }) {
  const cleanEmail = normalizeEmail(email)
  const cleanPass  = String(password || '')

  if (!isValidEmail(cleanEmail)) {
    return { ok: false, error: 'Invalid email or password.' }
  }

  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password: cleanPass }),
    })
    const data = await res.json()
    if (!data.ok) return { ok: false, error: data.error || 'Invalid email or password.' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Unable to connect. Please try again.' }
  }
}

// ─── Login ───────────────────────────────────────────────────────────────────

export async function loginUser({ email, password }) {
  const cleanEmail = normalizeEmail(email)
  const cleanPass  = String(password || '')

  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password: cleanPass }),
    })
    const data = await res.json()
    if (!data.ok) return { ok: false, error: data.error || 'Login failed.' }

    safeSetItem(CURRENT_USER_KEY, JSON.stringify(data.user))
    return { ok: true, user: data.user }
  } catch {
    return { ok: false, error: 'Unable to connect. Please try again.' }
  }
}

// ─── Reset password ──────────────────────────────────────────────────────────

export async function resetUserPassword({ email, password }) {
  const cleanEmail = normalizeEmail(email)
  const cleanPass  = String(password || '')

  if (!isValidEmail(cleanEmail)) {
    return { ok: false, error: 'Please enter a valid email address.' }
  }
  if (!isStrongPassword(cleanPass)) {
    return { ok: false, error: 'Password must be at least 8 characters and include letters and numbers.' }
  }

  try {
    const res  = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password: cleanPass }),
    })
    const data = await res.json()
    if (!data.ok) return { ok: false, error: data.error || 'Failed to reset password.' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Unable to connect. Please try again.' }
  }
}

// ─── Update profile ──────────────────────────────────────────────────────────

export async function updateUser({ firstName, lastName, email, password } = {}) {
  const current = getCurrentUser()
  if (!current) return { ok: false, error: 'Not logged in.' }

  const updates = {}

  if (firstName !== undefined) {
    const clean = String(firstName).trim()
    if (!isRealName(clean)) return { ok: false, error: 'Use your real first name.' }
    updates.firstName = clean
  }
  if (lastName !== undefined) {
    const clean = String(lastName).trim()
    if (!isRealName(clean)) return { ok: false, error: 'Use your real last name.' }
    updates.lastName = clean
  }
  if (email !== undefined) {
    const clean = normalizeEmail(email)
    if (!isValidEmail(clean)) return { ok: false, error: 'Please enter a valid email address.' }
    updates.email = clean
  }
  if (password !== undefined && password !== '') {
    if (!isStrongPassword(String(password))) {
      return { ok: false, error: 'Password must be at least 8 characters and include letters and numbers.' }
    }
    updates.password = String(password)
  }

  try {
    const res  = await fetch('/api/auth/update-profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': current.id },
      body: JSON.stringify(updates),
    })
    const data = await res.json()
    if (!data.ok) return { ok: false, error: data.error || 'Failed to update profile.' }

    const updatedSession = { ...current, ...data.user }
    safeSetItem(CURRENT_USER_KEY, JSON.stringify(updatedSession))
    return { ok: true, user: updatedSession }
  } catch {
    return { ok: false, error: 'Unable to connect. Please try again.' }
  }
}

// ─── Session helpers ──────────────────────────────────────────────────────────

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

export function resetAllUsers() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(CURRENT_USER_KEY)
  clearAllCarts()
}

export async function syncCurrentUserRole() {
  const raw = safeGetItem(CURRENT_USER_KEY)
  if (!raw) return
  let current
  try { current = JSON.parse(raw) } catch { return }
  if (!current?.email) return

  try {
    const res  = await fetch(`/api/auth/role?email=${encodeURIComponent(current.email)}`)
    const data = await res.json()
    if (!data.ok || data.role === current.role) return
    safeSetItem(CURRENT_USER_KEY, JSON.stringify({ ...current, role: data.role }))
  } catch { /* silent */ }
}

// Kept for backward compat
export function loadUsers() { return [] }
export function saveUsers() {}