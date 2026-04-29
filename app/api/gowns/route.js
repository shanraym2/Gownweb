import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'

export const dynamic = 'force-dynamic'

const USE_DB = process.env.USE_DB === 'true'

function loadJson() {
  const file = path.join(process.cwd(), 'data', 'gowns.json')
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export async function GET() {
  if (!USE_DB) {
    const all   = loadJson()
    const gowns = all.filter(g => g.is_active !== false)
    // FIX #1: ensure tryonImage is always present in JSON mode
    return NextResponse.json({
      ok: true,
      gowns: gowns.map(g => ({
        ...g,
        tryonImage: g.tryonImage || g.image || '',
      })),
    })
  }

  try {
    const { query } = await import('@/lib/db')

    // FIX #1: join tryon asset image so tryonImage is returned to the try-on page
    const rows = await query(`
      SELECT
        g.id, g.sku, g.name, g.description,
        g.color, g.silhouette, g.fabric, g.neckline,
        g.sale_price, g.is_active, g.tryon_calibration,
        c.name            AS category,
        gi.image_url      AS image,
        gi.alt,
        gi_tryon.image_url AS tryon_image_url,
        gi_back.image_url  AS tryon_image_back_url
      FROM gowns g
      LEFT JOIN categories  c       ON c.id = g.category_id
      LEFT JOIN gown_images gi      ON gi.gown_id = g.id AND gi.is_primary = TRUE
      LEFT JOIN gown_images gi_tryon
             ON gi_tryon.gown_id = g.id
            AND gi_tryon.is_tryon_asset = TRUE
            AND gi_tryon.id = (
              SELECT id FROM gown_images
              WHERE gown_id = g.id AND is_tryon_asset = TRUE
              ORDER BY sort_order LIMIT 1
            )
      LEFT JOIN gown_images gi_back
             ON gi_back.gown_id = g.id
            AND gi_back.is_tryon_back = TRUE
            AND gi_back.id = (
              SELECT id FROM gown_images
              WHERE gown_id = g.id AND is_tryon_back = TRUE
              ORDER BY sort_order LIMIT 1
            )
      WHERE g.is_active = TRUE
      ORDER BY g.created_at DESC
    `)

    if (!rows.length) return NextResponse.json({ ok: true, gowns: [] })

    const gownIds = rows.map(r => r.id)
    const invRows = await query(`
      SELECT gown_id, size_label, stock_qty, reserved_qty
      FROM gown_inventory
      WHERE gown_id = ANY($1)
      ORDER BY size_label
    `, [gownIds])

    const invByGown = {}
    for (const inv of invRows) {
      if (!invByGown[inv.gown_id]) invByGown[inv.gown_id] = []
      invByGown[inv.gown_id].push({
        size:     inv.size_label,
        stock:    Math.max(0, inv.stock_qty - inv.reserved_qty),
        stockQty: inv.stock_qty,
      })
    }

    const gowns = rows.map(r => ({
      id:               r.id,
      sku:              r.sku,
      name:             r.name,
      description:      r.description,
      color:            r.color,
      silhouette:       r.silhouette,
      fabric:           r.fabric,
      neckline:         r.neckline,
      price:            '₱' + Number(r.sale_price).toLocaleString('en-PH'),
      salePrice:        Number(r.sale_price),
      category:         r.category,
      image:            r.image || '/images/placeholder.jpg',
      alt:              r.alt   || r.name,
      // FIX #1: return tryonImage — falls back to display image if no tryon asset
      tryonImage:       r.tryon_image_url || r.image || '/images/placeholder.jpg',
      tryonImageBack:   r.tryon_image_back_url || null,
      tryonCalibration: r.tryon_calibration || null,
      sizeStock:        invByGown[r.id] || [],
      sizes:            (invByGown[r.id] || []).map(s => s.size),
    }))

    return NextResponse.json({ ok: true, gowns })
  } catch (err) {
    console.error('GET /api/gowns error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch gowns' }, { status: 500 })
  }
}