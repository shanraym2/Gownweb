import { NextResponse } from 'next/server'

const USE_DB = process.env.USE_DB === 'true'

function checkAuth(request) {
  const secret = request.headers.get('x-admin-secret') || ''
  return process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET
}

const VALID_SECTIONS = ['about', 'collection-spotlight', 'footer', 'theme-config', 'contact']

export async function GET(request) {
  if (!checkAuth(request))
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const section = searchParams.get('section')

  if (!USE_DB) {
    const { getContentBlock } = await import('@/lib/cms')
    if (section) return NextResponse.json({ ok: true, fields: await getContentBlock(section) })
    const all = {}
    for (const s of VALID_SECTIONS) all[s] = await getContentBlock(s)
    return NextResponse.json({ ok: true, blocks: all })
  }

  try {
    const { query } = await import('@/lib/db')
    if (section) {
      const rows = await query(`SELECT fields FROM cms_content_blocks WHERE section=$1`, [section])
      return NextResponse.json({ ok: true, fields: rows[0]?.fields || {} })
    }
    const rows = await query(`SELECT section, fields FROM cms_content_blocks ORDER BY section`)
    const blocks = {}
    for (const r of rows) blocks[r.section] = r.fields
    return NextResponse.json({ ok: true, blocks })
  } catch (err) {
    console.error('CMS content GET error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch content' }, { status: 500 })
  }
}

export async function PUT(request) {
  if (!checkAuth(request))
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { section, fields } = await request.json()
  if (!section || !VALID_SECTIONS.includes(section))
    return NextResponse.json({ ok: false, error: 'Valid section required' }, { status: 400 })
  if (!fields || typeof fields !== 'object')
    return NextResponse.json({ ok: false, error: 'fields object required' }, { status: 400 })

  if (!USE_DB)
    return NextResponse.json({ ok: false, error: 'DB required for writes' }, { status: 400 })

  try {
    const { query } = await import('@/lib/db')
    await query(
      `INSERT INTO cms_content_blocks (section, fields)
       VALUES ($1,$2)
       ON CONFLICT (section) DO UPDATE SET fields=$2, updated_at=NOW()`,
      [section, JSON.stringify(fields)]
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('CMS content PUT error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to update content' }, { status: 500 })
  }
}