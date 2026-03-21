import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getConnection } from '@/lib/db'

const ORDER_STATUSES = ['placed', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled']

function normalizeStatus(status) {
  const v = String(status || '').toLowerCase()
  return ORDER_STATUSES.includes(v) ? v : 'placed'
}

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
  writeFileSync(getOrdersPath(), JSON.stringify(orders, null, 2), 'utf8')
}

function requireAdmin(request) {
  const secret = request.headers.get('x-admin-secret') || ''
  const adminSecret = process.env.ADMIN_SECRET || ''
  return !!adminSecret && secret === adminSecret
}

export async function GET(request) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const orders = loadOrdersFromFile().map((o) => ({
    ...o,
    status: normalizeStatus(o.status),
  }))

  return NextResponse.json({ ok: true, orders })
}

export async function PATCH(request) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const orderId = body?.id != null ? String(body.id).trim() : ''
  const status = normalizeStatus(body?.status)

  if (!orderId) {
    return NextResponse.json({ ok: false, error: 'Order id is required' }, { status: 400 })
  }

  const orders = loadOrdersFromFile()
  const idx = orders.findIndex((o) => String(o.id) === orderId)
  if (idx === -1) {
    return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })
  }

  orders[idx] = { ...orders[idx], status }
  saveOrdersToFile(orders)

  // Optional: also update MySQL if a `status` column exists.
  if (process.env.DATABASE_URL) {
    try {
      const conn = await getConnection()
      try {
        await conn.execute('UPDATE orders SET status = ? WHERE id = ?', [status, orderId])
      } finally {
        conn.release()
      }
    } catch (err) {
      console.error('DB orders PATCH error:', err)
    }
  }

  return NextResponse.json({ ok: true, order: orders[idx] })
}
