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
    const { getTestimonials } = await import('@/lib/cms')
    return NextResponse.json({ ok: true, testimonials: await getTestimonials() })
  }

  try {
    const { query } = await import('@/lib/db')
    const testimonials = await query(
      `SELECT * FROM cms_testimonials ORDER BY sort_order ASC`
    )
    return NextResponse.json({ ok: true, testimonials })
  } catch (err) {
    console.error('CMS testimonials GET error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch testimonials' }, { status: 500 })
  }
}

export async function POST(request) {
  if (!checkAuth(request))
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { quote_text, author_name, image_url, sort_order } = await request.json()
  if (!quote_text || !author_name)
    return NextResponse.json({ ok: false, error: 'quote_text and author_name are required' }, { status: 400 })

  if (!USE_DB)
    return NextResponse.json({ ok: false, error: 'DB required for writes' }, { status: 400 })

  try {
    const { query } = await import('@/lib/db')
    const rows = await query(
      `INSERT INTO cms_testimonials (quote_text, author_name, image_url, sort_order)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [quote_text.trim(), author_name.trim(), (image_url||'').trim(), sort_order ?? 0]
    )
    return NextResponse.json({ ok: true, testimonial: rows[0] })
  } catch (err) {
    console.error('CMS testimonials POST error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to create testimonial' }, { status: 500 })
  }
}

export async function PUT(request) {
  if (!checkAuth(request))
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { id, quote_text, author_name, image_url, sort_order, is_active } = body

  if (!id)
    return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

  if (!USE_DB)
    return NextResponse.json({ ok: false, error: 'DB required for writes' }, { status: 400 })

  try {
    const { query } = await import('@/lib/db')
    const rows = await query(
      `UPDATE cms_testimonials
       SET quote_text=$1, author_name=$2, image_url=$3, sort_order=$4, is_active=$5
       WHERE id=$6 RETURNING *`,
      [
        (quote_text  || '').trim(),
        (author_name || '').trim(),
        (image_url   || '').trim(),
        sort_order ?? 0,
        is_active ?? true,
        id
      ]
    )
    if (!rows.length)
      return NextResponse.json({ ok: false, error: 'Testimonial not found' }, { status: 404 })
    return NextResponse.json({ ok: true, testimonial: rows[0] })
  } catch (err) {
    console.error('CMS testimonials PUT error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to update testimonial' }, { status: 500 })
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
    await query(`DELETE FROM cms_testimonials WHERE id=$1`, [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('CMS testimonials DELETE error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to delete testimonial' }, { status: 500 })
  }
}