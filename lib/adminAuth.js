import { query } from '@/lib/db'

let cachedSecret   = null
let cacheExpiresAt = 0

export async function getAdminSecret() {
  const now = Date.now()
  if (cachedSecret && now < cacheExpiresAt) return cachedSecret

  try {
    const rows = await query(
      `SELECT value FROM admin_config WHERE key = 'admin_secret' LIMIT 1`
    )
    if (rows.length && rows[0].value) {
      cachedSecret   = rows[0].value
      cacheExpiresAt = now + 60_000
      return cachedSecret
    }
  } catch {
    // table doesn't exist yet, fall through
  }

  return process.env.ADMIN_SECRET ?? null
}

export async function checkAdminAuth(request) {
  const provided = request.headers.get('x-admin-secret')?.trim()
  if (!provided) return false
  const secret = await getAdminSecret()
  return !!secret && provided === secret
}