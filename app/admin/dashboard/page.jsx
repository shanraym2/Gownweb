'use client'

import { useState, useEffect, useMemo, useCallback, useRef, startTransition } from 'react'
import Link from 'next/link'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement, Tooltip,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { getAdminSecret } from '../adminSecret'
import { useRoleGuard } from '../../utils/useRoleGuard'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip)

// ── Status constants ──────────────────────────────────────────────────────────

const STATUSES = [
  'placed', 'pending_payment', 'paid', 'processing',
  'ready', 'shipped', 'completed', 'cancelled', 'refunded',
]

const STATUS_META = {
  placed:          { label: 'Placed',          color: '#2d5be3' },
  pending_payment: { label: 'Pending Payment', color: '#856404' },
  paid:            { label: 'Paid',            color: '#155724' },
  processing:      { label: 'Processing',      color: '#4a2c82' },
  ready:           { label: 'Ready',           color: '#0a5276' },
  shipped:         { label: 'Shipped',         color: '#0c5460' },
  completed:       { label: 'Completed',       color: '#155724' },
  cancelled:       { label: 'Cancelled',       color: '#721c24' },
  refunded:        { label: 'Refunded',        color: '#7a3608' },
}

// ── Revenue counting: COMPLETED orders only ───────────────────────────────────
const isRevenueCounting = o => o.status === 'completed'

const ACTIVE_STATUSES = new Set(['paid', 'processing', 'ready', 'shipped'])

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPhp(n)    { return 'PHP ' + Math.round(n).toLocaleString('en-PH') }
function fmtPhpUI(n)  { return '₱'   + Math.round(n).toLocaleString('en-PH') }
function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}
function isoDate(d)      { return d.toISOString().slice(0, 10) }
function todayStr()      { return isoDate(new Date()) }
function daysAgoStr(n)   { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d) }
function monthsAgoStr(n) { const d = new Date(); d.setMonth(d.getMonth() - n); return isoDate(d) }

function customerName(o) {
  return (
    o.customerName    ||
    o.customer_name   ||
    (o.contact ? `${o.contact.firstName || ''} ${o.contact.lastName || ''}`.trim() : '') ||
    o.email           ||
    o.customerEmail   ||
    o.customer_email  ||
    '—'
  )
}

// ── Export constants ──────────────────────────────────────────────────────────

const REPORT_TYPES = [
  { key: 'orders',       label: 'Orders',       desc: 'One row per order' },
  { key: 'items',        label: 'Line items',   desc: 'One row per item' },
  { key: 'summary',      label: 'Summary',      desc: 'Aggregated stats' },
  { key: 'consolidated', label: 'Consolidated', desc: 'Full report (all sections)' },
]

// FIX (features): Presets store a datePreset key instead of literal date strings,
// so "Last 30 days" always means the rolling last 30 days when restored.
const DATE_PRESETS = [
  { key: 'today',    label: 'Today',          from: () => todayStr(),       to: () => todayStr()  },
  { key: 'last7',    label: 'Last 7 days',    from: () => daysAgoStr(7),    to: () => todayStr()  },
  { key: 'last30',   label: 'Last 30 days',   from: () => daysAgoStr(30),   to: () => todayStr()  },
  { key: 'last3mo',  label: 'Last 3 months',  from: () => monthsAgoStr(3),  to: () => todayStr()  },
  { key: 'last12mo', label: 'Last 12 months', from: () => monthsAgoStr(12), to: () => todayStr()  },
  { key: 'alltime',  label: 'All time',       from: () => '',               to: () => ''           },
]

// ── Column definitions ────────────────────────────────────────────────────────

const ORDER_COLUMNS = [
  { key: 'orderNumber',   label: 'Order #',          always: true,  getValue: o => o.orderNumber || o.order_number || '—' },
  { key: 'date',          label: 'Date',             always: true,  getValue: o => fmtDate(o.placedAt || o.createdAt || o.placed_at) },
  { key: 'customerName',  label: 'Customer name',    always: true,  getValue: o => customerName(o) },
  { key: 'email',         label: 'Email',            always: false, getValue: o => o.customerEmail || o.customer_email || o.contact?.email || '—' },
  { key: 'phone',         label: 'Phone',            always: false, getValue: o => o.customer_phone || o.contact?.phone || '—' },
  { key: 'status',        label: 'Status',           always: true,  getValue: o => STATUS_META[o.status]?.label || o.status },
  { key: 'paymentMethod', label: 'Payment method',   always: false, getValue: o => (o.paymentMethod || o.payment_method || '—').toUpperCase() },
  { key: 'paymentStatus', label: 'Payment status',   always: false, getValue: o => o.payment_status || o.paymentStatus || '—' },
  { key: 'proofStatus',   label: 'Proof status',     always: false, getValue: o => o.proofStatus   || o.proof_status   || '—' },
  { key: 'subtotal',      label: 'Subtotal',         always: false, getValue: o => fmtPhp(o.subtotal       || 0) },
  { key: 'discount',      label: 'Discount',         always: false, getValue: o => fmtPhp(o.discount_total || o.discountTotal || 0) },
  { key: 'shippingFee',   label: 'Shipping fee',     always: false, getValue: o => fmtPhp(o.shipping_fee   || o.shippingFee   || 0) },
  { key: 'total',         label: 'Total',            always: true,  getValue: o => fmtPhp(o.total          || 0) },
  { key: 'notes',         label: 'Notes',            always: false, getValue: o => o.notes || o.note || '—' },
  { key: 'deliveryAddr',  label: 'Delivery address', always: false, getValue: o => o.deliveryAddress || o.delivery_address || o.address || '—' },
]

const DEFAULT_ORDER_COL_KEYS = new Set([
  'orderNumber', 'date', 'customerName', 'status', 'paymentMethod', 'total',
])

// FIX (performance): memoised once — ORDER_COLUMNS is a module-level constant so
// there's no need to recompute this on every render.
const TOGGLEABLE_COLS = ORDER_COLUMNS.filter(c => !c.always)

// ── Revenue chart builder ─────────────────────────────────────────────────────

