const { Client } = require('pg')
const { existsSync, readFileSync } = require('fs')
const { join } = require('path')

function loadEnvValue(key) {
  try {
    const envPath = join(process.cwd(), '.env.local')
    const content = readFileSync(envPath, 'utf8')
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
    if (match) return match[1].trim().replace(/^["']|["']$/g, '')
  } catch {}
  return process.env[key]
}

function readJsonSafe(filePath, fallbackValue) {
  try {
    if (!existsSync(filePath)) return fallbackValue
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return fallbackValue
  }
}

function parsePhpAmount(value, defaultValue = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : defaultValue
  const cleaned = String(value || '').replace(/[^\d.-]/g, '')
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : defaultValue
}

function normalizeOrderStatus(status) {
  const raw = String(status || '').trim().toLowerCase()
  const map = {
    preparing: 'processing',
    delivered: 'completed',
  }
  const normalized = map[raw] || raw || 'placed'
  const allowed = new Set([
    'placed',
    'pending_payment',
    'paid',
    'processing',
    'ready',
    'shipped',
    'completed',
    'cancelled',
    'refunded',
  ])
  return allowed.has(normalized) ? normalized : 'placed'
}

function normalizePaymentMethod(paymentMethod) {
  const raw = String(paymentMethod || '').trim().toLowerCase()
  return ['gcash', 'bdo', 'cash'].includes(raw) ? raw : 'gcash'
}

function normalizePaymentStatus(order) {
  const raw = String(order?.paymentStatus || order?.paymentProofStatus || '').trim().toLowerCase()
  if (['verified', 'paid'].includes(raw)) return 'paid'
  if (['rejected', 'failed'].includes(raw)) return 'failed'
  if (['refunded'].includes(raw)) return 'refunded'
  if (['submitted', 'pending'].includes(raw)) return 'pending'
  return 'unpaid'
}

function normalizeDeliveryMethod(value) {
  const raw = String(value || '').trim().toLowerCase()
  return ['pickup', 'lalamove'].includes(raw) ? raw : 'pickup'
}

function extractInventoryRows(gown) {
  const rows = []
  if (Array.isArray(gown?.sizeStock)) {
    for (const entry of gown.sizeStock) {
      const size = String(entry?.size || '').trim()
      if (!size) continue
      rows.push({
        size,
        stockQty: Math.max(0, Number(entry?.stockQty ?? entry?.stock ?? 0) || 0),
        reservedQty: Math.max(0, Number(entry?.reservedQty ?? entry?.reserved ?? 0) || 0),
      })
    }
  } else if (gown?.sizeInventory && typeof gown.sizeInventory === 'object') {
    for (const [sizeLabel, value] of Object.entries(gown.sizeInventory)) {
      const size = String(sizeLabel || '').trim()
      if (!size) continue
      if (typeof value === 'number') {
        rows.push({ size, stockQty: Math.max(0, Number(value) || 0), reservedQty: 0 })
      } else {
        rows.push({
          size,
          stockQty: Math.max(0, Number(value?.stockQty ?? value?.stock ?? value?.available ?? 0) || 0),
          reservedQty: Math.max(0, Number(value?.reservedQty ?? value?.reserved ?? 0) || 0),
        })
      }
    }
  }
  return rows
}

async function upsertPrimaryImage(client, gownId, imageUrl, alt) {
  if (!imageUrl) return
  const updated = await client.query(
    `UPDATE gown_images
     SET image_url = $2, alt = $3
     WHERE id = (
       SELECT id
       FROM gown_images
       WHERE gown_id = $1 AND is_primary = TRUE
       ORDER BY sort_order, id
       LIMIT 1
     )`,
    [gownId, imageUrl, alt || null]
  )

  if (updated.rowCount === 0) {
    await client.query(
      `INSERT INTO gown_images (gown_id, image_url, alt, is_primary, sort_order)
       VALUES ($1, $2, $3, TRUE, 0)`,
      [gownId, imageUrl, alt || null]
    )
  }
}

async function main() {
  const databaseUrl = loadEnvValue('DATABASE_URL')
  if (!databaseUrl) {
    console.error('DATABASE_URL not found. Add it to .env.local first.')
    process.exit(1)
  }

  const gownsPath = join(process.cwd(), 'data', 'gowns.json')
  const ordersPath = join(process.cwd(), 'data', 'orders.json')

  const gowns = readJsonSafe(gownsPath, [])
  const orders = readJsonSafe(ordersPath, [])

  if (!Array.isArray(gowns)) {
    console.error('Invalid gowns.json format (expected array).')
    process.exit(1)
  }
  if (!Array.isArray(orders)) {
    console.error('Invalid orders.json format (expected array).')
    process.exit(1)
  }

  const client = new Client({ connectionString: databaseUrl })
  await client.connect()

  const gownIdMap = new Map()

  try {
    await client.query('BEGIN')

    for (const gown of gowns) {
      const legacyId = Number(gown?.id)
      const sku = `JSON-${Number.isFinite(legacyId) ? legacyId : Date.now()}`
      const salePrice = parsePhpAmount(gown?.salePrice ?? gown?.price, 0)
      const isActive = gown?.is_active !== false && gown?.archived !== true

      const { rows } = await client.query(
        `INSERT INTO gowns
          (sku, name, description, color, silhouette, fabric, neckline, sale_price, is_active, type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (sku)
         DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           color = EXCLUDED.color,
           silhouette = EXCLUDED.silhouette,
           fabric = EXCLUDED.fabric,
           neckline = EXCLUDED.neckline,
           sale_price = EXCLUDED.sale_price,
           is_active = EXCLUDED.is_active,
           type = EXCLUDED.type,
           updated_at = NOW()
         RETURNING id`,
        [
          sku,
          String(gown?.name || 'Untitled Gown').trim(),
          String(gown?.description || '').trim() || null,
          String(gown?.color || '').trim() || null,
          String(gown?.silhouette || '').trim() || null,
          String(gown?.fabric || '').trim() || null,
          String(gown?.neckline || '').trim() || null,
          salePrice,
          isActive,
          String(gown?.type || 'Gowns').trim() || 'Gowns',
        ]
      )

      const gownId = rows[0]?.id
      if (!gownId) continue
      gownIdMap.set(legacyId, gownId)

      await upsertPrimaryImage(
        client,
        gownId,
        String(gown?.image || '').trim(),
        String(gown?.alt || gown?.name || '').trim() || null
      )

      const inventoryRows = extractInventoryRows(gown)
      for (const inv of inventoryRows) {
        await client.query(
          `INSERT INTO gown_inventory (gown_id, size_label, stock_qty, reserved_qty)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (gown_id, size_label)
           DO UPDATE SET
             stock_qty = EXCLUDED.stock_qty,
             reserved_qty = EXCLUDED.reserved_qty`,
          [gownId, inv.size, inv.stockQty, inv.reservedQty]
        )
      }
    }

    for (const order of orders) {
      const paymentMethod = normalizePaymentMethod(order?.paymentMethod || order?.payment)
      const paymentStatus = normalizePaymentStatus(order)
      const status = normalizeOrderStatus(order?.status)
      const orderNumber = String(order?.orderNumber || order?.order_number || '').trim() || `JSON-ORDER-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const customerEmail = String(order?.customerEmail || order?.contact?.email || `guest+${Date.now()}@local.invalid`).trim().toLowerCase()
      const customerName = String(order?.customerName || order?.contact?.name || 'Guest Customer').trim()
      const customerPhone = String(order?.customerPhone || order?.contact?.phone || '').trim() || null
      const deliveryMethod = normalizeDeliveryMethod(order?.deliveryMethod || order?.delivery)
      const deliveryAddress = String(order?.deliveryAddress || order?.contact?.address || '').trim() || null
      const subtotal = parsePhpAmount(order?.subtotal, 0)
      const total = parsePhpAmount(order?.total, subtotal)
      const notes = String(order?.notes || '').trim() || null
      const placedAt = order?.placedAt || order?.createdAt || null

      const { rows } = await client.query(
        `INSERT INTO orders
          (order_number, user_id, customer_email, customer_name, customer_phone,
           status, payment_method, payment_status, delivery_method, delivery_address,
           subtotal, discount_total, shipping_fee, total, notes, placed_at)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0, $11, $12, COALESCE($13::timestamptz, NOW()))
         ON CONFLICT (order_number)
         DO UPDATE SET
           customer_email = EXCLUDED.customer_email,
           customer_name = EXCLUDED.customer_name,
           customer_phone = EXCLUDED.customer_phone,
           status = EXCLUDED.status,
           payment_method = EXCLUDED.payment_method,
           payment_status = EXCLUDED.payment_status,
           delivery_method = EXCLUDED.delivery_method,
           delivery_address = EXCLUDED.delivery_address,
           subtotal = EXCLUDED.subtotal,
           total = EXCLUDED.total,
           notes = EXCLUDED.notes,
           updated_at = NOW()
         RETURNING id`,
        [
          orderNumber,
          customerEmail,
          customerName,
          customerPhone,
          status,
          paymentMethod,
          paymentStatus,
          deliveryMethod,
          deliveryAddress,
          subtotal,
          total,
          notes,
          placedAt,
        ]
      )
      const orderId = rows[0]?.id
      if (!orderId) continue

      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [orderId])
      const items = Array.isArray(order?.items) ? order.items : []
      for (const item of items) {
        const qty = Math.max(1, Number(item?.quantity) || 1)
        const unitPrice = parsePhpAmount(item?.unitPrice, 0)
        const lineTotal = parsePhpAmount(item?.lineTotal, unitPrice * qty)
        const legacyGownId = Number(item?.gownId)
        const dbGownId = gownIdMap.get(legacyGownId) || null
        await client.query(
          `INSERT INTO order_items
            (order_id, gown_id, gown_name, size_label, quantity, unit_price, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            orderId,
            dbGownId,
            String(item?.gownName || item?.name || 'Gown').trim(),
            String(item?.sizeLabel || item?.size || '').trim() || null,
            qty,
            unitPrice,
            lineTotal,
          ]
        )
      }

      const proofUrl =
        String(order?.paymentProof?.imageUri || order?.proofImage || order?.proof_image_url || '').trim() || null
      if (paymentMethod !== 'cash' || proofUrl) {
        const paymentRecordStatus =
          paymentStatus === 'paid' ? 'verified' : paymentStatus === 'failed' ? 'rejected' : paymentStatus === 'refunded' ? 'refunded' : 'pending'
        await client.query(
          `INSERT INTO payments (order_id, method, amount, proof_image_url, status)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (order_id)
           DO UPDATE SET
             method = EXCLUDED.method,
             amount = EXCLUDED.amount,
             proof_image_url = EXCLUDED.proof_image_url,
             status = EXCLUDED.status`,
          [orderId, paymentMethod, total, proofUrl, paymentRecordStatus]
        )
      }
    }

    await client.query('COMMIT')
    console.log(`Imported ${gowns.length} gowns and ${orders.length} orders into PostgreSQL.`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Import failed:', err.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main()
