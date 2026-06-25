import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'

export const dynamic = 'force-dynamic'

const USE_DB   = process.env.USE_DB === 'true'
const dataFile = path.join(process.cwd(), 'data', 'users.json')

const rateLimitMap = new Map()
const WINDOW_MS = 60_000
const MAX_REQUESTS = 20

function checkRateLimit(request) {
  const key = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    rateLimitMap.set(key, { windowStart: now, count: 1 })
    return true
  }
  entry.count++
  return entry.count <= MAX_REQUESTS
}

function loadUsers() {
  if (!fs.existsSync(dataFile)) return []
  return JSON.parse(fs.readFileSync(dataFile, 'utf8'))
}

export async function GET(request) {
  if (!checkRateLimit(request)) {
    return NextResponse.json({ taken: false }, { status: 429, headers: { 'Retry-After': '60' } })
  }
  try {
    const { searchParams } = new URL(request.url)
    const email = String(searchParams.get('email') || '').trim().toLowerCase()

    if (!email) return NextResponse.json({ taken: false })

    if (!USE_DB) {
      const users = loadUsers()
      const taken = users.some(u => String(u.email || '').toLowerCase() === email)
      return NextResponse.json({ taken })
    }

    const { query } = await import('@/lib/db')
    const rows = await query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email])
    return NextResponse.json({ taken: rows.length > 0 })
  } catch (err) {
    console.error('Check email error:', err)
    return NextResponse.json({ taken: false })
  }
}