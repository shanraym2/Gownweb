import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import bcrypt from 'bcryptjs'

function checkAuth(request) {
  const secret = request.headers.get('x-admin-secret') || ''
  return process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET
}

function mapUser(row) {
  return {
    id:        row.id,
    firstName: row.first_name,
    lastName:  row.last_name,
    name:      `${row.first_name} ${row.last_name}`.trim(),
    email:     row.email,
    phone:     row.phone || '',
    role:      row.role,
    isActive:  row.is_active,
    createdAt: row.created_at,
  }
}

// GET — list all users
export async function GET(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const rows = await query(`
      SELECT id, first_name, last_name, email, phone, role, is_active, created_at
      FROM users
      ORDER BY created_at DESC
    `)
    return NextResponse.json({ ok: true, users: rows.map(mapUser) })
  } catch (err) {
    console.error('Admin users GET error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch users' }, { status: 500 })
  }
}

// POST — create user
export async function POST(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { firstName, lastName, email, password, role } = await request.json()
    if (!firstName || !lastName || !email || !password) {
      return NextResponse.json({ ok: false, error: 'All fields are required.' }, { status: 400 })
    }
    const cleanEmail = email.trim().toLowerCase()
    const existing   = await query('SELECT id FROM users WHERE email = $1', [cleanEmail])
    if (existing.length > 0) {
      return NextResponse.json(
        { ok: false, error: 'An account with this email already exists.' },
        { status: 409 }
      )
    }
    const passwordHash = await bcrypt.hash(password, 12)
    // ── Accept customer, staff, and admin ──
    const validRole = ['customer', 'staff', 'admin'].includes(role) ? role : 'customer'
    const rows = await query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [firstName.trim(), lastName.trim(), cleanEmail, passwordHash, validRole]
    )
    return NextResponse.json({ ok: true, user: mapUser(rows[0]) })
  } catch (err) {
    console.error('Admin users POST error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to create user.' }, { status: 500 })
  }
}

// PUT — update user (name, email, role, password, is_active)
export async function PUT(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { id, firstName, lastName, email, password, role, isActive } = await request.json()
    if (!id) return NextResponse.json({ ok: false, error: 'Id required.' }, { status: 400 })

    const setClauses = []
    const values     = []
    let   p          = 1

    if (firstName !== undefined) { setClauses.push(`first_name=$${p++}`); values.push(firstName.trim()) }
    if (lastName  !== undefined) { setClauses.push(`last_name=$${p++}`);  values.push(lastName.trim()) }
    if (email !== undefined) {
      const cleanEmail = email.trim().toLowerCase()
      const taken = await query('SELECT id FROM users WHERE email=$1 AND id!=$2', [cleanEmail, id])
      if (taken.length > 0) {
        return NextResponse.json({ ok: false, error: 'Email already in use.' }, { status: 409 })
      }
      setClauses.push(`email=$${p++}`); values.push(cleanEmail)
    }
    if (role !== undefined) {
      // ── Accept customer, staff, and admin ──
      const validRole = ['customer', 'staff', 'admin'].includes(role) ? role : 'customer'
      setClauses.push(`role=$${p++}`); values.push(validRole)
    }
    if (isActive !== undefined) { setClauses.push(`is_active=$${p++}`); values.push(isActive) }
    if (password) {
      const hash = await bcrypt.hash(password, 12)
      setClauses.push(`password_hash=$${p++}`); values.push(hash)
    }

    if (!setClauses.length) {
      return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 })
    }

    values.push(id)
    const rows = await query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id=$${p} RETURNING *`,
      values
    )
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: 'User not found.' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, user: mapUser(rows[0]) })
  } catch (err) {
    console.error('Admin users PUT error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to update user.' }, { status: 500 })
  }
}

// DELETE — deactivate (soft) or hard delete
export async function DELETE(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { searchParams } = new URL(request.url)
    const id        = searchParams.get('id')
    const permanent = searchParams.has('permanent')
    if (!id) return NextResponse.json({ ok: false, error: 'Id required.' }, { status: 400 })

    if (permanent) {
      await query('DELETE FROM users WHERE id=$1', [id])
    } else {
      await query('UPDATE users SET is_active=FALSE WHERE id=$1', [id])
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Admin users DELETE error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to delete user.' }, { status: 500 })
  }
}