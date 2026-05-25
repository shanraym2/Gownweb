import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const USE_DB = process.env.USE_DB === 'true'

function getUserId(request) {
  return request.headers.get('x-user-id') || null
}

export async function GET(request) {
  const userId = getUserId(request)
  if (!userId) return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 })

  if (!USE_DB) return NextResponse.json({ ok: true, favoriteIds: [] })

  try {
    const { query } = await import('@/lib/db')
    const rows = await query(
      `SELECT gown_id FROM favorites WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    )
    return NextResponse.json({ ok: true, favoriteIds: rows.map(r => r.gown_id) })
  } catch (err) {
    console.error('GET /api/favorites error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch favorites.' }, { status: 500 })
  }
}

export async function POST(request) {
  const userId = getUserId(request)
  if (!userId) return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 })

  let gownId
  try { ({ gownId } = await request.json()) } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 })
  }
  if (!gownId) return NextResponse.json({ ok: false, error: 'gownId is required.' }, { status: 400 })

  if (!USE_DB) return NextResponse.json({ ok: true })

  try {
    const { query } = await import('@/lib/db')
    await query(
      `INSERT INTO favorites (user_id, gown_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, gown_id) DO NOTHING`,
      [userId, gownId]
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST /api/favorites error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to save favorite.' }, { status: 500 })
  }
}

export async function DELETE(request) {
  const userId = getUserId(request)
  if (!userId) return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 })

  let gownId
  try { ({ gownId } = await request.json()) } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 })
  }
  if (!gownId) return NextResponse.json({ ok: false, error: 'gownId is required.' }, { status: 400 })

  if (!USE_DB) return NextResponse.json({ ok: true })

  try {
    const { query } = await import('@/lib/db')
    await query(
      `DELETE FROM favorites WHERE user_id = $1 AND gown_id = $2`,
      [userId, gownId]
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/favorites error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to remove favorite.' }, { status: 500 })
  }
}