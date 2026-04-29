import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const USE_DB = process.env.USE_DB === 'true'

  if (!USE_DB) {
    const { getHeroSlides } = await import('@/lib/cms')
    const slides = await getHeroSlides()
    return NextResponse.json({ ok: true, slides })
  }

  try {
    const { query } = await import('@/lib/db')
    const slides = await query(
      `SELECT * FROM cms_hero_slides WHERE is_active = TRUE ORDER BY sort_order ASC`
    )
    return NextResponse.json({ ok: true, slides })
  } catch (err) {
    console.error('Public CMS hero GET error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch slides' }, { status: 500 })
  }
}