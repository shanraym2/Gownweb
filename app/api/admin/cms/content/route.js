// app/api/admin/contents/route.js
// Audit-instrumented version — logAudit() added to PUT.

import { NextResponse } from 'next/server'
import { checkAdminAuth } from '@/lib/adminAuth'
import { logAudit }       from '@/lib/audit'

const USE_DB = process.env.USE_DB === 'true'

const VALID_SECTIONS = [
  'about', 'collection-spotlight', 'contact', 'footer', 'theme-config',
  'header', 'announcement-bar', 'catalogue', 'product-details',
  'login', 'cart', 'checkout', 'upload-proof', 'profile',
  'my-orders', 'fitting-room', 'global-seo',
]

export async function GET(request) {
  if (!await checkAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

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
  if (!await checkAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

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
       VALUES ($1, $2)
       ON CONFLICT (section) DO UPDATE
         SET fields     = cms_content_blocks.fields || $2,
             updated_at = NOW()`,
      [section, JSON.stringify(fields)]
    )

    // ── AUDIT ────────────────────────────────────────────────────────────────
    // Log which keys changed but not the full field values (can be large/noisy)
    logAudit({
      request,
      action:     'cms.content.update',
      entityType: 'cms_block',
      entityId:   section,
      payload:    { section, updatedKeys: Object.keys(fields) },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('CMS content PUT error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to update content' }, { status: 500 })
  }
}