import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'

const USE_DB   = process.env.USE_DB === 'true'
const dataFile = path.join(process.cwd(), 'data', 'gowns.json')

function checkAuth(request) {
  const secret = request.headers.get('x-admin-secret') || ''
  return process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET
}

function loadJson() {
  if (!fs.existsSync(dataFile)) return []
  return JSON.parse(fs.readFileSync(dataFile, 'utf8'))
}

function saveJson(gowns) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true })
  fs.writeFileSync(dataFile, JSON.stringify(gowns, null, 2))
}

function parsePriceAmount(priceStr) {
  if (priceStr == null) return 0
  const n = parseFloat(String(priceStr).replace(/[^\d.]/g, ''))
  return isNaN(n) ? 0 : n
}

export async function GET(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  if (!USE_DB) {
    return NextResponse.json({ ok: true, gowns: loadJson() })
  }

  try {
    const { default: pool } = await import('@/lib/db')
    const { rows } = await pool.query(`
      SELECT g.*, gi.image_url AS image, gi.alt
      FROM gowns g
      LEFT JOIN gown_images gi ON gi.gown_id = g.id AND gi.is_primary = TRUE
      ORDER BY g.created_at DESC
    `)
    const gowns = rows.map(r => ({
      id:          r.id,
      name:        r.name,
      description: r.description,
      color:       r.color,
      silhouette:  r.silhouette,
      fabric:      r.fabric,
      neckline:    r.neckline,
      price:       '₱' + Number(r.sale_price).toLocaleString('en-PH'),
      salePrice:   Number(r.sale_price),
      image:       r.image || '',
      alt:         r.alt   || '',
    }))
    return NextResponse.json({ ok: true, gowns })
  } catch (err) {
    console.error('Admin gowns GET error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch gowns' }, { status: 500 })
  }
}

export async function POST(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { name, price, image, alt, color, silhouette, fabric, neckline, description, type } = body

  if (!name || !price || !image) {
    return NextResponse.json({ ok: false, error: 'Name, price, and image are required' }, { status: 400 })
  }

  const salePrice = parsePriceAmount(price)

  if (!USE_DB) {
    const gowns   = loadJson()
    const newGown = {
      id:          Date.now(),
      name:        name.trim(),
      price:       '₱' + salePrice.toLocaleString('en-PH'),
      salePrice,
      image:       image.trim(),
      alt:         (alt || name).trim(),
      type:        (type || '').trim(),
      color:       (color || '').trim(),
      silhouette:  (silhouette || '').trim(),
      fabric:      (fabric || '').trim(),
      neckline:    (neckline || '').trim(),
      description: (description || '').trim(),
      createdAt:   new Date().toISOString(),
    }
    saveJson([...gowns, newGown])
    return NextResponse.json({ ok: true, gown: newGown })
  }

  try {
    const { default: pool } = await import('@/lib/db')
    const sku = 'SKU-' + Date.now()
    const { rows: [gownRow] } = await pool.query(
      `INSERT INTO gowns (sku, name, sale_price, color, silhouette, fabric, neckline, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [sku, name.trim(), salePrice,
       (color||'').trim(), (silhouette||'').trim(),
       (fabric||'').trim(), (neckline||'').trim(),
       (description||'').trim()]
    )
    await pool.query(
      `INSERT INTO gown_images (gown_id, image_url, alt, is_primary, sort_order)
       VALUES ($1,$2,$3,TRUE,0)`,
      [gownRow.id, image.trim(), (alt||name).trim()]
    )
    const gown = {
      id:    gownRow.id,
      name:  gownRow.name,
      price: '₱' + Number(gownRow.sale_price).toLocaleString('en-PH'),
      image,
      alt,
    }
    return NextResponse.json({ ok: true, gown })
  } catch (err) {
    console.error('Admin gowns POST error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to add gown' }, { status: 500 })
  }
}

export async function PUT(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { id, name, price, image, alt, color, silhouette, fabric, neckline, description, type } = body

  if (!id || !name || !price || !image) {
    return NextResponse.json({ ok: false, error: 'Id, name, price, and image are required' }, { status: 400 })
  }

  const salePrice = parsePriceAmount(price)

  if (!USE_DB) {
    const gowns = loadJson()
    const idx   = gowns.findIndex(g => String(g.id) === String(id))
    if (idx === -1) {
      return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
    }
    const updated = {
      ...gowns[idx],
      name:        name.trim(),
      price:       '₱' + salePrice.toLocaleString('en-PH'),
      salePrice,
      image:       image.trim(),
      alt:         (alt || name).trim(),
      type:        (type || '').trim(),
      color:       (color || '').trim(),
      silhouette:  (silhouette || '').trim(),
      fabric:      (fabric || '').trim(),
      neckline:    (neckline || '').trim(),
      description: (description || '').trim(),
    }
    gowns[idx] = updated
    saveJson(gowns)
    return NextResponse.json({ ok: true, gown: updated })
  }

  try {
    const { default: pool } = await import('@/lib/db')
    const { rows } = await pool.query(
      `UPDATE gowns
       SET name=$1, sale_price=$2, color=$3, silhouette=$4,
           fabric=$5, neckline=$6, description=$7
       WHERE id=$8 RETURNING *`,
      [name.trim(), salePrice,
       (color||'').trim(), (silhouette||'').trim(),
       (fabric||'').trim(), (neckline||'').trim(),
       (description||'').trim(), id]
    )
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
    }
    await pool.query(
      `UPDATE gown_images SET image_url=$1, alt=$2
       WHERE gown_id=$3 AND is_primary=TRUE`,
      [image.trim(), (alt||name).trim(), id]
    )
    return NextResponse.json({ ok: true, gown: { ...rows[0], image, alt } })
  } catch (err) {
    console.error('Admin gowns PUT error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to update gown' }, { status: 500 })
  }
}

export async function DELETE(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Id required' }, { status: 400 })
  }

  if (!USE_DB) {
    const gowns = loadJson()
    const next  = gowns.filter(g => String(g.id) !== String(id))
    if (next.length === gowns.length) {
      return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
    }
    saveJson(next)
    return NextResponse.json({ ok: true })
  }

  try {
    const { default: pool } = await import('@/lib/db')
    const { rows } = await pool.query(
      `UPDATE gowns SET is_active=FALSE WHERE id=$1 RETURNING id`, [id]
    )
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Admin gowns DELETE error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to delete gown' }, { status: 500 })
  }
}