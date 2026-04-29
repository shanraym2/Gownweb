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

// ── Revenue counting: completed orders only ───────────────────────────────────
const isRevenueCounting = o => o.status === 'completed'

// ── GET /api/admin/export?type=orders|summary|items|consolidated&from=YYYY-MM-DD&to=YYYY-MM-DD ──

export async function GET(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const type     = searchParams.get('type') || 'orders'
  const dateFrom = searchParams.get('from') || ''  // YYYY-MM-DD
  const dateTo   = searchParams.get('to')   || ''  // YYYY-MM-DD

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
      id:             r.id,
      order_number:   r.order_number,
      status:         r.status,
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

  // ── Date range filter ─────────────────────────────────────────────────────
  if (dateFrom || dateTo) {
    orders = orders.filter(o => {
      const d = (o.placedAt || o.createdAt || o.placed_at)?.slice(0, 10)
      if (!d) return false
      if (dateFrom && d < dateFrom) return false
      if (dateTo   && d > dateTo)   return false
      return true
    })
  }

  const now           = new Date().toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' })
  const rangeLabel    = dateFrom && dateTo
    ? `${dateFrom} to ${dateTo}`
    : dateFrom ? `From ${dateFrom}`
    : dateTo   ? `To ${dateTo}`
    : 'All time'

  const completed = orders.filter(isRevenueCounting)
  const revenue   = completed.reduce((s, o) => s + Number(o.total || 0), 0)
  const aov       = completed.length ? revenue / completed.length : 0

  let csv      = ''
  let filename = ''

  // ── Section builders (reused across consolidated) ─────────────────────────

  function buildReportHeader(title) {
    return [
      [`JCE Bridal Boutique — ${title}`],
      [`Generated: ${now}`],
      [`Period: ${rangeLabel}`],
      [`Total orders in range: ${orders.length}`],
      [],
    ]
  }

  function buildOverviewSection() {
    const statusCounts = {}
    for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1
    const cancelCount  = (statusCounts['cancelled'] || 0) + (statusCounts['refunded'] || 0)
    const fulfillRate  = orders.length ? Math.round(completed.length / orders.length * 100) : 0

    return [
      ['OVERVIEW'],
      ['Metric', 'Value'],
      ['Total orders (in range)', orders.length],
      ['Completed orders', completed.length],
      ['Fulfillment rate', `${fulfillRate}%`],
      ['Revenue (completed orders only)', fmtPhp(revenue)],
      ['Average order value (completed)', fmtPhp(aov)],
      ['Cancelled + Refunded', cancelCount],
      ['Cancellation rate', `${orders.length ? Math.round(cancelCount / orders.length * 100) : 0}%`],
      [],
    ]
  }

  function buildStatusSection() {
    const statusCounts = {}
    for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1
    return [
      ['ORDERS BY STATUS'],
      ['Status', 'Count', 'Share'],
      ...Object.entries(statusCounts).map(([s, c]) => [
        s, c, `${Math.round(c / (orders.length || 1) * 100)}%`,
      ]),
      [],
    ]
  }

  function buildOrdersSection() {
    return [
      ['ORDER DETAILS'],
      [
        'Order ID', 'Order Number', 'Date', 'Status',
        'Payment Method', 'Payment Status',
        'Customer Name', 'Customer Email', 'Customer Phone',
        'Subtotal', 'Discount', 'Shipping', 'Total', 'Notes',
      ],
      ...orders.map(o => [
        o.id,
        o.order_number || '',
        fmtDate(o.createdAt || o.placed_at),
        o.status,
        o.payment_method || o.payment || '',
        o.payment_status || '',
        o.customer_name  || `${o.contact?.firstName || ''} ${o.contact?.lastName || ''}`.trim(),
        o.customer_email || o.contact?.email || '',
        o.customer_phone || o.contact?.phone || '',
        fmtPhp(o.subtotal       || 0),
        fmtPhp(o.discount_total || 0),
        fmtPhp(o.shipping_fee   || 0),
        fmtPhp(o.total          || 0),
        o.notes || o.note || '',
      ]),
      [],
    ]
  }

  function buildItemsSection() {
    const rows = []
    for (const o of orders) {
      for (const it of (o.items || [])) {
        rows.push([
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
        ])
      }
    }
    return [
      ['LINE ITEMS'],
      ['Order ID', 'Order Number', 'Date', 'Status', 'Customer', 'Item', 'Size', 'Qty', 'Unit Price', 'Line Total'],
      ...rows,
      [],
    ]
  }

  function buildTopItemsSection() {
    const itemCounts = {}
    for (const o of completed)
      for (const it of (o.items || []))
        itemCounts[it.name || it.gown_name] = (itemCounts[it.name || it.gown_name] || 0) + (it.qty || it.quantity || 1)

    const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
    return [
      ['TOP 10 ITEMS SOLD (Completed Orders)'],
      ['Rank', 'Item', 'Units Sold'],
      ...topItems.map(([name, qty], i) => [`#${i + 1}`, name, qty]),
      [],
    ]
  }

  // ── Report types ──────────────────────────────────────────────────────────

  if (type === 'summary') {
    filename = `jce-summary-${Date.now()}.csv`
    const lines = [
      ...buildReportHeader('Sales Summary Report'),
      ...buildOverviewSection(),
      ...buildStatusSection(),
      ...buildTopItemsSection(),
    ]
    csv = lines.map(r => r.map(escapeCsv).join(',')).join('\n')

  } else if (type === 'items') {
    filename = `jce-line-items-${Date.now()}.csv`
    const lines = [
      ...buildReportHeader('Line Items Report'),
      ...buildItemsSection(),
    ]
    csv = lines.map(r => r.map(escapeCsv).join(',')).join('\n')

  } else if (type === 'consolidated') {
    filename = `jce-consolidated-report-${Date.now()}.csv`
    const lines = [
      ...buildReportHeader('Consolidated Report'),
      ...buildOverviewSection(),
      ...buildStatusSection(),
      ...buildOrdersSection(),
      ...buildItemsSection(),
      ...buildTopItemsSection(),
    ]
    csv = lines.map(r => r.map(escapeCsv).join(',')).join('\n')

  } else {
    // Default: orders
    filename = `jce-orders-${Date.now()}.csv`
    const lines = [
      ...buildReportHeader('Orders Report'),
      ...buildOrdersSection(),
    ]
    csv = lines.map(r => r.map(escapeCsv).join(',')).join('\n')
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}