import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'

const USE_DB   = process.env.USE_DB === 'true'
const dataFile = path.join(process.cwd(), 'data', 'gowns.json')

// FIX #11: checkAuth now returns 500 when ADMIN_SECRET is not configured at all,
// instead of silently locking everyone out with a misleading 401.
function checkAuth(request) {
  if (!process.env.ADMIN_SECRET) {
    // Misconfiguration — surface it loudly in server logs
    console.error('ADMIN_SECRET environment variable is not set.')
    return 'misconfigured'
  }
  const secret = request.headers.get('x-admin-secret') || ''
  return secret === process.env.ADMIN_SECRET ? 'ok' : 'unauthorized'
}

function authResponse(result) {
  if (result === 'misconfigured')
    return NextResponse.json(
      { ok: false, error: 'Server misconfiguration: ADMIN_SECRET not set.' },
      { status: 500 }
    )
  if (result === 'unauthorized')
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  return null // 'ok' — no error response needed
}

function loadJson() {
  if (!fs.existsSync(dataFile)) return []
  return JSON.parse(fs.readFileSync(dataFile, 'utf8'))
}

// FIX #12: atomic write using a temp file + rename to avoid corruption on
// concurrent requests (last-write-wins is still possible but the file is
// never left in a half-written state).
function saveJson(gowns) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true })
  const tmp = dataFile + '.tmp.' + process.hrtime.bigint()
  fs.writeFileSync(tmp, JSON.stringify(gowns, null, 2))
  fs.renameSync(tmp, dataFile)
}

function parsePriceAmount(priceStr) {
  if (priceStr == null) return 0
  const n = parseFloat(String(priceStr).replace(/[^\d.]/g, ''))
  return isNaN(n) ? 0 : n
}

