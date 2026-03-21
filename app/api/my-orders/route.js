import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

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

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
}

function formatOrderSummary(order) {
  const items = order.items || []
  return {
    id: order.id,
    createdAt: order.createdAt,
    status: order.status || 'placed',
    payment: order.payment,
    subtotal: order.subtotal,
    contact: order.contact || {},
    delivery: order.delivery || {},
    note: order.note || '',
    items,
  }
}

/**
 * GET /api/my-orders
 * Header: X-Customer-Email
 */
export async function GET(request) {
  const email = normalizeEmail(request.headers.get('x-customer-email'))
  if (!email) {
    return NextResponse.json({ ok: false, error: 'Sign in required' }, { status: 401 })
  }

  const orders = loadOrdersFromFile()
  const mine = orders
    .filter((o) => normalizeEmail(o?.contact?.email) === email)
    .sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime())
    .map(formatOrderSummary)

  return NextResponse.json({ ok: true, orders: mine })
}