function buildRevenueData(orders, period) {
  const countable = orders.filter(isRevenueCounting)
  const now = new Date()

  if (period === 'daily') {
    const days = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i)
      days.push({ key: isoDate(d), label: fmtDate(d.toISOString()), total: 0 })
    }
    for (const o of countable) {
      const d = days.find(x => x.key === (o.placedAt || o.createdAt)?.slice(0, 10))
      if (d) d.total += Number(o.total || 0)
    }
    return { labels: days.map(d => d.label), data: days.map(d => d.total) }
  }

  if (period === 'monthly') {
    const months = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }),
        total: 0,
      })
    }
    for (const o of countable) {
      const d = new Date(o.placedAt || o.createdAt)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const m = months.find(x => x.key === key)
      if (m) m.total += Number(o.total || 0)
    }
    return { labels: months.map(m => m.label), data: months.map(m => m.total) }
  }

  const years = {}
  for (const o of countable) {
    const y = new Date(o.placedAt || o.createdAt).getFullYear()
    years[y] = (years[y] || 0) + Number(o.total || 0)
  }
  const ks = Object.keys(years).sort()
  return { labels: ks, data: ks.map(k => years[k]) }
}

// ── Interpretations ───────────────────────────────────────────────────────────

function interpRevenue(revenueData, period) {
  const { data } = revenueData
  const nonZero = data.filter(v => v > 0)
  if (!nonZero.length) return { text: 'No completed order revenue recorded in this period yet.', cls: 'info' }
  const half  = Math.floor(data.length / 2)
  const early = data.slice(0, half).reduce((a, b) => a + b, 0)
  const late  = data.slice(half).reduce((a, b) => a + b, 0)
  const pct   = early ? Math.round((late - early) / early * 100) : 0
  const peak  = Math.max(...nonZero)
  const sign  = pct > 0 ? '+' : ''
  if (pct > 15)  return { text: `Revenue is up ${pct}% in the second half of this ${period} view — positive momentum. Peak was ${fmtPhpUI(peak)}.`, cls: 'good' }
  if (pct < -15) return { text: `Revenue dropped ${Math.abs(pct)}% in the second half of this ${period} view — worth investigating. Peak was ${fmtPhpUI(peak)}.`, cls: 'warn' }
  return { text: `Revenue is relatively flat (${sign}${pct}%) across this ${period} view. Peak reached ${fmtPhpUI(peak)}.`, cls: 'info' }
}

function interpMetrics({ revenue, orders, aov, completedCount, fulfillRate, pendingProofCount }) {
  const cancelCount = orders.filter(o => o.status === 'cancelled').length
  const refundCount = orders.filter(o => o.status === 'refunded').length
  const cancelRate  = orders.length ? Math.round((cancelCount + refundCount) / orders.length * 100) : 0

  const revenueInterp = revenue > 50000
    ? { text: 'Strong completed-order revenue — top-line looks healthy.', cls: 'good' }
    : revenue > 15000
      ? { text: 'Moderate revenue from completed orders. Push more orders through to completion.', cls: 'info' }
      : { text: 'Low completed-order revenue. Review fulfillment pipeline.', cls: 'warn' }

  const ordersInterp = pendingProofCount > 0
    ? { text: `${pendingProofCount} order${pendingProofCount > 1 ? 's' : ''} with payment proof awaiting review.`, cls: 'warn' }
    : cancelRate > 25
      ? { text: `Cancellation/refund rate is high at ${cancelRate}%. Investigate order drop-off.`, cls: 'bad' }
      : cancelRate > 12
        ? { text: `${cancelRate}% cancellation/refund rate — slightly elevated.`, cls: 'warn' }
        : { text: `Only ${cancelRate}% of orders cancelled or refunded — healthy retention.`, cls: 'good' }

  const aovInterp = aov > 1200
    ? { text: 'High average order value from completed orders.', cls: 'good' }
    : aov > 500
      ? { text: 'Average basket size is solid for completed orders.', cls: 'info' }
      : { text: 'Low AOV on completed orders. Consider bundle deals.', cls: 'warn' }

  const fulfillInterp = fulfillRate >= 75
    ? { text: `${fulfillRate}% fulfillment rate — operations are running smoothly.`, cls: 'good' }
    : fulfillRate >= 50
      ? { text: `Fulfillment at ${fulfillRate}% — room to improve delivery completion.`, cls: 'warn' }
      : { text: `Only ${fulfillRate}% completed. Check the pipeline for stalled orders.`, cls: 'bad' }

  return { revenueInterp, ordersInterp, aovInterp, fulfillInterp }
}

function interpTopItems(topItems) {
  if (!topItems.length) return { text: 'No item data yet.', cls: 'info' }
  const total = topItems.reduce((s, [, q]) => s + q, 0)
  const top2  = topItems.slice(0, 2).reduce((s, [, q]) => s + q, 0)
  const pct   = Math.round(top2 / total * 100)
  if (pct > 65) return { text: `Top 2 items account for ${pct}% of units sold — high concentration.`, cls: 'warn' }
  if (pct > 45) return { text: `Top 2 items drive ${pct}% of volume — healthy balance. "${topItems[0][0]}" leads.`, cls: 'good' }
  return { text: 'Volume is well-distributed across items — good catalogue diversity.', cls: 'info' }
}

function interpStatus(statusCounts, orders) {
  const total   = orders.length || 1
  const prepPct = Math.round(((statusCounts['processing'] || 0) + (statusCounts['ready'] || 0)) / total * 100)
  const shipPct = Math.round((statusCounts['shipped'] || 0) / total * 100)
  const pendPct = Math.round(((statusCounts['placed'] || 0) + (statusCounts['pending_payment'] || 0)) / total * 100)
  if (prepPct > 30) return { text: `${prepPct}% of orders in processing/ready — potential packing bottleneck.`, cls: 'bad' }
  if (shipPct > 20) return { text: `${shipPct}% of orders in transit. Follow up with couriers if ageing.`, cls: 'warn' }
  if (pendPct > 30) return { text: `${pendPct}% of orders still placed or awaiting payment.`, cls: 'warn' }
  return { text: 'Order flow looks healthy — no obvious bottleneck.', cls: 'good' }
}

const INTERP_STYLES = {
  good: { background: 'rgba(99,153,34,.08)',  borderColor: '#639922', color: '#3B6D11' },
  warn: { background: 'rgba(186,117,23,.08)', borderColor: '#BA7517', color: '#633806' },
  bad:  { background: 'rgba(226,75,74,.08)',  borderColor: '#E24B4A', color: '#791F1F' },
  info: { background: 'rgba(55,138,221,.08)', borderColor: '#378ADD', color: '#0C447C' },
}

