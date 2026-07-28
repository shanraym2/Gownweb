import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import bcrypt from 'bcryptjs'

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

// ── Rate limiter ──────────────────────────────────────────────────────────────
// Keyed by IP: max 10 attempts per 15 minutes.
// Keyed by email: max 5 attempts per 15 minutes.
// Both must pass — whichever hits first returns 429.
// Backed by login_attempt_log in Postgres (see schema migration) instead of
// an in-memory Map — survives restarts/redeploys and works correctly across
// multiple app instances, unlike the old in-process counters.
const WINDOW_SQL = '15 minutes'
const IP_MAX     = 10
const EMAIL_MAX  = 5

// Opportunistic cleanup: ~1% of requests also delete rows older than a day.
// No separate cron/scheduled job needed — this alone keeps the table small.
async function cleanupOldAttempts() {
  if (Math.random() > 0.01) return
  await query(
    `DELETE FROM login_attempt_log WHERE attempted_at < now() - interval '1 day'`
  )
}

async function checkRateLimit(ip, email) {
  await cleanupOldAttempts()

  const [ipCountRows, emailCountRows] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS n FROM login_attempt_log
       WHERE kind = 'ip' AND identifier = $1
         AND attempted_at > now() - interval '${WINDOW_SQL}'`,
      [ip]
    ),
    query(
      `SELECT COUNT(*)::int AS n FROM login_attempt_log
       WHERE kind = 'email' AND identifier = $1
         AND attempted_at > now() - interval '${WINDOW_SQL}'`,
      [email]
    ),
  ])

  const ipCount    = ipCountRows[0]?.n    ?? 0
  const emailCount = emailCountRows[0]?.n ?? 0

  // Record this attempt regardless of outcome, so a persistent attacker
  // can't dodge the count by aiming right at the boundary.
  await Promise.all([
    query(`INSERT INTO login_attempt_log (kind, identifier) VALUES ('ip', $1)`, [ip]),
    query(`INSERT INTO login_attempt_log (kind, identifier) VALUES ('email', $1)`, [email]),
  ])

  if (ipCount + 1 > IP_MAX)       return false
  if (emailCount + 1 > EMAIL_MAX) return false
  return true
}

export async function POST(request) {
  try {
    const { email, password } = await request.json()

    const cleanEmail = normalizeEmail(email)
    const cleanPass  = String(password || '')

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
    if (!(await checkRateLimit(ip, cleanEmail))) {
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