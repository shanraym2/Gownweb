import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
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

export async function GET(request) {
  const secret = request.headers.get('x-admin-secret') || ''
  const adminSecret = process.env.ADMIN_SECRET || ''
  if (!adminSecret || secret !== adminSecret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  const orders = loadOrders()
  return NextResponse.json({ ok: true, orders })
}
