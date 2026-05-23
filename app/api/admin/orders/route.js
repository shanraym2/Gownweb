// app/api/admin/orders/route.js
// Audit-instrumented version — logAudit() added to all PATCH actions.

import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'
import { checkAdminAuth } from '@/lib/adminAuth'
import { logAudit }       from '@/lib/audit'

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

// ── GET /api/admin/orders?status=xxx ─────────────────────────────────────────

export async function GET(request) {
  if (!await checkAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const filterStatus = searchParams.get('status') || ''

  if (!USE_DB) {
    let orders = loadJson()
    if (filterStatus) orders = orders.filter(o => o.status === filterStatus)
    orders = orders.map(o => ({
      id:               o.id,
      orderNumber:      o.orderNumber,
      status:           o.status,
      paymentMethod:    o.paymentMethod,
      paymentStatus:    o.paymentStatus,
      deliveryMethod:   o.deliveryMethod,
      deliveryAddress:  o.deliveryAddress,
      lalamoveVehicle:  o.lalamoveVehicle  || null,
      lalamoveTrackingUrl: o.lalamoveTrackingUrl || null,
      lalamoveEta:         o.lalamoveEta         || null,
      shipmentPhotoUrl:    o.shipmentPhotoUrl     || null,
      customerName:     o.customerName,
      customerEmail:    o.customerEmail,
      customerPhone:    o.customerPhone    || null,
      subtotal:         Number(o.subtotal  || 0),
      shippingFee:      Number(o.shippingFee || 0),
      total:            Number(o.total     || 0),
      notes:            o.notes            || null,
      placedAt:         o.placedAt,
      updatedAt:        o.updatedAt        || null,
      items:            o.items            || [],
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
      SELECT
        o.*,
        p.status       AS proof_status,
        p.proof_image_url,
        p.reference_no AS proof_reference_no,
        p.created_at   AS proof_uploaded_at,
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
      LEFT JOIN payments    p  ON p.order_id  = o.id
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
      lalamoveVehicle:  r.lalamove_vehicle  || null,
      lalamoveTrackingUrl: r.lalamove_tracking_url || null,
      lalamoveEta:         r.lalamove_eta          || null,
      shipmentPhotoUrl:    r.shipment_photo_url     || null,
      customerName:     r.customer_name,
      customerEmail:    r.customer_email,
      customerPhone:    r.customer_phone   || null,
      subtotal:         Number(r.subtotal  || 0),
      shippingFee:      Number(r.shipping_fee || 0),
      total:            Number(r.total     || 0),
      notes:            r.notes,
      placedAt:         r.placed_at,
      updatedAt:        r.updated_at,
      items:            (r.items || []).filter(Boolean),
      proofStatus:      r.proof_status       || null,
      proofImageUrl:    r.proof_image_url    || null,
      proofReferenceNo: r.proof_reference_no || null,
      proofUploadedAt:  r.proof_uploaded_at  || null,
    }))

    return NextResponse.json({ ok: true, orders })
  } catch (err) {
    console.error('GET /api/admin/orders error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to load orders' }, { status: 500 })
  }
}

// ── PATCH /api/admin/orders ───────────────────────────────────────────────────

