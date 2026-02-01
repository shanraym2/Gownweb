import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

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
    const { email, otp } = await request.json()
    if (!email || !otp) {
      return NextResponse.json({ ok: false, error: 'Email and OTP are required' }, { status: 400 })
    }

    const cleanEmail = email.trim().toLowerCase()
    const otpStr = String(otp).trim()

    const otps = loadOtps()
    const record = otps[cleanEmail]

    if (!record) {
      return NextResponse.json({ ok: false, error: 'Invalid or expired OTP' }, { status: 400 })
    }

    if (Date.now() > record.expires) {
      delete otps[cleanEmail]
      saveOtps(otps)
      return NextResponse.json({ ok: false, error: 'OTP has expired. Please request a new one.' }, { status: 400 })
    }

    if (record.otp !== otpStr) {
      return NextResponse.json({ ok: false, error: 'Invalid OTP' }, { status: 400 })
    }

    // OTP verified - remove it so it can't be reused
    delete otps[cleanEmail]
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
