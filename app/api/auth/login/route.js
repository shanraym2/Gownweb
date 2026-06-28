import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import bcrypt from 'bcryptjs'

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

// ── Rate limiter ──────────────────────────────────────────────────────────────
// Keyed by IP: max 10 attempts per 15 minutes.
// Keyed by email: max 8 attempts per 15 minutes.
// Both must pass — whichever hits first returns 429.
const ipMap    = new Map()
const emailMap = new Map()
const WINDOW   = 15 * 60 * 1000
const IP_MAX   = 10
const EMAIL_MAX = 8

function checkRateLimit(ip, email) {
  const now = Date.now()

  const ipEntry = ipMap.get(ip)
  if (!ipEntry || now - ipEntry.windowStart > WINDOW) {
    ipMap.set(ip, { windowStart: now, count: 1 })
  } else {
    ipEntry.count++
    if (ipEntry.count > IP_MAX) return false
  }

  const emailEntry = emailMap.get(email)
  if (!emailEntry || now - emailEntry.windowStart > WINDOW) {
    emailMap.set(email, { windowStart: now, count: 1 })
  } else {
    emailEntry.count++
    if (emailEntry.count > EMAIL_MAX) return false
  }

  return true
}

// Prune stale entries every 15 minutes to avoid unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - WINDOW
  for (const [k, v] of ipMap)    if (v.windowStart < cutoff) ipMap.delete(k)
  for (const [k, v] of emailMap) if (v.windowStart < cutoff) emailMap.delete(k)
}, WINDOW)

export async function POST(request) {
  try {
    const { email, password } = await request.json()

    const cleanEmail = normalizeEmail(email)
    const cleanPass  = String(password || '')

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
    if (!checkRateLimit(ip, cleanEmail)) {
      return NextResponse.json(
        { ok: false, error: 'Too many login attempts. Please wait 15 minutes and try again.' },
        { status: 429, headers: { 'Retry-After': '900' } }
      )
    }

    if (!cleanEmail || !cleanPass) {
      return NextResponse.json(
        { ok: false, error: 'Email and password are required' },
        { status: 400 }
      )
    }

    const rows = await query(
      `SELECT id, first_name, last_name, email, password_hash, role, is_active, created_at
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [cleanEmail]
    )

    // Same error message whether email exists or not — prevents email enumeration
    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Invalid email or password.' },
        { status: 401 }
      )
    }

    const user = rows[0]

    if (!user.is_active) {
      return NextResponse.json(
        { ok: false, error: 'Invalid email or password.' },
        { status: 401 }
      )
    }

    const passwordMatch = await bcrypt.compare(cleanPass, user.password_hash)
    if (!passwordMatch) {
      return NextResponse.json(
        { ok: false, error: 'Invalid email or password.' },
        { status: 401 }
      )
    }

    // Build the response with a session cookie so middleware can identify the user
    const userData = {
      id:        user.id,
      firstName: user.first_name,
      lastName:  user.last_name,
      name:      `${user.first_name} ${user.last_name}`.trim(),
      email:     user.email,
      role:      user.role,
      createdAt: user.created_at,
    }

    const response = NextResponse.json({ ok: true, user: userData })

    // Issue a random opaque session token and store only its hash —
    // mirrors the pattern already used correctly for device_tokens.
    // The raw user.id is never sent to the browser as a credential.
    const crypto = await import('crypto')
    const sessionToken = crypto.randomBytes(32).toString('hex')
    const sessionHash  = crypto.createHash('sha256').update(sessionToken).digest('hex')
    const expiresAt    = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, sessionHash, expiresAt,
       request.headers.get('x-forwarded-for')?.split(',')[0] || null,
       request.headers.get('user-agent') || null]
    )

    response.cookies.set('jce_session', sessionToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   60 * 60 * 24 * 7,   // 7 days
      path:     '/',
    })

    return response
    
  } catch (err) {
    console.error('Login error:', err)
    return NextResponse.json(
      { ok: false, error: 'Login failed. Please try again.' },
      { status: 500 }
    )
  }
}