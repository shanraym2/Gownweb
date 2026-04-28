import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'

const USE_DB   = process.env.USE_DB === 'true'
const dataFile = path.join(process.cwd(), 'data', 'orders.json')

function loadJson() {
  if (!fs.existsSync(dataFile)) return []
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')) } catch { return [] }
}

// Synthesise a history array from the flat order object when no log table exists.
// Each status transition recorded on the order is turned into a timestamped event.
// This keeps the frontend working even before a status_log table is added to the DB.
function syntheticHistory(order) {
  const events = []

  // Always include the placed event
  if (order.placed_at || order.placedAt) {
    events.push({ status: 'placed', changedAt: order.placed_at || order.placedAt })
  }

  // If payment was verified, infer a "paid" event around the payment record date
  if ((order.payment_status === 'paid' || order.paymentStatus === 'paid') && (order.paid_at || order.paidAt)) {
    events.push({ status: 'paid', changedAt: order.paid_at || order.paidAt })
  }

  // Use updated_at as the timestamp for the current status if it differs from placed_at
  const updatedAt = order.updated_at || order.updatedAt
  const placedAt  = order.placed_at  || order.placedAt
  const curStatus = order.status
  if (updatedAt && updatedAt !== placedAt && curStatus !== 'placed') {
    // Don't double-push "paid" if we already added it
    if (curStatus !== 'paid' || !events.find(e => e.status === 'paid')) {
      events.push({ status: curStatus, changedAt: updatedAt })
    }
  }

  // Sort descending (most recent first)
  events.sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt))
  return events
}

export async function GET(request) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Sign in required' }, { status: 401 })
  }

  // ── JSON mode ──────────────────────────────────────────────────────────────
  if (!USE_DB) {
    const all    = loadJson()
    const orders = all
      .filter(o => String(o.userId) === String(userId))
      .map(o => ({
        id:             o.id,
        orderNumber:    o.orderNumber,
        status:         o.status,
        payment:        o.paymentMethod,
        paymentStatus:  o.paymentStatus,
        deliveryMethod: o.deliveryMethod,
        subtotal:       Number(o.subtotal || 0),
        shippingFee:    Number(o.shippingFee || 0),
        total:          Number(o.total || 0),
        note:           o.notes || '',
        createdAt:      o.placedAt,
        contact: {
          firstName: (o.customerName || '').split(' ')[0],
          lastName:  (o.customerName || '').split(' ').slice(1).join(' '),
          email:     o.customerEmail,
          phone:     o.customerPhone || null,
        },
        delivery: {
          method:  o.deliveryMethod,
          address: o.deliveryAddress || null,
        },
        items:         (o.items || []).map(i => ({
          id:       i.gownId,
          name:     i.gownName,
          size:     i.sizeLabel,
          qty:      i.quantity,
          price:    '₱' + Number(i.unitPrice).toLocaleString('en-PH'),
          subtotal: i.lineTotal,
        })),
        statusHistory: o.statusHistory || syntheticHistory(o),
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    return NextResponse.json({ ok: true, orders })
  }

  // ── DB mode ────────────────────────────────────────────────────────────────
  //
  // NOTE: This query joins against order_status_log if it exists.
  // If you haven't yet created the log table, the LEFT JOIN still works —
  // statusHistory will simply be empty and syntheticHistory() fills in.
  //
  // To create the status log table, run:
  //
  //   CREATE TABLE IF NOT EXISTS public.order_status_log (
  //     id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  //     order_id   uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  //     status     text        NOT NULL,
  //     note       text,
  //     changed_by uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  //     changed_at timestamptz NOT NULL DEFAULT now()
  //   );
  //   CREATE INDEX idx_order_status_log_order
  //     ON public.order_status_log(order_id, changed_at DESC);
  //
  // And in your admin PATCH action='status' handler, add:
  //   await conn.query(
  //     `INSERT INTO order_status_log (order_id, status, note, changed_by)
  //      VALUES ($1, $2, $3, $4)`,
  //     [orderId, status, note || null, adminUserId || null]
  //   )

  try {
    const { query } = await import('@/lib/db')

    const rows = await query(`
      SELECT
        o.id,
        o.order_number,
        o.status,
        o.payment_method,
        o.payment_status,
        o.delivery_method,
        o.delivery_address,
        o.subtotal,
        o.shipping_fee,
        o.total,
        o.notes,
        o.placed_at,
        o.updated_at,
        o.customer_email,
        o.customer_name,
        o.customer_phone,
        p.paid_at,
        json_agg(
          DISTINCT jsonb_build_object(
            'id',       oi.gown_id,
            'name',     oi.gown_name,
            'size',     oi.size_label,
            'qty',      oi.quantity,
            'price',    '₱' || to_char(oi.unit_price, 'FM999,999,999'),
            'subtotal', oi.line_total
          )
        ) FILTER (WHERE oi.id IS NOT NULL) AS items,
        (
          SELECT json_agg(
            json_build_object(
              'status',    sl.status,
              'changedAt', sl.changed_at,
              'note',      sl.note
            ) ORDER BY sl.changed_at DESC
          )
          FROM order_status_log sl
          WHERE sl.order_id = o.id
        ) AS status_history
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN payments    p  ON p.order_id  = o.id
      WHERE o.user_id = $1
      GROUP BY o.id, p.paid_at
      ORDER BY o.placed_at DESC
    `, [userId])

    const orders = rows.map(r => {
      const nameParts = (r.customer_name || '').trim().split(/\s+/)
      const rawHistory = (r.status_history || []).filter(Boolean)

      return {
        id:             r.id,
        orderNumber:    r.order_number,
        status:         r.status,
        payment:        r.payment_method,
        paymentStatus:  r.payment_status,
        deliveryMethod: r.delivery_method,
        subtotal:       Number(r.subtotal || 0),
        shippingFee:    Number(r.shipping_fee || 0),
        total:          Number(r.total || 0),
        note:           r.notes || '',
        createdAt:      r.placed_at,
        contact: {
          firstName: nameParts[0]                 || '',
          lastName:  nameParts.slice(1).join(' ') || '',
          email:     r.customer_email,
          phone:     r.customer_phone || null,
        },
        delivery: {
          method:  r.delivery_method,
          address: r.delivery_address || null,
        },
        items: (r.items || []).filter(Boolean),
        // Use real log if available, fall back to synthetic history
        statusHistory: rawHistory.length > 0
          ? rawHistory
          : syntheticHistory(r),
      }
    })

    return NextResponse.json({ ok: true, orders })
  } catch (err) {
    console.error('GET /api/my-orders error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch orders' }, { status: 500 })
  }
}