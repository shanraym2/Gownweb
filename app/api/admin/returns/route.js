// app/api/admin/returns/route.js
// Admin API for listing and resolving return/refund/exchange requests.

import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'
import { checkAdminAuth } from '@/lib/adminAuth'
import { logAudit }       from '@/lib/audit'

const USE_DB   = process.env.USE_DB === 'true'
const retFile  = path.join(process.cwd(), 'data', 'returns.json')
const ordFile  = path.join(process.cwd(), 'data', 'orders.json')

function loadReturns() {
  if (!fs.existsSync(retFile)) return []
  try { return JSON.parse(fs.readFileSync(retFile, 'utf8')) } catch { return [] }
}
function saveReturns(data) {
  fs.mkdirSync(path.dirname(retFile), { recursive: true })
  fs.writeFileSync(retFile, JSON.stringify(data, null, 2))
}
function loadOrders() {
  if (!fs.existsSync(ordFile)) return []
  try { return JSON.parse(fs.readFileSync(ordFile, 'utf8')) } catch { return [] }
}
function saveOrders(data) {
  fs.mkdirSync(path.dirname(ordFile), { recursive: true })
  fs.writeFileSync(ordFile, JSON.stringify(data, null, 2))
}

const VALID_ACTIONS = ['approve', 'reject', 'complete', 'cancel']

// ── GET /api/admin/returns ────────────────────────────────────────────────────

export async function GET(request) {
  if (!await checkAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const filterStatus = searchParams.get('status') || ''

  if (!USE_DB) {
    let returns = loadReturns()
    if (filterStatus) returns = returns.filter(r => r.status === filterStatus)
    returns = returns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    return NextResponse.json({ ok: true, returns })
  }

  try {
    const { query } = await import('@/lib/db')
    const rows = await query(`
      SELECT r.*,
             o.order_number,
             o.customer_name,
             o.customer_email,
             o.total,
             o.payment_method,
             o.delivery_method
      FROM   return_requests r
      JOIN   orders o ON o.id = r.order_id
      ${filterStatus ? 'WHERE r.status = $1' : ''}
      ORDER  BY r.created_at DESC
    `, filterStatus ? [filterStatus] : [])

    const returns = rows.map(r => ({
      id:             r.id,
      orderId:        r.order_id,
      orderNumber:    r.order_number,
      type:           r.request_type,
      reason:         r.reason,
      details:        r.details,
      items:          typeof r.items === 'string' ? JSON.parse(r.items) : (r.items || []),
      status:         r.status,
      adminNote:      r.admin_note    || null,
      refundAmount:   r.refund_amount != null ? Number(r.refund_amount) : null,
      customerName:   r.customer_name,
      customerEmail:  r.customer_email,
      orderTotal:     Number(r.total || 0),
      paymentMethod:  r.payment_method,
      deliveryMethod: r.delivery_method,
      createdAt:      r.created_at,
      resolvedAt:     r.resolved_at   || null,
    }))

    return NextResponse.json({ ok: true, returns })
  } catch (err) {
    console.error('GET /api/admin/returns error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to load returns' }, { status: 500 })
  }
}

// ── PATCH /api/admin/returns ──────────────────────────────────────────────────

