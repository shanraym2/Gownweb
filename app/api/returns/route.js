// app/api/returns/route.js
// Changes vs original:
//   POST — accepts optional `evidenceUrls` array and persists it on the record
//   GET  — returns `evidenceUrls` field so the customer can see what they uploaded

import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'
import { getAuthenticatedUser } from '@/lib/auth'

const USE_DB   = process.env.USE_DB === 'true'
const DATA_DIR = path.join(process.cwd(), 'data')
const dataFile = path.join(DATA_DIR, 'orders.json')
const retFile  = path.join(DATA_DIR, 'returns.json')

const RETURN_WINDOW_HOURS = 48
const VALID_TYPES = ['return', 'exchange', 'refund']

const VALID_REASONS = [
  'Item is defective or damaged',
  'Item differs significantly from description',
  'Wrong size received',
  'Wrong item received',
  'Other',
]

function loadOrders() {
  if (!fs.existsSync(dataFile)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}
function loadReturns() {
  if (!fs.existsSync(retFile)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(retFile, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}
function saveReturns(data) {
  fs.mkdirSync(path.dirname(retFile), { recursive: true })
  fs.writeFileSync(retFile, JSON.stringify(data, null, 2))
}

function isWithinReturnWindow(order) {
  const baseDate = order.updatedAt || order.updated_at || order.placedAt || order.placed_at
  if (!baseDate) return false
  const elapsed = (Date.now() - new Date(baseDate).getTime()) / 3600000
  return elapsed <= RETURN_WINDOW_HOURS
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request) {
  const sessionUser = await getAuthenticatedUser(request)
  if (!sessionUser)
    return NextResponse.json({ ok: false, error: 'Sign in required' }, { status: 401 })
  const userId = sessionUser.id

  if (!USE_DB) {
    const returns = loadReturns()
      .filter(r => String(r.userId) === String(userId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    return NextResponse.json({ ok: true, returns })
  }

  try {
    const { query } = await import('@/lib/db')
    const rows = await query(`
      SELECT r.*, o.order_number
      FROM   return_requests r
      JOIN   orders o ON o.id = r.order_id
      WHERE  o.user_id = $1
      ORDER  BY r.created_at DESC
    `, [userId])

    const returns = rows.map(r => ({
      id:           r.id,
      orderId:      r.order_id,
      orderNumber:  r.order_number,
      type:         r.request_type,
      reason:       r.reason,
      details:      r.details,
      status:       r.status,
      adminNote:    r.admin_note    || null,
      refundAmount: r.refund_amount != null ? Number(r.refund_amount) : null,
      evidenceUrls: typeof r.evidence_urls === 'string'
        ? JSON.parse(r.evidence_urls)
        : (r.evidence_urls || []),
      createdAt:    r.created_at,
      resolvedAt:   r.resolved_at   || null,
    }))

    return NextResponse.json({ ok: true, returns })
  } catch (err) {
    console.error('GET /api/returns error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch returns' }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request) {
  console.log('[returns POST] cwd:', process.cwd(), '| retFile:', retFile)
  const sessionUser = await getAuthenticatedUser(request)
  if (!sessionUser)
    return NextResponse.json({ ok: false, error: 'Sign in required' }, { status: 401 })
  const userId = sessionUser.id

  let body
  try { body = await request.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 }) }

  const { orderId, type, reason, details, items, evidenceUrls } = body

  if (!orderId)
    return NextResponse.json({ ok: false, error: 'orderId required' }, { status: 400 })
  if (!type || !VALID_TYPES.includes(type))
    return NextResponse.json({ ok: false, error: 'Invalid request type. Must be: return, exchange, or refund.' }, { status: 400 })
  if (!reason || !VALID_REASONS.includes(reason))
    return NextResponse.json({ ok: false, error: 'Please select a valid reason.' }, { status: 400 })
  if (!items?.length)
    return NextResponse.json({ ok: false, error: 'Select at least one item.' }, { status: 400 })

  const cleanDetails      = (details || '').trim().slice(0, 500)
  // evidenceUrls is an array of { url, name, type } objects from /api/returns/upload
  const cleanEvidenceUrls = Array.isArray(evidenceUrls)
    ? evidenceUrls.slice(0, 5).filter(f => f?.url)
    : []

  // ── JSON path ──────────────────────────────────────────────────────────────

  if (!USE_DB) {
    const orders = loadOrders()
    const order  = orders.find(o => String(o.id) === String(orderId))

    if (!order)
      return NextResponse.json({ ok: false, error: 'Order not found.' }, { status: 404 })
    if (String(order.userId) !== String(userId))
      return NextResponse.json({ ok: false, error: 'Access denied.' }, { status: 403 })
    if (order.status !== 'completed')
      return NextResponse.json({ ok: false, error: 'Only completed orders can be returned.' }, { status: 400 })
    if (!isWithinReturnWindow(order))
      return NextResponse.json({
        ok: false,
        error: `Return window has closed. Requests must be submitted within ${RETURN_WINDOW_HOURS} hours of order completion.`,
        windowClosed: true,
      }, { status: 400 })

    const existing = loadReturns()
    const dupe = existing.find(
      r => String(r.orderId) === String(orderId) && !['rejected', 'cancelled'].includes(r.status)
    )
    if (dupe)
      return NextResponse.json({ ok: false, error: 'A return request for this order is already open.' }, { status: 409 })

    const newReturn = {
      id:            Date.now(),
      userId:        String(userId),
      orderId:       String(orderId),
      orderNumber:   order.orderNumber || order.order_number || '',
      type,
      reason,
      details:       cleanDetails,
      items:         items || [],
      evidenceUrls:  cleanEvidenceUrls,
      status:        'pending',
      adminNote:     null,
      refundAmount:  null,
      createdAt:     new Date().toISOString(),
      resolvedAt:    null,
      // snapshot for admin display
      customerName:  order.customerName  || order.customer_name  || '',
      customerEmail: order.customerEmail || order.customer_email || '',
      orderTotal:    Number(order.total  || 0),
      paymentMethod: order.paymentMethod || order.payment_method || '',
    }
    saveReturns([newReturn, ...existing])
    sendConfirmationEmail(newReturn, order).catch(console.error)
    return NextResponse.json({ ok: true, returnId: newReturn.id })
  }

  // ── DB path ────────────────────────────────────────────────────────────────

  try {
    const { query } = await import('@/lib/db')

    const orderRows = await query(
      `SELECT * FROM orders WHERE id=$1 AND user_id=$2 LIMIT 1`,
      [orderId, userId]
    )
    if (!orderRows.length)
      return NextResponse.json({ ok: false, error: 'Order not found.' }, { status: 404 })

    const order = orderRows[0]

    if (order.status !== 'completed')
      return NextResponse.json({ ok: false, error: 'Only completed orders can be returned.' }, { status: 400 })
    if (!isWithinReturnWindow(order))
      return NextResponse.json({
        ok: false,
        error: `Return window has closed. Requests must be submitted within ${RETURN_WINDOW_HOURS} hours of order completion.`,
        windowClosed: true,
      }, { status: 400 })

    const dupeRows = await query(
      `SELECT id FROM return_requests
       WHERE  order_id=$1 AND status NOT IN ('rejected','cancelled')
       LIMIT  1`,
      [orderId]
    )
    if (dupeRows.length)
      return NextResponse.json({ ok: false, error: 'A return request for this order is already open.' }, { status: 409 })

    // Rebuild the items payload from the real order — never trust
    // gownName/quantity as submitted by the client, since an attacker
    // could fabricate items never actually purchased on this order.
    const realItemRows = await query(
      `SELECT gown_id, gown_name, size_label, quantity FROM order_items WHERE order_id = $1`,
      [orderId]
    )
    const realByGownId = new Map(realItemRows.map(i => [String(i.gown_id), i]))

    const validatedItems = (items || [])
      .filter(i => realByGownId.has(String(i.gownId)))
      .map(i => {
        const real = realByGownId.get(String(i.gownId))
        return {
          gownId: real.gown_id,
          gownName: real.gown_name,
          sizeLabel: real.size_label,
          quantity: Math.min(Number(i.quantity) || 1, real.quantity),
        }
      })

    if (validatedItems.length === 0)
      return NextResponse.json({ ok: false, error: 'Selected items do not match this order.' }, { status: 400 })

    const result = await query(`
      INSERT INTO return_requests
        (order_id, request_type, reason, details, items, evidence_urls, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING id
    `, [
      orderId,
      type,
      reason,
      cleanDetails,
      JSON.stringify(validatedItems),
      JSON.stringify(cleanEvidenceUrls),
    ])

    sendConfirmationEmail(
      {
        ...order,
        orderNumber:   order.order_number,
        customerEmail: order.customer_email,
        customerName:  order.customer_name,
        type,
        reason,
        details:       cleanDetails,
        items:         validatedItems,
        evidenceUrls:  cleanEvidenceUrls,
      },
      order
    ).catch(console.error)

    return NextResponse.json({ ok: true, returnId: result[0].id })
  } catch (err) {
    console.error('POST /api/returns error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to submit return request.' }, { status: 500 })
  }
}

// ── Email ─────────────────────────────────────────────────────────────────────

async function sendConfirmationEmail(ret, order) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return
  const email = ret.customerEmail || order?.customer_email
  if (!email) return
  const name    = ret.customerName || order?.customer_name || 'there'
  const num     = ret.orderNumber  || order?.order_number  || ''
  const label   = { return: 'Return', refund: 'Refund', exchange: 'Exchange' }[ret.type] || ret.type
  const hasEvidence = (ret.evidenceUrls || []).length > 0
  try {
    const { default: nodemailer } = await import('nodemailer')
    const t = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    })
    await t.sendMail({
      from:    `"JCE Bridal Boutique" <${process.env.GMAIL_USER}>`,
      to:      email,
      subject: `${label} request received — ${num}`,
      text: `Hi ${name},

We've received your ${label.toLowerCase()} request for order ${num}.

Reason: ${ret.reason}
${ret.details ? `Details: ${ret.details}\n` : ''}
Items:
${(ret.items || []).map(i => `  • ${i.gownName}${i.sizeLabel ? ` (${i.sizeLabel})` : ''} ×${i.quantity || 1}`).join('\n')}
${hasEvidence ? `\nEvidence attached: ${(ret.evidenceUrls || []).length} file(s) submitted.\n` : ''}
Our team will review your request within 1–2 business days and notify you by email.

Policy reminder:
• Returns accepted within 48 hours of order completion only
• Items must be unworn, unaltered, and in original condition with tags attached
• Refunds processed within 7–14 business days via original payment method

Thank you,
JCE Bridal Boutique`.trim(),
    })
  } catch (e) {
    console.warn('Return confirmation email failed:', e.message)
  }
}