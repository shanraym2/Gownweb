import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

let cachedSecret   = null
let cacheExpiresAt = 0

async function getAdminSecret() {
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
  } catch (err) {
    console.warn('admin_config fallback to env var:', err?.message)
  }

  return process.env.ADMIN_SECRET ?? null
}

export async function GET(request) {
  const provided = request.headers.get('x-admin-secret')?.trim()
  if (!provided) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const secret = await getAdminSecret()
  if (!secret || provided !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ ok: true })
}