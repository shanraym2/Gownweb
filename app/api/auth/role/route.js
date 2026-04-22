// app/api/auth/role/route.js
//
// SECURITY FIX: Added rate limiting to prevent email enumeration.
// Previously this endpoint was open — any caller could probe it to discover
// whether an email belongs to an admin/staff user. We now enforce a per-IP
// sliding window (same pattern as the OTP cooldown).
//
// Rate limit: 20 requests per minute per IP (generous for legitimate use,
// tight enough to prevent automated enumeration).

import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

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
  // ── Rate limit ───────────────────────────────────────────────────────────
  const rlKey    = getRateLimitKey(request)
  const rl       = checkRateLimit(rlKey)
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: `Too many requests. Please wait ${rl.retryAfter}s.` },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfter) },
      }
    )
  }

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
  if (envIsAdmin) {
    role = 'admin'
  } else if (envIsStaff) {
    role = dbRole === 'admin' ? 'admin' : 'staff'
  } else if (dbRole) {
    role = dbRole
  } else {
    role = 'customer'
  }

  const res = { ok: true, role }

  if (process.env.NODE_ENV === 'development') {
    res.dbRole                = dbRole
    res.adminEmailConfigured  = adminEmail.length > 0
    res.staffEmailsConfigured = staffEmails.length > 0
    res.staffCount            = staffEmails.length
    res.resolvedFrom          = envIsAdmin ? 'env:admin' : envIsStaff ? 'env:staff' : dbRole ? 'db' : 'default'
  }

  return NextResponse.json(res)
}