import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'

const USE_DB   = process.env.USE_DB === 'true'
const dataFile = path.join(process.cwd(), 'data', 'orders.json')

function loadJson() {
  if (!fs.existsSync(dataFile)) return []
  return JSON.parse(fs.readFileSync(dataFile, 'utf8'))
}

function saveJson(orders) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true })
  fs.writeFileSync(dataFile, JSON.stringify(orders, null, 2))
}

function parsePriceAmount(priceStr) {
  if (priceStr == null) return 0
  const n = parseFloat(String(priceStr).replace(/[^\d.]/g, ''))
  return isNaN(n) ? 0 : n
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { contact, delivery, payment, items, note,
            subtotal, shippingFee, taxes, total } = body

    if (!contact?.email || !items?.length) {
      return NextResponse.json(
        { ok: false, error: 'Contact and items are required' },
        { status: 400 }
      )
    }

    // ── JSON mode ────────────────────────────────────────────────────────────
    if (!USE_DB) {
      const newOrder = {
        id:        String(Date.now()),
        status:    'placed',
        contact: {
          email:     String(contact.email       || '').trim(),
          firstName: String(contact.firstName   || '').trim(),
          lastName:  String(contact.lastName    || '').trim(),
          phone:     String(contact.phone       || '').trim(),
        },
        delivery: {
          address:  String(delivery?.address  || '').trim(),
          city:     String(delivery?.city     || '').trim(),
          province: String(delivery?.province || '').trim(),
          zip:      String(delivery?.zip      || '').trim(),
        },
        payment:     String(payment || 'gcash'),
        items:       items.map(i => ({
          id:       i.id,
          name:     String(i.name     || '').trim(),
          qty:      Number(i.qty)     || 1,
          price:    i.price,
          subtotal: Number(i.subtotal)|| 0,
        })),
        note:        String(note        || '').trim(),
        subtotal:    Number(subtotal)   || 0,
        shippingFee: Number(shippingFee)|| 0,
        taxes:       Number(taxes)      || 0,
        total:       Number(total)      || 0,
        createdAt:   new Date().toISOString(),
      }

      const orders = loadJson()
      saveJson([newOrder, ...orders])

      return NextResponse.json({
        ok: true,
        orderId:     newOrder.id,
        orderNumber: newOrder.id,
      })
    }

    // ── DB mode ───────────────────────────────────────────────────────────────
    const { default: pool } = await import('@/lib/db')

    const contactEmail    = String(contact.email       || '').trim().toLowerCase()
    const contactName     = `${String(contact.firstName || '').trim()} ${String(contact.lastName || '').trim()}`.trim()
    const contactPhone    = String(contact.phone        || '').trim()
    const paymentMethod   = ['gcash','bdo','cash'].includes(payment) ? payment : 'gcash'
    const noteText        = String(note                 || '').trim()
    const subtotalNum     = Number(subtotal)            || 0
    const shippingNum     = Number(shippingFee)         || 0
    const totalNum        = Number(total)               || subtotalNum + shippingNum

    const datePart    = new Date().toISOString().slice(0,10).replace(/-/g,'')
    const orderNumber = `JCE-${datePart}-${Date.now().toString().slice(-4)}`

    const client = await pool.connect()
    let orderId

    try {
      await client.query('BEGIN')

      const orderResult = await client.query(
        `INSERT INTO orders
           (order_number, customer_email, customer_name, customer_phone,
            payment_method, status, payment_status,
            subtotal, shipping_fee, total, notes)
         VALUES ($1,$2,$3,$4,$5,'placed','unpaid',$6,$7,$8,$9)
         RETURNING id`,
        [orderNumber, contactEmail, contactName, contactPhone,
         paymentMethod, subtotalNum, shippingNum, totalNum, noteText]
      )

      orderId = orderResult.rows[0].id

      // Save delivery address
      if (delivery?.address) {
        const userResult = await client.query(
          `SELECT id FROM users WHERE email = $1 LIMIT 1`,
          [contactEmail]
        )
        const userId = userResult.rows[0]?.id || null

        await client.query(
          `INSERT INTO user_addresses
             (user_id, recipient_name, line1, city, province, postal_code, country, phone)
           VALUES ($1,$2,$3,$4,$5,$6,'PH',$7)`,
          [userId, contactName,
           String(delivery.address  || '').trim(),
           String(delivery.city     || '').trim(),
           String(delivery.province || '').trim(),
           String(delivery.zip      || '').trim(),
           contactPhone]
        )
      }

      // Save order items
      for (const item of items) {
        const unitPrice = Number(item.unitPrice || parsePriceAmount(item.price)) || 0
        const qty       = Math.max(1, parseInt(item.qty, 10) || 1)
        const lineTotal = Number(item.subtotal) || unitPrice * qty

        await client.query(
          `INSERT INTO order_items
             (order_id, gown_id, gown_name, size_label, quantity, unit_price, line_total)
           VALUES ($1,$2,$3,NULL,$4,$5,$6)`,
          [orderId, item.id || null, String(item.name || '').trim(),
           qty, unitPrice, lineTotal]
        )
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    return NextResponse.json({ ok: true, orderId, orderNumber })

  } catch (err) {
    console.error('Orders POST error:', err)
    return NextResponse.json(
      { ok: false, error: 'Failed to save order' },
      { status: 500 }
    )
  }
}