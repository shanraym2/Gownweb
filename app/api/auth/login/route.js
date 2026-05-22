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
      `SELECT id, first_name, last_name, email, password_hash, role, is_active, created_at
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [cleanEmail]
    )

    // Same error message whether email exists or not — prevents email enumeration
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
      return NextResponse.json(
        { ok: false, error: 'Invalid email or password.' },
        { status: 401 }
      )
    }

    // Build the response with a session cookie so middleware can identify the user
    const userData = {
      id:        user.id,
      firstName: user.first_name,
      lastName:  user.last_name,
      name:      `${user.first_name} ${user.last_name}`.trim(),
      email:     user.email,
      role:      user.role,
      createdAt: user.created_at,
    }

    const response = NextResponse.json({ ok: true, user: userData })

    // Persist a simple session cookie so the user stays logged in across
    // page navigations without localStorage being the sole source of truth.
    // HttpOnly so JS cannot read it — used only by middleware for role checks.
    response.cookies.set('jce_session', user.id, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   60 * 60 * 24 * 7,   // 7 days
      path:     '/',
    })

    return response
  } catch (err) {
    console.error('Login error:', err)
    return NextResponse.json(
      { ok: false, error: 'Login failed. Please try again.' },
      { status: 500 }
    )
  }
}