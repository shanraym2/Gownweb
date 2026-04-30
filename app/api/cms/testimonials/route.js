import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const USE_DB = process.env.USE_DB === 'true'

  if (!USE_DB) {
    const { getTestimonials } = await import('@/lib/cms')
    return NextResponse.json({ ok: true, testimonials: await getTestimonials() })
  }

  try {
    const { query } = await import('@/lib/db')
    const testimonials = await query(
      `SELECT id, quote_text, author_name, image_url, sort_order
      FROM cms_testimonials WHERE is_active = TRUE ORDER BY sort_order ASC`
    )
    return NextResponse.json({ ok: true, testimonials })
  } catch (err) {
    console.error('Public CMS testimonials GET error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch' }, { status: 500 })
  }
}