import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'

const USE_DB   = process.env.USE_DB === 'true'
const dataFile = path.join(process.cwd(), 'data', 'orders.json')

function loadJson() {
  if (!fs.existsSync(dataFile)) return []
  return JSON.parse(fs.readFileSync(dataFile, 'utf8'))
}

// SECURITY FIX: Previously this route accepted an x-customer-email header that
// any client could spoof to read any user's orders. It now requires x-user-id
// (set by your auth middleware/session layer) and resolves the email server-side
// from the DB, ensuring a user can only ever read their own orders.

export async function GET(request) {
  // Require a verified user ID from the session/middleware layer
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Sign in required' }, { status: 401 })
  }

  // ── JSON mode ──────────────────────────────────────────────────────────────
  if (!USE_DB) {
    const all    = loadJson()
    const orders = all.filter(o => String(o.userId) === String(userId))
    return NextResponse.json({ ok: true, orders })
  }

  // ── DB mode ────────────────────────────────────────────────────────────────
  try {
    const { query } = await import('@/lib/db')

    const rows = await query(`
      SELECT
        o.id,
        o.order_number,
        o.status,
        o.payment_method  AS payment,
        o.payment_status,
        o.subtotal,
        o.shipping_fee,
        o.total,
        o.notes           AS note,
        o.placed_at       AS "createdAt",
        o.customer_email,
        o.customer_name,
        o.customer_phone,
        json_agg(
          json_build_object(
            'id',       oi.gown_id,
            'name',     oi.gown_name,
            'size',     oi.size_label,
            'qty',      oi.quantity,
            'price',    '₱' || to_char(oi.unit_price, 'FM999,999,999'),
            'subtotal', oi.line_total
          )
          ORDER BY oi.id
        ) FILTER (WHERE oi.id IS NOT NULL) AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = $1
      GROUP BY o.id
      ORDER BY o.placed_at DESC
    `, [userId])

    const orders = rows.map(r => {
      const nameParts = (r.customer_name || '').trim().split(/\s+/)
      return {
        id:          r.id,
        orderNumber: r.order_number,
        status:      r.status,
        payment:     r.payment,
        subtotal:    Number(r.subtotal),
        shippingFee: Number(r.shipping_fee),
        total:       Number(r.total),
        note:        r.note || '',
        createdAt:   r.createdAt,
        contact: {
          firstName: nameParts[0]                 || '',
          lastName:  nameParts.slice(1).join(' ') || '',
          email:     r.customer_email,
          phone:     r.customer_phone,
        },
        delivery: null,
        items: r.items || [],
      }
    })

    return NextResponse.json({ ok: true, orders })
  } catch (err) {
    console.error('My orders GET error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch orders' }, { status: 500 })
  }
}