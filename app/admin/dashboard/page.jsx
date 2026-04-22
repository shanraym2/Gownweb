'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement, Tooltip,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { getAdminSecret } from '../layout'
import { useRoleGuard } from '../../utils/useRoleGuard'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip)

// ── Status constants (mirrors orders page exactly) ────────────────────────────

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

// Terminal / negative statuses excluded from revenue
const NON_REVENUE_STATUSES = new Set(['cancelled', 'refunded'])

// "Active" = in flight, not terminal-negative, not just placed/awaiting payment
const ACTIVE_STATUSES = new Set(['paid', 'processing', 'ready', 'shipped', 'completed'])

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPhp(n)    { return '₱' + Math.round(n).toLocaleString('en-PH') }
function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

// Revenue uses `total` (not subtotal) — matches what the API route exposes
function isRevenueCounting(order) {
  return !NON_REVENUE_STATUSES.has(order.status)
}

// ── Revenue chart builder ─────────────────────────────────────────────────────

function buildRevenueData(orders, period) {
  const countable = orders.filter(isRevenueCounting)
  const now = new Date()

  if (period === 'daily') {
    const days = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i)
      days.push({ key: d.toISOString().slice(0, 10), label: fmtDate(d.toISOString()), total: 0 })
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

  // Yearly
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
  if (!nonZero.length) return { text: 'No revenue recorded in this period yet.', cls: 'info' }

  const half  = Math.floor(data.length / 2)
  const early = data.slice(0, half).reduce((a, b) => a + b, 0)
  const late  = data.slice(half).reduce((a, b) => a + b, 0)
  const pct   = early ? Math.round((late - early) / early * 100) : 0
  const peak  = Math.max(...nonZero)
  const sign  = pct > 0 ? '+' : ''

  if (pct > 15)  return { text: `Revenue is up ${pct}% in the second half of this ${period} view — positive momentum. Peak was ${fmtPhp(peak)}.`, cls: 'good' }
  if (pct < -15) return { text: `Revenue dropped ${Math.abs(pct)}% in the second half of this ${period} view — worth investigating. Peak was ${fmtPhp(peak)}.`, cls: 'warn' }
  return { text: `Revenue is relatively flat (${sign}${pct}%) across this ${period} view. Peak reached ${fmtPhp(peak)}.`, cls: 'info' }
}

function interpMetrics({ revenue, orders, aov, completedCount, fulfillRate, pendingProofCount }) {
  const cancelCount = orders.filter(o => o.status === 'cancelled').length
  const refundCount = orders.filter(o => o.status === 'refunded').length
  const cancelRate  = orders.length ? Math.round((cancelCount + refundCount) / orders.length * 100) : 0

  const revenueInterp = revenue > 50000
    ? { text: 'Strong total revenue — top-line looks healthy.', cls: 'good' }
    : revenue > 15000
      ? { text: 'Moderate revenue. Consider promotions to boost volume.', cls: 'info' }
      : { text: 'Revenue is low. Review pricing and acquisition channels.', cls: 'warn' }

  // Proof alerts take priority over cancellation rate in the orders card
  const ordersInterp = pendingProofCount > 0
    ? { text: `${pendingProofCount} order${pendingProofCount > 1 ? 's' : ''} with payment proof awaiting review.`, cls: 'warn' }
    : cancelRate > 25
      ? { text: `Cancellation/refund rate is high at ${cancelRate}%. Investigate order drop-off.`, cls: 'bad' }
      : cancelRate > 12
        ? { text: `${cancelRate}% cancellation/refund rate — slightly elevated. Monitor trends.`, cls: 'warn' }
        : { text: `Only ${cancelRate}% of orders cancelled or refunded — healthy retention.`, cls: 'good' }

  const aovInterp = aov > 1200
    ? { text: 'High average order value — customers are buying premium or multiple items.', cls: 'good' }
    : aov > 500
      ? { text: 'Average basket size is solid. Upselling bundles could push this higher.', cls: 'info' }
      : { text: 'Low AOV. Consider bundle deals or free-shipping thresholds to increase spend.', cls: 'warn' }

  const fulfillInterp = fulfillRate >= 75
    ? { text: `${fulfillRate}% fulfillment rate — operations are running smoothly.`, cls: 'good' }
    : fulfillRate >= 50
      ? { text: `Fulfillment at ${fulfillRate}% — room to improve delivery completion.`, cls: 'warn' }
      : { text: `Only ${fulfillRate}% completed. A large share of orders may be stalling — check the pipeline.`, cls: 'bad' }

  return { revenueInterp, ordersInterp, aovInterp, fulfillInterp }
}

