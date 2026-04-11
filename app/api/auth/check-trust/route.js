import { NextResponse } from 'next/server'

export async function POST(request) {
  try {
    const { email } = await request.json()
    if (!email) return NextResponse.json({ trusted: false })

    const cleanEmail  = email.trim().toLowerCase()
    const cookieKey   = `jce_trust_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`
    const cookieStore = request.cookies
    const token       = cookieStore.get(cookieKey)?.value

    return NextResponse.json({ trusted: !!token })
  } catch {
    return NextResponse.json({ trusted: false })
  }
}