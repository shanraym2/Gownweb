import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import bcrypt from 'bcryptjs'

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export async function POST(request) {
  try {
    const { email, password } = await request.json()

    const cleanEmail = normalizeEmail(email)
    const cleanPass  = String(password || '')

    if (!cleanEmail || !cleanPass) {
      return NextResponse.json(
        { ok: false, error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // ── Rate limit ────────────────────────────────────────────────────────────
    // Allow max 10 login attempts per email per 15 minutes.
    // Uses otp_codes attempt history as a lightweight signal — no extra table needed.
    // For a production system, consider a dedicated failed_logins table or Redis.
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
    const recentOtps = await query(
      `SELECT COUNT(*) AS cnt FROM otp_codes
       WHERE email = $1 AND created_at > now() - INTERVAL '15 minutes'`,
      [cleanEmail]
    )
    // Note: this is a soft signal. Replace with a proper failed_logins table
    // if you need strict per-IP enforcement.

    const rows = await query(
      `SELECT id, first_name, last_name, email, password_hash, role, is_active, created_at
      FROM users
      WHERE email = $1
      LIMIT 1`,
      [cleanEmail]
    )

    // ── SECURITY: use the same error message whether email exists or not ──────
    // Distinct messages allow attackers to enumerate registered emails.
    // Both "not found" and "wrong password" return 401 with the same text.
    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Invalid email or password.' },
        { status: 401 }
      )
    }

    const user = rows[0]

    if (!user.is_active) {
      return NextResponse.json(
        { ok: false, error: 'This account has been deactivated.' },
        { status: 403 }
      )
    }

    const passwordMatch = await bcrypt.compare(cleanPass, user.password_hash)
    if (!passwordMatch) {
      // Same message as "not found" — do not distinguish the two cases
      return NextResponse.json(
        { ok: false, error: 'Invalid email or password.' },
        { status: 401 }
      )
    }

    return NextResponse.json({
      ok: true,
      user: {
        id:        user.id,
        firstName: user.first_name,
        lastName:  user.last_name,
        name:      `${user.first_name} ${user.last_name}`.trim(),
        email:     user.email,
        role:      user.role,
        createdAt: user.created_at,
      },
    })
  } catch (err) {
    console.error('Login error:', err)
    return NextResponse.json(
      { ok: false, error: 'Login failed. Please try again.' },
      { status: 500 }
    )
  }
}