export async function PATCH(request) {
  if (!await checkAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body
  try { body = await request.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 }) }

  const { action, orderId, status, note, referenceNo, reason, trackingUrl, eta, shipmentPhotoUrl } = body
  if (!orderId) return NextResponse.json({ ok: false, error: 'orderId required' }, { status: 400 })
  if (!action)  return NextResponse.json({ ok: false, error: 'action required' },  { status: 400 })

  // ── JSON path ───────────────────────────────────────────────────────────────
  if (!USE_DB) {
    const all = loadJson()
    const idx = all.findIndex(o => String(o.id) === String(orderId))
    if (idx === -1) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

    if (action === 'status') {
      const VALID = ['placed','pending_payment','paid','processing','ready','shipped','completed','cancelled','refunded']
      if (!status || !VALID.includes(status))
        return NextResponse.json({ ok: false, error: 'Invalid status' }, { status: 400 })

      const prevStatus = all[idx].status
      all[idx].status  = status
      if (trackingUrl      !== undefined) all[idx].lalamoveTrackingUrl  = trackingUrl      || null
      if (eta              !== undefined) all[idx].lalamoveEta           = eta              || null
      if (shipmentPhotoUrl !== undefined) all[idx].shipmentPhotoUrl      = shipmentPhotoUrl || null

      const isCashPickup = all[idx].deliveryMethod === 'pickup' && all[idx].paymentMethod === 'cash'
      if (
        status === 'paid' || status === 'completed' ||
        (isCashPickup && ['processing','ready','shipped','completed'].includes(status))
      ) {
        all[idx].paymentStatus = 'paid'
      }

      all[idx].updatedAt = new Date().toISOString()
      saveJson(all)
      sendStatusEmail(all[idx], status, note).catch(console.error)

      // ── AUDIT ──────────────────────────────────────────────────────────────
      logAudit({
        request,
        action:     'order.status',
        entityType: 'order',
        entityId:   String(orderId),
        payload:    {
          orderNumber: all[idx].orderNumber || null,
          from:        prevStatus,
          to:          status,
          note:        note || null,
        },
      })

      return NextResponse.json({ ok: true, order: all[idx] })
    }

    if (action === 'verify-payment') {
      const hasProof = all[idx].proofImage || all[idx].proofReferenceNo
      if (!hasProof) {
        return NextResponse.json(
          { ok: false, error: 'No proof uploaded for this order. Cannot verify payment.' },
          { status: 400 }
        )
      }

      all[idx].paymentStatus    = 'paid'
      all[idx].status           = 'paid'
      all[idx].proofStatus      = 'verified'
      all[idx].proofReferenceNo = referenceNo || all[idx].proofReferenceNo
      all[idx].updatedAt        = new Date().toISOString()
      saveJson(all)
      sendVerifyEmail(all[idx]).catch(console.error)

      // ── AUDIT ──────────────────────────────────────────────────────────────
      logAudit({
        request,
        action:     'order.payment.verify',
        entityType: 'order',
        entityId:   String(orderId),
        payload:    {
          orderNumber:  all[idx].orderNumber || null,
          referenceNo:  referenceNo || null,
          customerEmail: all[idx].customerEmail || null,
        },
      })

      return NextResponse.json({ ok: true, order: all[idx] })
    }

    if (action === 'reject-payment') {
      const hasProof = all[idx].proofImage || all[idx].proofReferenceNo
      if (!hasProof) {
        return NextResponse.json(
          { ok: false, error: 'No proof uploaded for this order. Nothing to reject.' },
          { status: 400 }
        )
      }

      all[idx].paymentStatus = 'unpaid'
      all[idx].status        = 'placed'
      all[idx].proofStatus   = 'rejected'
      all[idx].updatedAt     = new Date().toISOString()
      saveJson(all)
      sendRejectEmail(all[idx], reason).catch(console.error)

      // ── AUDIT ──────────────────────────────────────────────────────────────
      logAudit({
        request,
        action:     'order.payment.reject',
        entityType: 'order',
        entityId:   String(orderId),
        payload:    {
          orderNumber:  all[idx].orderNumber || null,
          reason:       reason || null,
          customerEmail: all[idx].customerEmail || null,
        },
      })

      return NextResponse.json({ ok: true, order: all[idx] })
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
  }

  // ── DB path ─────────────────────────────────────────────────────────────────
  try {
    const { query, getClient } = await import('@/lib/db')

    // ── action: status ────────────────────────────────────────────────────────
    if (action === 'status') {
      const VALID = ['placed','pending_payment','paid','processing','ready','shipped','completed','cancelled','refunded']
      if (!status || !VALID.includes(status))
        return NextResponse.json({ ok: false, error: 'Invalid status' }, { status: 400 })

      // Fetch previous status for the audit diff
      const prevRows = await query(`SELECT status, order_number FROM orders WHERE id=$1`, [orderId])
      const prevStatus    = prevRows[0]?.status || null
      const orderNumber   = prevRows[0]?.order_number || null

      const rows = await query(
        `UPDATE orders
         SET
           status                = $1,
           lalamove_tracking_url = COALESCE($3, lalamove_tracking_url),
           lalamove_eta          = COALESCE($4, lalamove_eta),
           shipment_photo_url    = COALESCE($5, shipment_photo_url),
           payment_status        = CASE
             WHEN $1 IN ('paid', 'completed') THEN 'paid'
             WHEN $1 = 'processing'
              AND delivery_method = 'pickup'
              AND payment_method  = 'cash'   THEN 'paid'
             ELSE payment_status
           END,
           updated_at            = NOW()
         WHERE id = $2
         RETURNING *`,
        [status, orderId, trackingUrl || null, eta || null, shipmentPhotoUrl || null]
      )

      if (!rows.length)
        return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

      sendStatusEmail(rows[0], status, note).catch(console.error)

      // ── AUDIT ──────────────────────────────────────────────────────────────
      logAudit({
        request,
        action:     'order.status',
        entityType: 'order',
        entityId:   String(orderId),
        payload:    { orderNumber, from: prevStatus, to: status, note: note || null },
      })

      return NextResponse.json({ ok: true })
    }

    // ── action: verify-payment ────────────────────────────────────────────────
    if (action === 'verify-payment') {
      const conn = await getClient()
      try {
        await conn.query('BEGIN')

        const { rows: proofRows } = await conn.query(
          `SELECT id FROM payments
           WHERE order_id=$1
             AND (proof_image_url IS NOT NULL OR reference_no IS NOT NULL)
           LIMIT 1`,
          [orderId]
        )
        if (!proofRows.length) {
          await conn.query('ROLLBACK')
          return NextResponse.json(
            { ok: false, error: 'No proof uploaded for this order. Cannot verify payment.' },
            { status: 400 }
          )
        }

        await conn.query(
          `UPDATE payments
           SET status='verified', reference_no=COALESCE($1, reference_no)
           WHERE order_id=$2`,
          [referenceNo || null, orderId]
        )

        const { rows } = await conn.query(
          `UPDATE orders
           SET status='paid', payment_status='paid', updated_at=NOW()
           WHERE id=$1 RETURNING *`,
          [orderId]
        )

        if (!rows.length) {
          await conn.query('ROLLBACK')
          return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })
        }

        await conn.query('COMMIT')
        sendVerifyEmail(rows[0]).catch(console.error)

        // ── AUDIT ────────────────────────────────────────────────────────────
        logAudit({
          request,
          action:     'order.payment.verify',
          entityType: 'order',
          entityId:   String(orderId),
          payload:    {
            orderNumber:   rows[0].order_number || null,
            referenceNo:   referenceNo || null,
            customerEmail: rows[0].customer_email || null,
          },
        })

        return NextResponse.json({ ok: true })
      } catch (err) {
        await conn.query('ROLLBACK')
        throw err
      } finally {
        conn.release()
      }
    }

    // ── action: reject-payment ────────────────────────────────────────────────
    if (action === 'reject-payment') {
      const conn = await getClient()
      try {
        await conn.query('BEGIN')

        const { rows: proofRows } = await conn.query(
          `SELECT id FROM payments
           WHERE order_id=$1
             AND (proof_image_url IS NOT NULL OR reference_no IS NOT NULL)
           LIMIT 1`,
          [orderId]
        )
        if (!proofRows.length) {
          await conn.query('ROLLBACK')
          return NextResponse.json(
            { ok: false, error: 'No proof uploaded for this order. Nothing to reject.' },
            { status: 400 }
          )
        }

        await conn.query(
          `UPDATE payments SET status='rejected' WHERE order_id=$1`,
          [orderId]
        )

        const { rows } = await conn.query(
          `UPDATE orders
           SET status='placed', payment_status='unpaid', updated_at=NOW()
           WHERE id=$1 RETURNING *`,
          [orderId]
        )

        if (!rows.length) {
          await conn.query('ROLLBACK')
          return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })
        }

        await conn.query('COMMIT')
        sendRejectEmail(rows[0], reason).catch(console.error)

        // ── AUDIT ────────────────────────────────────────────────────────────
        logAudit({
          request,
          action:     'order.payment.reject',
          entityType: 'order',
          entityId:   String(orderId),
          payload:    {
            orderNumber:   rows[0].order_number || null,
            reason:        reason || null,
            customerEmail: rows[0].customer_email || null,
          },
        })

        return NextResponse.json({ ok: true })
      } catch (err) {
        await conn.query('ROLLBACK')
        throw err
      } finally {
        conn.release()
      }
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })

  } catch (err) {
    console.error('PATCH /api/admin/orders error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to update order' }, { status: 500 })
  }
}

