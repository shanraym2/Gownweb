'use client'

const CART_PREFIX = 'jce_cart_'
const CART_NOTE_PREFIX = 'jce_cart_note_'

function safeGetItem(key) {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(key)
}

function safeSetItem(key, value) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, value)
}

function getCurrentUserEmail() {
  try {
    const raw = safeGetItem('jce_current_user')
    if (!raw) return null
    const user = JSON.parse(raw)
    return user?.email ? String(user.email).trim().toLowerCase() : null
  } catch {
    return null
  }
}

/** Returns the storage key for the current user's cart (per-account) */
function getCartKey() {
  const email = getCurrentUserEmail()
  return email ? `${CART_PREFIX}${email}` : `${CART_PREFIX}guest`
}

function getCartNoteKey() {
  const email = getCurrentUserEmail()
  return email ? `${CART_NOTE_PREFIX}${email}` : `${CART_NOTE_PREFIX}guest`
}

export function loadCart() {
  try {
    const key = getCartKey()
    const raw = safeGetItem(key)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function saveCart(items) {
  const key = getCartKey()
  safeSetItem(key, JSON.stringify(items))
}

export function addToCart(gownId) {
  const items = loadCart()
  const existing = items.find((item) => item.id === gownId)
  if (existing) {
    existing.qty += 1
  } else {
    items.push({ id: gownId, qty: 1 })
  }
  saveCart(items)
  return items
}

export function setQuantity(gownId, qty) {
  const items = loadCart()
  const entry = items.find((item) => item.id === gownId)
  if (!entry) return items
  if (qty < 1) {
    const next = items.filter((item) => item.id !== gownId)
    saveCart(next)
    return next
  }
  entry.qty = qty
  saveCart(items)
  return items
}

export function removeItem(gownId) {
  const items = loadCart().filter((item) => item.id !== gownId)
  saveCart(items)
  return items
}

export function clearCart() {
  const key = getCartKey()
  const noteKey = getCartNoteKey()
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(key)
    window.localStorage.removeItem(noteKey)
  }
}

/** Clears all carts (for admin reset). */
export function clearAllCarts() {
  if (typeof window === 'undefined') return
  const keysToRemove = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    if (key && (key.startsWith(CART_PREFIX) || key.startsWith(CART_NOTE_PREFIX))) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach((k) => window.localStorage.removeItem(k))
}

export function loadCartNote() {
  const key = getCartNoteKey()
  return safeGetItem(key) || ''
}

export function saveCartNote(note) {
  const key = getCartNoteKey()
  safeSetItem(key, note)
}
