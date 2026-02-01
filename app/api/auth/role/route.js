import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')
  if (!email) {
    return NextResponse.json({ ok: false, error: 'Email required' }, { status: 400 })
  }
  // Read from env; trim to avoid spaces from .env file
  const rawAdmin = process.env.ADMIN_EMAIL
  const adminEmail = typeof rawAdmin === 'string' ? rawAdmin.trim() : ''
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedAdmin = adminEmail.toLowerCase()
  const isAdmin =
    normalizedAdmin.length > 0 && normalizedEmail === normalizedAdmin
  const role = isAdmin ? 'admin' : 'customer'
  const res = { ok: true, role }
  // In development, tell the client if ADMIN_EMAIL is set (so they can debug)
  if (process.env.NODE_ENV === 'development') {
    res.adminEmailConfigured = adminEmail.length > 0
  }
  return NextResponse.json(res)
}
