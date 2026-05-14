// app/api/admin/audit/route.js
// GET /api/admin/audit
// Query params:
//   action      — filter by exact action string (e.g. 'order.status')
//   entity_type — filter by entity_type (e.g. 'order', 'user', 'gown')
//   actor       — filter by actor_email (partial, case-insensitive)
//   from        — ISO date string lower bound on logged_at
//   to          — ISO date string upper bound on logged_at
//   limit       — rows per page (default 50, max 200)
//   offset      — pagination offset (default 0)

import { NextResponse }   from 'next/server'
import { checkAdminAuth } from '@/lib/adminAuth'
import { query }          from '@/lib/db'

export async function GET(request) {
  if (!await checkAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const action     = searchParams.get('action')      || ''
  const entityType = searchParams.get('entity_type') || ''
  const actor      = searchParams.get('actor')       || ''
  const from       = searchParams.get('from')        || ''
  const to         = searchParams.get('to')          || ''
  const limit      = Math.min(Number(searchParams.get('limit')  || 50),  200)
  const offset     = Math.max(Number(searchParams.get('offset') || 0),   0)

  try {
    const conditions = []
    const values     = []
    let   p          = 1

    if (action)     { conditions.push(`action = $${p++}`);                  values.push(action) }
    if (entityType) { conditions.push(`entity_type = $${p++}`);             values.push(entityType) }
    if (actor)      { conditions.push(`actor_email ILIKE $${p++}`);         values.push(`%${actor}%`) }
    if (from)       { conditions.push(`logged_at >= $${p++}::timestamptz`); values.push(from) }
    if (to)         { conditions.push(`logged_at <= $${p++}::timestamptz`); values.push(to) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const countRows = await query(
      `SELECT COUNT(*) AS total FROM admin_audit_log ${where}`,
      values
    )
    const total = Number(countRows[0]?.total || 0)

    const rows = await query(
      `SELECT id, actor_email, action, entity_type, entity_id, payload, ip, logged_at
       FROM admin_audit_log
       ${where}
       ORDER BY logged_at DESC
       LIMIT $${p++} OFFSET $${p++}`,
      [...values, limit, offset]
    )

    return NextResponse.json({ ok: true, total, limit, offset, logs: rows })
  } catch (err) {
    console.error('GET /api/admin/audit error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch audit logs' }, { status: 500 })
  }
}