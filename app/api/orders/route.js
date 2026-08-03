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

async function makeOrderNumberDb(conn) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const { rows } = await conn.query(`SELECT nextval('order_seq') AS n`)
  return `JCE-${date}-${String(rows[0].n).padStart(4, '0')}`
}

function makeOrderNumberJson(existing = []) {
  const date   = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `JCE-${date}-`
  const used   = existing
    .filter(o => (o.orderNumber || o.order_number || '').startsWith(prefix))
    .map(o => parseInt((o.orderNumber || o.order_number || '').slice(-4)) || 0)
  const next = used.length ? Math.max(...used) + 1 : 1
  return prefix + String(next).padStart(4, '0')
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId')

  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  if (!USE_DB) {
    const all    = loadJson()
    const orders = all.filter(o => String(o.userId) === String(userId))
    return NextResponse.json({ ok: true, orders })
  }

  try {
    const { query, getClient } = await import('@/lib/db')
    const { sweepExpiredReservations } = await import('@/lib/inventory')
    await sweepExpiredReservations(query, getClient)

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
      discountTotal:   Number(r.discount_total),
      shippingFee:     Number(r.shipping_fee),
      tax:             Number(r.tax ?? 0),
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

// ── POST — create order, reduce stock immediately on placement ────────────────
export async function POST(request) {
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })
  }

  let body
  try { body = await request.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 }) }

  const {
    customerEmail, customerName,
    paymentMethod, deliveryMethod, deliveryAddress,
    lalamoveVehicle,
    items, subtotal, shippingFee, tax, total, notes,
  } = body

  if (!customerEmail)  return NextResponse.json({ ok: false, error: 'Email required' },           { status: 400 })
  if (!paymentMethod)  return NextResponse.json({ ok: false, error: 'Payment method required' },  { status: 400 })
  if (!deliveryMethod) return NextResponse.json({ ok: false, error: 'Delivery method required' }, { status: 400 })
  if (!items?.length)  return NextResponse.json({ ok: false, error: 'No items in order' },        { status: 400 })

  if (!['gcash', 'bdo', 'cash', 'qrph'].includes(paymentMethod)) {
    return NextResponse.json({ ok: false, error: 'Invalid payment method' }, { status: 400 })
  }
  if (!['pickup', 'lalamove'].includes(deliveryMethod)) {
    return NextResponse.json({ ok: false, error: 'Invalid delivery method' }, { status: 400 })
  }
  if (deliveryMethod === 'lalamove' && !deliveryAddress?.trim()) {
    return NextResponse.json({ ok: false, error: 'Delivery address required for Lalamove' }, { status: 400 })
  }
  if (deliveryMethod === 'lalamove' && lalamoveVehicle && !['motorcycle', 'sedan', 'suv'].includes(lalamoveVehicle)) {
    return NextResponse.json({ ok: false, error: 'Invalid Lalamove vehicle type' }, { status: 400 })
  }

  // ── JSON path ─────────────────────────────────────────────────────────────
  if (!USE_DB) {
    const all         = loadJson()
    const orderNumber = makeOrderNumberJson(all)
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
      lalamoveVehicle: deliveryMethod === 'lalamove' ? (lalamoveVehicle || 'sedan') : null,
      subtotal:        Number(subtotal)    || 0,
      discountTotal:   0,
      shippingFee:     Number(shippingFee) || 0,
      tax:             Number(tax)         || 0,
      total:           Number(total)       || 0,
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

  // ── DB path ───────────────────────────────────────────────────────────────
  try {
    const { getClient } = await import('@/lib/db')
    const conn = await getClient()

    try {
      await conn.query('BEGIN')

      const orderNumber = await makeOrderNumberDb(conn)

      const { rows: [order] } = await conn.query(
        `INSERT INTO orders
          (order_number, user_id, customer_email, customer_name,
           status, payment_method, payment_status,
           delivery_method, delivery_address, lalamove_vehicle,
           subtotal, discount_total, shipping_fee, tax, total, notes,
           reservation_expires_at)
         VALUES ($1,$2,$3,$4,'placed',$5,'unpaid',$6,$7,$8,$9,0,$10,$11,$12,$13,
           CASE $5
             WHEN 'qrph'  THEN NOW() + INTERVAL '20 minutes'
             WHEN 'gcash' THEN NOW() + INTERVAL '24 hours'
             WHEN 'bdo'   THEN NOW() + INTERVAL '24 hours'
             ELSE NULL
           END)
         RETURNING *`,
        [
          orderNumber,                                          // $1
          userId,                                               // $2
          customerEmail.trim().toLowerCase(),                   // $3
          (customerName || '').trim(),                          // $4
          paymentMethod,                                        // $5
          deliveryMethod,                                       // $6
          (deliveryAddress || '').trim() || null,               // $7
          deliveryMethod === 'lalamove'
            ? (lalamoveVehicle || 'sedan') : null,              // $8
          Number(subtotal)    || 0,                             // $9
          Number(shippingFee) || 0,                             // $10
          Number(tax)         || 0,                             // $11
          Number(total)       || 0,                             // $12
          (notes || '').trim(),                                 // $13
        ]
      )

      for (const item of items) {
        const qty       = item.quantity || 1
        const lineTotal = (Number(item.unitPrice) || 0) * qty

        await conn.query(
          `INSERT INTO order_items
            (order_id, gown_id, gown_name, size_label, quantity, unit_price, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            order.id, item.gownId || null, item.gownName,
            item.sizeLabel || null, qty,
            Number(item.unitPrice) || 0, lineTotal,
          ]
        )

        // ── INVENTORY: soft-reserve stock on order placement ─────────────────
        // Increments reserved_qty (not stock_qty) so other customers see
        // accurate availability (stock_qty - reserved_qty) without units being
        // physically removed until payment actually succeeds. Converted to a
        // real stock_qty decrement by convertReservationToSale() in
        // lib/inventory.js, or released back by releaseReservation() if the
        // order is abandoned/cancelled before payment completes.
        if (item.gownId && item.sizeLabel) {
          const { rowCount } = await conn.query(
            `UPDATE gown_inventory
             SET reserved_qty = reserved_qty + $1
             WHERE gown_id    = $2
               AND size_label = $3
               AND stock_qty - reserved_qty >= $1`,
            [qty, item.gownId, item.sizeLabel]
          )

          if (rowCount === 0) {
            await conn.query('ROLLBACK')
            return NextResponse.json(
              {
                ok:         false,
                error:      `"${item.gownName}"${item.sizeLabel ? ` (size ${item.sizeLabel})` : ''} is no longer available in the requested quantity. Please update your cart.`,
                outOfStock: true,
              },
              { status: 409 }
            )
          }
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
  const { checkAdminAuth }      = await import('@/lib/adminAuth')
  const { getAuthenticatedUser } = await import('@/lib/auth')

  const isAdmin    = await checkAdminAuth(request)
  const sessionUser = !isAdmin ? await getAuthenticatedUser(request) : null
  const userId      = sessionUser?.id || null

  if (!isAdmin && !userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body
  try { body = await request.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 }) }

  const { orderId, status, paymentStatus, paymentMethod } = body
  if (!orderId) return NextResponse.json({ ok: false, error: 'orderId required' }, { status: 400 })

  const VALID_PAYMENT_METHODS = ['gcash', 'bdo', 'cash', 'qrph']
  if (paymentMethod && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    return NextResponse.json({ ok: false, error: 'Invalid payment method' }, { status: 400 })
  }

  const VALID_STATUSES = [
    'placed', 'pending_payment', 'paid', 'processing',
    'ready', 'shipped', 'completed', 'cancelled', 'refunded',
  ]
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

    if (paymentMethod && !isAdmin) {
      const owner = await query(`SELECT user_id FROM orders WHERE id=$1`, [orderId])
      if (!owner.length) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })
      if (String(owner[0].user_id) !== String(userId)) {
        return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 403 })
      }
    }

    const setParts  = []
    const vals      = []
    let   i         = 1

    if (status)        { setParts.push(`status=$${i++}`);         vals.push(status) }
    if (paymentStatus) { setParts.push(`payment_status=$${i++}`); vals.push(paymentStatus) }
    if (paymentMethod) {
      setParts.push(`payment_method=$${i++}`)
      vals.push(paymentMethod)
      setParts.push(`reservation_expires_at = CASE $${i - 1}
        WHEN 'gcash' THEN NOW() + INTERVAL '24 hours'
        WHEN 'bdo'   THEN NOW() + INTERVAL '24 hours'
        WHEN 'qrph'  THEN NOW() + INTERVAL '20 minutes'
        ELSE NULL END`)
    }
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

const PAYMENT_METHOD_LABELS = {
  qrph:  'GCash / Maya / Bank (QR Ph)',
  gcash: 'GCash',
  bdo:   'BDO Bank Transfer',
  cash:  'Cash on Pickup',
}

function paymentInstructionText(method) {
  if (method === 'qrph')  return 'Your payment is verified automatically through PayMongo. No action is needed from you.'
  if (method === 'cash')  return 'Please bring full payment when you collect your order at the boutique.'
  return 'Please upload your proof of payment within 24 hours to avoid cancellation.'
}

function paymentInstructionHtml(method) {
  if (method === 'qrph') {
    return `<p style="margin:0;color:#2c6e3f;">Your payment is verified automatically through PayMongo. No action is needed from you.</p>`
  }
  if (method === 'cash') {
    return `<p style="margin:0;color:#5a4a44;">Please bring full payment when you collect your order at the boutique.</p>`
  }
  return `<p style="margin:0;color:#92400E;">Please upload your proof of payment within 24 hours to avoid cancellation.</p>`
}

async function sendOrderEmail(order) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return
  const { default: nodemailer } = await import('nodemailer')
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })

  const paymentMethod = order.paymentMethod || order.payment_method
  const deliveryMethod = order.deliveryMethod || order.delivery_method
  const deliveryAddress = order.deliveryAddress || order.delivery_address
  const customerName = order.customerName || order.customer_name || 'there'
  const orderNumber = order.orderNumber || order.order_number
  const tax      = Number(order.tax || 0)
  const shipping = Number(order.shippingFee || order.shipping_fee || 0)
  const items    = order.items || []

  const itemLines = items
    .map(i => `  • ${i.gownName}${i.sizeLabel ? ` (${i.sizeLabel})` : ''} ×${i.quantity} — ₱${Number(i.unitPrice).toLocaleString('en-PH')}`)
    .join('\n')

  const itemRowsHtml = items.map(i => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e8e0db;color:#2c2420;font-size:14px;">
        ${i.gownName}${i.sizeLabel ? ` <span style="color:#9a8880;">(${i.sizeLabel})</span>` : ''}
        <span style="color:#9a8880;"> ×${i.quantity}</span>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #e8e0db;color:#2c2420;font-size:14px;text-align:right;white-space:nowrap;">
        ₱${(Number(i.unitPrice) * i.quantity).toLocaleString('en-PH')}
      </td>
    </tr>`).join('')

  await transporter.sendMail({
    from:    `"JCE Bridal Boutique" <${process.env.GMAIL_USER}>`,
    to:      order.customerEmail || order.customer_email,
    subject: `Order confirmed — ${orderNumber}`,
    text: `Hi ${customerName},

Thank you for your order at JCE Bridal Boutique!

Order number: ${orderNumber}
Status: Placed — awaiting payment confirmation

Items:
${itemLines}

Subtotal:      ₱${Number(order.subtotal).toLocaleString('en-PH')}
${shipping > 0 ? `Shipping fee:  ₱${shipping.toLocaleString('en-PH')}\n` : ''}${tax > 0 ? `Business tax:  ₱${tax.toLocaleString('en-PH')}\n` : ''}Total:         ₱${Number(order.total).toLocaleString('en-PH')}

Payment method: ${PAYMENT_METHOD_LABELS[paymentMethod] || paymentMethod}
${paymentInstructionText(paymentMethod)}

Delivery: ${deliveryMethod}
${deliveryAddress ? `Address: ${deliveryAddress}` : ''}

You can track your order on your my-orders page.

Thank you,
JCE Bridal Boutique`.trim(),
    html: `
<div style="background:#faf7f4;padding:32px 16px;font-family:'Jost',Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e8e0db;border-radius:12px;overflow:hidden;">

    <div style="background:#1a0f0a;padding:28px 32px;text-align:center;">
      <p style="margin:0;color:#c9a96e;font-family:Georgia,'Cormorant Garamond',serif;font-size:22px;letter-spacing:1px;">
        JCE Bridal Boutique
      </p>
    </div>

    <div style="padding:32px;">
      <p style="margin:0 0 4px;color:#2c2420;font-size:15px;">Hi ${customerName},</p>
      <p style="margin:0 0 24px;color:#5a4a44;font-size:14px;">Thank you for your order. Here are your details.</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tr>
          <td style="padding:8px 0;color:#9a8880;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Order number</td>
          <td style="padding:8px 0;color:#2c2420;font-size:14px;text-align:right;font-weight:600;">${orderNumber}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#9a8880;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Status</td>
          <td style="padding:8px 0;color:#2c2420;font-size:14px;text-align:right;">Placed — awaiting payment confirmation</td>
        </tr>
      </table>

      <p style="margin:0 0 8px;color:#2c2420;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Items</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        ${itemRowsHtml}
      </table>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="padding:4px 0;color:#5a4a44;font-size:13px;">Subtotal</td>
          <td style="padding:4px 0;color:#5a4a44;font-size:13px;text-align:right;">₱${Number(order.subtotal).toLocaleString('en-PH')}</td>
        </tr>
        ${shipping > 0 ? `
        <tr>
          <td style="padding:4px 0;color:#5a4a44;font-size:13px;">Shipping fee</td>
          <td style="padding:4px 0;color:#5a4a44;font-size:13px;text-align:right;">₱${shipping.toLocaleString('en-PH')}</td>
        </tr>` : ''}
        ${tax > 0 ? `
        <tr>
          <td style="padding:4px 0;color:#9a8880;font-size:12px;">Business tax</td>
          <td style="padding:4px 0;color:#9a8880;font-size:12px;text-align:right;">₱${tax.toLocaleString('en-PH')}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:10px 0 0;color:#2c2420;font-size:15px;font-weight:700;border-top:1px solid #e8e0db;">Total</td>
          <td style="padding:10px 0 0;color:#2c2420;font-size:15px;font-weight:700;text-align:right;border-top:1px solid #e8e0db;">₱${Number(order.total).toLocaleString('en-PH')}</td>
        </tr>
      </table>

      <div style="background:#faf9f7;border:1px solid #e8e0db;border-radius:8px;padding:16px 18px;margin-bottom:20px;">
        <p style="margin:0 0 6px;color:#2c2420;font-size:13px;font-weight:600;">
          Payment method: ${PAYMENT_METHOD_LABELS[paymentMethod] || paymentMethod}
        </p>
        ${paymentInstructionHtml(paymentMethod)}
      </div>

      <p style="margin:0 0 4px;color:#2c2420;font-size:13px;font-weight:600;">Delivery</p>
      <p style="margin:0 0 20px;color:#5a4a44;font-size:14px;">
        ${deliveryMethod === 'lalamove' ? 'Lalamove delivery' : 'Store pickup'}
        ${deliveryAddress ? `<br/>${deliveryAddress}` : ''}
      </p>

      <p style="margin:0;color:#9a8880;font-size:12px;">
        You can track your order anytime on your my-orders page.
      </p>
    </div>

    <div style="background:#faf9f7;padding:18px 32px;text-align:center;border-top:1px solid #e8e0db;">
      <p style="margin:0;color:#9a8880;font-size:11px;">JCE Bridal Boutique · 4I-19 Soler Wing 168 Mall Recto Mla, Manila</p>
    </div>

  </div>
</div>`,
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
    text:    `Hi,\n\nYour order ${order.order_number} has been updated.\n\nStatus: ${label}\n\nView your order on your my-orders page.\n\nThank you,\nJCE Bridal Boutique`,
  })
}