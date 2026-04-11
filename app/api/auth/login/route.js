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

    const rows = await query(
      `SELECT id, first_name, last_name, email, password_hash, role, is_active
       FROM users WHERE email = $1 LIMIT 1`,
      [cleanEmail]
    )

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No account found with this email.' },
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
      return NextResponse.json(
        { ok: false, error: 'Incorrect password.' },
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