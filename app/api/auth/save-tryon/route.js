import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 })
    }

    const { image, gownId, gownName } = await request.json()
    if (!image) {
      return NextResponse.json({ ok: false, error: 'No image provided.' }, { status: 400 })
    }

    // Store snapshot in ar_fit_profiles JSONB
    // We append to a snapshots array so users can have multiple saves
    const existing = await query(
      'SELECT profile FROM ar_fit_profiles WHERE user_id = $1',
      [userId]
    )

    const snapshot = {
      id:        crypto.randomUUID(),
      image,     // base64 data URL
      gownId:    gownId || null,
      gownName:  gownName || '',
      savedAt:   new Date().toISOString(),
    }

    if (existing.length === 0) {
      // Create new profile
      await query(
        `INSERT INTO ar_fit_profiles (user_id, profile)
         VALUES ($1, $2)`,
        [userId, JSON.stringify({ snapshots: [snapshot] })]
      )
    } else {
      // Append snapshot, keep last 20 only
      const profile   = existing[0].profile || {}
      const snapshots = Array.isArray(profile.snapshots) ? profile.snapshots : []
      snapshots.unshift(snapshot)
      if (snapshots.length > 20) snapshots.length = 20
      await query(
        `UPDATE ar_fit_profiles SET profile = $1, updated_at = NOW() WHERE user_id = $2`,
        [JSON.stringify({ ...profile, snapshots }), userId]
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Save try-on error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to save.' }, { status: 500 })
  }
}