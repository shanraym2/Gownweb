import { NextResponse } from 'next/server'
import pool from '@/lib/db'

function checkAuth(request) {
  const secret = request.headers.get('x-admin-secret') || ''
  return process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET
}

// Split "First Last" → { firstName, lastName }
function splitName(fullName = '') {
  const parts = fullName.trim().split(/\s+/)
  const firstName = parts[0] || ''
  const lastName  = parts.slice(1).join(' ') || ''
  return { firstName, lastName }
}

// Shape a DB row + its items into what the frontend OrderCard expects
function rowToOrder(row, items = []) {
  const { firstName, lastName } = splitName(row.customer_name)
  return {
    id:         row.id,
    orderNumber: row.order_number,
    status:     row.status,
    subtotal:   Number(row.subtotal),
    total:      Number(row.total),
    createdAt:  row.placed_at,
    note:       row.notes || '',
    contact: {
      firstName,
      lastName,
      email: row.customer_email,
      phone: row.customer_phone,
    },
    // delivery comes from user_addresses joined in, or falls back to empty
    delivery: {
      address:  row.delivery_address  || '',
      city:     row.delivery_city     || '',
      province: row.delivery_province || '',
      zip:      row.delivery_zip      || '',
    },
    payment: {
      method: row.payment_method,
      status: row.payment_status,
    },
    items: items.map(i => ({
      id:        i.gown_id,
      name:      i.gown_name,
      size:      i.size_label,
      qty:       i.quantity,
      price:     '₱' + Number(i.unit_price).toLocaleString('en-PH'),
      unitPrice: Number(i.unit_price),
      subtotal:  Number(i.line_total),
    })),
  }
}

// ── GET /api/admin/orders ────────────────────────────────────────────────────
export async function GET(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Fetch orders, with latest delivery address per customer email joined in
    const { rows: orderRows } = await pool.query(`
      SELECT
        o.*,
        ua.line1        AS delivery_address,
        ua.city         AS delivery_city,
        ua.province     AS delivery_province,
        ua.postal_code  AS delivery_zip
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT line1, city, province, postal_code
        FROM user_addresses
        WHERE user_addresses.user_id = o.user_id
        ORDER BY created_at DESC
        LIMIT 1
      ) ua ON TRUE
      ORDER BY o.placed_at DESC
    `)

    if (orderRows.length === 0) {
      return NextResponse.json({ ok: true, orders: [] })
    }

    // Fetch all items for those orders in one query
    const orderIds = orderRows.map(r => r.id)
    const { rows: itemRows } = await pool.query(
      `SELECT * FROM order_items WHERE order_id = ANY($1)`,
      [orderIds]
    )

    // Group items by order_id
    const itemsByOrder = {}
    for (const item of itemRows) {
      const key = String(item.order_id)
      if (!itemsByOrder[key]) itemsByOrder[key] = []
      itemsByOrder[key].push(item)
    }

    const orders = orderRows.map(row =>
      rowToOrder(row, itemsByOrder[String(row.id)] || [])
    )

    return NextResponse.json({ ok: true, orders })
  } catch (err) {
    console.error('Admin orders GET error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch orders' }, { status: 500 })
  }
}

// ── PATCH /api/admin/orders ──────────────────────────────────────────────────
// Body: { id: string, status: string }
export async function PATCH(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id, status } = await request.json()

    const validStatuses = [
      'placed', 'pending_payment', 'paid', 'processing',
      'ready', 'shipped', 'completed', 'cancelled', 'refunded',
    ]

    // The frontend uses 'preparing' and 'delivered'; map them to DB values
    const statusMap = {
      preparing: 'processing',
      delivered: 'completed',
    }
    const dbStatus = statusMap[status] ?? status

    if (!id || !validStatuses.includes(dbStatus)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid id or status' },
        { status: 400 }
      )
    }

    const { rows } = await pool.query(
      `UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status`,
      [dbStatus, id]
    )

    if (!rows.length) {
      return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, status: rows[0].status })
  } catch (err) {
    console.error('Admin orders PATCH error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to update order' }, { status: 500 })
  }
}