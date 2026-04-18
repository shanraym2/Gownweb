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

function requireAdmin(request) {
  const secret = request.headers.get('x-admin-secret')
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return null
}

// ── GET /api/admin/orders?status=xxx ─────────────────────────────────────────

export async function GET(request) {
  const deny = requireAdmin(request)
  if (deny) return deny

  const { searchParams } = new URL(request.url)
  const filterStatus = searchParams.get('status') || ''

  if (!USE_DB) {
    let orders = loadJson()
    if (filterStatus) orders = orders.filter(o => o.status === filterStatus)
    // Map to camelCase and include proof fields
    orders = orders.map(o => ({
      id:               o.id,
      orderNumber:      o.orderNumber,
      status:           o.status,
      paymentMethod:    o.paymentMethod,
      paymentStatus:    o.paymentStatus,
      deliveryMethod:   o.deliveryMethod,
      deliveryAddress:  o.deliveryAddress,
      customerName:     o.customerName,
      customerEmail:    o.customerEmail,
      customerPhone:    o.customerPhone || null,
      subtotal:         Number(o.subtotal || 0),
      total:            Number(o.total || 0),
      notes:            o.notes || null,
      placedAt:         o.placedAt,
      updatedAt:        o.updatedAt || null,
      items:            o.items || [],
      // Proof fields — these are what the frontend checks
      proofStatus:      o.proofStatus      || (o.proofImage ? 'pending' : null),
      proofImageUrl:    o.proofImage        || null,
      proofReferenceNo: o.proofReferenceNo  || null,
      proofUploadedAt:  o.proofUploadedAt   || null,
    }))
    return NextResponse.json({ ok: true, orders })
  }

  try {
    const { query } = await import('@/lib/db')
    const rows = await query(`
      SELECT o.*,
        p.status        AS proof_status,
        p.proof_image_url,
        p.reference_no  AS proof_reference_no,
        p.created_at    AS proof_uploaded_at,
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
        ) FILTER (WHERE oi.id IS NOT NULL) AS items
      FROM orders o
      LEFT JOIN payments p     ON p.order_id = o.id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      ${filterStatus ? 'WHERE o.status = $1' : ''}
      GROUP BY o.id, p.status, p.proof_image_url, p.reference_no, p.created_at
      ORDER BY o.placed_at DESC
    `, filterStatus ? [filterStatus] : [])

    const orders = rows.map(r => ({
      id:               r.id,
      orderNumber:      r.order_number,
      status:           r.status,
      paymentMethod:    r.payment_method,
      paymentStatus:    r.payment_status,
      deliveryMethod:   r.delivery_method,
      deliveryAddress:  r.delivery_address,
      customerName:     r.customer_name,
      customerEmail:    r.customer_email,
      customerPhone:    r.customer_phone || null,
      subtotal:         Number(r.subtotal || 0),
      shippingFee:      Number(r.shipping_fee || 0),
      total:            Number(r.total || 0),
      notes:            r.notes,
      placedAt:         r.placed_at,
      updatedAt:        r.updated_at,
      items:            (r.items || []).filter(Boolean),
      proofStatus:      r.proof_status      || null,
      proofImageUrl:    r.proof_image_url   || null,
      proofReferenceNo: r.proof_reference_no || null,
      proofUploadedAt:  r.proof_uploaded_at  || null,
    }))

    return NextResponse.json({ ok: true, orders })
  } catch (err) {
    console.error('GET /api/admin/orders error:', err)
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 })
  }
}

// ── PATCH /api/admin/orders ───────────────────────────────────────────────────
// actions: 'status' | 'verify-payment' | 'reject-payment'