function interpTopItems(topItems) {
  if (!topItems.length) return { text: 'No item data yet.', cls: 'info' }
  const total = topItems.reduce((s, [, q]) => s + q, 0)
  const top2  = topItems.slice(0, 2).reduce((s, [, q]) => s + q, 0)
  const pct   = Math.round(top2 / total * 100)
  if (pct > 65) return { text: `Top 2 items account for ${pct}% of units sold — high concentration. Consider diversifying the catalogue.`, cls: 'warn' }
  if (pct > 45) return { text: `Top 2 items drive ${pct}% of volume — healthy balance. "${topItems[0][0]}" leads.`, cls: 'good' }
  return { text: 'Volume is well-distributed across items — good catalogue diversity.', cls: 'info' }
}

function interpStatus(statusCounts, orders) {
  const total   = orders.length || 1
  const prepPct = Math.round(((statusCounts['processing'] || 0) + (statusCounts['ready'] || 0)) / total * 100)
  const shipPct = Math.round((statusCounts['shipped'] || 0) / total * 100)
  const pendPct = Math.round(((statusCounts['placed'] || 0) + (statusCounts['pending_payment'] || 0)) / total * 100)

  if (prepPct > 30) return { text: `${prepPct}% of orders are in processing/ready — potential packing bottleneck. Review fulfilment capacity.`, cls: 'bad' }
  if (shipPct > 20) return { text: `${shipPct}% of orders in transit. If ageing, follow up with couriers.`, cls: 'warn' }
  if (pendPct > 30) return { text: `${pendPct}% of orders are still placed or awaiting payment — consider nudging customers.`, cls: 'warn' }
  return { text: 'Order flow looks healthy — statuses are distributed with no obvious jam.', cls: 'good' }
}

// ── Interpretation pill ───────────────────────────────────────────────────────

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
      fontSize: 11,
      lineHeight: 1.55,
      padding: '7px 10px',
      borderRadius: 8,
      borderLeft: `3px solid ${s.borderColor}`,
      marginTop: 8,
      ...s,
    }}>
      {text}
    </p>
  )
}

// ── Export helper ─────────────────────────────────────────────────────────────

