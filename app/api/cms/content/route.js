import { NextResponse } from 'next/server'
const VALID_SECTIONS = ['about', 'collection-spotlight', 'footer', 'theme-config', 'contact']
export const dynamic = 'force-dynamic'
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const section = searchParams.get('section')

  const USE_DB = process.env.USE_DB === 'true'

  if (!USE_DB) {
    const { getContentBlock } = await import('@/lib/cms')
    if (section) {
      if (!VALID_SECTIONS.includes(section))
        return NextResponse.json({ ok: false, error: 'Invalid section' }, { status: 400 })
      const fields = await getContentBlock(section)
      return NextResponse.json({ ok: true, fields })
    }
    const all = {}
    for (const s of VALID_SECTIONS) all[s] = await getContentBlock(s)
    return NextResponse.json({ ok: true, blocks: all })
  }

  try {
    const { query } = await import('@/lib/db')
    if (section) {
      if (!VALID_SECTIONS.includes(section))
        return NextResponse.json({ ok: false, error: 'Invalid section' }, { status: 400 })
      const rows = await query(
        `SELECT fields FROM cms_content_blocks WHERE section = $1`, [section]
      )
      return NextResponse.json({ ok: true, fields: rows[0]?.fields || {} })
    }
    const rows = await query(
      `SELECT section, fields FROM cms_content_blocks ORDER BY section`
    )
    const blocks = {}
    for (const r of rows) blocks[r.section] = r.fields
    return NextResponse.json({ ok: true, blocks })
  } catch (err) {
    console.error('Public CMS content GET error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch content' }, { status: 500 })
  }
}