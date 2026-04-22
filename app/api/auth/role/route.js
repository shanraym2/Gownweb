// app/api/auth/role/route.js
//
// Role resolution order:
//   1. Database  — role column on the users table (source of truth for staff/admin
//                  created via the Users UI)
//   2. Env vars  — ADMIN_EMAIL / STAFF_EMAILS override (useful for the very first
//                  bootstrap admin before the DB row exists, or for CI environments)
//
// The DB wins when a row exists; env vars act as a fallback/override.

import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')

  if (!email) {
    return NextResponse.json({ ok: false, error: 'Email required' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()

  // ── 1. Database lookup ───────────────────────────────────────────────────
  let dbRole = null
  try {
    const rows = await query(
      'SELECT role FROM users WHERE email = $1 AND is_active = TRUE LIMIT 1',
      [normalizedEmail]
    )
    if (rows.length > 0) dbRole = rows[0].role
  } catch (err) {
    // DB unavailable — fall through to env-var check
    console.warn('[role] DB lookup failed, falling back to env vars:', err.message)
  }

  // ── 2. Env-var overrides ─────────────────────────────────────────────────
  const adminEmail  = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const staffEmails = (process.env.STAFF_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)

  const envIsAdmin = adminEmail.length > 0 && normalizedEmail === adminEmail
  const envIsStaff = staffEmails.includes(normalizedEmail)

  // ── 3. Merge: env-var admin/staff designation always wins upward;
  //             DB role wins when env vars don't match ────────────────────
  let role
  if (envIsAdmin) {
    role = 'admin'
  } else if (envIsStaff) {
    // Env marks them as staff — honour it even if DB says customer
    role = dbRole === 'admin' ? 'admin' : 'staff'
  } else if (dbRole) {
    role = dbRole
  } else {
    role = 'customer'
  }

  const res = { ok: true, role }

  // Development debug info
  if (process.env.NODE_ENV === 'development') {
    res.dbRole                  = dbRole
    res.adminEmailConfigured    = adminEmail.length > 0
    res.staffEmailsConfigured   = staffEmails.length > 0
    res.staffCount              = staffEmails.length
    res.resolvedFrom            = envIsAdmin ? 'env:admin' : envIsStaff ? 'env:staff' : dbRole ? 'db' : 'default'
  }

  return NextResponse.json(res)
}