// ── Email helpers ─────────────────────────────────────────────────────────────

async function getTransporter() {
  const nodemailer = (await import('nodemailer')).default
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })
}

async function sendStatusEmail(order, status, note = '') {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return
  const name = order.customer_name  || order.customerName  || 'there'
  const num  = order.order_number   || order.orderNumber
  const to   = order.customer_email || order.customerEmail
  if (!to) return

  const templates = {
    pending_payment: [`Awaiting payment — ${num}`, `Hi ${name},\n\nWe're waiting for your proof of payment for order ${num}.\n\nPlease upload within 24 hours to avoid cancellation.\n\nJCE Bridal Boutique`],
    paid:            [`Payment verified ✓ — ${num}`, `Hi ${name},\n\nYour payment for order ${num} has been verified. We'll now begin preparing your order.\n\nJCE Bridal Boutique`],
    processing:      [`Order being prepared — ${num}`, `Hi ${name},\n\nYour order ${num} is now being prepared.\n\nJCE Bridal Boutique`],
    ready:           [`Ready for pickup — ${num}`, `Hi ${name},\n\nYour order ${num} is ready! Please visit our store at your earliest convenience.\n\nStore hours: Mon–Sat 9AM–6PM\nAddress: 4I-19 Soler Wing 168 Mall Recto Mla, Manila\n\nJCE Bridal Boutique`],
    shipped:         [`Order on its way — ${num}`, `Hi ${name},\n\nOrder ${num} has been dispatched via Lalamove. You will receive it shortly.\n\nJCE Bridal Boutique`],
    completed:       [`Order completed — ${num}`, `Hi ${name},\n\nOrder ${num} is complete. We hope you love your gown!\n\nThank you for choosing JCE Bridal Boutique.\n\nWith love,\nJCE Bridal Boutique`],
    cancelled:       [`Order cancelled — ${num}`, `Hi ${name},\n\nYour order ${num} has been cancelled.${note ? `\n\nReason: ${note}` : ''}\n\nIf you have questions, please contact us.\n\nJCE Bridal Boutique`],
    refunded:        [`Refund processed — ${num}`, `Hi ${name},\n\nA refund for order ${num} has been processed. Please allow 7–14 business days for the amount to reflect.\n\nJCE Bridal Boutique`],
  }

  const tmpl = templates[status]
  if (!tmpl) return
  try {
    const t = await getTransporter()
    await t.sendMail({ from: `"JCE Bridal Boutique" <${process.env.GMAIL_USER}>`, to, subject: tmpl[0], text: tmpl[1] })
  } catch (e) { console.warn('Status email failed:', e.message) }
}

