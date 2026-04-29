'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement, Tooltip,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { getAdminSecret } from '../layout'
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

// jsPDF's built-in Helvetica font does not contain ₱ (U+20B1).
// Use PHP prefix throughout PDF output to avoid the ± glyph fallback.
function fmtPhp(n)    { return 'PHP ' + Math.round(n).toLocaleString('en-PH') }
function fmtPhpUI(n)  { return '₱'   + Math.round(n).toLocaleString('en-PH') }  // UI only
function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}
function isoDate(d)    { return d.toISOString().slice(0, 10) }
function todayStr()    { return isoDate(new Date()) }
function daysAgoStr(n) { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d) }
function monthsAgoStr(n) { const d = new Date(); d.setMonth(d.getMonth() - n); return isoDate(d) }

// Resolve customer name from any field shape the API might return
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
// Notes:
//   • jsPDF's built-in fonts (Helvetica/Times/Courier) lack ₱ (U+20B1).
//     We use "PHP" prefix instead to avoid the ± fallback glyph.
//   • autoTable column widths are tuned for A4 landscape (270 mm usable).
//   • Customer name resolved via customerName() helper — handles camelCase,
//     snake_case, and nested contact object from both JSON and DB paths.

async function generatePDF(orders, dateFrom, dateTo, reportType) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const W   = doc.internal.pageSize.getWidth()   // 297
  const H   = doc.internal.pageSize.getHeight()  // 210
  const now = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })

  const rangeLabel = dateFrom && dateTo
    ? `${dateFrom}  to  ${dateTo}`
    : dateFrom ? `From ${dateFrom}`
    : dateTo   ? `To ${dateTo}`
    : 'All time'

  const completed = orders.filter(isRevenueCounting)
  const revenue   = completed.reduce((s, o) => s + Number(o.total || 0), 0)
  const aov       = completed.length ? revenue / completed.length : 0

  // ── Colour palette ─────────────────────────────────────────────────────────
  const NAVY  = [26,  26,  46 ]
  const GOLD  = [200, 169, 110]
  const WHITE = [255, 255, 255]
  const DARK  = [30,  30,  30 ]
  const GREY  = [100, 100, 100]
  const LIGHT = [245, 245, 248]

  // ── Shared table styles ────────────────────────────────────────────────────
  const headStyles = { fillColor: NAVY, textColor: GOLD, fontSize: 8, fontStyle: 'bold', cellPadding: { top: 4, bottom: 4, left: 4, right: 4 } }
  const bodyStyles = { fontSize: 8, cellPadding: { top: 3, bottom: 3, left: 4, right: 4 }, textColor: DARK, overflow: 'ellipsize' }
  const altRowStyles = { fillColor: LIGHT }
  const margin = { left: 14, right: 14 }

  // ── Helper: draw a section title ──────────────────────────────────────────
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

  // ── Helper: add new page with mini header ─────────────────────────────────
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

  // ── Cover / header ─────────────────────────────────────────────────────────
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 28, 'F')

  // Gold accent bar
  doc.setFillColor(...GOLD)
  doc.rect(0, 28, W, 1.5, 'F')

  doc.setTextColor(...GOLD)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('JCE Bridal Boutique', 14, 13)

  const titleMap = {
    orders:       'Orders Report',
    items:        'Line Items Report',
    summary:      'Sales Summary Report',
    consolidated: 'Consolidated Report',
  }
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...WHITE)
  doc.text(titleMap[reportType] || 'Report', 14, 21)

  // Right-aligned meta
  doc.setFontSize(8)
  doc.setTextColor(180, 180, 180)
  doc.text(`Generated: ${now}`, W - 14, 12, { align: 'right' })
  doc.text(`Period: ${rangeLabel}`, W - 14, 18, { align: 'right' })
  doc.text(`${orders.length} order${orders.length !== 1 ? 's' : ''} in range`, W - 14, 24, { align: 'right' })

  let y = 38

  // ── Overview stats (shown on every report type) ────────────────────────────
  const statusCounts = {}
  for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1
  const cancelCount  = (statusCounts['cancelled'] || 0) + (statusCounts['refunded'] || 0)
  const fulfillRate  = orders.length ? Math.round(completed.length / orders.length * 100) : 0

  y = sectionTitle('Overview', y)

  // 3-column stat grid
  const statGrid = [
    ['Total Orders',          String(orders.length),              'Completed Orders',    String(completed.length)],
    ['Revenue (completed)',   fmtPhp(revenue),                    'Avg Order Value',     fmtPhp(aov)            ],
    ['Fulfillment Rate',      `${fulfillRate}%`,                  'Cancelled / Refunded',String(cancelCount)    ],
  ]

  autoTable(doc, {
    startY: y,
    head: [],
    body: statGrid,
    theme: 'plain',
    styles: { ...bodyStyles, fontSize: 9 },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: GREY,  cellWidth: 52 },
      1: { textColor: DARK,   cellWidth: 50, fontStyle: 'bold', fontSize: 10 },
      2: { fontStyle: 'bold', textColor: GREY,  cellWidth: 52 },
      3: { textColor: DARK,   cellWidth: 50, fontStyle: 'bold', fontSize: 10 },
    },
    margin,
  })
  y = doc.lastAutoTable.finalY + 8

  // ── Status breakdown ───────────────────────────────────────────────────────
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
      theme: 'striped',
      headStyles,
      bodyStyles,
      alternateRowStyles: altRowStyles,
      columnStyles: {
        0: { cellWidth: 55 },
        1: { halign: 'right', cellWidth: 25 },
        2: { halign: 'right', cellWidth: 35 },
      },
      margin,
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // ── Orders table ───────────────────────────────────────────────────────────
  if (reportType === 'orders' || reportType === 'consolidated') {
    if (y > 160) { y = addPage() }
    y = sectionTitle('Order Details', y)

    autoTable(doc, {
      startY: y,
      head: [['Order Number', 'Date', 'Customer Name', 'Email', 'Status', 'Payment', 'Total']],
      body: orders.map(o => [
        o.orderNumber || o.order_number || '—',
        new Date(o.placedAt || o.createdAt || o.placed_at).toLocaleDateString('en-PH', {
          month: 'short', day: 'numeric', year: 'numeric',
        }),
        customerName(o),
        o.customerEmail || o.customer_email || o.contact?.email || '—',
        STATUS_META[o.status]?.label || o.status,
        (o.paymentMethod || o.payment_method || '—').toUpperCase(),
        fmtPhp(o.total || 0),
      ]),
      theme: 'striped',
      headStyles,
      bodyStyles,
      alternateRowStyles: altRowStyles,
      columnStyles: {
        0: { cellWidth: 38 },
        1: { cellWidth: 28 },
        2: { cellWidth: 48 },
        3: { cellWidth: 52 },
        4: { cellWidth: 28 },
        5: { cellWidth: 22 },
        6: { halign: 'right', cellWidth: 32 },
      },
      margin,
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // ── Line items table ───────────────────────────────────────────────────────
  if (reportType === 'items' || reportType === 'consolidated') {
    const allItems = []
    for (const o of orders) {
      for (const it of (o.items || [])) {
        allItems.push([
          o.orderNumber || o.order_number || '—',
          customerName(o),
          it.gownName || it.gown_name || it.name || '—',
          it.sizeLabel || it.size_label || it.size || '—',
          String(it.quantity || it.qty || 1),
          fmtPhp(it.unitPrice || it.unit_price || 0),
          fmtPhp(it.lineTotal || it.line_total || 0),
        ])
      }
    }

    if (allItems.length) {
      if (y > 160) { y = addPage() }
      y = sectionTitle('Line Items', y)

      autoTable(doc, {
        startY: y,
        head: [['Order Number', 'Customer', 'Item', 'Size', 'Qty', 'Unit Price', 'Line Total']],
        body: allItems,
        theme: 'striped',
        headStyles,
        bodyStyles,
        alternateRowStyles: altRowStyles,
        columnStyles: {
          0: { cellWidth: 38 },
          1: { cellWidth: 45 },
          2: { cellWidth: 68 },
          3: { cellWidth: 16 },
          4: { halign: 'right', cellWidth: 12 },
          5: { halign: 'right', cellWidth: 32 },
          6: { halign: 'right', cellWidth: 32 },
        },
        margin,
      })
      y = doc.lastAutoTable.finalY + 8
    }
  }

  // ── Top items (summary / consolidated) ────────────────────────────────────
  if (reportType === 'summary' || reportType === 'consolidated') {
    // Count across ALL items in completed orders (not just the outer completed array)
    const itemCounts = {}
    for (const o of orders.filter(isRevenueCounting)) {
      for (const it of (o.items || [])) {
        const name = it.gownName || it.gown_name || it.name || '(unknown)'
        itemCounts[name] = (itemCounts[name] || 0) + Number(it.quantity || it.qty || 1)
      }
    }
    const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)

    if (topItems.length) {
      if (y > 160) { y = addPage() }
      y = sectionTitle('Top Items Sold  (completed orders only)', y)

      const maxQty = topItems[0]?.[1] || 1
      autoTable(doc, {
        startY: y,
        head: [['Rank', 'Item Name', 'Units Sold', 'Share of Top 10']],
        body: topItems.map(([name, qty], i) => [
          `#${i + 1}`,
          name,
          String(qty),
          `${Math.round(qty / maxQty * 100)}%`,
        ]),
        theme: 'striped',
        headStyles,
        bodyStyles,
        alternateRowStyles: altRowStyles,
        columnStyles: {
          0: { cellWidth: 16, halign: 'center' },
          1: { cellWidth: 120 },
          2: { cellWidth: 28, halign: 'right' },
          3: { cellWidth: 35, halign: 'right' },
        },
        margin,
      })
    }
  }

  // ── Page footers ───────────────────────────────────────────────────────────
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

// ── CSV export ────────────────────────────────────────────────────────────────

async function downloadCSV(type, secret, dateFrom, dateTo, setExporting) {
  setExporting(`${type}-csv`)
  try {
    const params = new URLSearchParams({ type })
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo)   params.set('to',   dateTo)
    const res = await fetch(`/api/admin/export?${params}`, { headers: { 'X-Admin-Secret': secret } })
    if (!res.ok) { alert('Export failed. Please try again.'); return }
    const blob     = await res.blob()
    const url      = URL.createObjectURL(blob)
    const a        = document.createElement('a')
    const filename = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || `jce-${type}.csv`
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  } catch { alert('Export failed. Please try again.') }
  finally { setExporting(null) }
}

// ── Export panel ──────────────────────────────────────────────────────────────

const REPORT_TYPES = [
  { key: 'orders',       label: 'Orders',      desc: 'One row per order' },
  { key: 'items',        label: 'Line items',   desc: 'One row per item' },
  { key: 'summary',      label: 'Summary',      desc: 'Aggregated stats' },
  { key: 'consolidated', label: 'Consolidated', desc: 'Full report (all sections)' },
]

const DATE_PRESETS = [
  { label: 'Today',         from: () => todayStr(),       to: () => todayStr()  },
  { label: 'Last 7 days',   from: () => daysAgoStr(7),    to: () => todayStr()  },
  { label: 'Last 30 days',  from: () => daysAgoStr(30),   to: () => todayStr()  },
  { label: 'Last 3 months', from: () => monthsAgoStr(3),  to: () => todayStr()  },
  { label: 'Last 12 months',from: () => monthsAgoStr(12), to: () => todayStr()  },
  { label: 'All time',      from: () => '',               to: () => ''           },
]

function ExportPanel({ orders, secret, exporting, setExporting }) {
  const [open,       setOpen      ] = useState(false)
  const [reportType, setReportType] = useState('consolidated')
  const [dateFrom,   setDateFrom  ] = useState('')
  const [dateTo,     setDateTo    ] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)

  const filteredForPDF = useMemo(() => {
    if (!dateFrom && !dateTo) return orders
    return orders.filter(o => {
      const d = (o.placedAt || o.createdAt)?.slice(0, 10)
      if (!d) return false
      if (dateFrom && d < dateFrom) return false
      if (dateTo   && d > dateTo)   return false
      return true
    })
  }, [orders, dateFrom, dateTo])

  const applyPreset = p => { setDateFrom(p.from()); setDateTo(p.to()) }

  const handlePDF = async () => {
    setPdfLoading(true)
    try {
      await generatePDF(filteredForPDF, dateFrom, dateTo, reportType)
    } catch (e) {
      console.error(e)
      alert('PDF generation failed.\n\nMake sure jspdf and jspdf-autotable are installed:\nnpm install jspdf jspdf-autotable')
    } finally {
      setPdfLoading(false)
    }
  }

  const handleCSV = () => downloadCSV(reportType, secret, dateFrom, dateTo, setExporting)
  const isBusy = pdfLoading || !!exporting

  const pill = (active) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500,
    cursor: 'pointer', transition: 'all .15s',
    border: active ? '1px solid var(--color-text-primary)' : '1px solid var(--color-border-tertiary)',
    background: active ? 'var(--color-text-primary)' : 'var(--color-background-primary)',
    color: active ? 'var(--color-background-primary)' : 'var(--color-text-secondary)',
  })

  const presetPill = {
    padding: '4px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
    border: '1px solid var(--color-border-tertiary)',
    background: 'var(--color-background-primary)',
    color: 'var(--color-text-secondary)', transition: 'border-color .15s',
  }

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
          marginTop: 8, padding: '18px 20px',
          border: '1px solid var(--color-border-tertiary)', borderRadius: 12,
          background: 'var(--color-background-secondary)',
        }}>

          {/* Report type */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: .5 }}>Report type</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {REPORT_TYPES.map(r => (
                <button key={r.key} onClick={() => setReportType(r.key)} title={r.desc} style={pill(reportType === r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date range */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: .5 }}>Date range</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {DATE_PRESETS.map(p => (
                <button key={p.label} onClick={() => applyPreset(p)} style={presetPill}>{p.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {[['From', dateFrom, setDateFrom], ['To', dateTo, setDateTo]].map(([lbl, val, set]) => (
                <label key={lbl} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  {lbl}
                  <input
                    type="date" value={val} onChange={e => set(e.target.value)}
                    style={{
                      padding: '6px 10px', borderRadius: 6, fontSize: 12,
                      border: '1px solid var(--color-border-tertiary)',
                      background: 'var(--color-background-primary)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                </label>
              ))}
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo('') }}
                  style={{ padding: '6px 10px', borderRadius: 6, fontSize: 11, border: '1px solid var(--color-border-tertiary)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer' }}
                >
                  Clear
                </button>
              )}
            </div>
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
              {(dateFrom || dateTo)
                ? `${filteredForPDF.length} of ${orders.length} orders match this range`
                : `All ${orders.length} orders will be included`}
            </p>
          </div>

          {/* Download buttons */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={handleCSV} disabled={isBusy}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.5 : 1,
                border: '1px solid var(--color-border-secondary)',
                background: 'var(--color-background-primary)',
                color: 'var(--color-text-primary)', transition: 'all .15s',
              }}
            >
              {exporting
                ? <svg style={{ animation: 'adm-spin .7s linear infinite' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              }
              {exporting ? 'Exporting…' : 'Download CSV'}
            </button>

            <button
              onClick={handlePDF} disabled={isBusy}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.5 : 1,
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

            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              PDF: in-browser · CSV: server
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminSalesDashboardPage() {
  const { user: authUser, ready } = useRoleGuard(['admin', 'staff'], '/')

  const [orders,    setOrders   ] = useState([])
  const [loading,   setLoading  ] = useState(true)
  const [error,     setError    ] = useState('')
  const [period,    setPeriod   ] = useState('daily')
  const [exporting, setExporting] = useState(null)

  useEffect(() => {
    const secret = getAdminSecret()
    if (!secret) { setError('Enter the admin secret first.'); setLoading(false); return }
    fetch('/api/admin/orders', { headers: { 'X-Admin-Secret': secret } })
      .then(r => r.json())
      .then(d => { if (d.ok) setOrders(d.orders || []); else setError(d.error || 'Failed') })
      .catch(() => setError('Could not load orders.'))
      .finally(() => setLoading(false))
  }, [])

  const completed      = useMemo(() => orders.filter(isRevenueCounting), [orders])
  const revenue        = useMemo(() => completed.reduce((s, o) => s + Number(o.total || 0), 0), [completed])
  const completedCount = completed.length
  const fulfillRate    = orders.length ? Math.round(completedCount / orders.length * 100) : 0
  const aov            = completed.length ? revenue / completed.length : 0
  const activeCount    = useMemo(() => orders.filter(o => ACTIVE_STATUSES.has(o.status)).length, [orders])
  const pendingProofCount = useMemo(() => orders.filter(o => o.proofStatus === 'pending').length, [orders])
  const revenueData    = useMemo(() => buildRevenueData(orders, period), [orders, period])

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

  const secret  = typeof window !== 'undefined' ? getAdminSecret() : ''
  const isAdmin = authUser?.role === 'admin'

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

      {isAdmin && (
        <ExportPanel orders={orders} secret={secret} exporting={exporting} setExporting={setExporting} />
      )}

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