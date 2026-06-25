// app/api/admin/change-secret/route.js
// Audit-instrumented version — logAudit() added on successful step=change.

import { NextResponse } from 'next/server'
import { query }        from '@/lib/db'
import { sendOtp }      from '@/lib/sendOtp'
import bcrypt           from 'bcryptjs'
import crypto           from 'crypto'
import { checkAdminAuth } from '@/lib/adminAuth'
import { logAudit }       from '@/lib/audit'

const WINDOW_MS     = 15 * 60 * 1000
const MAX_PWD_FAILS = 5

const pwdFailMap = new Map()

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
  if (record && now < record.resetAt) record.count++
  else map.set(ip, { count: 1, resetAt: now + WINDOW_MS })
}

function clearFails(map, ip) { map.delete(ip) }

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp).trim()).digest('hex')
}

async function writeSecretToDb(newSecret) {
  // Store only the hash — matches checkAdminAuth()'s post-FIX-9 expectation
  // and the pattern already used correctly for OTPs and device tokens.
  const hash = crypto.createHash('sha256').update(newSecret).digest('hex')
  await query(
    `INSERT INTO admin_config (key, value)
     VALUES ('admin_secret', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [hash]
  )
}

export async function POST(request) {
  const ip = getIp(request)

  let body
  try { body = await request.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }

  const { step, adminEmail } = body

  if (!adminEmail || typeof adminEmail !== 'string') {
    return NextResponse.json({ ok: false, error: 'adminEmail is required' }, { status: 400 })
  }

  const cleanEmail = adminEmail.trim().toLowerCase()

  const userRows = await query(
    `SELECT id, password_hash, role FROM users WHERE email=$1 AND is_active=TRUE`,
    [cleanEmail]
  ).catch(() => [])

  if (!userRows.length || userRows[0].role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Incorrect email or password.' }, { status: 403 })
  }

  // ── STEP 1 — send_otp ──────────────────────────────────────────────────────
  if (step === 'send_otp') {
    const { password } = body
    if (!password)
      return NextResponse.json({ ok: false, error: 'Password is required.' }, { status: 400 })

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

    const otpData = await sendOtp(cleanEmail, 'password_reset')
    if (!otpData.ok) {
      return NextResponse.json(
        { ok: false, error: otpData.error || 'Could not send verification code.' },
        { status: otpData.status || 500 }
      )
    }

    return NextResponse.json({ ok: true, devMode: otpData.devMode ?? false, message: 'Verification code sent to admin email.' })
  }

  // ── STEP 2 — change ────────────────────────────────────────────────────────
  if (step === 'change') {
    const { password, otp, newSecret } = body

    if (!password || !otp || !newSecret) {
      return NextResponse.json(
        { ok: false, error: 'password, otp, and newSecret are all required.' },
        { status: 400 }
      )
    }

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

    if (newSecret.trim().length < 16) {
      return NextResponse.json({ ok: false, error: 'New secret must be at least 16 characters.' }, { status: 400 })
    }
    if (/\s/.test(newSecret)) {
      return NextResponse.json({ ok: false, error: 'New secret must not contain spaces.' }, { status: 400 })
    }

    const otpRows = await query(
      `SELECT id, code_hash, attempts, max_attempts, expires_at
       FROM otp_codes
       WHERE email=$1 AND purpose='password_reset'
         AND consumed_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
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
        await query(`UPDATE otp_codes SET attempts=$1, consumed_at=NOW() WHERE id=$2`, [nextAttempts, record.id])
        return NextResponse.json({ ok: false, error: 'Too many incorrect attempts. Please request a new code.' }, { status: 429 })
      }
      await query(`UPDATE otp_codes SET attempts=$1 WHERE id=$2`, [nextAttempts, record.id])
      return NextResponse.json(
        { ok: false, error: `Incorrect code. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`, attemptsLeft },
        { status: 400 }
      )
    }

    await query(`UPDATE otp_codes SET consumed_at=NOW(), attempts=$1 WHERE id=$2`, [nextAttempts, record.id])

    try {
      await writeSecretToDb(newSecret.trim())
    } catch (err) {
      console.error('Failed to persist new admin secret:', err)
      return NextResponse.json({ ok: false, error: 'Could not save the new secret. Check database connection.' }, { status: 500 })
    }

    clearFails(pwdFailMap, ip)

    // ── AUDIT ── (no payload — secret value is NEVER logged) ─────────────────
    logAudit({
      request,
      action:     'secret.changed',
      entityType: 'secret',
      entityId:   'admin_secret',
      payload:    { changedBy: cleanEmail },
      // The new secret value is intentionally omitted
    })

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: false, error: 'Invalid step.' }, { status: 400 })
}