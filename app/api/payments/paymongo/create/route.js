import { NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { query } from '@/lib/db'
import { createQrPhIntent } from '@/lib/paymongo'

export async function POST(request) {
  const sessionUser = await getAuthenticatedUser(request)
  if (!sessionUser)
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })

  let body
  try { body = await request.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 }) }

  const { orderId } = body
  if (!orderId)
    return NextResponse.json({ ok: false, error: 'orderId required' }, { status: 400 })

  const orders = await query(
    `SELECT id, user_id, total, payment_method, payment_status FROM orders WHERE id=$1`,
    [orderId]
  )
  if (!orders.length)
    return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

  const order = orders[0]
  if (String(order.user_id) !== String(sessionUser.id))
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 403 })
  if (order.payment_method !== 'qrph')
    return NextResponse.json({ ok: false, error: 'Order is not set up for QR Ph' }, { status: 400 })
  if (order.payment_status === 'paid')
    return NextResponse.json({ ok: false, error: 'Order already paid' }, { status: 400 })

  try {
    const { intentId, qrImageUrl, status } = await createQrPhIntent({
      amountPesos: Number(order.total),
      orderId: order.id,
    })

    await query(
      // Fallback ceiling only — the qrph.expired webhook (see
      // app/api/webhooks/paymongo/route.js) is the authoritative signal and
      // will sync this to NOW() the moment PayMongo actually expires the
      // code. 30 minutes matches PayMongo's observed real QR Ph expiry
      // window, so this fallback shouldn't fire before the real webhook
      // does under normal conditions — it only matters if that webhook is
      // ever delayed or missed.
      `INSERT INTO payments (order_id, method, amount, status, paymongo_intent_id, paymongo_qr_image_url, paymongo_expires_at)
       VALUES ($1, 'qrph', $2, 'pending', $3, $4, NOW() + INTERVAL '30 minutes')
       ON CONFLICT (order_id) DO UPDATE
         SET paymongo_intent_id=$3, paymongo_qr_image_url=$4,
             paymongo_expires_at=NOW() + INTERVAL '30 minutes', status='pending'`,
      [orderId, order.total, intentId, qrImageUrl]
    )

    return NextResponse.json({ ok: true, qrImageUrl, intentId, status })
  } catch (err) {
    console.error('POST /api/payments/paymongo/create error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to create QR Ph payment' }, { status: 500 })
  }
}

// Lets the frontend poll while waiting for the webhook
export async function GET(request) {
  const sessionUser = await getAuthenticatedUser(request)
  if (!sessionUser)
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })

  const orderId = new URL(request.url).searchParams.get('orderId')
  if (!orderId)
    return NextResponse.json({ ok: false, error: 'orderId required' }, { status: 400 })

  const rows = await query(
    `SELECT o.payment_status, o.status, p.paymongo_qr_image_url, p.paymongo_expires_at
     FROM orders o LEFT JOIN payments p ON p.order_id = o.id
     WHERE o.id=$1 AND o.user_id=$2`,
    [orderId, sessionUser.id]
  )
  if (!rows.length)
    return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

  const expired = rows[0].paymongo_expires_at && new Date(rows[0].paymongo_expires_at) < new Date()

  return NextResponse.json({
    ok: true,
    paymentStatus: rows[0].payment_status,
    orderStatus:   rows[0].status,
    qrImageUrl:    rows[0].paymongo_qr_image_url || null,
    expired: !!expired && rows[0].payment_status === 'pending',
  })
}