import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { query, getConnection } from '@/lib/db'

function getOrdersPath() {
  return join(process.cwd(), 'data', 'orders.json')
}

function loadOrdersFromFile() {
  const path = getOrdersPath()
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
}

function saveOrdersToFile(orders) {
  const dir = join(process.cwd(), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = getOrdersPath()
  writeFileSync(path, JSON.stringify(orders, null, 2), 'utf8')
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { contact, delivery, payment, items, note, subtotal, createdAt } = body
    if (!contact?.email || !items?.length) {
      return NextResponse.json(
        { ok: false, error: 'Contact and items are required' },
        { status: 400 }
      )
    }

    const orderId = Date.now().toString()
    const contactEmail = String(contact.email || '').trim()
    const contactFirstName = String(contact.firstName || '').trim()
    const contactLastName = String(contact.lastName || '').trim()
    const contactPhone = String(contact.phone || '').trim()
    const deliveryAddress = String((delivery && delivery.address) || '').trim()
    const deliveryCity = String((delivery && delivery.city) || '').trim()
    const deliveryProvince = String((delivery && delivery.province) || '').trim()
    const deliveryZip = String((delivery && delivery.zip) || '').trim()
    const paymentMethod = String(payment || 'gcash').trim()
    const noteText = String(note || '').trim()
    const subtotalNum = Number(subtotal) || 0

    const order = {
      id: orderId,
      contact: { email: contactEmail, firstName: contactFirstName, lastName: contactLastName, phone: contactPhone },
      delivery: { address: deliveryAddress, city: deliveryCity, province: deliveryProvince, zip: deliveryZip },
      payment: paymentMethod,
      items: items || [],
      note: noteText,
      subtotal: subtotalNum,
      createdAt: new Date().toISOString(),
    }
    const orders = loadOrdersFromFile()
    orders.push(order)
    saveOrdersToFile(orders)

    if (process.env.DATABASE_URL) {
      try {
        const conn = await getConnection()
        try {
          await conn.beginTransaction()
          await conn.execute(
            `INSERT INTO orders (id, contact_email, contact_first_name, contact_last_name, contact_phone,
             delivery_address, delivery_city, delivery_province, delivery_zip, payment_method, note, subtotal)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              orderId,
              contactEmail,
              contactFirstName,
              contactLastName,
              contactPhone,
              deliveryAddress,
              deliveryCity,
              deliveryProvince,
              deliveryZip,
              paymentMethod,
              noteText,
              subtotalNum,
            ]
          )
          for (const item of items) {
            const gownId = Number(item.id)
            const itemName = String(item.name || '').trim()
            const qty = Math.max(1, parseInt(item.qty, 10) || 1)
            const itemPrice = String(item.price || '').trim()
            const itemSubtotal = Number(item.subtotal) || 0
            await conn.execute(
              `INSERT INTO order_items (order_id, gown_id, name, qty, price, subtotal)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [orderId, gownId, itemName, qty, itemPrice, itemSubtotal]
            )
          }
          await conn.commit()
        } catch (err) {
          await conn.rollback()
          throw err
        } finally {
          conn.release()
        }
      } catch (err) {
        console.error('DB orders POST error:', err)
      }
    }
    return NextResponse.json({ ok: true, orderId })
  } catch (err) {
    console.error('Orders POST error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to save order' }, { status: 500 })
  }
}
