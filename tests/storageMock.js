/**
 * Storage Mock
 * ─────────────
 * Provides localStorage and sessionStorage mocks for the Node/Vitest environment.
 * Also mocks the fs module functions used by the API route.
 *
 * Import this in vitest.setup.js or at the top of each test file that needs it.
 */

// ── In-memory storage implementation ──────────────────────────────────────

class MemoryStorage {
  constructor() {
    this._store = {}
    this.length = 0
  }

  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this._store, key)
      ? this._store[key]
      : null
  }

  setItem(key, value) {
    if (!Object.prototype.hasOwnProperty.call(this._store, key)) {
      this.length++
    }
    this._store[key] = String(value)
  }

  removeItem(key) {
    if (Object.prototype.hasOwnProperty.call(this._store, key)) {
      delete this._store[key]
      this.length--
    }
  }

  clear() {
    this._store = {}
    this.length = 0
  }

  key(index) {
    return Object.keys(this._store)[index] || null
  }

  // Helper for tests: dump entire store
  _dump() {
    return { ...this._store }
  }
}

// ── Install globals ────────────────────────────────────────────────────────

export function installStorageMocks() {
  const ls = new MemoryStorage()
  const ss = new MemoryStorage()

  Object.defineProperty(global, 'localStorage', {
    value: ls,
    writable: true,
    configurable: true,
  })

  Object.defineProperty(global, 'sessionStorage', {
    value: ss,
    writable: true,
    configurable: true,
  })

  Object.defineProperty(global, 'window', {
    value: global,
    writable: true,
    configurable: true,
  })

  return { localStorage: ls, sessionStorage: ss }
}

export function clearStorageMocks() {
  if (global.localStorage) global.localStorage.clear()
  if (global.sessionStorage) global.sessionStorage.clear()
}

/**
 * Seed localStorage with a pre-built interactions object.
 * @param {object} interactions — { [userId]: { [gownId]: score } }
 */
export function seedInteractions(interactions) {
  global.localStorage.setItem('jce_interactions', JSON.stringify(interactions))
}

/**
 * Seed localStorage with a pre-built baskets array.
 * @param {Array<string[]>} baskets
 */
export function seedBaskets(baskets) {
  global.localStorage.setItem('jce_baskets', JSON.stringify(baskets))
}

/**
 * Read raw interactions from localStorage.
 */
export function readInteractions() {
  try {
    return JSON.parse(global.localStorage.getItem('jce_interactions') || '{}')
  } catch {
    return {}
  }
}

/**
 * Read raw baskets from localStorage.
 */
export function readBaskets() {
  try {
    return JSON.parse(global.localStorage.getItem('jce_baskets') || '[]')
  } catch {
    return []
  }
}
