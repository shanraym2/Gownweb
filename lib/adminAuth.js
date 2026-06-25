import { query } from '@/lib/db'
import crypto from 'crypto'

let cachedSecret   = null
let cacheExpiresAt = 0

function hashSecret(s) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

// Returns the stored hash (not the plaintext secret).
export async function getAdminSecretHash() {
  const now = Date.now()
  if (cachedSecret && now < cacheExpiresAt) return cachedSecret

  try {
    const rows = await query(
      `SELECT value FROM admin_config WHERE key = 'admin_secret' LIMIT 1`
    )
    if (rows.length && rows[0].value) {
      cachedSecret   = rows[0].value   // expected to already be a sha256 hex hash — see migration below
      cacheExpiresAt = now + 60_000
      return cachedSecret
    }
  } catch {
    // table doesn't exist yet, fall through
  }

  const envSecret = process.env.ADMIN_SECRET
  return envSecret ? hashSecret(envSecret) : null
}

export async function checkAdminAuth(request) {
  const provided = request.headers.get('x-admin-secret')?.trim()
  if (!provided) return false
  const storedHash = await getAdminSecretHash()
  if (!storedHash) return false

  const providedHash = hashSecret(provided)
  const a = Buffer.from(providedHash)
  const b = Buffer.from(storedHash)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}