// app/api/auth/role/route.js
//
// SECURITY FIX: Endpoint now requires an authenticated session.
// Previously accepted ?email= from anyone and revealed whether that email
// belonged to an admin or staff member. Now derives identity from the
// session cookie only — no caller-supplied email accepted.

import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth'

// In-memory rate limit store (per-process; good enough for single-instance).
// For multi-instance deployments, swap this for a Redis/Upstash counter.
const rateLimitMap = new Map()
const WINDOW_MS    = 60_000  // 1 minute
const MAX_REQUESTS = 20

function getRateLimitKey(request) {
  // Use the X-Forwarded-For header (set by your reverse proxy / Vercel edge)
  // falling back to a generic key if unavailable.
  const forwarded = request.headers.get('x-forwarded-for')
  return forwarded ? forwarded.split(',')[0].trim() : 'unknown'
}

function checkRateLimit(key) {
  const now = Date.now()
  const entry = rateLimitMap.get(key)

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    rateLimitMap.set(key, { windowStart: now, count: 1 })
    return { allowed: true, remaining: MAX_REQUESTS - 1 }
  }

  entry.count++
  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000)
    return { allowed: false, retryAfter }
  }

  return { allowed: true, remaining: MAX_REQUESTS - entry.count }
}

// Periodically prune stale entries to avoid unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS
  for (const [key, entry] of rateLimitMap) {
    if (entry.windowStart < cutoff) rateLimitMap.delete(key)
  }
}, WINDOW_MS)

export async function GET(request) {
  const sessionUser = await getAuthenticatedUser(request)
  if (!sessionUser) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })
  }

  const normalizedEmail = sessionUser.email.trim().toLowerCase()

  // ── 1. Database lookup ───────────────────────────────────────────────────
  let dbRole = null
  try {
    const rows = await query(
      'SELECT role FROM users WHERE email = $1 AND is_active = TRUE LIMIT 1',
      [normalizedEmail]
    )
    if (rows.length > 0) dbRole = rows[0].role
  } catch (err) {
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

  // ── 3. Merge ─────────────────────────────────────────────────────────────
  let role
  if (envIsAdmin)      role = 'admin'
  else if (envIsStaff) role = dbRole === 'admin' ? 'admin' : 'staff'
  else if (dbRole)     role = dbRole
  else                 role = 'customer'

  const res = { ok: true, role }

  if (process.env.NODE_ENV === 'development') {
    res.dbRole       = dbRole
    res.resolvedFrom = envIsAdmin ? 'env:admin' : envIsStaff ? 'env:staff' : dbRole ? 'db' : 'default'
  }

  return NextResponse.json(res)
}