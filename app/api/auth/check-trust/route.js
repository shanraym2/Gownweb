import { NextResponse } from 'next/server'
import crypto from 'crypto'

// SECURITY FIX: Must use the same opaque (hashed) cookie name as verify-otp.
// Previously this used the raw email in the cookie name, leaking it to DevTools.
function trustCookieName(email) {
  const hash = crypto.createHash('sha256').update(email).digest('hex')
  return `jce_trust_${hash.slice(0, 16)}`
}

export async function POST(request) {
  try {
    const { email } = await request.json()
    if (!email) return NextResponse.json({ trusted: false })

    const cleanEmail = email.trim().toLowerCase()
    const cookieKey  = trustCookieName(cleanEmail)
    const token      = request.cookies.get(cookieKey)?.value

    return NextResponse.json({ trusted: !!token })
  } catch {
    return NextResponse.json({ trusted: false })
  }
}