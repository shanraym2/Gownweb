// lib/inventory.js
//
// Shared helpers for converting a soft stock reservation into a real sale,
// or releasing it back, without ever letting stock_qty and reserved_qty
// drift out of sync between the different places that can trigger each
// transition (PayMongo webhook, manual proof verification, expiry sweep).
//
// Both functions expect `conn` to be a client obtained from
// lib/db.js's getClient() — i.e. conn.query(...) resolves to { rows }.
// Callers are responsible for wrapping calls in BEGIN/COMMIT/ROLLBACK.

export async function convertReservationToSale(conn, orderId) {
  const { rows: items } = await conn.query(
    `SELECT gown_id, size_label, quantity FROM order_items WHERE order_id=$1`,
    [orderId]
  )

  for (const item of items) {
    if (!item.gown_id || !item.size_label) continue
    await conn.query(
      `UPDATE gown_inventory
       SET stock_qty    = stock_qty - $1,
           reserved_qty = GREATEST(0, reserved_qty - $1)
       WHERE gown_id = $2 AND size_label = $3`,
      [item.quantity, item.gown_id, item.size_label]
    )
  }
}

export async function sweepExpiredReservations(query, getClient) {
  // Two conditions, either one qualifies an order for auto-cancel:
  //  1. Its own reservation_expires_at has passed (qrph 20min, gcash/bdo 24hr)
  //  2. It never got a short expiry at all (cash) and has sat unpaid for 7 days
  // Either way: skip if proof has already been uploaded — that order is
  // awaiting staff review, not abandoned, and must not auto-cancel out
  // from under a pending verification.
  const expired = await query(
    `SELECT o.id FROM orders o
     LEFT JOIN payments p ON p.order_id = o.id
     WHERE o.status NOT IN ('cancelled', 'paid')
       AND o.payment_status IN ('unpaid', 'pending')
       AND COALESCE(p.proof_image_url, p.reference_no) IS NULL
       AND (
         (o.reservation_expires_at IS NOT NULL AND o.reservation_expires_at < NOW())
         OR (o.reservation_expires_at IS NULL AND o.placed_at < NOW() - INTERVAL '7 days')
       )`
  )

  for (const row of expired) {
    const conn = await getClient()
    try {
      await conn.query('BEGIN')
      await releaseReservation(conn, row.id)
      await conn.query(
        `UPDATE orders SET status='cancelled', reservation_expires_at=NULL, updated_at=NOW() WHERE id=$1`,
        [row.id]
      )
      await conn.query('COMMIT')
    } catch (err) {
      await conn.query('ROLLBACK')
      console.error('sweepExpiredReservations: failed for order', row.id, err)
      // Don't let one bad row stop the rest of the sweep.
    } finally {
      conn.release()
    }
  }
}

export async function releaseReservation(conn, orderId) {
  const { rows: items } = await conn.query(
    `SELECT gown_id, size_label, quantity FROM order_items WHERE order_id=$1`,
    [orderId]
  )

  for (const item of items) {
    if (!item.gown_id || !item.size_label) continue
    await conn.query(
      `UPDATE gown_inventory
       SET reserved_qty = GREATEST(0, reserved_qty - $1)
       WHERE gown_id = $2 AND size_label = $3`,
      [item.quantity, item.gown_id, item.size_label]
    )
  }
}