import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'

const USE_DB   = process.env.USE_DB === 'true'
const dataFile = path.join(process.cwd(), 'data', 'users.json')

function loadUsers() {
  if (!fs.existsSync(dataFile)) return []
  return JSON.parse(fs.readFileSync(dataFile, 'utf8'))
}

export async function GET(request) {
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