'use client'

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

export function registerUser({ name, email, password }) {
  const users = loadUsers()
  const existing = users.find((u) => u.email.toLowerCase() === email.toLowerCase())
  if (existing) {
    return { ok: false, error: 'An account with this email already exists.' }
  }

  const newUser = {
    id: Date.now(),
    name,
    email,
    password, // NOTE: for demo only; do not store plain passwords in production.
  }

  const updated = [...users, newUser]
  saveUsers(updated)
  const session = { id: newUser.id, name: newUser.name, email: newUser.email, role: 'customer' }
  safeSetItem(CURRENT_USER_KEY, JSON.stringify(session))
  return { ok: true, user: newUser }
}

export function loginUser({ email, password }) {
  const users = loadUsers()
  const match = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
  )

  if (!match) {
    return { ok: false, error: 'Invalid email or password.' }
  }

  const session = { id: match.id, name: match.name, email: match.email, role: match.role || 'customer' }
  safeSetItem(CURRENT_USER_KEY, JSON.stringify(session))
  return { ok: true, user: match }
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

/** Clears all registered users and current session (this browser only). */
export function resetAllUsers() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(USERS_KEY)
  window.localStorage.removeItem(CURRENT_USER_KEY)
}
