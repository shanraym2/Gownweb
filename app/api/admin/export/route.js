import { NextResponse } from 'next/server'

function checkAuth(request) {
  const secret = request.headers.get('x-admin-secret') || ''
  return process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET
}

function fmtPhp(n) {
  return '₱' + Math.round(Number(n) || 0).toLocaleString('en-PH')
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function escapeCsv(val) {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function rowToCsv(fields) {
  return fields.map(escapeCsv).join(',')
}

// ── GET /api/admin/export?type=orders|summary|items ──────────────────────────

export async function GET(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') || 'orders'

  const USE_DB = process.env.USE_DB === 'true'

  let orders = []

  if (!USE_DB) {
    const fs   = await import('fs')
    const path = await import('path')
    const file = path.join(process.cwd(), 'data', 'orders.json')
    if (fs.existsSync(file)) {
      orders = JSON.parse(fs.readFileSync(file, 'utf8'))
    }
  } else {
    const { query } = await import('@/lib/db')
    const rows = await query(`
      SELECT o.*,
        json_agg(
          json_build_object(
            'name',       oi.gown_name,
            'size',       oi.size_label,
            'qty',        oi.quantity,
            'unit_price', oi.unit_price,
            'line_total', oi.line_total
          ) ORDER BY oi.id
        ) FILTER (WHERE oi.id IS NOT NULL) AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      GROUP BY o.id
      ORDER BY o.placed_at DESC
    `)
    orders = rows.map(r => ({
      id:            r.id,
      order_number:  r.order_number,
      status:        r.status,
      payment_method: r.payment_method,
      payment_status: r.payment_status,
      customer_name:  r.customer_name,
      customer_email: r.customer_email,
      customer_phone: r.customer_phone,
      subtotal:       r.subtotal,
      discount_total: r.discount_total,
      shipping_fee:   r.shipping_fee,
      total:          r.total,
      notes:          r.notes,
      createdAt:      r.placed_at,
      items:          r.items || [],
    }))
  }

  const now     = new Date().toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' })
  const paid    = orders.filter(o => o.status !== 'cancelled')
  const revenue = paid.reduce((s, o) => s + Number(o.subtotal || o.total || 0), 0)

  let csv = ''
  let filename = ''

  if (type === 'summary') {
    // ── Summary report ──────────────────────────────────────────────────────
    filename = `jce-sales-summary-${Date.now()}.csv`

    const statusCounts = {}
    for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1

    const itemCounts = {}
    for (const o of paid)
      for (const it of (o.items || []))
        itemCounts[it.name || it.gown_name] = (itemCounts[it.name || it.gown_name] || 0) + (it.qty || it.quantity || 1)

    const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)

    const lines = [
      ['JCE Bridal Boutique — Sales Summary Report'],
      [`Generated: ${now}`],
      [],
      ['OVERVIEW'],
      ['Metric', 'Value'],
      ['Total orders', orders.length],
      ['Active orders (excl. cancelled)', paid.length],
      ['Total revenue', fmtPhp(revenue)],
      ['Average order value', fmtPhp(paid.length ? revenue / paid.length : 0)],
      ['Delivered', orders.filter(o => o.status === 'delivered').length],
      [],
      ['ORDERS BY STATUS'],
      ['Status', 'Count'],
      ...Object.entries(statusCounts).map(([s, c]) => [s, c]),
      [],
      ['TOP 10 ITEMS SOLD'],
      ['Item', 'Units sold'],
      ...topItems.map(([name, qty]) => [name, qty]),
    ]

    csv = lines.map(r => r.map(escapeCsv).join(',')).join('\n')

  } else if (type === 'items') {
    // ── Line items report ───────────────────────────────────────────────────
    filename = `jce-order-items-${Date.now()}.csv`

    const header = ['Order ID', 'Order Number', 'Date', 'Status', 'Customer', 'Item', 'Size', 'Qty', 'Unit Price', 'Line Total']
    const rows2  = []

    for (const o of orders) {
      for (const it of (o.items || [])) {
        rows2.push(rowToCsv([
          o.id,
          o.order_number || '',
          fmtDate(o.createdAt || o.placed_at),
          o.status,
          o.customer_name || `${o.contact?.firstName || ''} ${o.contact?.lastName || ''}`.trim(),
          it.name || it.gown_name || '',
          it.size || it.size_label || '',
          it.qty  || it.quantity  || 1,
          fmtPhp(it.unit_price || 0),
          fmtPhp(it.line_total || it.subtotal || 0),
        ]))
      }
    }

    csv = [rowToCsv(header), ...rows2].join('\n')

  } else {
    // ── Orders report (default) ─────────────────────────────────────────────
    filename = `jce-orders-${Date.now()}.csv`

    const header = [
      'Order ID', 'Order Number', 'Date', 'Status',
      'Payment Method', 'Payment Status',
      'Customer Name', 'Customer Email', 'Customer Phone',
      'Subtotal', 'Discount', 'Shipping', 'Total',
      'Items', 'Notes',
    ]

    const rows2 = orders.map(o => rowToCsv([
      o.id,
      o.order_number || '',
      fmtDate(o.createdAt || o.placed_at),
      o.status,
      o.payment_method || o.payment || '',
      o.payment_status || '',
      o.customer_name  || `${o.contact?.firstName || ''} ${o.contact?.lastName || ''}`.trim(),
      o.customer_email || o.contact?.email || '',
      o.customer_phone || o.contact?.phone || '',
      fmtPhp(o.subtotal || 0),
      fmtPhp(o.discount_total || 0),
      fmtPhp(o.shipping_fee   || 0),
      fmtPhp(o.total || o.subtotal || 0),
      (o.items || []).map(it => `${it.name || it.gown_name} x${it.qty || it.quantity || 1}`).join(' | '),
      o.notes || o.note || '',
    ]))

    csv = [rowToCsv(header), ...rows2].join('\n')
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}