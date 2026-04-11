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
    if (!passwordMeetsRules(cleanPass)) {
      return NextResponse.json(
        { ok: false, error: 'Password must be at least 8 characters and include letters and numbers.' },
        { status: 400 }
      )
    }

    const rows = await query(
      'SELECT id FROM users WHERE email = $1',
      [cleanEmail]
    )

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No account found with this email.' },
        { status: 404 }
      )
    }

    const passwordHash = await bcrypt.hash(cleanPass, 12)
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