async function sendVerifyEmail(order) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return
  const name = order.customer_name  || order.customerName  || 'there'
  const num  = order.order_number   || order.orderNumber
  const to   = order.customer_email || order.customerEmail
  if (!to) return
  try {
    const t = await getTransporter()
    await t.sendMail({ from: `"JCE Bridal Boutique" <${process.env.GMAIL_USER}>`, to, subject: `Payment verified ✓ — ${num}`, text: `Hi ${name},\n\nYour payment for order ${num} has been verified. We'll now begin preparing your order.\n\nThank you,\nJCE Bridal Boutique` })
  } catch (e) { console.warn('Verify email failed:', e.message) }
}

async function sendRejectEmail(order, reason = '') {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return
  const name = order.customer_name  || order.customerName  || 'there'
  const num  = order.order_number   || order.orderNumber
  const to   = order.customer_email || order.customerEmail
  if (!to) return
  try {
    const t = await getTransporter()
    await t.sendMail({ from: `"JCE Bridal Boutique" <${process.env.GMAIL_USER}>`, to, subject: `Payment proof rejected — ${num}`, text: `Hi ${name},\n\nUnfortunately your payment proof for order ${num} was rejected.${reason ? `\n\nReason: ${reason}` : ''}\n\nPlease re-upload a clear screenshot of your payment confirmation.\n\nJCE Bridal Boutique` })
  } catch (e) { console.warn('Reject email failed:', e.message) }
}