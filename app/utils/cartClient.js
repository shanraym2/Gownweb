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

// Each unique (id + size) combination is a separate cart line.
// maxQty: if provided, caps the total qty in cart to this value (= available stock).
// Returns { items, capped } — capped=true if qty was limited by stock.
export function addToCart(gownId, qty = 1, options = {}) {
  const { size = null, maxQty = null } = options
  const items = loadCart()
  const existing = items.find(
    (item) => item.id === gownId && (item.size ?? null) === size
  )

  if (existing) {
    const proposed = existing.qty + qty
    existing.qty = maxQty != null ? Math.min(proposed, maxQty) : proposed
  } else {
    const capped = maxQty != null ? Math.min(qty, maxQty) : qty
    items.push({ id: gownId, qty: capped, size })
  }

  saveCart(items)
  return items
}

export function setQuantity(gownId, qty, size = null, maxQty = null) {
  const items = loadCart()
  const entry = items.find(
    (item) => item.id === gownId && (item.size ?? null) === size
  )
  if (!entry) return items

  if (qty < 1) {
    const next = items.filter(
      (item) => !(item.id === gownId && (item.size ?? null) === size)
    )
    saveCart(next)
    return next
  }

  entry.qty = maxQty != null ? Math.min(qty, maxQty) : qty
  saveCart(items)
  return items
}

export function removeItem(gownId, size = null) {
  const items = loadCart().filter(
    (item) => !(item.id === gownId && (item.size ?? null) === size)
  )
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