import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'

const USE_DB   = process.env.USE_DB === 'true'
const dataFile = path.join(process.cwd(), 'data', 'orders.json')

function loadJson() {
  if (!fs.existsSync(dataFile)) return []
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')) } catch { return [] }
}
function saveJson(orders) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true })
  fs.writeFileSync(dataFile, JSON.stringify(orders, null, 2))
}

// ── Order number generator ────────────────────────────────────────────────────
function makeOrderNumber(existing = []) {
  const date   = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `JCE-${date}-`
  const used   = existing
    .filter(o => (o.orderNumber || o.order_number || '').startsWith(prefix))
    .map(o => parseInt((o.orderNumber || o.order_number || '').slice(-4)) || 0)
  const next = used.length ? Math.max(...used) + 1 : 1
  return prefix + String(next).padStart(4, '0')
}

// ── GET — fetch orders for a user only; admin must use /api/admin/orders ──────
//
// SECURITY: This endpoint is scoped strictly to the authenticated user.
// The userId comes from x-user-id which must be set server-side by middleware
// (or a session layer). We never allow listing all orders here — admins use
// the dedicated /api/admin/orders endpoint which enforces x-admin-secret.
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId')

  // Require a userId — no anonymous or wildcard access
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  if (!USE_DB) {
    const all    = loadJson()
    const orders = all.filter(o => String(o.userId) === String(userId))
    return NextResponse.json({ ok: true, orders })
  }

  try {
    const { query } = await import('@/lib/db')
    const rows = await query(`
      SELECT o.*,
        json_agg(
          json_build_object(
            'id',        oi.id,
            'gownId',    oi.gown_id,
            'gownName',  oi.gown_name,
            'sizeLabel', oi.size_label,
            'quantity',  oi.quantity,
            'unitPrice', oi.unit_price,
            'lineTotal', oi.line_total
          ) ORDER BY oi.id
        ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = $1
      GROUP BY o.id
      ORDER BY o.placed_at DESC
    `, [userId])

    const orders = rows.map(r => ({
      id:              r.id,
      orderNumber:     r.order_number,
      status:          r.status,
      paymentMethod:   r.payment_method,
      paymentStatus:   r.payment_status,
      deliveryMethod:  r.delivery_method,
      deliveryAddress: r.delivery_address,
      subtotal:        Number(r.subtotal),
      total:           Number(r.total),
      notes:           r.notes,
      placedAt:        r.placed_at,
      items:           r.items?.filter(Boolean) || [],
    }))

    return NextResponse.json({ ok: true, orders })
  } catch (err) {
    console.error('GET /api/orders error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch orders' }, { status: 500 })
  }
}

