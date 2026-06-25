// lib/auth.js
import crypto from 'crypto'
import { query } from '@/lib/db'

export async function getAuthenticatedUser(request) {
  const token = request.cookies.get('jce_session')?.value
  if (!token) return null
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  const rows = await query(
    `SELECT u.id, u.email, u.role, u.first_name, u.last_name
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [hash]
  )
  return rows[0] || null
}