function rowToGown(row) {
  if (!row) return null
  return {
    id:               row.id,
    name:             row.name,
    price:            '₱' + Number(row.sale_price).toLocaleString('en-PH'),
    salePrice:        Number(row.sale_price),
    image:            row.image_url || row.image || '',
    alt:              row.alt       || row.name  || '',
    tryonImage:       row.tryon_image_url || row.tryon_image || row.image_url || row.image || '',
    tryonImageBack:   row.tryon_image_back_url || row.tryon_image_back || null,
    tryonCalibration: row.tryon_calibration || null,
    color:            row.color       || '',
    silhouette:       row.silhouette  || '',
    fabric:           row.fabric      || '',
    neckline:         row.neckline    || '',
    description:      row.description || '',
    type:             row.type        || '',
    isActive:         row.is_active   ?? true,
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(request) {
  const auth = checkAuth(request)
  const errRes = authResponse(auth)
  if (errRes) return errRes

  const { searchParams } = new URL(request.url)
  const archived = searchParams.get('tab') === 'archived'

  if (!USE_DB) {
    const all   = loadJson()
    const gowns = all.filter(g => archived ? g.is_active === false : g.is_active !== false)
    return NextResponse.json({ ok: true, gowns })
  }

  try {
    const { query } = await import('@/lib/db')

    const rows = await query(
      `SELECT g.*,
              gi.image_url,
              gi.alt,
              gi_tryon.image_url AS tryon_image_url
       FROM gowns g
       LEFT JOIN gown_images gi
              ON gi.gown_id = g.id AND gi.is_primary = TRUE
       LEFT JOIN gown_images gi_tryon
              ON gi_tryon.gown_id = g.id AND gi_tryon.is_tryon_asset = TRUE
             AND gi_tryon.id = (
               SELECT id FROM gown_images
               WHERE gown_id = g.id AND is_tryon_asset = TRUE
               ORDER BY sort_order LIMIT 1
             )
       WHERE g.is_active = $1
       ORDER BY g.updated_at DESC`,
      [!archived]
    )

    if (!rows.length) return NextResponse.json({ ok: true, gowns: [] })

    const gownIds = rows.map(r => r.id)
    const invRows = await query(
      `SELECT gown_id, size_label, stock_qty, reserved_qty
       FROM gown_inventory WHERE gown_id = ANY($1) ORDER BY size_label`,
      [gownIds]
    )

    const invByGown = {}
    for (const inv of invRows) {
      if (!invByGown[inv.gown_id]) invByGown[inv.gown_id] = []
      invByGown[inv.gown_id].push({
        size:      inv.size_label,
        stock:     inv.stock_qty,
        reserved:  inv.reserved_qty,
        available: Math.max(0, inv.stock_qty - inv.reserved_qty),
      })
    }

    const gowns = rows.map(r => ({
      ...rowToGown(r),
      inventory: invByGown[r.id] || [],
    }))

    return NextResponse.json({ ok: true, gowns })
  } catch (err) {
    console.error('Admin gowns GET error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch gowns' }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(request) {
  const auth = checkAuth(request)
  const errRes = authResponse(auth)
  if (errRes) return errRes

  const body = await request.json()
  const {
    name, price, image, alt,
    tryonImage, tryonCalibration,
    color, silhouette, fabric, neckline,
    description, type, inventory,
  } = body

  if (!name || !price || !image) {
    return NextResponse.json({ ok: false, error: 'Name, price, and image are required' }, { status: 400 })
  }

  const salePrice = parsePriceAmount(price)

  if (!USE_DB) {
    const gowns   = loadJson()
    const newGown = {
      id: Date.now(), name: name.trim(),
      price: '₱' + salePrice.toLocaleString('en-PH'), salePrice,
      image: image.trim(), alt: (alt||name).trim(),
      tryonImage: (tryonImage || image).trim(),
      tryonCalibration: tryonCalibration || null,
      type: (type||'').trim(), color: (color||'').trim(),
      silhouette: (silhouette||'').trim(), fabric: (fabric||'').trim(),
      neckline: (neckline||'').trim(), description: (description||'').trim(),
      inventory: inventory || [], is_active: true,
      createdAt: new Date().toISOString(),
    }
    saveJson([...gowns, newGown])
    return NextResponse.json({ ok: true, gown: newGown })
  }

  try {
    const { getClient } = await import('@/lib/db')
    const sku  = 'SKU-' + Date.now()
    const conn = await getClient()
    try {
      await conn.query('BEGIN')

      const { rows: [gownRow] } = await conn.query(
        `INSERT INTO gowns
           (sku, name, sale_price, color, silhouette, fabric, neckline,
            description, type, tryon_calibration)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [sku, name.trim(), salePrice,
         (color||'').trim(), (silhouette||'').trim(),
         (fabric||'').trim(), (neckline||'').trim(),
         (description||'').trim(), (type||'').trim(),
         tryonCalibration ? JSON.stringify(tryonCalibration) : null]
      )

      await conn.query(
        `INSERT INTO gown_images
           (gown_id, image_url, alt, is_primary, is_tryon_asset, sort_order)
         VALUES ($1,$2,$3,TRUE,FALSE,0)`,
        [gownRow.id, image.trim(), (alt||name).trim()]
      )

      const resolvedTryon = (tryonImage || '').trim()
      if (resolvedTryon && resolvedTryon !== image.trim()) {
        await conn.query(
          `INSERT INTO gown_images
             (gown_id, image_url, alt, is_primary, is_tryon_asset, sort_order)
           VALUES ($1,$2,$3,FALSE,TRUE,0)`,
          [gownRow.id, resolvedTryon, (alt||name).trim() + ' (try-on)']
        )
      }

      if (Array.isArray(inventory) && inventory.length > 0) {
        for (const inv of inventory) {
          if (!inv.size) continue
          await conn.query(
            `INSERT INTO gown_inventory (gown_id, size_label, stock_qty)
             VALUES ($1,$2,$3)
             ON CONFLICT (gown_id, size_label)
             DO UPDATE SET stock_qty = EXCLUDED.stock_qty`,
            [gownRow.id, String(inv.size).trim(), Math.max(0, parseInt(inv.stock)||0)]
          )
        }
      }

      await conn.query('COMMIT')
      return NextResponse.json({
        ok: true,
        gown: {
          ...rowToGown({
            ...gownRow,
            image_url: image.trim(),
            alt: (alt||name).trim(),
            tryon_image_url: resolvedTryon || image.trim(),
          }),
          inventory: inventory || [],
        },
      })
    } catch (err) { await conn.query('ROLLBACK'); throw err }
    finally { conn.release() }
  } catch (err) {
    console.error('Admin gowns POST error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to add gown' }, { status: 500 })
  }
}

// ── PUT ───────────────────────────────────────────────────────────────────────
export async function PUT(request) {
  const auth = checkAuth(request)
  const errRes = authResponse(auth)
  if (errRes) return errRes

  const body = await request.json()
  const { id, restore } = body

  if (restore && id) {
    if (!USE_DB) {
      const gowns = loadJson()
      const idx   = gowns.findIndex(g => String(g.id) === String(id))
      if (idx === -1) return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
      gowns[idx].is_active = true
      saveJson(gowns)
      return NextResponse.json({ ok: true, gown: gowns[idx] })
    }
    try {
      const { query } = await import('@/lib/db')
      const rows = await query(
        `UPDATE gowns SET is_active=TRUE WHERE id=$1
         RETURNING *, (SELECT image_url FROM gown_images WHERE gown_id=$1 AND is_primary=TRUE LIMIT 1) AS image_url`,
        [id]
      )
      if (!rows.length) return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
      return NextResponse.json({ ok: true, gown: rowToGown(rows[0]) })
    } catch (err) {
      console.error('Admin gowns RESTORE error:', err)
      return NextResponse.json({ ok: false, error: 'Failed to restore gown' }, { status: 500 })
    }
  }
// ── Inventory-only update (from StockModal) ───────────────────────────────
  if (id && body.inventory !== undefined &&
      !body.name && !body.price && !body.image) {

    if (!USE_DB) {
      const gowns = loadJson()
      const idx   = gowns.findIndex(g => String(g.id) === String(id))
      if (idx === -1)
        return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
      gowns[idx].inventory = body.inventory
      saveJson(gowns)
      return NextResponse.json({ ok: true, gown: gowns[idx] })
    }

    try {
      const { getClient } = await import('@/lib/db')
      const conn = await getClient()
      try {
        await conn.query('BEGIN')

        const newSizeLabels = (body.inventory || [])
          .filter(i => i.size)
          .map(i => String(i.size).trim().toUpperCase())

        if (newSizeLabels.length > 0) {
          await conn.query(
            `DELETE FROM gown_inventory WHERE gown_id = $1 AND size_label != ALL($2::text[])`,
            [id, newSizeLabels]
          )
        } else {
          await conn.query(`DELETE FROM gown_inventory WHERE gown_id = $1`, [id])
        }

        for (const inv of body.inventory || []) {
          if (!inv.size) continue
          await conn.query(
            `INSERT INTO gown_inventory (gown_id, size_label, stock_qty)
            VALUES ($1, $2, $3)
            ON CONFLICT (gown_id, size_label)
            DO UPDATE SET stock_qty = EXCLUDED.stock_qty`,
            [id, String(inv.size).trim().toUpperCase(), Math.max(0, parseInt(inv.stock) || 0)]
          )
        }

        await conn.query('COMMIT')
        return NextResponse.json({ ok: true, gown: { id, inventory: body.inventory } })
      } catch (err) {
        await conn.query('ROLLBACK')
        throw err
      } finally {
        conn.release()
      }
    } catch (err) {
      console.error('Admin gowns inventory-only PUT error:', err)
      return NextResponse.json({ ok: false, error: 'Failed to update inventory' }, { status: 500 })
    }
  }
  const {
    name, price, image, alt,
    tryonImage, tryonCalibration,
    color, silhouette, fabric, neckline,
    description, type, inventory,
  } = body

  if (!id || !name || !price || !image) {
    return NextResponse.json({ ok: false, error: 'Id, name, price, and image are required' }, { status: 400 })
  }

  const salePrice = parsePriceAmount(price)

  if (!USE_DB) {
    const gowns = loadJson()
    const idx   = gowns.findIndex(g => String(g.id) === String(id))
    if (idx === -1) return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
    const updated = {
      ...gowns[idx],
      name: name.trim(), price: '₱' + salePrice.toLocaleString('en-PH'), salePrice,
      image: image.trim(), alt: (alt||name).trim(),
      tryonImage: (tryonImage || image).trim(),
      tryonCalibration: tryonCalibration || null,
      type: (type||'').trim(), color: (color||'').trim(),
      silhouette: (silhouette||'').trim(), fabric: (fabric||'').trim(),
      neckline: (neckline||'').trim(), description: (description||'').trim(),
      inventory: inventory || gowns[idx].inventory || [],
    }
    gowns[idx] = updated
    saveJson(gowns)
    return NextResponse.json({ ok: true, gown: updated })
  }

  try {
    const { getClient } = await import('@/lib/db')
    const conn = await getClient()
    try {
      await conn.query('BEGIN')

      const { rows } = await conn.query(
        `UPDATE gowns
         SET name=$1, sale_price=$2, color=$3, silhouette=$4,
             fabric=$5, neckline=$6, description=$7, type=$8,
             tryon_calibration=$9
         WHERE id=$10 RETURNING *`,
        [name.trim(), salePrice,
         (color||'').trim(), (silhouette||'').trim(),
         (fabric||'').trim(), (neckline||'').trim(),
         (description||'').trim(), (type||'').trim(),
         tryonCalibration ? JSON.stringify(tryonCalibration) : null,
         id]
      )

      if (!rows.length) {
        await conn.query('ROLLBACK')
        return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
      }

      await conn.query(
        `UPDATE gown_images SET image_url=$1, alt=$2
         WHERE gown_id=$3 AND is_primary=TRUE`,
        [image.trim(), (alt||name).trim(), id]
      )

      // Upsert front try-on image
      const resolvedTryon = (tryonImage || '').trim()
      if (resolvedTryon) {
        await conn.query(
          `DELETE FROM gown_images WHERE gown_id = $1 AND is_tryon_asset = TRUE`,
          [id]
        )
        await conn.query(
          `INSERT INTO gown_images
             (gown_id, image_url, alt, is_primary, is_tryon_asset, sort_order)
           VALUES ($1, $2, $3, FALSE, TRUE, 0)`,
          [id, resolvedTryon, (alt||name).trim() + ' (try-on)']
        )
      }

      // Upsert back try-on image
      const resolvedBack = (body.tryonImageBack || '').trim()
      await conn.query(
        `DELETE FROM gown_images WHERE gown_id = $1 AND is_tryon_back = TRUE`,
        [id]
      )
      if (resolvedBack) {
        await conn.query(
          `INSERT INTO gown_images
             (gown_id, image_url, alt, is_primary, is_tryon_asset, is_tryon_back, sort_order)
           VALUES ($1, $2, $3, FALSE, FALSE, TRUE, 0)`,
          [id, resolvedBack, (alt||name).trim() + ' (try-on back)']
        )
      }

      if (Array.isArray(inventory)) {
        const newSizeLabels = inventory
          .filter(inv => inv.size)
          .map(inv => String(inv.size).trim().toUpperCase())

        if (newSizeLabels.length > 0) {
          await conn.query(
            `DELETE FROM gown_inventory
            WHERE gown_id = $1
              AND size_label != ALL($2::text[])`,
            [id, newSizeLabels]
          )
        } else {
          await conn.query(`DELETE FROM gown_inventory WHERE gown_id = $1`, [id])
        }

        for (const inv of inventory) {
          if (!inv.size) continue
          await conn.query(
            `INSERT INTO gown_inventory (gown_id, size_label, stock_qty)
            VALUES ($1, $2, $3)
            ON CONFLICT (gown_id, size_label)
            DO UPDATE SET stock_qty = EXCLUDED.stock_qty`,
            [id, String(inv.size).trim().toUpperCase(), Math.max(0, parseInt(inv.stock) || 0)]
          )
        }
      }

      await conn.query('COMMIT')
      return NextResponse.json({
        ok: true,
        gown: {
          ...rowToGown({
            ...rows[0],
            image_url: image.trim(),
            alt: (alt||name).trim(),
            tryon_image_url: resolvedTryon || image.trim(),
          }),
          inventory: inventory || [],
        },
      })
    } catch (err) { await conn.query('ROLLBACK'); throw err }
    finally { conn.release() }
  } catch (err) {
    console.error('Admin gowns PUT error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to update gown' }, { status: 500 })
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function DELETE(request) {
  const auth = checkAuth(request)
  const errRes = authResponse(auth)
  if (errRes) return errRes

  const { searchParams } = new URL(request.url)
  const id        = searchParams.get('id')
  const permanent = searchParams.has('permanent')

  if (!id) return NextResponse.json({ ok: false, error: 'Id required' }, { status: 400 })

  if (!USE_DB) {
    const gowns = loadJson()
    const idx   = gowns.findIndex(g => String(g.id) === String(id))
    if (idx === -1) return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
    if (permanent) {
      // FIX #13: strict boolean check — is_active missing/undefined is treated
      // as active (safe default), preventing accidental permanent deletion.
      const isActive = gowns[idx].is_active
      if (isActive !== false) {
        return NextResponse.json(
          { ok: false, error: 'Archive the gown before permanently deleting it.' },
          { status: 400 }
        )
      }
      saveJson(gowns.filter((_, i) => i !== idx))
    } else {
      gowns[idx].is_active = false
      saveJson(gowns)
    }
    return NextResponse.json({ ok: true })
  }

  try {
    const { getClient } = await import('@/lib/db')

    if (permanent) {
      const conn = await getClient()
      try {
        await conn.query('BEGIN')
        const check = await conn.query(
          `SELECT is_active FROM gowns WHERE id=$1 FOR UPDATE`, [id]
        )
        if (!check.rows.length) {
          await conn.query('ROLLBACK')
          return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
        }
        if (check.rows[0].is_active) {
          await conn.query('ROLLBACK')
          return NextResponse.json(
            { ok: false, error: 'Archive the gown before permanently deleting it.' },
            { status: 400 }
          )
        }
        await conn.query(`DELETE FROM gowns WHERE id=$1`, [id])
        await conn.query('COMMIT')
      } catch (err) {
        await conn.query('ROLLBACK')
        throw err
      } finally {
        conn.release()
      }
    } else {
      const { query } = await import('@/lib/db')
      const rows = await query(`UPDATE gowns SET is_active=FALSE WHERE id=$1 RETURNING id`, [id])
      if (!rows.length) return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Admin gowns DELETE error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to delete gown' }, { status: 500 })
  }
}