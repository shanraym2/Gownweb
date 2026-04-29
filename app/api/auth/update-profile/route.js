import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { isRealName } from '@/app/utils/authValidation'

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export async function PATCH(request) {
  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 })
    }

    const body = await request.json()
    // Accept both split fields (firstName/lastName) and legacy combined (name)
    const { firstName, lastName, name, email, password } = body

    const setClauses = []
    const values     = []
    let   paramIndex = 1

    // ── Name handling ─────────────────────────────────────────────────────────
    // Prefer firstName/lastName if provided; fall back to splitting legacy name
    if (firstName !== undefined || lastName !== undefined || name !== undefined) {
      let cleanFirst, cleanLast

      if (firstName !== undefined || lastName !== undefined) {
        // Split-field path (used by admin EditSelfModal)
        cleanFirst = String(firstName || '').trim()
        cleanLast  = String(lastName  || '').trim()
      } else {
        // Legacy combined name path
        const cleanName = String(name || '').trim().replace(/\s+/g, ' ')
        const parts     = cleanName.split(' ')
        cleanFirst = parts[0]
        cleanLast  = parts.slice(1).join(' ') || parts[0]
      }

      if (!isRealName(cleanFirst)) {
        return NextResponse.json(
          { ok: false, error: 'First name: letters only, spaces, hyphens, and apostrophes.' },
          { status: 400 }
        )
      }
      if (!isRealName(cleanLast)) {
        return NextResponse.json(
          { ok: false, error: 'Last name: letters only, spaces, hyphens, and apostrophes.' },
          { status: 400 }
        )
      }

      setClauses.push(`first_name = $${paramIndex++}`)
      values.push(cleanFirst)
      setClauses.push(`last_name = $${paramIndex++}`)
      values.push(cleanLast)
    }

    // ── Email handling ────────────────────────────────────────────────────────
    if (email !== undefined) {
      const cleanEmail = normalizeEmail(email)
      const taken = await query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [cleanEmail, userId]
      )
      if (taken.length > 0) {
        return NextResponse.json(
          { ok: false, error: 'That email is already in use.' },
          { status: 409 }
        )
      }
      setClauses.push(`email = $${paramIndex++}`)
      values.push(cleanEmail)
    }

    // ── Password handling ─────────────────────────────────────────────────────
    if (password !== undefined && password !== '') {
      const hash = await bcrypt.hash(String(password), 12)
      setClauses.push(`password_hash = $${paramIndex++}`)
      values.push(hash)
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 })
    }

    values.push(userId)
    const rows = await query(
      `UPDATE users
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, first_name, last_name, email, role`,
      values
    )

    if (!rows.length) {
      return NextResponse.json({ ok: false, error: 'User not found.' }, { status: 404 })
    }

    const u = rows[0]
    return NextResponse.json({
      ok: true,
      user: {
        id:        u.id,
        firstName: u.first_name,
        lastName:  u.last_name,
        name:      `${u.first_name} ${u.last_name}`.trim(),
        email:     u.email,
        role:      u.role,
      },
    })
  } catch (err) {
    console.error('Update profile error:', err)
    return NextResponse.json(
      { ok: false, error: 'Failed to update profile. Please try again.' },
      { status: 500 }
    )
  }
}