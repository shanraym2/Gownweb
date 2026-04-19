import { NextResponse } from 'next/server'

const USE_DB = process.env.USE_DB === 'true'

function checkAuth(request) {
  const secret = request.headers.get('x-admin-secret') || ''
  return process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET
}

export async function GET(request) {
  if (!checkAuth(request))
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  if (!USE_DB) {
    const { getHeroSlides } = await import('@/lib/cms')
    const slides = await getHeroSlides()
    return NextResponse.json({ ok: true, slides })
  }

  try {
    const { query } = await import('@/lib/db')
    const slides = await query(`SELECT * FROM cms_hero_slides ORDER BY sort_order ASC`)
    return NextResponse.json({ ok: true, slides })
  } catch (err) {
    console.error('CMS hero GET error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch slides' }, { status: 500 })
  }
}

export async function POST(request) {
  if (!checkAuth(request))
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { image_url, subtitle, heading, body, sort_order } = await request.json()
  if (!image_url || !heading)
    return NextResponse.json({ ok: false, error: 'image_url and heading are required' }, { status: 400 })

  if (!USE_DB)
    return NextResponse.json({ ok: false, error: 'DB required for writes' }, { status: 400 })

  try {
    const { query } = await import('@/lib/db')
    const rows = await query(
      `INSERT INTO cms_hero_slides (image_url, subtitle, heading, body, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [image_url.trim(), (subtitle||'').trim(), heading.trim(), (body||'').trim(), sort_order ?? 0]
    )
    return NextResponse.json({ ok: true, slide: rows[0] })
  } catch (err) {
    console.error('CMS hero POST error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to create slide' }, { status: 500 })
  }
}

export async function PUT(request) {
  if (!checkAuth(request))
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { id, image_url, subtitle, heading, body: slideBody, sort_order, is_active } = body
  if (!id)
    return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

  if (!USE_DB)
    return NextResponse.json({ ok: false, error: 'DB required for writes' }, { status: 400 })

  try {
    const { query } = await import('@/lib/db')
    const rows = await query(
      `UPDATE cms_hero_slides
       SET image_url=$1, subtitle=$2, heading=$3, body=$4, sort_order=$5, is_active=$6
       WHERE id=$7 RETURNING *`,
      [image_url.trim(), (subtitle||'').trim(), heading.trim(), (slideBody||'').trim(),
       sort_order ?? 0, is_active ?? true, id]
    )
    if (!rows.length)
      return NextResponse.json({ ok: false, error: 'Slide not found' }, { status: 404 })
    return NextResponse.json({ ok: true, slide: rows[0] })
  } catch (err) {
    console.error('CMS hero PUT error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to update slide' }, { status: 500 })
  }
}

export async function DELETE(request) {
  if (!checkAuth(request))
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id)
    return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

  if (!USE_DB)
    return NextResponse.json({ ok: false, error: 'DB required for writes' }, { status: 400 })

  try {
    const { query } = await import('@/lib/db')
    await query(`DELETE FROM cms_hero_slides WHERE id=$1`, [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('CMS hero DELETE error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to delete slide' }, { status: 500 })
  }
}