import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function POST(request) {
  try {
    const { name, email, password } = await request.json()

    // Validation
    if (!name || !email || !password) {
      return NextResponse.json(
        { ok: false, error: 'Name, email, and password are required' },
        { status: 400 }
      )
    }

    const cleanName = String(name).trim()
    const cleanEmail = String(email).trim().toLowerCase()
    const cleanPassword = String(password).trim()

    if (cleanPassword.length < 6) {
      return NextResponse.json(
        { ok: false, error: 'Password must be at least 6 characters' },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existing = await query('SELECT id FROM users WHERE LOWER(email) = ?', [cleanEmail])
    if (existing.length > 0) {
      return NextResponse.json(
        { ok: false, error: 'An account with this email already exists' },
        { status: 409 }
      )
    }

    // For production, use bcrypt or argon2 to hash passwords
    // For now, storing as plain text (NOT SECURE - only for demo)
    const result = await query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [cleanName, cleanEmail, cleanPassword, 'customer']
    )

    if (!result.insertId) {
      return NextResponse.json(
        { ok: false, error: 'Failed to create account' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        ok: true,
        message: 'Account created successfully',
        user: {
          id: result.insertId,
          name: cleanName,
          email: cleanEmail,
          role: 'customer',
        },
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('Register error:', err)
    return NextResponse.json(
      { ok: false, error: 'Registration failed. Please try again.' },
      { status: 500 }
    )
  }
}
