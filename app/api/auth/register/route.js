import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { isRealName, passwordMeetsRules } from '@/app/utils/authValidation'
import path from 'path'
import fs   from 'fs'

// ── Production safety guard ───────────────────────────────────────────────────
// JSON file mode stores user data (including bcrypt hashes) in a flat file on
// disk. This is only acceptable for local development. If this guard throws on
// startup it means USE_DB=true is missing from your DigitalOcean environment
// variables — add it in App Platform → Settings → Environment Variables.
if (process.env.NODE_ENV === 'production' && process.env.USE_DB !== 'true') {
  throw new Error(
    'FATAL: USE_DB must be "true" in production. ' +
    'JSON file mode must not be used in a deployed environment.'
  )
}

const USE_DB   = process.env.USE_DB === 'true'
const dataFile = path.join(process.cwd(), 'data', 'users.json')

function loadUsers() {
  if (!fs.existsSync(dataFile)) return []
  return JSON.parse(fs.readFileSync(dataFile, 'utf8'))
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true })
  fs.writeFileSync(dataFile, JSON.stringify(users, null, 2))
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// FIXED: Previously only checked ADMIN_EMAIL, ignoring STAFF_EMAILS.
// A staff member self-registering would get the 'customer' role instead of 'staff'.
function getRole(email) {
  const adminEmail  = (process.env.ADMIN_EMAIL  || '').trim().toLowerCase()
  const staffEmails = (process.env.STAFF_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)

  if (adminEmail && email === adminEmail) return 'admin'
  if (staffEmails.includes(email))        return 'staff'
  return 'customer'
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { firstName, lastName, email, password } = body

    const cleanFirst = String(firstName || '').trim()
    const cleanLast  = String(lastName  || '').trim()
    const cleanEmail = normalizeEmail(email)
    const cleanPass  = String(password  || '')

    if (!isRealName(cleanFirst)) {
      return NextResponse.json({ ok: false, error: 'Please enter a valid first name.' }, { status: 400 })
    }
    if (!isRealName(cleanLast)) {
      return NextResponse.json({ ok: false, error: 'Please enter a valid last name.' }, { status: 400 })
    }
    if (!isValidEmail(cleanEmail)) {
      return NextResponse.json({ ok: false, error: 'Please enter a valid email address.' }, { status: 400 })
    }
    if (!passwordMeetsRules(cleanPass)) {
      return NextResponse.json(
        { ok: false, error: 'Password must be at least 8 characters and include letters and numbers.' },
        { status: 400 }
      )
    }

    // Cost factor 10: consistent with all other auth routes in this project.
    // Factor 12 risks hitting Next.js serverless timeout on basic DigitalOcean
    // droplets (~1–3s at factor 12 vs ~300ms at factor 10).
    const passwordHash = await bcrypt.hash(cleanPass, 10)
    const role         = getRole(cleanEmail)

    // ── JSON mode ─────────────────────────────────────────────────────────────
    // Only reachable locally (USE_DB=false). The production guard at the top of
    // this file prevents this path from ever running in a deployed environment.
    if (!USE_DB) {
      const users    = loadUsers()
      const existing = users.find(u => String(u.email || '').toLowerCase() === cleanEmail)
      if (existing) {
        return NextResponse.json(
          { ok: false, error: 'An account with this email already exists.' },
          { status: 409 }
        )
      }

      const newUser = {
        id:           String(Date.now()),
        firstName:    cleanFirst,
        lastName:     cleanLast,
        name:         `${cleanFirst} ${cleanLast}`.trim(),
        email:        cleanEmail,
        passwordHash,
        role,
        createdAt:    new Date().toISOString(),
      }

      saveUsers([...users, newUser])

      return NextResponse.json({
        ok:   true,
        user: {
          id:        newUser.id,
          firstName: newUser.firstName,
          lastName:  newUser.lastName,
          name:      newUser.name,
          email:     newUser.email,
          role:      newUser.role,
          createdAt: newUser.createdAt,
        },
      })
    }

    // ── DB mode ───────────────────────────────────────────────────────────────
    const { query } = await import('@/lib/db')

    const existing = await query(
      'SELECT id FROM users WHERE email = $1',
      [cleanEmail]
    )

    if (existing.length > 0) {
      return NextResponse.json(
        { ok: false, error: 'An account with this email already exists.' },
        { status: 409 }
      )
    }

    const rows = await query(
      `INSERT INTO users (
          first_name,
          last_name,
          email,
          password_hash,
          role
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
          id,
          first_name,
          last_name,
          email,
          role,
          created_at`,
      [cleanFirst, cleanLast, cleanEmail, passwordHash, role]
    )

    const user = rows[0]
    return NextResponse.json({
      ok:   true,
      user: {
        id:        user.id,
        firstName: user.first_name,
        lastName:  user.last_name,
        name:      `${user.first_name} ${user.last_name}`.trim(),
        email:     user.email,
        role:      user.role,
        createdAt: user.created_at,
      },
    })
  } catch (err) {
    console.error('Register error:', err)
    return NextResponse.json(
      { ok: false, error: 'Failed to create account. Please try again.' },
      { status: 500 }
    )
  }
}