function Interpretation({ text, cls }) {
  const s = INTERP_STYLES[cls] || INTERP_STYLES.info
  return (
    <p style={{
      fontSize: 11, lineHeight: 1.55, padding: '7px 10px', borderRadius: 8,
      borderLeft: `3px solid ${s.borderColor}`, marginTop: 8, ...s,
    }}>
      {text}
    </p>
  )
}

// ── PDF generator ─────────────────────────────────────────────────────────────

async function generatePDF(orders, dateFrom, dateTo, reportType, activeColKeys) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const W   = doc.internal.pageSize.getWidth()
  const H   = doc.internal.pageSize.getHeight()
  const now = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })

  const rangeLabel = dateFrom && dateTo
    ? `${dateFrom}  to  ${dateTo}`
    : dateFrom ? `From ${dateFrom}`
    : dateTo   ? `To ${dateTo}`
    : 'All time'

  const completed = orders.filter(isRevenueCounting)
  const revenue   = completed.reduce((s, o) => s + Number(o.total || 0), 0)
  const aov       = completed.length ? revenue / completed.length : 0

  const NAVY  = [26,  26,  46 ]
  const GOLD  = [200, 169, 110]
  const WHITE = [255, 255, 255]
  const DARK  = [30,  30,  30 ]
  const GREY  = [100, 100, 100]
  const LIGHT = [245, 245, 248]

  const headStyles   = { fillColor: NAVY, textColor: GOLD, fontSize: 8, fontStyle: 'bold', cellPadding: { top: 4, bottom: 4, left: 4, right: 4 } }
  const bodyStyles   = { fontSize: 8, cellPadding: { top: 3, bottom: 3, left: 4, right: 4 }, textColor: DARK, overflow: 'ellipsize' }
  const altRowStyles = { fillColor: LIGHT }
  const margin       = { left: 14, right: 14 }

  function sectionTitle(text, y) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...NAVY)
    doc.text(text.toUpperCase(), 14, y)
    doc.setDrawColor(...GOLD)
    doc.setLineWidth(0.4)
    doc.line(14, y + 1.5, W - 14, y + 1.5)
    return y + 6
  }

  function addPage() {
    doc.addPage()
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, W, 10, 'F')
    doc.setTextColor(...GOLD)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.text('JCE Bridal Boutique', 14, 6.5)
    doc.setTextColor(...WHITE)
    doc.setFont('helvetica', 'normal')
    doc.text(rangeLabel, W - 14, 6.5, { align: 'right' })
    return 16
  }

  // Cover
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 28, 'F')
  doc.setFillColor(...GOLD)
  doc.rect(0, 28, W, 1.5, 'F')
  doc.setTextColor(...GOLD)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('JCE Bridal Boutique', 14, 13)

  const titleMap = { orders: 'Orders Report', items: 'Line Items Report', summary: 'Sales Summary Report', consolidated: 'Consolidated Report' }
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...WHITE)
  doc.text(titleMap[reportType] || 'Report', 14, 21)
  doc.setFontSize(8)
  doc.setTextColor(180, 180, 180)
  doc.text(`Generated: ${now}`, W - 14, 12, { align: 'right' })
  doc.text(`Period: ${rangeLabel}`, W - 14, 18, { align: 'right' })
  doc.text(`${orders.length} order${orders.length !== 1 ? 's' : ''} in range`, W - 14, 24, { align: 'right' })

  let y = 38

  // Overview stats
  const statusCounts = {}
  for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1
  const cancelCount  = (statusCounts['cancelled'] || 0) + (statusCounts['refunded'] || 0)
  const fulfillRate  = orders.length ? Math.round(completed.length / orders.length * 100) : 0

  y = sectionTitle('Overview', y)
  const statGrid = [
    ['Total Orders',        String(orders.length),   'Completed Orders',     String(completed.length)],
    ['Revenue (completed)', fmtPhp(revenue),         'Avg Order Value',      fmtPhp(aov)            ],
    ['Fulfillment Rate',    `${fulfillRate}%`,        'Cancelled / Refunded', String(cancelCount)    ],
  ]
  autoTable(doc, {
    startY: y, head: [], body: statGrid, theme: 'plain',
    styles: { ...bodyStyles, fontSize: 9 },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: GREY,  cellWidth: 52 },
      1: { textColor: DARK, cellWidth: 50, fontStyle: 'bold', fontSize: 10 },
      2: { fontStyle: 'bold', textColor: GREY,  cellWidth: 52 },
      3: { textColor: DARK, cellWidth: 50, fontStyle: 'bold', fontSize: 10 },
    },
    margin,
  })
  y = doc.lastAutoTable.finalY + 8

  // Status breakdown
  const presentStatuses = STATUSES.filter(s => statusCounts[s] > 0)
  if (presentStatuses.length) {
    y = sectionTitle('Orders by Status', y)
    autoTable(doc, {
      startY: y,
      head: [['Status', 'Count', 'Share of Total']],
      body: presentStatuses.map(s => [
        STATUS_META[s]?.label || s,
        statusCounts[s],
        `${Math.round(statusCounts[s] / orders.length * 100)}%`,
      ]),
      theme: 'striped', headStyles, bodyStyles, alternateRowStyles: altRowStyles,
      columnStyles: { 0: { cellWidth: 55 }, 1: { halign: 'right', cellWidth: 25 }, 2: { halign: 'right', cellWidth: 35 } },
      margin,
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // Orders table — honours activeColKeys
  if (reportType === 'orders' || reportType === 'consolidated') {
    const cols = ORDER_COLUMNS.filter(c => c.always || activeColKeys.has(c.key))
    if (y > 160) { y = addPage() }
    y = sectionTitle('Order Details', y)
    autoTable(doc, {
      startY: y,
      head: [cols.map(c => c.label)],
      body: orders.map(o => cols.map(c => c.getValue(o))),
      theme: 'striped', headStyles, bodyStyles, alternateRowStyles: altRowStyles,
      margin,
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // Line items
  if (reportType === 'items' || reportType === 'consolidated') {
    const allItems = []
    for (const o of orders)
      for (const it of (o.items || []))
        allItems.push([
          o.orderNumber || o.order_number || '—',
          customerName(o),
          it.gownName || it.gown_name || it.name || '—',
          it.sizeLabel || it.size_label || it.size || '—',
          String(it.quantity || it.qty || 1),
          fmtPhp(it.unitPrice || it.unit_price || 0),
          fmtPhp(it.lineTotal || it.line_total || 0),
        ])
    if (allItems.length) {
      if (y > 160) { y = addPage() }
      y = sectionTitle('Line Items', y)
      autoTable(doc, {
        startY: y,
        head: [['Order #', 'Customer', 'Item', 'Size', 'Qty', 'Unit Price', 'Line Total']],
        body: allItems,
        theme: 'striped', headStyles, bodyStyles, alternateRowStyles: altRowStyles,
        columnStyles: {
          0: { cellWidth: 38 }, 1: { cellWidth: 45 }, 2: { cellWidth: 68 },
          3: { cellWidth: 16 }, 4: { halign: 'right', cellWidth: 12 },
          5: { halign: 'right', cellWidth: 32 }, 6: { halign: 'right', cellWidth: 32 },
        },
        margin,
      })
      y = doc.lastAutoTable.finalY + 8
    }
  }

  // Top items
  if (reportType === 'summary' || reportType === 'consolidated') {
    const itemCounts = {}
    for (const o of orders.filter(isRevenueCounting))
      for (const it of (o.items || [])) {
        // FIX (bug): use '(unknown)' fallback so unnamed items don't all merge
        // under an `undefined` key. PDF version already did this; now consistent.
        const name = it.gownName || it.gown_name || it.name || '(unknown)'
        itemCounts[name] = (itemCounts[name] || 0) + Number(it.quantity || it.qty || 1)
      }
    const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
    if (topItems.length) {
      if (y > 160) { y = addPage() }
      y = sectionTitle('Top Items Sold  (completed orders only)', y)
      const maxQty = topItems[0]?.[1] || 1
      autoTable(doc, {
        startY: y,
        head: [['Rank', 'Item Name', 'Units Sold', 'Share of Top 10']],
        body: topItems.map(([name, qty], i) => [`#${i + 1}`, name, String(qty), `${Math.round(qty / maxQty * 100)}%`]),
        theme: 'striped', headStyles, bodyStyles, alternateRowStyles: altRowStyles,
        columnStyles: { 0: { cellWidth: 16, halign: 'center' }, 1: { cellWidth: 120 }, 2: { cellWidth: 28, halign: 'right' }, 3: { cellWidth: 35, halign: 'right' } },
        margin,
      })
    }
  }

  // Page footers
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFillColor(...NAVY)
    doc.rect(0, H - 10, W, 10, 'F')
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...GOLD)
    doc.text('JCE Bridal Boutique', 14, H - 3.5)
    doc.setTextColor(160, 160, 160)
    doc.text('CONFIDENTIAL', W / 2, H - 3.5, { align: 'center' })
    doc.text(`Page ${i} of ${pageCount}`, W - 14, H - 3.5, { align: 'right' })
  }

  doc.save(`jce-${reportType}-report-${Date.now()}.pdf`)
}

// ── CSV generator (fully client-side) ────────────────────────────────────────

function escapeCsv(val) {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n'))
    return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function generateCSV(orders, dateFrom, dateTo, reportType, activeColKeys) {
  const now        = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
  const rangeLabel = dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : dateFrom ? `From ${dateFrom}` : dateTo ? `To ${dateTo}` : 'All time'
  const completed  = orders.filter(isRevenueCounting)
  const revenue    = completed.reduce((s, o) => s + Number(o.total || 0), 0)
  const aov        = completed.length ? revenue / completed.length : 0

  function buildHeader(title) {
    return [
      [`JCE Bridal Boutique — ${title}`],
      [`Generated: ${now}`],
      [`Period: ${rangeLabel}`],
      [`Total orders in range: ${orders.length}`],
      [],
    ]
  }

  function buildOverview() {
    const sc = {}
    for (const o of orders) sc[o.status] = (sc[o.status] || 0) + 1
    const cancelCount = (sc['cancelled'] || 0) + (sc['refunded'] || 0)
    const fulfillRate = orders.length ? Math.round(completed.length / orders.length * 100) : 0
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

  function buildStatus() {
    const sc = {}
    for (const o of orders) sc[o.status] = (sc[o.status] || 0) + 1
    return [
      ['ORDERS BY STATUS'],
      ['Status', 'Count', 'Share'],
      ...Object.entries(sc).map(([s, c]) => [s, c, `${Math.round(c / (orders.length || 1) * 100)}%`]),
      [],
    ]
  }

  function buildOrders() {
    const cols = ORDER_COLUMNS.filter(c => c.always || activeColKeys.has(c.key))
    return [
      ['ORDER DETAILS'],
      cols.map(c => c.label),
      ...orders.map(o => cols.map(c => c.getValue(o))),
      [],
    ]
  }

  function buildItems() {
    const rows = []
    for (const o of orders)
      for (const it of (o.items || []))
        rows.push([
          o.orderNumber || o.order_number || '',
          fmtDate(o.placedAt || o.createdAt || o.placed_at),
          o.status,
          customerName(o),
          it.gownName || it.gown_name || it.name || '',
          it.sizeLabel || it.size_label || it.size || '',
          it.quantity  || it.qty || 1,
          fmtPhp(it.unitPrice || it.unit_price || 0),
          fmtPhp(it.lineTotal || it.line_total || 0),
        ])
    return [
      ['LINE ITEMS'],
      ['Order #', 'Date', 'Status', 'Customer', 'Item', 'Size', 'Qty', 'Unit Price', 'Line Total'],
      ...rows,
      [],
    ]
  }

  function buildTopItems() {
    const ic = {}
    for (const o of completed)
      for (const it of (o.items || [])) {
        // FIX (bug): '(unknown)' fallback prevents undefined key merging all
        // unnamed items together — matches the PDF generator's existing behaviour.
        const name = it.gownName || it.gown_name || it.name || '(unknown)'
        ic[name] = (ic[name] || 0) + (it.quantity || it.qty || 1)
      }
    const top = Object.entries(ic).sort((a, b) => b[1] - a[1]).slice(0, 10)
    return [
      ['TOP 10 ITEMS SOLD (Completed Orders)'],
      ['Rank', 'Item', 'Units Sold'],
      ...top.map(([name, qty], i) => [`#${i + 1}`, name, qty]),
      [],
    ]
  }

  let sections = []
  if (reportType === 'summary')           sections = [...buildHeader('Sales Summary Report'),  ...buildOverview(), ...buildStatus(), ...buildTopItems()]
  else if (reportType === 'items')        sections = [...buildHeader('Line Items Report'),      ...buildItems()]
  else if (reportType === 'consolidated') sections = [...buildHeader('Consolidated Report'),   ...buildOverview(), ...buildStatus(), ...buildOrders(), ...buildItems(), ...buildTopItems()]
  else                                    sections = [...buildHeader('Orders Report'),          ...buildOrders()]

  return sections.map(r => r.map(escapeCsv).join(',')).join('\n')
}

function downloadCSVClient(orders, dateFrom, dateTo, reportType, activeColKeys) {
  const csv  = generateCSV(orders, dateFrom, dateTo, reportType, activeColKeys)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `jce-${reportType}-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Preset helpers (localStorage) ────────────────────────────────────────────

const PRESET_KEY = 'jce_export_presets'

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]') }
  catch { return [] }
}
function savePresets(presets) {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(presets)) } catch {}
}

// FIX (features): resolve a saved datePreset key back to concrete from/to strings.
// Presets that were saved before this change (with literal dateFrom/dateTo strings)
// fall back gracefully — they just won't roll forward.
function resolvePresetDates(config) {
  if (config.datePreset) {
    const p = DATE_PRESETS.find(x => x.key === config.datePreset)
    if (p) return { dateFrom: p.from(), dateTo: p.to() }
  }
  return { dateFrom: config.dateFrom || '', dateTo: config.dateTo || '' }
}

// ── Shared style builders ─────────────────────────────────────────────────────

const S = {
  // FIX (code quality): pill styles moved to CSS classes (adm-report-pill /
  // adm-report-pill--active) to avoid creating new objects on every render and
  // to stay consistent with the adm-period-pill pattern used on the chart.
  presetPill: {
    padding: '4px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
    border: '1px solid var(--color-border-tertiary)',
    background: 'var(--color-background-primary)',
    color: 'var(--color-text-secondary)', transition: 'border-color .15s',
  },
  // FIX (UX): active preset pill so the selected date range is highlighted.
  presetPillActive: {
    padding: '4px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
    border: '1px solid var(--color-text-primary)',
    background: 'var(--color-text-primary)',
    color: 'var(--color-background-primary)', transition: 'all .15s',
  },
  label:   { fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: .5 },
  section: { marginBottom: 18 },
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CheckRow({ checked, onChange, label, disabled, dotColor }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1 }}>
      <input
        type="checkbox" checked={checked} onChange={onChange} disabled={disabled}
        style={{ width: 14, height: 14, accentColor: 'var(--color-text-primary)', cursor: disabled ? 'default' : 'pointer' }}
      />
      {dotColor && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />}
      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{label}</span>
    </label>
  )
}

function Collapse({ title, badge, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: 14 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: '0 0 6px', color: 'var(--color-text-tertiary)',
          fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .5,
        }}
      >
        {/* FIX (UX): optional badge beside title shows e.g. "3 of 9 active" so
            users can immediately see when a filter is narrowing results without
            having to open the collapse. */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {title}
          {badge != null && (
            <span style={{
              fontSize: 10, fontWeight: 500, padding: '1px 7px', borderRadius: 10,
              background: 'var(--color-border-tertiary)', color: 'var(--color-text-secondary)',
              textTransform: 'none', letterSpacing: 0,
            }}>
              {badge}
            </span>
          )}
        </span>
        <span style={{ fontSize: 9, opacity: 0.55 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && children}
    </div>
  )
}

// FIX (code quality): named DateInput component instead of an opaque tuple map.
// Accepts label, value, onChange, min, max — easy to extend.
function DateInput({ label, value, onChange, min, max }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
      {label}
      <input
        type="date" value={value} onChange={e => onChange(e.target.value)}
        min={min} max={max}
        style={{
          padding: '6px 10px', borderRadius: 6, fontSize: 12,
          border: '1px solid var(--color-border-tertiary)',
          background: 'var(--color-background-primary)',
          color: 'var(--color-text-primary)',
        }}
      />
    </label>
  )
}

// ── ExportPanel ───────────────────────────────────────────────────────────────

function ExportPanel({ orders = [] }) {
  const [open,       setOpen      ] = useState(false)
  const [reportType, setReportType] = useState('consolidated')
  const [dateFrom,   setDateFrom  ] = useState('')
  const [dateTo,     setDateTo    ] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [csvLoading, setCsvLoading] = useState(false)

  const [activeColKeys,   setActiveColKeys  ] = useState(new Set(DEFAULT_ORDER_COL_KEYS))
  const [activeStatuses,  setActiveStatuses ] = useState(new Set(STATUSES))

  // FIX (UX): lazy initial state — loadPresets() is called once at mount so
  // the "Saved presets" collapse correctly reads presets.length > 0 on first render,
  // rather than always starting as 0 before the useEffect fires.
  const [presets,      setPresets    ] = useState(() => loadPresets())
  const [presetName,   setPresetName ] = useState('')
  const [presetSaved,  setPresetSaved] = useState(false)
  const saveTimerRef = useRef(null)

  // FIX (bug): clean up the "✓ Saved" timer on unmount to prevent setting state
  // on an unmounted component.
  useEffect(() => () => clearTimeout(saveTimerRef.current), [])

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      const d = (o.placedAt || o.createdAt)?.slice(0, 10)
      if (dateFrom && d < dateFrom) return false
      if (dateTo   && d > dateTo)   return false
      if (!activeStatuses.has(o.status)) return false
      return true
    })
  }, [orders, dateFrom, dateTo, activeStatuses])

  // FIX (UX): derive which date preset (if any) matches the current from/to so
  // the active preset pill can be highlighted.
  const activeDatePresetKey = useMemo(() => {
    for (const p of DATE_PRESETS) {
      if (p.from() === dateFrom && p.to() === dateTo) return p.key
    }
    return null
  }, [dateFrom, dateTo])

  const applyDatePreset = useCallback(p => { setDateFrom(p.from()); setDateTo(p.to()) }, [])
  const toggleCol       = useCallback(key => {
    setActiveColKeys(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }, [])
  const toggleStatus    = useCallback(s => {
    setActiveStatuses(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n })
  }, [])
  const toggleAllStatuses = useCallback(on => {
    setActiveStatuses(on ? new Set(STATUSES) : new Set())
  }, [])

  // FIX (UX): reset to defaults in one click.
  const handleReset = useCallback(() => {
    setReportType('consolidated')
    setDateFrom('')
    setDateTo('')
    setActiveColKeys(new Set(DEFAULT_ORDER_COL_KEYS))
    setActiveStatuses(new Set(STATUSES))
  }, [])

  function currentConfig() {
    // FIX (features): store the active datePreset key (if any) instead of literal
    // strings so rolling presets like "Last 30 days" stay relative when restored.
    return {
      reportType,
      datePreset: activeDatePresetKey ?? undefined,
      // Keep literal dates too so custom ranges round-trip correctly.
      dateFrom: activeDatePresetKey ? undefined : dateFrom,
      dateTo:   activeDatePresetKey ? undefined : dateTo,
      colKeys:   [...activeColKeys],
      statuses:  [...activeStatuses],
    }
  }

  function applyConfig(cfg) {
    setReportType(cfg.reportType || 'consolidated')
    const { dateFrom: df, dateTo: dt } = resolvePresetDates(cfg)
    setDateFrom(df)
    setDateTo(dt)
    setActiveColKeys(new Set(cfg.colKeys || [...DEFAULT_ORDER_COL_KEYS]))
    setActiveStatuses(new Set(cfg.statuses || STATUSES))
  }

  function handleSavePreset() {
    const name = presetName.trim()
    if (!name) return
    const updated = [...presets.filter(p => p.name !== name), { name, config: currentConfig() }]
    setPresets(updated); savePresets(updated); setPresetName('')
    setPresetSaved(true)
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => setPresetSaved(false), 2000)
  }
  function handleDeletePreset(name) {
    const updated = presets.filter(p => p.name !== name)
    setPresets(updated); savePresets(updated)
  }

  const handlePDF = async () => {
    setPdfLoading(true)
    try {
      await generatePDF(filteredOrders, dateFrom, dateTo, reportType, activeColKeys)
    } catch (e) {
      console.error(e)
      alert('PDF generation failed.\n\nMake sure jspdf and jspdf-autotable are installed:\nnpm install jspdf jspdf-autotable')
    } finally { setPdfLoading(false) }
  }

  // FIX (code quality): use startTransition instead of setTimeout(..., 0) to
  // yield to the browser for the loading spinner — the correct React 18 idiom.
  const handleCSV = () => {
    setCsvLoading(true)
    startTransition(() => {
      try { downloadCSVClient(filteredOrders, dateFrom, dateTo, reportType, activeColKeys) }
      catch (e) { console.error(e); alert('CSV generation failed.') }
      finally { setCsvLoading(false) }
    })
  }

  const isBusy         = pdfLoading || csvLoading
  const statusesInData = useMemo(() => new Set(orders.map(o => o.status)), [orders])

  // Status badge: how many statuses are active vs total that exist in data
  const statusBadge = useMemo(() => {
    const inData = STATUSES.filter(s => statusesInData.has(s))
    const active = inData.filter(s => activeStatuses.has(s))
    return active.length < inData.length ? `${active.length} of ${inData.length}` : null
  }, [activeStatuses, statusesInData])

  // FIX (features): warn when the order count is very large — PDF will be slow.
  const largeExportWarning = filteredOrders.length > 500

  return (
    <div style={{ marginBottom: 24 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          cursor: 'pointer', transition: 'border-color .15s',
          border: '1px solid var(--color-border-secondary)',
          background: 'var(--color-background-primary)',
          color: 'var(--color-text-primary)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Export report
        <span style={{ fontSize: 10, opacity: 0.45 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          marginTop: 8, padding: '20px 22px',
          border: '1px solid var(--color-border-tertiary)', borderRadius: 12,
          background: 'var(--color-background-secondary)',
        }}>

          {/* Report type — uses CSS classes to avoid new style objects per render */}
          <div style={S.section}>
            <div style={S.label}>Report type</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {REPORT_TYPES.map(r => (
                <button
                  key={r.key}
                  onClick={() => setReportType(r.key)}
                  title={r.desc}
                  className={`adm-period-pill${reportType === r.key ? ' active' : ''}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date range */}
          <div style={S.section}>
            <div style={S.label}>Date range</div>
            {/* FIX (UX): active preset pill is highlighted */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {DATE_PRESETS.map(p => (
                <button
                  key={p.key}
                  onClick={() => applyDatePreset(p)}
                  style={activeDatePresetKey === p.key ? S.presetPillActive : S.presetPill}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {/* FIX (code quality): named DateInput instead of opaque tuple map;
                  "To" enforces min=dateFrom so you can't accidentally set an invalid range. */}
              <DateInput label="From" value={dateFrom} onChange={setDateFrom} max={dateTo || undefined} />
              <DateInput label="To"   value={dateTo}   onChange={setDateTo}   min={dateFrom || undefined} />
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo('') }}
                  style={{ padding: '6px 10px', borderRadius: 6, fontSize: 11, border: '1px solid var(--color-border-tertiary)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer' }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Status filter — badge shows narrowed count at a glance */}
          <Collapse title="Status filter" badge={statusBadge} defaultOpen={false}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <button onClick={() => toggleAllStatuses(true)}  style={{ ...S.presetPill, fontSize: 10 }}>All</button>
              <button onClick={() => toggleAllStatuses(false)} style={{ ...S.presetPill, fontSize: 10 }}>None</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '6px 16px', marginBottom: 10 }}>
              {STATUSES.map(s => (
                <CheckRow
                  key={s}
                  checked={activeStatuses.has(s)}
                  onChange={() => toggleStatus(s)}
                  label={`${STATUS_META[s]?.label || s}${statusesInData.has(s) ? '' : ' (none)'}`}
                  disabled={!statusesInData.has(s)}
                  dotColor={STATUS_META[s]?.color}
                />
              ))}
            </div>
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 0 }}>
              {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''} match current filters
              {orders.length !== filteredOrders.length ? ` (of ${orders.length} total)` : ''}
            </p>
          </Collapse>

          {/* Column selection */}
          {(reportType === 'orders' || reportType === 'consolidated') && (
            <Collapse title="Column selection (orders table)" defaultOpen={false}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '6px 16px', marginBottom: 10 }}>
                {ORDER_COLUMNS.filter(c => c.always).map(c => (
                  <CheckRow key={c.key} checked disabled label={`${c.label} (required)`} />
                ))}
                {/* FIX (performance): TOGGLEABLE_COLS is now a module-level constant
                    computed once instead of being refiltered on every render. */}
                {TOGGLEABLE_COLS.map(c => (
                  <CheckRow
                    key={c.key}
                    checked={activeColKeys.has(c.key)}
                    onChange={() => toggleCol(c.key)}
                    label={c.label}
                  />
                ))}
              </div>
              <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: 0 }}>
                {ORDER_COLUMNS.filter(c => c.always || activeColKeys.has(c.key)).length} of {ORDER_COLUMNS.length} columns selected
              </p>
            </Collapse>
          )}

          {/* Saved presets */}
          <Collapse title="Saved presets" defaultOpen={presets.length > 0}>
            {presets.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {presets.map(p => (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <button
                      onClick={() => applyConfig(p.config)}
                      style={{
                        padding: '4px 12px', borderRadius: '20px 0 0 20px', fontSize: 11,
                        border: '1px solid var(--color-border-secondary)', borderRight: 'none',
                        background: 'var(--color-background-primary)',
                        color: 'var(--color-text-primary)', cursor: 'pointer',
                      }}
                    >
                      {p.name}
                    </button>
                    <button
                      onClick={() => handleDeletePreset(p.name)}
                      title="Delete preset"
                      style={{
                        padding: '4px 8px', borderRadius: '0 20px 20px 0', fontSize: 10,
                        border: '1px solid var(--color-border-secondary)',
                        background: 'var(--color-background-primary)',
                        color: 'var(--color-text-tertiary)', cursor: 'pointer', lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text" placeholder="Preset name…" value={presetName}
                onChange={e => setPresetName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSavePreset()}
                style={{
                  padding: '6px 10px', borderRadius: 6, fontSize: 12,
                  border: '1px solid var(--color-border-tertiary)',
                  background: 'var(--color-background-primary)',
                  color: 'var(--color-text-primary)', width: 180,
                }}
              />
              <button
                onClick={handleSavePreset} disabled={!presetName.trim()}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12,
                  cursor: presetName.trim() ? 'pointer' : 'not-allowed',
                  border: '1px solid var(--color-border-secondary)',
                  background: 'var(--color-background-primary)',
                  color: 'var(--color-text-primary)', opacity: presetName.trim() ? 1 : 0.4,
                }}
              >
                Save current config
              </button>
              {presetSaved && <span style={{ fontSize: 11, color: '#639922' }}>✓ Saved</span>}
            </div>
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 8, marginBottom: 0 }}>
              Presets are stored in your browser. Click a preset name to restore its settings.
            </p>
          </Collapse>

          {/* Download buttons */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
            <button
              onClick={handleCSV} disabled={isBusy || filteredOrders.length === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                cursor: (isBusy || filteredOrders.length === 0) ? 'not-allowed' : 'pointer',
                opacity: (isBusy || filteredOrders.length === 0) ? 0.5 : 1,
                border: '1px solid var(--color-border-secondary)',
                background: 'var(--color-background-primary)',
                color: 'var(--color-text-primary)', transition: 'all .15s',
              }}
            >
              {csvLoading
                ? <svg style={{ animation: 'adm-spin .7s linear infinite' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              }
              {csvLoading ? 'Generating…' : 'Download CSV'}
            </button>

            <button
              onClick={handlePDF} disabled={isBusy || filteredOrders.length === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                cursor: (isBusy || filteredOrders.length === 0) ? 'not-allowed' : 'pointer',
                opacity: (isBusy || filteredOrders.length === 0) ? 0.5 : 1,
                border: '1px solid #c8a96e', background: '#1a1a2e', color: '#c8a96e',
                transition: 'all .15s',
              }}
            >
              {pdfLoading
                ? <svg style={{ animation: 'adm-spin .7s linear infinite' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>
              }
              {pdfLoading ? 'Generating PDF…' : 'Download PDF'}
            </button>

            {/* FIX (UX): reset to defaults button */}
            <button
              onClick={handleReset}
              style={{
                padding: '9px 14px', borderRadius: 8, fontSize: 12,
                cursor: 'pointer', border: '1px solid var(--color-border-tertiary)',
                background: 'transparent', color: 'var(--color-text-tertiary)', transition: 'all .15s',
              }}
            >
              Reset defaults
            </button>

            {filteredOrders.length === 0 && (
              <span style={{ fontSize: 11, color: '#E24B4A' }}>No orders match the current filters</span>
            )}
            {/* FIX (features): large export warning */}
            {largeExportWarning && (
              <span style={{ fontSize: 11, color: '#BA7517' }}>
                Large export ({filteredOrders.length} orders) — PDF may be slow. Consider CSV for big datasets.
              </span>
            )}
            {filteredOrders.length > 0 && !largeExportWarning && (
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''} · PDF & CSV generated in-browser
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminSalesDashboardPage() {
  const { user: authUser, ready } = useRoleGuard(['admin', 'staff'], '/')

  const [orders,  setOrders ] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError  ] = useState('')
  const [period,  setPeriod ] = useState('daily')

  useEffect(() => {
    const secret = getAdminSecret()
    if (!secret) { setError('Enter the admin secret first.'); setLoading(false); return }
    fetch('/api/admin/orders', { headers: { 'X-Admin-Secret': secret } })
      .then(r => r.json())
      .then(d => { if (d.ok) setOrders(d.orders || []); else setError(d.error || 'Failed') })
      .catch(() => setError('Could not load orders.'))
      .finally(() => setLoading(false))
  }, [])

  const completed         = useMemo(() => orders.filter(isRevenueCounting), [orders])
  const revenue           = useMemo(() => completed.reduce((s, o) => s + Number(o.total || 0), 0), [completed])
  const completedCount    = completed.length
  const fulfillRate       = orders.length ? Math.round(completedCount / orders.length * 100) : 0
  const aov               = completed.length ? revenue / completed.length : 0
  const activeCount       = useMemo(() => orders.filter(o => ACTIVE_STATUSES.has(o.status)).length, [orders])
  const pendingProofCount = useMemo(() => orders.filter(o => o.proofStatus === 'pending').length, [orders])
  const revenueData       = useMemo(() => buildRevenueData(orders, period), [orders, period])

  const topItems = useMemo(() => {
    const counts = {}
    for (const o of completed)
      for (const it of (o.items || [])) {
        const name = it.gownName || it.gown_name || it.name || '(unknown)'
        counts[name] = (counts[name] || 0) + Number(it.quantity || it.qty || 1)
      }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [completed])

  const statusCounts = useMemo(() => {
    const c = {}
    for (const s of STATUSES) c[s] = 0
    for (const o of orders) if (c[o.status] !== undefined) c[o.status]++
    return c
  }, [orders])

  const statusLabels = STATUSES.filter(s => orders.some(o => o.status === s))

  const { revenueInterp, ordersInterp, aovInterp, fulfillInterp } = useMemo(
    () => interpMetrics({ revenue, orders, aov, completedCount, fulfillRate, pendingProofCount }),
    [revenue, orders, aov, completedCount, fulfillRate, pendingProofCount]
  )
  const chartInterp  = useMemo(() => interpRevenue(revenueData, period),  [revenueData, period])
  const itemsInterp  = useMemo(() => interpTopItems(topItems),             [topItems])
  const statusInterp = useMemo(() => interpStatus(statusCounts, orders),   [statusCounts, orders])

  const isAdmin  = authUser?.role === 'admin'
  const tickColor = '#999'
  const gridColor = 'rgba(0,0,0,0.05)'

  const barOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtPhpUI(ctx.parsed.y) } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: tickColor, font: { size: 10 }, maxTicksLimit: 12, maxRotation: 45 } },
      y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 10 }, callback: v => v >= 1e6 ? '₱' + (v/1e6).toFixed(1) + 'M' : v >= 1000 ? '₱' + (v/1000).toFixed(0) + 'k' : '₱' + v } },
    },
  }

  const donutData = {
    labels: statusLabels,
    datasets: [{ data: statusLabels.map(s => statusCounts[s]), backgroundColor: statusLabels.map(s => STATUS_META[s]?.color || '#ccc'), borderWidth: 0, hoverOffset: 4 }],
  }
  const donutOptions = { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false } } }

  if (!ready)  return null
  if (loading) return <p className="adm-muted">Loading dashboard…</p>
  if (error)   return <p className="adm-error-msg">{error}</p>

  return (
    <div className="adm-sales-page">
      <style>{`@keyframes adm-spin { to { transform: rotate(360deg); } }`}</style>

      <div className="adm-sales-topbar">
        <h1 className="adm-page-title">Sales dashboard</h1>
        <Link href="/admin/orders" className="adm-back-link">View orders →</Link>
      </div>

      {isAdmin && <ExportPanel orders={orders} />}

      <div className="adm-metrics">
        <div className="adm-metric">
          <div className="adm-metric-lbl">Total revenue</div>
          <div className="adm-metric-val">{fmtPhpUI(revenue)}</div>
          <div className="adm-metric-sub">Completed orders only</div>
          <Interpretation {...revenueInterp} />
        </div>
        <div className="adm-metric">
          <div className="adm-metric-lbl">Total orders</div>
          <div className="adm-metric-val">{orders.length}</div>
          <div className="adm-metric-sub">{activeCount} active</div>
          <Interpretation {...ordersInterp} />
        </div>
        <div className="adm-metric">
          <div className="adm-metric-lbl">Avg order value</div>
          <div className="adm-metric-val">{fmtPhpUI(aov)}</div>
          <div className="adm-metric-sub">Completed orders only</div>
          <Interpretation {...aovInterp} />
        </div>
        <div className="adm-metric">
          <div className="adm-metric-lbl">Fulfillment rate</div>
          <div className="adm-metric-val">{fulfillRate}%</div>
          <div className={completedCount / (orders.length || 1) >= 0.7 ? 'adm-metric-sub-up' : 'adm-metric-sub-down'}>
            {completedCount} completed
          </div>
          <Interpretation {...fulfillInterp} />
        </div>
      </div>

      <div className="adm-chart-card">
        <div className="adm-chart-head">
          <span className="adm-chart-title">
            Revenue over time
            <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.6 }}> (completed orders)</span>
          </span>
          <div className="adm-period-pills">
            {['daily', 'monthly', 'yearly'].map(p => (
              <button key={p} onClick={() => setPeriod(p)} className={`adm-period-pill${period === p ? ' active' : ''}`}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="adm-chart-canvas">
          <Bar
            data={{ labels: revenueData.labels, datasets: [{ data: revenueData.data, backgroundColor: '#7F77DD', borderRadius: 4, borderSkipped: false }] }}
            options={barOptions}
          />
        </div>
        <Interpretation {...chartInterp} />
      </div>

      <div className="adm-two-col">
        <div className="adm-chart-card">
          <div className="adm-chart-title" style={{ marginBottom: 14 }}>
            Top items sold
            <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.6 }}> (completed)</span>
          </div>
          {topItems.length === 0
            ? <p className="adm-muted">No item data yet.</p>
            : topItems.map(([name, qty], i) => (
                <div key={name} className="adm-top-row">
                  <span className="adm-top-rank">#{i + 1}</span>
                  <span className="adm-top-name">{name}</span>
                  <div className="adm-top-bar-bg">
                    <div className="adm-top-bar-fill" style={{ width: `${Math.round(qty / (topItems[0]?.[1] || 1) * 100)}%` }} />
                  </div>
                  <span className="adm-top-qty">{qty} sold</span>
                </div>
              ))
          }
          <Interpretation {...itemsInterp} />
        </div>

        <div className="adm-chart-card">
          <div className="adm-chart-title" style={{ marginBottom: 14 }}>Orders by status</div>
          <div className="adm-donut-wrap">
            <div className="adm-donut-canvas">
              <Doughnut data={donutData} options={donutOptions} />
            </div>
            <div className="adm-donut-legend">
              {statusLabels.map(s => (
                <div key={s} className="adm-donut-legend-row">
                  <span className="adm-donut-dot" style={{ background: STATUS_META[s]?.color || '#ccc' }} />
                  <span className="adm-donut-legend-lbl">{STATUS_META[s]?.label || s}</span>
                  <span className="adm-donut-legend-cnt">{statusCounts[s]}</span>
                </div>
              ))}
            </div>
          </div>
          <Interpretation {...statusInterp} />
        </div>
      </div>

      <Link href="/admin" className="adm-back-link">← Admin home</Link>
    </div>
  )
}