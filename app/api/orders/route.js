import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

function getOrdersPath() {
  return join(process.cwd(), 'data', 'orders.json')
}

function loadOrders() {
  const path = getOrdersPath()
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
}

function saveOrders(orders) {
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
    const orders = loadOrders()
    const order = {
      id: Date.now().toString(),
      contact: { email: contact.email, firstName: contact.firstName, lastName: contact.lastName, phone: contact.phone },
      delivery: delivery || {},
      payment: payment || 'gcash',
      items: items || [],
      note: note || '',
      subtotal: subtotal || 0,
      createdAt: createdAt || new Date().toISOString(),
    }
    orders.push(order)
    saveOrders(orders)
    return NextResponse.json({ ok: true, orderId: order.id })
  } catch (err) {
    console.error('Orders POST error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to save order' }, { status: 500 })
  }
}
