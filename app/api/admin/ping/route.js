// app/api/admin/ping/route.js
//
// Lightweight endpoint used solely to validate the admin secret.
// Returns 200 on success, 401 on failure — no DB queries, no side effects.

import { NextResponse } from 'next/server'

function checkAuth(request) {
  const secret = request.headers.get('x-admin-secret') || ''
  return process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET
}

export async function GET(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}