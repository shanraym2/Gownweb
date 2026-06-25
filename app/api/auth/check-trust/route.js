import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { query } from '@/lib/db'

// Must use the same opaque (hashed) cookie name as verify-otp.
function trustCookieName(email) {
  const hash = crypto.createHash('sha256').update(email).digest('hex')
  return `jce_trust_${hash.slice(0, 16)}`
}

export async function POST(request) {
  try {
    const { email } = await request.json()
    if (!email) return NextResponse.json({ trusted: false })

    const cleanEmail = email.trim().toLowerCase()
    const cookieKey  = trustCookieName(cleanEmail)
    const token      = request.cookies.get(cookieKey)?.value
    if (!token) return NextResponse.json({ trusted: false })

    // Validate the token itself against device_tokens — previously this
    // only checked whether *a* cookie with the right name existed, not
    // whether its value was a real, unexpired token for this user.
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const rows = await query(
      `SELECT dt.id FROM device_tokens dt
       JOIN users u ON u.id = dt.user_id
       WHERE u.email = $1 AND dt.token_hash = $2 AND dt.expires_at > NOW()
       LIMIT 1`,
      [cleanEmail, tokenHash]
    )

    return NextResponse.json({ trusted: rows.length > 0 })
  } catch {
    return NextResponse.json({ trusted: false })
  }
}