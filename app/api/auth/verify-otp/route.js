import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const MAX_ATTEMPTS = 5

/**
 * Must match the key scheme in send-otp/route.js
 */
function storeKey(email, purpose) {
  return `${email}::${purpose}`
}

function getStorePath() {
  return join(tmpdir(), 'jce-otps.json')
}

function loadOtps() {
  const path = getStorePath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

function saveOtps(otps) {
  writeFileSync(getStorePath(), JSON.stringify(otps, null, 0))
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
    const otpStr = String(otp).trim()
    const cleanPurpose = String(purpose || '').trim().toLowerCase()

    if (!cleanPurpose || !['login', 'signup', 'auth', 'reset-password'].includes(cleanPurpose)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid or missing OTP purpose.' },
        { status: 400 }
      )
    }

    const key = storeKey(cleanEmail, cleanPurpose)
    const otps = loadOtps()
    const record = otps[key]

    // No record at all
    if (!record) {
      return NextResponse.json(
        { ok: false, error: 'No verification code found. Please request a new one.' },
        { status: 400 }
      )
    }

    // Expired
    if (Date.now() > record.expires) {
      delete otps[key]
      saveOtps(otps)
      return NextResponse.json(
        { ok: false, error: 'Your code has expired. Please request a new one.' },
        { status: 400 }
      )
    }

    // Wrong code
    if (record.otp !== otpStr) {
      const nextAttempts = Number(record.attempts || 0) + 1
      const attemptsLeft = MAX_ATTEMPTS - nextAttempts

      if (nextAttempts >= MAX_ATTEMPTS) {
        delete otps[key]
        saveOtps(otps)
        return NextResponse.json(
          { ok: false, error: 'Too many incorrect attempts. Please request a new code.' },
          { status: 429 }
        )
      }

      otps[key] = { ...record, attempts: nextAttempts }
      saveOtps(otps)

      return NextResponse.json(
        {
          ok: false,
          error: `Incorrect code. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`,
          attemptsLeft,
        },
        { status: 400 }
      )
    }

    // ✅ Correct — consume the OTP so it can't be reused
    delete otps[key]
    saveOtps(otps)

    return NextResponse.json({ ok: true, message: 'OTP verified' })
  } catch (err) {
    console.error('Verify OTP error:', err)
    return NextResponse.json(
      { ok: false, error: 'Verification failed. Please try again.' },
      { status: 500 }
    )
  }
}