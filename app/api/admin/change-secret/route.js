import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// ── Rate limiting (in-memory, per IP) ────────────────────────────────────────
// Resets after WINDOW_MS. In a multi-instance deployment, use Redis instead.

const WINDOW_MS        = 15 * 60 * 1000  // 15-minute rolling window
const MAX_SECRET_FAILS = 5               // wrong X-Admin-Secret attempts per IP
const MAX_PWD_FAILS    = 5               // wrong password attempts per IP

const secretFailMap = new Map()  // ip → { count, resetAt }
const pwdFailMap    = new Map()  // ip → { count, resetAt }

function getIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    '0.0.0.0'
  )
}

function checkRateLimit(map, ip, max) {
  const now    = Date.now()
  const record = map.get(ip)
  if (record && now < record.resetAt) {
    if (record.count >= max) {
      const secsLeft = Math.ceil((record.resetAt - now) / 1000)
      return { blocked: true, secsLeft }
    }
    return { blocked: false }
  }
  map.set(ip, { count: 0, resetAt: now + WINDOW_MS })
  return { blocked: false }
}

function recordFail(map, ip) {
  const now    = Date.now()
  const record = map.get(ip)
  if (record && now < record.resetAt) {
    record.count++
  } else {
    map.set(ip, { count: 1, resetAt: now + WINDOW_MS })
  }
}

function clearFails(map, ip) {
  map.delete(ip)
}

// ── Auth check with rate limiting ─────────────────────────────────────────────
function checkAuth(request, ip) {
  const limit = checkRateLimit(secretFailMap, ip, MAX_SECRET_FAILS)
  if (limit.blocked) return { ok: false, locked: true, secsLeft: limit.secsLeft }

  const secret = request.headers.get('x-admin-secret') || ''
  const valid  = process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET
  if (!valid) {
    recordFail(secretFailMap, ip)
    return { ok: false, locked: false }
  }

  clearFails(secretFailMap, ip)
  return { ok: true }
}

// ── OTP helper ────────────────────────────────────────────────────────────────
function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp).trim()).digest('hex')
}