export async function PATCH(request) {
  const deny = requireAdmin(request)
  if (deny) return deny

  let body
  try { body = await request.json() } 
  catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const { action, orderId, status, note, referenceNo, reason } = body
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  // ── JSON path ───────────────────────────────────────────────────────────────
  if (!USE_DB) {
    const all = loadJson()
    const idx = all.findIndex(o => String(o.id) === String(orderId))
    if (idx === -1) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    if (action === 'status') {
      if (status) all[idx].status = status
      all[idx].updatedAt = new Date().toISOString()
      saveJson(all)
      sendStatusEmail(all[idx], status, note).catch(console.error)
      return NextResponse.json({ ok: true, order: all[idx] })
    }

    if (action === 'verify-payment') {
      all[idx].paymentStatus    = 'paid'
      all[idx].status           = 'paid'
      all[idx].proofStatus      = 'verified'
      all[idx].proofReferenceNo = referenceNo || all[idx].proofReferenceNo
      all[idx].updatedAt        = new Date().toISOString()
      saveJson(all)
      sendVerifyEmail(all[idx]).catch(console.error)
      return NextResponse.json({ ok: true, order: all[idx] })
    }

    if (action === 'reject-payment') {
      all[idx].paymentStatus = 'unpaid'
      all[idx].status        = 'placed'
      all[idx].proofStatus   = 'rejected'
      all[idx].updatedAt     = new Date().toISOString()
      saveJson(all)
      sendRejectEmail(all[idx], reason).catch(console.error)
      return NextResponse.json({ ok: true, order: all[idx] })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  // ── DB path ─────────────────────────────────────────────────────────────────
  try {
    const { query } = await import('@/lib/db')

    if (action === 'status') {
      const VALID = ['placed','pending_payment','paid','processing','ready','shipped','completed','cancelled','refunded']
      if (!status || !VALID.includes(status))
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

      const rows = await query(
        `UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
        [status, orderId]
      )
      if (!rows.length) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

      if (status === 'cancelled') {
        await query(
          `UPDATE gown_inventory gi
           SET reserved_qty = GREATEST(0, gi.reserved_qty - oi.quantity)
           FROM order_items oi
           WHERE oi.order_id=$1 AND oi.gown_id=gi.gown_id AND oi.size_label=gi.size_label`,
          [orderId]
        )
      }
      sendStatusEmail(rows[0], status, note).catch(console.error)
      return NextResponse.json({ ok: true })
    }

    if (action === 'verify-payment') {
      await query(
        `UPDATE payments SET status='verified' WHERE order_id=$1`,
        [orderId]
      )
      if (referenceNo) {
        await query(
          `UPDATE payments SET reference_no=$1 WHERE order_id=$2`,
          [referenceNo, orderId]
        )
      }
      const rows = await query(
        `UPDATE orders SET payment_status='paid', status='paid', updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [orderId]
      )
      if (!rows.length) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      sendVerifyEmail(rows[0]).catch(console.error)
      return NextResponse.json({ ok: true })
    }

    if (action === 'reject-payment') {
      await query(
        `UPDATE payments SET status='rejected' WHERE order_id=$1`,
        [orderId]
      )
      const rows = await query(
        `UPDATE orders SET payment_status='unpaid', status='placed', updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [orderId]
      )
      if (!rows.length) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      sendRejectEmail(rows[0], reason).catch(console.error)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('PATCH /api/admin/orders error:', err)
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
  }
}

// ── Email helpers ─────────────────────────────────────────────────────────────

async function sendStatusEmail(order, status, note = '') {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return
  const name = order.customer_name || order.customerName || 'there'
  const num  = order.order_number  || order.orderNumber
  const to   = order.customer_email || order.customerEmail
  if (!to) return

  const templates = {
    pending_payment: [`Awaiting payment — ${num}`,       `Hi ${name},\n\nWe're waiting for your proof of payment for order ${num}.\n\nPlease upload within 24 hours.\n\nJCE Bridal Boutique`],
    paid:            [`Payment verified ✓ — ${num}`,     `Hi ${name},\n\nYour payment for order ${num} has been verified. We'll now begin preparing your order.\n\nJCE Bridal Boutique`],
    processing:      [`Order being prepared — ${num}`,   `Hi ${name},\n\nYour order ${num} is now being prepared.\n\nJCE Bridal Boutique`],
    ready:           [`Ready for pickup — ${num}`,       `Hi ${name},\n\nYour order ${num} is ready!\n\nJCE Bridal Boutique`],
    shipped:         [`Order on its way — ${num}`,       `Hi ${name},\n\nOrder ${num} has been dispatched.\n\nJCE Bridal Boutique`],
    completed:       [`Order completed — ${num}`,        `Hi ${name},\n\nOrder ${num} is complete. We hope you love your gown!\n\nWith love,\nJCE Bridal Boutique`],
    cancelled:       [`Order cancelled — ${num}`,        `Hi ${name},\n\nYour order ${num} has been cancelled.${note ? `\n\nReason: ${note}` : ''}\n\nJCE Bridal Boutique`],
    refunded:        [`Refund processed — ${num}`,       `Hi ${name},\n\nA refund for order ${num} has been processed. Allow 7–14 business days.\n\nJCE Bridal Boutique`],
  }
  const tmpl = templates[status]
  if (!tmpl) return
  try {
    const nodemailer = (await import('nodemailer')).default
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } })
    await t.sendMail({ from: `"JCE Bridal Boutique" <${process.env.GMAIL_USER}>`, to, subject: tmpl[0], text: tmpl[1] })
  } catch (e) { console.warn('Status email failed:', e.message) }
}

async function sendVerifyEmail(order) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return
  const name = order.customer_name || order.customerName || 'there'
  const num  = order.order_number  || order.orderNumber
  const to   = order.customer_email || order.customerEmail
  if (!to) return
  try {
    const nodemailer = (await import('nodemailer')).default
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } })
    await t.sendMail({
      from: `"JCE Bridal Boutique" <${process.env.GMAIL_USER}>`, to,
      subject: `Payment verified ✓ — ${num}`,
      text: `Hi ${name},\n\nYour payment for order ${num} has been verified. We'll now begin preparing your order.\n\nThank you,\nJCE Bridal Boutique`,
    })
  } catch (e) { console.warn('Verify email failed:', e.message) }
}

async function sendRejectEmail(order, reason = '') {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return
  const name = order.customer_name || order.customerName || 'there'
  const num  = order.order_number  || order.orderNumber
  const to   = order.customer_email || order.customerEmail
  if (!to) return
  try {
    const nodemailer = (await import('nodemailer')).default
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } })
    await t.sendMail({
      from: `"JCE Bridal Boutique" <${process.env.GMAIL_USER}>`, to,
      subject: `Payment proof rejected — ${num}`,
      text: `Hi ${name},\n\nUnfortunately your payment proof for order ${num} was rejected.${reason ? `\n\nReason: ${reason}` : ''}\n\nPlease re-upload a clear proof of payment.\n\nJCE Bridal Boutique`,
    })
  } catch (e) { console.warn('Reject email failed:', e.message) }
}