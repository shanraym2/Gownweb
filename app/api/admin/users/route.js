// app/api/admin/users/route.js
// Audit-instrumented version — logAudit() added to POST, PUT, DELETE.

import { NextResponse } from 'next/server'
import { query }        from '@/lib/db'
import bcrypt           from 'bcryptjs'
import { checkAdminAuth } from '@/lib/adminAuth'
import { logAudit }       from '@/lib/audit'

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

function generateTempPassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz'
  let pwd = ''
  for (let i = 0; i < 12; i++) pwd += chars.charAt(Math.floor(Math.random() * chars.length))
  return pwd
}

// GET — list all users
export async function GET(request) {
  if (!await checkAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    const rows = await query(`
      SELECT id, first_name, last_name, email, phone, role, is_active, created_at
      FROM users ORDER BY created_at DESC
    `)
    return NextResponse.json({ ok: true, users: rows.map(mapUser) })
  } catch (err) {
    console.error('Admin users GET error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch users' }, { status: 500 })
  }
}

// POST — create user
export async function POST(request) {
  if (!await checkAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    const { firstName, lastName, email, password, role } = await request.json()
    if (!firstName || !lastName || !email) {
      return NextResponse.json({ ok: false, error: 'First name, last name, and email are required.' }, { status: 400 })
    }
    const cleanEmail = email.trim().toLowerCase()
    const existing   = await query('SELECT id FROM users WHERE email=$1', [cleanEmail])
    if (existing.length > 0) {
      return NextResponse.json({ ok: false, error: 'An account with this email already exists.' }, { status: 409 })
    }
    const finalPassword = password || generateTempPassword()
    const passwordHash  = await bcrypt.hash(finalPassword, 12)
    const validRole     = ['customer','staff','admin'].includes(role) ? role : 'customer'
    const rows = await query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [firstName.trim(), lastName.trim(), cleanEmail, passwordHash, validRole]
    )
    const user = mapUser(rows[0])

    // ── AUDIT ────────────────────────────────────────────────────────────────
    logAudit({
      request,
      action:     'user.create',
      entityType: 'user',
      entityId:   user.id,
      payload:    { email: cleanEmail, role: validRole, passwordWasProvided: !!password },
      // Note: actual password/hash is never logged
    })

    return NextResponse.json({ ok: true, user, tempPassword: finalPassword })
  } catch (err) {
    console.error('Admin users POST error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to create user.' }, { status: 500 })
  }
}

// PUT — update user (name, email, role, password, is_active)
export async function PUT(request) {
  if (!await checkAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    const { id, firstName, lastName, email, password, role, isActive } = await request.json()
    if (!id) return NextResponse.json({ ok: false, error: 'Id required.' }, { status: 400 })

    // Snapshot before for diff
    const beforeRows = await query(
      `SELECT first_name, last_name, email, role, is_active FROM users WHERE id=$1`,
      [id]
    )
    const before = beforeRows[0] || {}

    const setClauses = []
    const values     = []
    let   p          = 1

    // Track only what actually changed for the audit payload
    const changed = {}

    if (firstName !== undefined) {
      setClauses.push(`first_name=$${p++}`)
      values.push(firstName.trim())
      if (firstName.trim() !== before.first_name) changed.firstName = { from: before.first_name, to: firstName.trim() }
    }
    if (lastName !== undefined) {
      setClauses.push(`last_name=$${p++}`)
      values.push(lastName.trim())
      if (lastName.trim() !== before.last_name) changed.lastName = { from: before.last_name, to: lastName.trim() }
    }
    if (email !== undefined) {
      const cleanEmail = email.trim().toLowerCase()
      const taken = await query('SELECT id FROM users WHERE email=$1 AND id!=$2', [cleanEmail, id])
      if (taken.length > 0) {
        return NextResponse.json({ ok: false, error: 'Email already in use.' }, { status: 409 })
      }
      setClauses.push(`email=$${p++}`)
      values.push(cleanEmail)
      if (cleanEmail !== String(before.email).toLowerCase()) changed.email = { from: before.email, to: cleanEmail }
    }
    if (role !== undefined) {
      const validRole = ['customer','staff','admin'].includes(role) ? role : 'customer'
      setClauses.push(`role=$${p++}`)
      values.push(validRole)
      if (validRole !== before.role) changed.role = { from: before.role, to: validRole }
    }
    if (isActive !== undefined) {
      setClauses.push(`is_active=$${p++}`)
      values.push(isActive)
      if (isActive !== before.is_active) changed.isActive = { from: before.is_active, to: isActive }
    }
    if (password) {
      const hash = await bcrypt.hash(password, 12)
      setClauses.push(`password_hash=$${p++}`)
      values.push(hash)
      changed.password = '[changed]' // never log the actual value
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

    const user = mapUser(rows[0])

    // ── AUDIT ────────────────────────────────────────────────────────────────
    logAudit({
      request,
      action:     'user.update',
      entityType: 'user',
      entityId:   id,
      payload:    { email: user.email, changed },
    })

    return NextResponse.json({ ok: true, user })
  } catch (err) {
    console.error('Admin users PUT error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to update user.' }, { status: 500 })
  }
}

// DELETE — deactivate (soft) or hard delete
export async function DELETE(request) {
  if (!await checkAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    const { searchParams } = new URL(request.url)
    const id        = searchParams.get('id')
    const permanent = searchParams.has('permanent')
    if (!id) return NextResponse.json({ ok: false, error: 'Id required.' }, { status: 400 })

    // Fetch user details for audit before deletion
    const userRows = await query(`SELECT email, role FROM users WHERE id=$1`, [id])
    const userEmail = userRows[0]?.email || null
    const userRole  = userRows[0]?.role  || null

    if (permanent) {
      await query('DELETE FROM users WHERE id=$1', [id])
    } else {
      await query('UPDATE users SET is_active=FALSE WHERE id=$1', [id])
    }

    // ── AUDIT ────────────────────────────────────────────────────────────────
    logAudit({
      request,
      action:     permanent ? 'user.delete' : 'user.deactivate',
      entityType: 'user',
      entityId:   id,
      payload:    { targetEmail: userEmail, targetRole: userRole, permanent },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Admin users DELETE error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to delete user.' }, { status: 500 })
  }
}