// ── Secret writer ─────────────────────────────────────────────────────────────
function writeEnvSecret(newSecret) {
  const envPath = path.resolve(process.cwd(), '.env.local')
  let contents = ''
  try { contents = fs.readFileSync(envPath, 'utf8') } catch { /* new file */ }

  const line    = `ADMIN_SECRET=${newSecret}`
  const pattern = /^ADMIN_SECRET=.*$/m

  if (pattern.test(contents)) {
    contents = contents.replace(pattern, line)
  } else {
    contents = contents.endsWith('\n') || contents === ''
      ? contents + line + '\n'
      : contents + '\n' + line + '\n'
  }

  fs.writeFileSync(envPath, contents, 'utf8')
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/change-secret
// step: 'send_otp'  — verify password, send OTP to admin email
// step: 'change'    — verify OTP + new secret, persist
// Both steps require a valid X-Admin-Secret header.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request) {
  const ip      = getIp(request)
  const authRes = checkAuth(request, ip)

  if (!authRes.ok) {
    if (authRes.locked) {
      return NextResponse.json(
        { ok: false, error: `Too many failed attempts. Try again in ${authRes.secsLeft} seconds.` },
        { status: 429 }
      )
    }
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const { step, adminEmail } = body

  if (!adminEmail || typeof adminEmail !== 'string') {
    return NextResponse.json({ ok: false, error: 'adminEmail is required' }, { status: 400 })
  }

  const cleanEmail = adminEmail.trim().toLowerCase()

  // ── Confirm active admin account ──────────────────────────────────────────
  const userRows = await query(
    `SELECT id, password_hash, role FROM users WHERE email = $1 AND is_active = TRUE`,
    [cleanEmail]
  ).catch(() => [])

  if (!userRows.length || userRows[0].role !== 'admin') {
    // Generic message — don't reveal whether the email exists
    return NextResponse.json(
      { ok: false, error: 'Incorrect email or password.' },
      { status: 403 }
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1 — send_otp
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === 'send_otp') {
    const { password } = body

    if (!password) {
      return NextResponse.json({ ok: false, error: 'Password is required.' }, { status: 400 })
    }

    // Check password rate limit
    const pwdLimit = checkRateLimit(pwdFailMap, ip, MAX_PWD_FAILS)
    if (pwdLimit.blocked) {
      return NextResponse.json(
        { ok: false, error: `Too many failed attempts. Try again in ${pwdLimit.secsLeft} seconds.` },
        { status: 429 }
      )
    }

    const passwordOk = await bcrypt.compare(password, userRows[0].password_hash)
    if (!passwordOk) {
      recordFail(pwdFailMap, ip)
      const entry     = pwdFailMap.get(ip)
      const remaining = MAX_PWD_FAILS - (entry?.count || 0)
      return NextResponse.json(
        {
          ok:    false,
          error: remaining > 0
            ? `Incorrect password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
            : 'Too many failed attempts. Try again in 15 minutes.',
        },
        { status: 401 }
      )
    }

    clearFails(pwdFailMap, ip)

    // Delegate OTP send to existing route
    const otpRes  = await fetch(
      new URL('/api/auth/send-otp', request.url).toString(),
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: cleanEmail, purpose: 'password_reset' }),
      }
    )
    const otpData = await otpRes.json()

    if (!otpData.ok) {
      return NextResponse.json(
        { ok: false, error: otpData.error || 'Could not send verification code.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok:      true,
      devMode: otpData.devMode ?? false,
      message: 'Verification code sent to admin email.',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2 — change
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === 'change') {
    const { password, otp, newSecret } = body

    if (!password || !otp || !newSecret) {
      return NextResponse.json(
        { ok: false, error: 'password, otp, and newSecret are all required.' },
        { status: 400 }
      )
    }

    // Re-verify password with rate limit (replay protection)
    const pwdLimit = checkRateLimit(pwdFailMap, ip, MAX_PWD_FAILS)
    if (pwdLimit.blocked) {
      return NextResponse.json(
        { ok: false, error: `Too many failed attempts. Try again in ${pwdLimit.secsLeft} seconds.` },
        { status: 429 }
      )
    }

    const passwordOk = await bcrypt.compare(password, userRows[0].password_hash)
    if (!passwordOk) {
      recordFail(pwdFailMap, ip)
      const entry     = pwdFailMap.get(ip)
      const remaining = MAX_PWD_FAILS - (entry?.count || 0)
      return NextResponse.json(
        {
          ok:    false,
          error: remaining > 0
            ? `Incorrect password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
            : 'Too many failed attempts. Try again in 15 minutes.',
        },
        { status: 401 }
      )
    }

    clearFails(pwdFailMap, ip)

    // Validate new secret
    if (newSecret.trim().length < 16) {
      return NextResponse.json(
        { ok: false, error: 'New secret must be at least 16 characters.' },
        { status: 400 }
      )
    }
    if (/\s/.test(newSecret)) {
      return NextResponse.json(
        { ok: false, error: 'New secret must not contain spaces.' },
        { status: 400 }
      )
    }

    // Verify OTP
    const otpRows = await query(
      `SELECT id, code_hash, attempts, max_attempts, expires_at
       FROM otp_codes
       WHERE email = $1 AND purpose = 'password_reset'
         AND consumed_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [cleanEmail]
    ).catch(() => [])

    if (!otpRows.length) {
      return NextResponse.json(
        { ok: false, error: 'No active verification code found. Please request a new one.' },
        { status: 400 }
      )
    }

    const record       = otpRows[0]
    const codeHash     = hashOtp(otp)
    const nextAttempts = Number(record.attempts) + 1

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
          ok:           false,
          error:        `Incorrect code. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`,
          attemptsLeft,
        },
        { status: 400 }
      )
    }

    // ✅ OTP correct — consume it
    await query(
      `UPDATE otp_codes SET consumed_at = NOW(), attempts = $1 WHERE id = $2`,
      [nextAttempts, record.id]
    )

    // Persist the new secret
    try {
      writeEnvSecret(newSecret.trim())
    } catch (err) {
      console.error('Failed to persist new admin secret:', err)
      return NextResponse.json(
        { ok: false, error: 'Could not save the new secret. Check server permissions.' },
        { status: 500 }
      )
    }

    clearFails(secretFailMap, ip)
    clearFails(pwdFailMap, ip)

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: false, error: 'Invalid step.' }, { status: 400 })
}