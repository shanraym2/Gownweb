import { NextResponse } from 'next/server'
import { query, getClient } from '@/lib/db'
import { verifyWebhookSignature } from '@/lib/paymongo'
import { convertReservationToSale } from '@/lib/inventory'

export async function POST(request) {
  const rawBody   = await request.text()
  const signature = request.headers.get('paymongo-signature')

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn('PayMongo webhook: invalid signature')
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 })
  }

  let event
  try { event = JSON.parse(rawBody) }
  catch { return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 }) }

  const eventType  = event?.data?.attributes?.type
  const paymentObj = event?.data?.attributes?.data
  const intentId   = paymentObj?.attributes?.payment_intent_id

  if (!intentId)
    return NextResponse.json({ ok: true }) // nothing to do, ack anyway

  // Idempotency: look up the order purely by the intent ID we stored at creation time
  const paymentRows = await query(
    `SELECT order_id, status FROM payments WHERE paymongo_intent_id=$1`,
    [intentId]
  )
  if (!paymentRows.length) return NextResponse.json({ ok: true })
  if (paymentRows[0].status === 'verified') return NextResponse.json({ ok: true }) // already processed

  const orderId = paymentRows[0].order_id

  const conn = await getClient()
  try {
    await conn.query('BEGIN')

    if (eventType === 'payment_intent.payment.paid' || eventType === 'payment.paid') {
      await conn.query(
        `UPDATE payments SET status='verified', paid_at=NOW() WHERE order_id=$1 AND paymongo_intent_id=$2`,
        [orderId, intentId]
      )
      await conn.query(
        `UPDATE orders SET payment_status='paid', status='paid',
                           reservation_expires_at=NULL, updated_at=NOW()
         WHERE id=$1`,
        [orderId]
      )
      await convertReservationToSale(conn, orderId)
      await conn.query(
        `INSERT INTO order_status_log (order_id, status, note) VALUES ($1, 'paid', 'Confirmed via PayMongo QR Ph')`,
        [orderId]
      )
    } else if (eventType === 'payment_intent.payment.failed' || eventType === 'payment.failed') {
      await conn.query(
        `UPDATE payments SET status='rejected' WHERE order_id=$1 AND paymongo_intent_id=$2`,
        [orderId, intentId]
      )
      await conn.query(
        `UPDATE orders SET payment_status='failed', updated_at=NOW() WHERE id=$1`,
        [orderId]
      )
      // Reservation is intentionally left in place here — a failed QR
      // attempt falls through to "pay another way" (GCash/BDO) on the
      // same order, not a cancelled one. See lib/inventory.js.
    }

    await conn.query('COMMIT')
  } catch (err) {
    await conn.query('ROLLBACK')
    console.error('PayMongo webhook processing error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  } finally {
    conn.release()
  }

  return NextResponse.json({ ok: true })
}