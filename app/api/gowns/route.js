import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'

const USE_DB = process.env.USE_DB === 'true'

function loadJson() {
  const file = path.join(process.cwd(), 'data', 'gowns.json')
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export async function GET() {
  if (!USE_DB) {
    const gowns = loadJson()
    return NextResponse.json({ ok: true, gowns })
  }

  try {
    const { default: pool } = await import('@/lib/db')
    const { rows } = await pool.query(`
      SELECT
        g.id, g.sku, g.name, g.description,
        g.color, g.silhouette, g.fabric, g.neckline,
        g.sale_price,
        g.is_active,
        c.name  AS category,
        gi.image_url AS image,
        gi.alt
      FROM gowns g
      LEFT JOIN categories c        ON c.id = g.category_id
      LEFT JOIN gown_images gi      ON gi.gown_id = g.id AND gi.is_primary = TRUE
      WHERE g.is_active = TRUE
      ORDER BY g.created_at DESC
    `)
    const gowns = rows.map(r => ({
      id:          r.id,
      sku:         r.sku,
      name:        r.name,
      description: r.description,
      color:       r.color,
      silhouette:  r.silhouette,
      fabric:      r.fabric,
      neckline:    r.neckline,
      price:       '₱' + Number(r.sale_price).toLocaleString('en-PH'),
      salePrice:   Number(r.sale_price),
      category:    r.category,
      image:       r.image || '/images/placeholder.jpg',
      alt:         r.alt   || r.name,
    }))
    return NextResponse.json({ ok: true, gowns })
  } catch (err) {
    console.error('GET /api/gowns error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch gowns' }, { status: 500 })
  }
}