async function downloadReport(type, secret, setExporting) {
  setExporting(type)
  try {
    const res      = await fetch(`/api/admin/export?type=${type}`, { headers: { 'X-Admin-Secret': secret } })
    if (!res.ok)   { alert('Export failed. Please try again.'); return }
    const blob     = await res.blob()
    const url      = URL.createObjectURL(blob)
    const a        = document.createElement('a')
    const filename = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || `jce-${type}.csv`
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  } catch {
    alert('Export failed. Please try again.')
  } finally {
    setExporting(null)
  }
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

  // ── Derived stats ───────────────────────────────────────────────────────────
  // Uses `total` (not subtotal) and `placedAt` (not createdAt) — matching the API
  const countable      = useMemo(() => orders.filter(isRevenueCounting), [orders])
  const revenue        = useMemo(() => countable.reduce((s, o) => s + Number(o.total || 0), 0), [countable])
  const activeCount    = useMemo(() => orders.filter(o => ACTIVE_STATUSES.has(o.status)).length, [orders])
  const completedCount = useMemo(() => orders.filter(o => o.status === 'completed').length, [orders])
  const fulfillRate    = orders.length ? Math.round(completedCount / orders.length * 100) : 0
  const aov            = countable.length ? revenue / countable.length : 0

  // Proof alert count — same logic as orders page stats block
  const pendingProofCount = useMemo(() => orders.filter(o => o.proofStatus === 'pending').length, [orders])

  const revenueData = useMemo(() => buildRevenueData(orders, period), [orders, period])

  // Top items — uses gownName from the order_items join (falls back to name for JSON path)
  const topItems = useMemo(() => {
    const counts = {}
    for (const o of countable)
      for (const it of (o.items || []))
        counts[it.gownName || it.name] = (counts[it.gownName || it.name] || 0) + (it.quantity || it.qty || 1)
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [countable])

  // Status counts across full STATUSES list (includes pending_payment, refunded, etc.)
  const statusCounts = useMemo(() => {
    const c = {}
    for (const s of STATUSES) c[s] = 0
    for (const o of orders) if (c[o.status] !== undefined) c[o.status]++
    return c
  }, [orders])

  const statusLabels = STATUSES.filter(s => orders.some(o => o.status === s))

  // ── Interpretations ─────────────────────────────────────────────────────────
  const { revenueInterp, ordersInterp, aovInterp, fulfillInterp } = useMemo(
    () => interpMetrics({ revenue, orders, aov, completedCount, fulfillRate, pendingProofCount }),
    [revenue, orders, aov, completedCount, fulfillRate, pendingProofCount]
  )
  const chartInterp  = useMemo(() => interpRevenue(revenueData, period),      [revenueData, period])
  const itemsInterp  = useMemo(() => interpTopItems(topItems),                 [topItems])
  const statusInterp = useMemo(() => interpStatus(statusCounts, orders),       [statusCounts, orders])

  const secret = typeof window !== 'undefined' ? getAdminSecret() : ''
  const isAdmin = authUser?.role === 'admin'

  const tickColor = '#999'
  const gridColor = 'rgba(0,0,0,0.05)'

  const barOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtPhp(ctx.parsed.y) } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: tickColor, font: { size: 10 }, maxTicksLimit: 12, maxRotation: 45 } },
      y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 10 }, callback: v => v >= 1e6 ? '₱' + (v / 1e6).toFixed(1) + 'M' : v >= 1000 ? '₱' + (v / 1000).toFixed(0) + 'k' : '₱' + v } },
    },
  }

  const donutData = {
    labels: statusLabels,
    datasets: [{
      data:            statusLabels.map(s => statusCounts[s]),
      backgroundColor: statusLabels.map(s => STATUS_META[s]?.color || '#ccc'),
      borderWidth: 0, hoverOffset: 4,
    }],
  }
  const donutOptions = {
    responsive: true, maintainAspectRatio: false, cutout: '72%',
    plugins: { legend: { display: false } },
  }

  if (!ready) return null                                          
  if (loading) return <p className="adm-muted">Loading dashboard…</p>  
  if (error)   return <p className="adm-error-msg">{error}</p> 

  return (
    <div className="adm-sales-page">
      <style>{`
        .adm-export-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:24px;padding:16px 20px;border:1px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);background:var(--color-background-secondary);}
        .adm-export-lbl{font-size:12px;font-weight:500;color:var(--color-text-secondary);margin-right:4px;white-space:nowrap;}
        .adm-export-btn{display:flex;align-items:center;gap:6px;padding:7px 14px;border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-md);background:var(--color-background-primary);color:var(--color-text-primary);font-size:12px;font-weight:500;cursor:pointer;transition:border-color .15s,background .15s;white-space:nowrap;}
        .adm-export-btn:hover:not(:disabled){border-color:var(--color-border-primary);}
        .adm-export-btn:disabled{opacity:.5;cursor:not-allowed;}
        .adm-export-btn svg{flex-shrink:0;}
        .adm-export-spinning{animation:adm-spin .7s linear infinite;}
        @keyframes adm-spin{to{transform:rotate(360deg);}}
      `}</style>

      <div className="adm-sales-topbar">
        <h1 className="adm-page-title">Sales dashboard</h1>
        <Link href="/admin/orders" className="adm-back-link">View orders →</Link>
      </div>

      {/* Export bar */}
      {/* Export bar — admin only */}
      {isAdmin && (
        <div className="adm-export-bar">

        <span className="adm-export-lbl">Export report:</span>
        {[
          { type: 'orders',  label: 'All orders' },
          { type: 'items',   label: 'Line items' },
          { type: 'summary', label: 'Summary' },
        ].map(({ type, label }) => (
          <button
            key={type}
            className="adm-export-btn"
            disabled={!!exporting}
            onClick={() => downloadReport(type, secret, setExporting)}
          >
            {exporting === type ? (
              <svg className="adm-export-spinning" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            )}
            {exporting === type ? 'Exporting…' : label}
          </button>
        ))}
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>
          CSV · {orders.length} orders
        </span>
      </div>)}

      {/* Metrics */}
      <div className="adm-metrics">
        <div className="adm-metric">
          <div className="adm-metric-lbl">Total revenue</div>
          <div className="adm-metric-val">{fmtPhp(revenue)}</div>
          <div className="adm-metric-sub">Excl. cancelled &amp; refunded</div>
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
          <div className="adm-metric-val">{fmtPhp(aov)}</div>
          <div className="adm-metric-sub">Per revenue-counting order</div>
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

      {/* Revenue chart */}
      <div className="adm-chart-card">
        <div className="adm-chart-head">
          <span className="adm-chart-title">Revenue over time</span>
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

      {/* Bottom two-col */}
      <div className="adm-two-col">
        <div className="adm-chart-card">
          <div className="adm-chart-title" style={{ marginBottom: 14 }}>Top items sold</div>
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