export async function PATCH(request) {
  if (!await checkAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body
  try { body = await request.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 }) }

  const { returnId, action, adminNote, refundAmount } = body

  if (!returnId)
    return NextResponse.json({ ok: false, error: 'returnId required' }, { status: 400 })
  if (!action || !VALID_ACTIONS.includes(action))
    return NextResponse.json({ ok: false, error: 'Invalid action. Use: approve, reject, complete, or cancel.' }, { status: 400 })

  // ── JSON path ──────────────────────────────────────────────────────────────

  if (!USE_DB) {
    const all  = loadReturns()
    const idx  = all.findIndex(r => String(r.id) === String(returnId))
    if (idx === -1)
      return NextResponse.json({ ok: false, error: 'Return not found.' }, { status: 404 })

    const prev = { ...all[idx] }

    if (action === 'approve') {
      if (all[idx].status !== 'pending')
        return NextResponse.json({ ok: false, error: 'Only pending requests can be approved.' }, { status: 400 })
      all[idx].status     = 'approved'
      all[idx].adminNote  = adminNote?.trim() || null
      all[idx].resolvedAt = new Date().toISOString()
    }

    if (action === 'reject') {
      if (!['pending', 'approved'].includes(all[idx].status))
        return NextResponse.json({ ok: false, error: 'Request cannot be rejected in its current state.' }, { status: 400 })
      all[idx].status     = 'rejected'
      all[idx].adminNote  = adminNote?.trim() || null
      all[idx].resolvedAt = new Date().toISOString()
    }

    if (action === 'complete') {
      if (all[idx].status !== 'approved')
        return NextResponse.json({ ok: false, error: 'Only approved requests can be completed.' }, { status: 400 })
      all[idx].status       = 'completed'
      all[idx].adminNote    = adminNote?.trim() || null
      all[idx].refundAmount = refundAmount != null ? Number(refundAmount) : null
      all[idx].resolvedAt   = new Date().toISOString()

      // Mark parent order as refunded for return/refund types
      if (['return', 'refund'].includes(all[idx].type)) {
        const orders = loadOrders()
        const oIdx   = orders.findIndex(o => String(o.id) === String(all[idx].orderId))
        if (oIdx !== -1) {
          orders[oIdx].status    = 'refunded'
          orders[oIdx].updatedAt = new Date().toISOString()
          saveOrders(orders)
        }
      }
    }

    if (action === 'cancel') {
      if (!['pending', 'approved'].includes(all[idx].status))
        return NextResponse.json({ ok: false, error: 'Only pending/approved requests can be cancelled.' }, { status: 400 })
      all[idx].status     = 'cancelled'
      all[idx].adminNote  = adminNote?.trim() || null
      all[idx].resolvedAt = new Date().toISOString()
    }

    saveReturns(all)
    sendReturnStatusEmail(all[idx]).catch(console.error)

    logAudit({
      request,
      action:     `return.${action}`,
      entityType: 'return',
      entityId:   String(returnId),
      payload: {
        orderNumber:  all[idx].orderNumber || null,
        type:         all[idx].type,
        from:         prev.status,
        to:           all[idx].status,
        adminNote:    adminNote || null,
        refundAmount: refundAmount || null,
      },
    })

    return NextResponse.json({ ok: true, return: all[idx] })
  }

  // ── DB path ────────────────────────────────────────────────────────────────

  try {
    const { query, getClient } = await import('@/lib/db')

    const prevRows = await query(`SELECT * FROM return_requests WHERE id=$1 LIMIT 1`, [returnId])
    if (!prevRows.length)
      return NextResponse.json({ ok: false, error: 'Return not found.' }, { status: 404 })
    const prev = prevRows[0]

    if (action === 'approve' && prev.status !== 'pending')
      return NextResponse.json({ ok: false, error: 'Only pending requests can be approved.' }, { status: 400 })
    if (action === 'reject' && !['pending', 'approved'].includes(prev.status))
      return NextResponse.json({ ok: false, error: 'Request cannot be rejected in its current state.' }, { status: 400 })
    if (action === 'complete' && prev.status !== 'approved')
      return NextResponse.json({ ok: false, error: 'Only approved requests can be completed.' }, { status: 400 })
    if (action === 'cancel' && !['pending', 'approved'].includes(prev.status))
      return NextResponse.json({ ok: false, error: 'Only pending/approved requests can be cancelled.' }, { status: 400 })

    const STATUS_MAP = { approve: 'approved', reject: 'rejected', complete: 'completed', cancel: 'cancelled' }
    const newStatus  = STATUS_MAP[action]

    if (action === 'complete' && ['return', 'refund'].includes(prev.request_type)) {
      const conn = await getClient()
      try {
        await conn.query('BEGIN')
        await conn.query(
          `UPDATE return_requests
           SET status=$1, admin_note=$2, refund_amount=$3, resolved_at=NOW()
           WHERE id=$4`,
          [newStatus, adminNote?.trim() || null, refundAmount ?? null, returnId]
        )
        await conn.query(
          `UPDATE orders SET status='refunded', updated_at=NOW() WHERE id=$1`,
          [prev.order_id]
        )
        await conn.query('COMMIT')
      } catch (err) {
        await conn.query('ROLLBACK')
        throw err
      } finally {
        conn.release()
      }
    } else {
      await query(
        `UPDATE return_requests
         SET status=$1, admin_note=$2, resolved_at=NOW()
         WHERE id=$3`,
        [newStatus, adminNote?.trim() || null, returnId]
      )
    }

    const updatedRows = await query(`SELECT * FROM return_requests WHERE id=$1 LIMIT 1`, [returnId])
    const updated     = updatedRows[0]

    sendReturnStatusEmail(updated).catch(console.error)

    logAudit({
      request,
      action:     `return.${action}`,
      entityType: 'return',
      entityId:   String(returnId),
      payload: {
        orderNumber:  updated.order_number || null,
        type:         updated.request_type,
        from:         prev.status,
        to:           newStatus,
        adminNote:    adminNote || null,
        refundAmount: refundAmount || null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/admin/returns error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to update return.' }, { status: 500 })
  }
}

// ── Email helper ──────────────────────────────────────────────────────────────

async function sendReturnStatusEmail(ret) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return
  const email = ret.customer_email || ret.customerEmail
  if (!email) return

  const num  = ret.order_number || ret.orderNumber || 'your order'
  const name = ret.customer_name || ret.customerName || 'there'
  const type = ret.request_type  || ret.type

  const templates = {
    approved: {
      subject: `${type.charAt(0).toUpperCase() + type.slice(1)} request approved — ${num}`,
      body: `Hi ${name},

Your ${type} request for order ${num} has been approved.

${ret.admin_note || ret.adminNote ? `Note from our team: ${ret.admin_note || ret.adminNote}\n\n` : ''}Next steps:
• Please bring the item(s) to our store in unworn, original condition with tags attached.
• Store hours: Mon–Sat 9AM–6PM
• Address: 4I-19 Soler Wing 168 Mall Recto Mla, Manila

Thank you,
JCE Bridal Boutique`,
    },
    rejected: {
      subject: `${type.charAt(0).toUpperCase() + type.slice(1)} request update — ${num}`,
      body: `Hi ${name},

Unfortunately we are unable to process your ${type} request for order ${num}.

${ret.admin_note || ret.adminNote ? `Reason: ${ret.admin_note || ret.adminNote}\n\n` : ''}If you need further assistance, please contact us directly.

Thank you for your understanding,
JCE Bridal Boutique`,
    },
    completed: {
      subject: `${type.charAt(0).toUpperCase() + type.slice(1)} processed — ${num}`,
      body: `Hi ${name},

We have completed processing your ${type} request for order ${num}.

${ret.refund_amount || ret.refundAmount
  ? `Refund amount: ₱${Number(ret.refund_amount || ret.refundAmount).toLocaleString('en-PH')}\n`
  : ''}Refunds will reflect within 7–14 business days via your original payment method.

${ret.admin_note || ret.adminNote ? `Note: ${ret.admin_note || ret.adminNote}\n\n` : ''}Thank you for shopping with JCE Bridal Boutique.

With love,
JCE Bridal Boutique`,
    },
  }

  const tmpl = templates[ret.status]
  if (!tmpl) return

  try {
    const { default: nodemailer } = await import('nodemailer')
    const t = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    })
    await t.sendMail({
      from:    `"JCE Bridal Boutique" <${process.env.GMAIL_USER}>`,
      to:      email,
      subject: tmpl.subject,
      text:    tmpl.body,
    })
  } catch (e) {
    console.warn('Return status email failed:', e.message)
  }
}