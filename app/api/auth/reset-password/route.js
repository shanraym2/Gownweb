import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { passwordMeetsRules } from '@/app/utils/authValidation'

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { email, password } = body

    const cleanEmail = normalizeEmail(email)
    const cleanPass  = String(password || '')

    if (!cleanEmail) {
      return NextResponse.json(
        { ok: false, error: 'Email is required.' },
        { status: 400 }
      )
    }

    // ── Password validation ───────────────────────────────────────────────────
    if (!passwordMeetsRules(cleanPass)) {
      return NextResponse.json(
        { ok: false, error: 'Password must be at least 8 characters and include letters and numbers.' },
        { status: 400 }
      )
    }

    // ── OTP verification gate comes BEFORE account existence is revealed ─────
    // otp_codes rows exist independent of whether a user account exists for
    // that email, so checking this first never leaks registration status.
    // A non-existent email will simply never have a matching consumed OTP.
    // Require a recently-consumed password_reset OTP before allowing the update.
    // Without this, anyone who knows a registered email can reset the password
    // with a single unauthenticated POST request.
    //
    // The verify-otp route sets consumed_at when the correct code is entered.
    // We check that a consumed OTP exists within the last 10 minutes — the same
    // window as OTP_EXPIRY_MS in send-otp/route.js.
    const otpCheck = await query(
      `SELECT id FROM otp_codes
       WHERE email     = $1
         AND purpose   = 'password_reset'
         AND consumed_at IS NOT NULL
         AND consumed_at > now() - INTERVAL '10 minutes'
       ORDER BY consumed_at DESC
       LIMIT 1`,
      [cleanEmail]
    )

    if (otpCheck.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'OTP verification required before resetting password.' },
        { status: 403 }
      )
    }

    // ── Rate limit ────────────────────────────────────────────────────────────
    // Allow max 5 reset attempts per email per 15 minutes to prevent abuse.
    
      const rateLimitCheck = await query(
        `SELECT COUNT(*) AS cnt FROM otp_codes
        WHERE email      = $1
          AND purpose    = 'password_reset'
          AND consumed_at IS NOT NULL
          AND consumed_at > now() - INTERVAL '15 minutes'`,
        [cleanEmail]
      )

    if (Number(rateLimitCheck[0].cnt) >= 5) {
      return NextResponse.json(
        { ok: false, error: 'Too many attempts. Please wait before trying again.' },
        { status: 429 }
      )
    }

    // ── Hash and update ───────────────────────────────────────────────────────
    // Cost factor 10: consistent with all other auth routes in this project.
    // Factor 12 risks hitting Next.js serverless timeout on basic DigitalOcean
    // droplets (~1–3s at factor 12 vs ~300ms at factor 10).
    // The trg_users_updated_at trigger handles updated_at automatically.
    const passwordHash = await bcrypt.hash(cleanPass, 10)
    await query(
      'UPDATE users SET password_hash = $1 WHERE email = $2',
      [passwordHash, cleanEmail]
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Reset password error:', err)
    return NextResponse.json(
      { ok: false, error: 'Failed to reset password. Please try again.' },
      { status: 500 }
    )
  }
}