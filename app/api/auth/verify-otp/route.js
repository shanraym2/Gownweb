import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import crypto from 'crypto'

const MAX_ATTEMPTS = 5
const TRUST_DAYS   = 7
const TRUST_MS     = TRUST_DAYS * 24 * 60 * 60 * 1000

const PURPOSE_MAP = {
  login:            'login',
  signup:           'signup',
  auth:             'login',
  'reset-password': 'password_reset',
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex')
}

function generateTrustToken() {
  return crypto.randomBytes(32).toString('hex')
}

// SECURITY FIX: Previously the trust cookie name was derived directly from the
// plaintext email address: `jce_trust_${cleanEmail.replace(...)}`.
// This leaked the user's email into cookie names visible in browser DevTools,
// server access logs, and any proxies/CDN that log headers.
//
// We now hash the email (SHA-256, truncated) so the cookie name is opaque:
//   jce_trust_<first-16-hex-chars-of-sha256(email)>
// This is still deterministic (same email → same cookie name on re-login)
// but reveals nothing about the underlying address.
function trustCookieName(email) {
  const hash = crypto.createHash('sha256').update(email).digest('hex')
  return `jce_trust_${hash.slice(0, 16)}`
}

export async function POST(request) {
  try {
    const { email, otp, purpose } = await request.json()

    if (!email || !otp) {
      return NextResponse.json(
        { ok: false, error: 'Email and OTP are required' },
        { status: 400 }
      )
    }

    const cleanEmail = email.trim().toLowerCase()
    const otpStr     = String(otp).trim()
    const rawPurpose = String(purpose || '').trim().toLowerCase()
    const dbPurpose  = PURPOSE_MAP[rawPurpose]

    if (!dbPurpose) {
      return NextResponse.json(
        { ok: false, error: 'Invalid or missing OTP purpose.' },
        { status: 400 }
      )
    }

    // Find the latest active OTP for this email + purpose
    const rows = await query(
      `SELECT id, code_hash, attempts, max_attempts, expires_at
       FROM otp_codes
       WHERE email = $1 AND purpose = $2
         AND consumed_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [cleanEmail, dbPurpose]
    )

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No verification code found. Please request a new one.' },
        { status: 400 }
      )
    }

    const record       = rows[0]
    const codeHash     = hashOtp(otpStr)
    const nextAttempts = Number(record.attempts) + 1

    // Wrong code
    if (codeHash !== record.code_hash) {
      const attemptsLeft = record.max_attempts - nextAttempts

      if (nextAttempts >= record.max_attempts) {
        await query(
          `UPDATE otp_codes SET attempts = $1, consumed_at = NOW() WHERE id = $2`,
          [nextAttempts, record.id]
        )
        return NextResponse.json(
          { ok: false, error: 'Too many incorrect attempts. Please request a new code.' },
          { status: 429 }
        )
      }

      await query(
        `UPDATE otp_codes SET attempts = $1 WHERE id = $2`,
        [nextAttempts, record.id]
      )

      return NextResponse.json(
        {
          ok: false,
          error: `Incorrect code. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`,
          attemptsLeft,
        },
        { status: 400 }
      )
    }

    // ✅ Correct — consume the OTP
    await query(
      `UPDATE otp_codes SET consumed_at = NOW(), attempts = $1 WHERE id = $2`,
      [nextAttempts, record.id]
    )

    // Issue a trust cookie using an opaque (hashed) name — not the raw email
    const trustToken  = generateTrustToken()
    const trustExpiry = new Date(Date.now() + TRUST_MS)
    const cookieName  = trustCookieName(cleanEmail)

    const response = NextResponse.json({ ok: true, message: 'OTP verified' })
    response.cookies.set(cookieName, trustToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires:  trustExpiry,
      path:     '/',
    })

    return response
  } catch (err) {
    console.error('Verify OTP error:', err)
    return NextResponse.json(
      { ok: false, error: 'Verification failed. Please try again.' },
      { status: 500 }
    )
  }
}