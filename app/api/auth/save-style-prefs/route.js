import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 })

    const { bodyType, skinTone, styleTags, preferredSilhouettes, preferredColors } = await request.json()

    const existing = await query('SELECT id FROM user_style_preferences WHERE user_id = $1', [userId])

    if (existing.length === 0) {
      await query(
        `INSERT INTO user_style_preferences
           (user_id, body_type, skin_tone, style_tags, preferred_silhouettes, preferred_colors)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, bodyType||null, skinTone||null,
         JSON.stringify(styleTags||[]),
         JSON.stringify(preferredSilhouettes||[]),
         JSON.stringify(preferredColors||[])]
      )
    } else {
      await query(
        `UPDATE user_style_preferences
         SET body_type=$1, skin_tone=$2, style_tags=$3,
             preferred_silhouettes=$4, preferred_colors=$5, updated_at=NOW()
         WHERE user_id=$6`,
        [bodyType||null, skinTone||null,
         JSON.stringify(styleTags||[]),
         JSON.stringify(preferredSilhouettes||[]),
         JSON.stringify(preferredColors||[]),
         userId]
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Save style prefs error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to save.' }, { status: 500 })
  }
}