// ── POST — create a new order ─────────────────────────────────────────────────
export async function POST(request) {
  const userId = request.headers.get('x-user-id')

  // FIXED: removed debug console.log statements that exposed USE_DB, userId,
  // and DATABASE_URL presence on every order creation in production.

  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })
  }

  let body
  try { body = await request.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 }) }

  const {
    customerEmail, customerName,
    paymentMethod, deliveryMethod, deliveryAddress,
    items, subtotal, total, notes,
  } = body

  if (!customerEmail)          return NextResponse.json({ ok: false, error: 'Email required' },          { status: 400 })
  if (!paymentMethod)          return NextResponse.json({ ok: false, error: 'Payment method required' }, { status: 400 })
  if (!deliveryMethod)         return NextResponse.json({ ok: false, error: 'Delivery method required' }, { status: 400 })
  if (!items?.length)          return NextResponse.json({ ok: false, error: 'No items in order' },       { status: 400 })
  if (!['gcash','bdo','cash'].includes(paymentMethod)) {
    return NextResponse.json({ ok: false, error: 'Invalid payment method' }, { status: 400 })
  }
  if (!['pickup','lalamove'].includes(deliveryMethod)) {
    return NextResponse.json({ ok: false, error: 'Invalid delivery method' }, { status: 400 })
  }
  if (deliveryMethod === 'lalamove' && !deliveryAddress?.trim()) {
    return NextResponse.json({ ok: false, error: 'Delivery address required for Lalamove' }, { status: 400 })
  }

  // ── JSON path ────────────────────────────────────────────────────────────────
  if (!USE_DB) {
    const all         = loadJson()
    const orderNumber = makeOrderNumber(all)
    const newOrder = {
      id:              Date.now(),
      orderNumber,
      userId:          String(userId),
      customerEmail:   customerEmail.trim().toLowerCase(),
      customerName:    (customerName || '').trim(),
      status:          'placed',
      paymentMethod,
      paymentStatus:   'unpaid',
      deliveryMethod,
      deliveryAddress: (deliveryAddress || '').trim() || null,
      subtotal:        Number(subtotal) || 0,
      discountTotal:   0,
      shippingFee:     0,
      total:           Number(total) || 0,
      notes:           (notes || '').trim(),
      placedAt:        new Date().toISOString(),
      items:           items.map((i, idx) => ({
        id:        Date.now() + idx,
        gownId:    i.gownId,
        gownName:  i.gownName,
        sizeLabel: i.sizeLabel || null,
        quantity:  i.quantity  || 1,
        unitPrice: Number(i.unitPrice) || 0,
        lineTotal: (Number(i.unitPrice) || 0) * (i.quantity || 1),
      })),
    }
    saveJson([newOrder, ...all])
    sendOrderEmail(newOrder).catch(console.error)
    return NextResponse.json({ ok: true, orderId: newOrder.id, orderNumber })
  }

  // ── DB path ──────────────────────────────────────────────────────────────────
  try {
    const { query, getClient } = await import('@/lib/db')

    const recent = await query(
      `SELECT order_number FROM orders WHERE placed_at > NOW() - INTERVAL '1 day'`
    )
    const orderNumber = makeOrderNumber(recent.map(r => ({ orderNumber: r.order_number })))

    const conn = await getClient()
    let orderId
    try {
      await conn.query('BEGIN')

      const { rows: [order] } = await conn.query(
        `INSERT INTO orders
          (order_number, user_id, customer_email, customer_name,
            status, payment_method, payment_status,
            delivery_method, delivery_address,
            subtotal, discount_total, shipping_fee, total, notes)
        VALUES ($1,$2,$3,$4,'placed',$5,'unpaid',$6,$7,$8,0,0,$9,$10)
        RETURNING *`,
        [
          orderNumber, userId,
          customerEmail.trim().toLowerCase(), (customerName || '').trim(),
          paymentMethod,
          deliveryMethod, (deliveryAddress || '').trim() || null,
          Number(subtotal) || 0,
          Number(total) || 0,
          (notes || '').trim(),
        ]
      )
      orderId = order.id

      for (const item of items) {
        const lineTotal = (Number(item.unitPrice) || 0) * (item.quantity || 1)
        await conn.query(
          `INSERT INTO order_items
            (order_id, gown_id, gown_name, size_label, quantity, unit_price, line_total)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [order.id, item.gownId || null, item.gownName,
          item.sizeLabel || null, item.quantity || 1,
          Number(item.unitPrice) || 0, lineTotal]
        )
        if (item.gownId && item.sizeLabel) {
          await conn.query(
            `UPDATE gown_inventory
            SET reserved_qty = reserved_qty + $1
            WHERE gown_id = $2 AND size_label = $3
              AND (stock_qty - reserved_qty) >= $1`,
            [item.quantity || 1, item.gownId, item.sizeLabel]
          )
        }
      }

      await conn.query('COMMIT')
      sendOrderEmail({ ...order, orderNumber, items }).catch(console.error)
      return NextResponse.json({ ok: true, orderId: order.id, orderNumber })
    } catch (err) {
      await conn.query('ROLLBACK')
      throw err
    } finally {
      conn.release()
    }
  } catch (err) {
    console.error('POST /api/orders error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to create order' }, { status: 500 })
  }
}

// ── PATCH — update order status ───────────────────────────────────────────────
export async function PATCH(request) {
  const adminSecret = request.headers.get('x-admin-secret')
  const isAdmin     = process.env.ADMIN_SECRET && adminSecret === process.env.ADMIN_SECRET
  const userId      = request.headers.get('x-user-id')

  if (!isAdmin && !userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body
  try { body = await request.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 }) }

  const { orderId, status, paymentStatus } = body
  if (!orderId) return NextResponse.json({ ok: false, error: 'orderId required' }, { status: 400 })

  const VALID_STATUSES = ['placed','pending_payment','paid','processing','ready','shipped','completed','cancelled','refunded']
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ ok: false, error: 'Invalid status' }, { status: 400 })
  }

  if (!isAdmin && status && status !== 'completed') {
    return NextResponse.json({ ok: false, error: 'Unauthorized status change' }, { status: 403 })
  }

  if (!USE_DB) {
    const all = loadJson()
    const idx = all.findIndex(o => String(o.id) === String(orderId))
    if (idx === -1) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })
    if (status)        all[idx].status        = status
    if (paymentStatus) all[idx].paymentStatus = paymentStatus
    saveJson(all)
    return NextResponse.json({ ok: true, order: all[idx] })
  }

  try {
    const { query } = await import('@/lib/db')
    const setParts  = []
    const vals      = []
    let   i         = 1

    if (status)        { setParts.push(`status=$${i++}`);         vals.push(status) }
    if (paymentStatus) { setParts.push(`payment_status=$${i++}`); vals.push(paymentStatus) }
    if (!setParts.length) return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })

    vals.push(orderId)
    const rows = await query(
      `UPDATE orders SET ${setParts.join(', ')}, updated_at=NOW() WHERE id=$${i} RETURNING *`,
      vals
    )
    if (!rows.length) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

    sendStatusEmail(rows[0]).catch(console.error)
    return NextResponse.json({ ok: true, order: rows[0] })
  } catch (err) {
    console.error('PATCH /api/orders error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to update order' }, { status: 500 })
  }
}

// ── Email helpers ─────────────────────────────────────────────────────────────
async function sendOrderEmail(order) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return
  const { default: nodemailer } = await import('nodemailer')
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })
  const itemLines = (order.items || [])
    .map(i => `  • ${i.gownName}${i.sizeLabel ? ` (${i.sizeLabel})` : ''} ×${i.quantity} — ₱${Number(i.unitPrice).toLocaleString('en-PH')}`)
    .join('\n')
  await transporter.sendMail({
    from:    `"JCE Bridal Boutique" <${process.env.GMAIL_USER}>`,
    to:      order.customerEmail || order.customer_email,
    subject: `Order confirmed — ${order.orderNumber || order.order_number}`,
    text: `Hi ${order.customerName || order.customer_name || 'there'},\n\nThank you for your order at JCE Bridal Boutique!\n\nOrder number: ${order.orderNumber || order.order_number}\nStatus: Placed — awaiting payment confirmation\n\nItems:\n${itemLines}\n\nTotal: ₱${Number(order.total).toLocaleString('en-PH')}\n\nPayment method: ${order.paymentMethod || order.payment_method}\n${(order.paymentMethod || order.payment_method) !== 'cash' ? 'Please upload your proof of payment within 24 hours to avoid cancellation.' : ''}\n\nDelivery: ${order.deliveryMethod || order.delivery_method}\n${order.deliveryAddress || order.delivery_address ? `Address: ${order.deliveryAddress || order.delivery_address}` : ''}\n\nYou can track your order on your profile page.\n\nThank you,\nJCE Bridal Boutique`.trim(),
  })
}

async function sendStatusEmail(order) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return
  const email = order.customer_email || order.customerEmail
  if (!email) return
  const { default: nodemailer } = await import('nodemailer')
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })
  const labels = {
    paid:       'Payment verified ✓',
    processing: 'Your order is being prepared',
    ready:      'Ready for pickup / out for delivery',
    shipped:    'Order on its way',
    completed:  'Order completed — thank you!',
    cancelled:  'Order cancelled',
  }
  const label = labels[order.status] || `Order status updated: ${order.status}`
  await transporter.sendMail({
    from:    `"JCE Bridal Boutique" <${process.env.GMAIL_USER}>`,
    to:      email,
    subject: `${label} — ${order.order_number}`,
    text:    `Hi,\n\nYour order ${order.order_number} has been updated.\n\nStatus: ${label}\n\nView your order on your profile page.\n\nThank you,\nJCE Bridal Boutique`,
  })
}