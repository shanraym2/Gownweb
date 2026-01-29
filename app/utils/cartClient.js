'use client'

const CART_KEY = 'jce_cart'
const CART_NOTE_KEY = 'jce_cart_note'

function safeGetItem(key) {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(key)
}

function safeSetItem(key, value) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, value)
}

export function loadCart() {
  try {
    const raw = safeGetItem(CART_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function saveCart(items) {
  safeSetItem(CART_KEY, JSON.stringify(items))
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
  saveCart([])
}

export function loadCartNote() {
  return safeGetItem(CART_NOTE_KEY) || ''
}

export function saveCartNote(note) {
  safeSetItem(CART_NOTE_KEY, note)
}

