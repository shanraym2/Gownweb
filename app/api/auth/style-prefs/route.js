import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth'

// ─────────────────────────────────────────────────────────────────────────────
// GET STYLE PREFERENCES
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request) {
  try {
    const sessionUser = await getAuthenticatedUser(request)

    if (!sessionUser) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated.' },
        { status: 401 }
      )
    }
    const userId = sessionUser.id

    const rows = await query(
      `
      SELECT
        body_type,
        skin_tone,
        style_tags,
        preferred_silhouettes,
        preferred_colors
      FROM user_style_preferences
      WHERE user_id = $1
      LIMIT 1
      `,
      [userId]
    )

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        prefs: null,
      })
    }

    const prefs = rows[0]

    return NextResponse.json({
      ok: true,
      prefs: {
        bodyType: prefs.body_type,
        skinTone: prefs.skin_tone,
        styleTags: prefs.style_tags || [],
        preferredSilhouettes: prefs.preferred_silhouettes || [],
        preferredColors: prefs.preferred_colors || [],
      },
    })
  } catch (err) {
    console.error('Load style prefs error:', err)

    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to load preferences.',
      },
      { status: 500 }
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SAVE STYLE PREFERENCES
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const sessionUser = await getAuthenticatedUser(request)

    if (!sessionUser) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated.' },
        { status: 401 }
      )
    }
    const userId = sessionUser.id

    const {
      bodyType,
      skinTone,
      styleTags,
      preferredSilhouettes,
      preferredColors,
    } = await request.json()

    const existing = await query(
      'SELECT id FROM user_style_preferences WHERE user_id = $1',
      [userId]
    )

    if (existing.length === 0) {
      await query(
        `
        INSERT INTO user_style_preferences
        (
          user_id,
          body_type,
          skin_tone,
          style_tags,
          preferred_silhouettes,
          preferred_colors
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          userId,
          bodyType || null,
          skinTone || null,
          JSON.stringify(styleTags || []),
          JSON.stringify(preferredSilhouettes || []),
          JSON.stringify(preferredColors || []),
        ]
      )
    } else {
      await query(
        `
        UPDATE user_style_preferences
        SET
          body_type = $1,
          skin_tone = $2,
          style_tags = $3,
          preferred_silhouettes = $4,
          preferred_colors = $5,
          updated_at = NOW()
        WHERE user_id = $6
        `,
        [
          bodyType || null,
          skinTone || null,
          JSON.stringify(styleTags || []),
          JSON.stringify(preferredSilhouettes || []),
          JSON.stringify(preferredColors || []),
          userId,
        ]
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Save style prefs error:', err)

    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to save.',
      },
      { status: 500 }
    )
  }
}
