import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendOtp, checkOtpIpLimit } from '@/lib/sendOtp'

const PURPOSE_MAP = {
  login:          'login',
  signup:         'signup',
  auth:           'login',
  password_reset: 'password_reset',
}

export async function POST(request) {
  try {
    const { email, purpose } = await request.json()
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
    if (!checkOtpIpLimit(ip)) {
      return NextResponse.json(
        { ok: false, error: 'Too many requests. Please wait before requesting another code.' },
        { status: 429, headers: { 'Retry-After': '600' } }
      )
    }

    if (!email || typeof email !== 'string')
      return NextResponse.json({ ok: false, error: 'Email is required' }, { status: 400 })

    const cleanEmail = email.trim().toLowerCase()
    const rawPurpose = String(purpose || 'login').trim().toLowerCase()
    const dbPurpose  = PURPOSE_MAP[rawPurpose]

    if (!dbPurpose)
      return NextResponse.json({ ok: false, error: 'Invalid OTP purpose' }, { status: 400 })

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))
      return NextResponse.json({ ok: false, error: 'Invalid email format' }, { status: 400 })

    if (dbPurpose === 'login') {
      const userExists = await query('SELECT id FROM users WHERE email = $1', [cleanEmail])
      if (userExists.length === 0)
        return NextResponse.json({ ok: true, devMode: false, message: 'OTP sent if account exists' })
    }

    const result = await sendOtp(cleanEmail, dbPurpose)
    if (!result.ok)
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status || 500 })

    return NextResponse.json({ ok: true, devMode: result.devMode, message: 'OTP sent' })
  } catch (err) {
    console.error('Send OTP error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to send OTP. Please try again.' }, { status: 500 })
  }
}