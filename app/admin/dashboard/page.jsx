'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement, Tooltip,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { getAdminSecret } from '../layout'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip)

const STATUSES = ['placed','paid','preparing','shipped','delivered','cancelled']
const STATUS_COLORS = {
  placed:'#378ADD', paid:'#639922', preparing:'#7F77DD',
  shipped:'#1D9E75', delivered:'#3B6D11', cancelled:'#E24B4A',
}

function fmtPhp(n)    { return '₱' + Math.round(n).toLocaleString('en-PH') }
function fmtDate(iso) { if (!iso) return ''; return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) }

function buildRevenueData(orders, period) {
  const paid = orders.filter(o => o.status !== 'cancelled')
  const now  = new Date()
  if (period === 'daily') {
    const days = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i)
      days.push({ key: d.toISOString().slice(0,10), label: d.toLocaleDateString('en-PH', { month:'short', day:'numeric' }), total: 0 })
    }
    for (const o of paid) { const d = days.find(x => x.key === o.createdAt?.slice(0,10)); if (d) d.total += Number(o.subtotal||0) }
    return { labels: days.map(d => d.label), data: days.map(d => d.total) }
  }
  if (period === 'monthly') {
    const months = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: d.toLocaleDateString('en-PH', { month:'short', year:'2-digit' }), total: 0 })
    }
    for (const o of paid) {
      const d = new Date(o.createdAt)
      const m = months.find(x => x.key === `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)
      if (m) m.total += Number(o.subtotal||0)
    }
    return { labels: months.map(m => m.label), data: months.map(m => m.total) }
  }
  const years = {}
  for (const o of paid) { const y = new Date(o.createdAt).getFullYear(); years[y] = (years[y]||0) + Number(o.subtotal||0) }
  const ks = Object.keys(years).sort()
  return { labels: ks, data: ks.map(k => years[k]) }
}

// ── Export helper ─────────────────────────────────────────────────────────────

async function downloadReport(type, secret, setExporting) {
  setExporting(type)
  try {
    const res = await fetch(`/api/admin/export?type=${type}`, {
      headers: { 'X-Admin-Secret': secret },
    })
    if (!res.ok) { alert('Export failed. Please try again.'); return }
    const blob     = await res.blob()
    const url      = URL.createObjectURL(blob)
    const a        = document.createElement('a')
    const filename = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || `jce-${type}.csv`
    a.href     = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    alert('Export failed. Please try again.')
  } finally {
    setExporting(null)
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminSalesDashboardPage() {
  const [orders,    setOrders   ] = useState([])
  const [loading,   setLoading  ] = useState(true)
  const [error,     setError    ] = useState('')
  const [period,    setPeriod   ] = useState('daily')
  const [exporting, setExporting] = useState(null)  // which report is downloading

  useEffect(() => {
    const secret = getAdminSecret()
    if (!secret) { setError('Enter the admin secret first.'); setLoading(false); return }
    fetch('/api/admin/orders', { headers: { 'X-Admin-Secret': secret } })
      .then(r => r.json())
      .then(d => { if (d.ok) setOrders(d.orders||[]); else setError(d.error||'Failed') })
      .catch(() => setError('Could not load.'))
      .finally(() => setLoading(false))
  }, [])

  const paid        = useMemo(() => orders.filter(o => o.status !== 'cancelled'), [orders])
  const revenue     = useMemo(() => paid.reduce((s,o) => s + Number(o.subtotal||0), 0), [paid])
  const aov         = paid.length ? revenue / paid.length : 0
  const delivered   = useMemo(() => orders.filter(o => o.status === 'delivered').length, [orders])
  const fulfillRate = orders.length ? Math.round(delivered / orders.length * 100) : 0

  const revenueData = useMemo(() => buildRevenueData(orders, period), [orders, period])

  const topItems = useMemo(() => {
    const counts = {}
    for (const o of paid)
      for (const it of (o.items||[]))
        counts[it.name] = (counts[it.name]||0) + (it.qty||1)
    return Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,6)
  }, [paid])

  const statusLabels = STATUSES.filter(s => orders.some(o => o.status === s))
  const statusCounts = useMemo(() => {
    const c = {}; for (const s of STATUSES) c[s] = 0
    for (const o of orders) if (c[o.status] !== undefined) c[o.status]++
    return c
  }, [orders])

  const secret = typeof window !== 'undefined' ? getAdminSecret() : ''

  const tickColor = '#999'
  const gridColor = 'rgba(0,0,0,0.05)'

  const barOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtPhp(ctx.parsed.y) } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: tickColor, font: { size: 10 }, maxTicksLimit: 12, maxRotation: 45 } },
      y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 10 }, callback: v => v>=1e6?'₱'+(v/1e6).toFixed(1)+'M':v>=1000?'₱'+(v/1000).toFixed(0)+'k':'₱'+v } },
    },
  }

  const donutData = {
    labels: statusLabels,
    datasets: [{ data: statusLabels.map(s => statusCounts[s]), backgroundColor: statusLabels.map(s => STATUS_COLORS[s]), borderWidth: 0, hoverOffset: 4 }],
  }
  const donutOptions = { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false } } }

  if (loading) return <p className="adm-muted">Loading dashboard…</p>
  if (error)   return <p className="adm-error-msg">{error}</p>

  return (
    <div className="adm-sales-page">
      <style>{`
        .adm-export-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:24px;padding:16px 20px;border:1px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);background:var(--color-background-secondary);}
        .adm-export-lbl{font-size:12px;font-weight:500;color:var(--color-text-secondary);margin-right:4px;white-space:nowrap;}
        .adm-export-btn{display:flex;align-items:center;gap:6px;padding:7px 14px;border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-md);background:var(--color-background-primary);color:var(--color-text-primary);font-size:12px;font-weight:500;cursor:pointer;transition:border-color .15s,background .15s;white-space:nowrap;}
        .adm-export-btn:hover:not(:disabled){border-color:var(--color-border-primary);background:var(--color-background-primary);}
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
      </div>

      <div className="adm-metrics">
        <div className="adm-metric">
          <div className="adm-metric-lbl">Total revenue</div>
          <div className="adm-metric-val">{fmtPhp(revenue)}</div>
          <div className="adm-metric-sub">Excl. cancelled</div>
        </div>
        <div className="adm-metric">
          <div className="adm-metric-lbl">Total orders</div>
          <div className="adm-metric-val">{orders.length}</div>
          <div className="adm-metric-sub">{paid.length} active</div>
        </div>
        <div className="adm-metric">
          <div className="adm-metric-lbl">Avg order value</div>
          <div className="adm-metric-val">{fmtPhp(aov)}</div>
          <div className="adm-metric-sub">Per paid order</div>
        </div>
        <div className="adm-metric">
          <div className="adm-metric-lbl">Fulfillment rate</div>
          <div className="adm-metric-val">{fulfillRate}%</div>
          <div className={fulfillRate >= 70 ? 'adm-metric-sub-up' : 'adm-metric-sub-down'}>
            {delivered} delivered
          </div>
        </div>
      </div>

      <div className="adm-chart-card">
        <div className="adm-chart-head">
          <span className="adm-chart-title">Revenue over time</span>
          <div className="adm-period-pills">
            {['daily','monthly','yearly'].map(p => (
              <button key={p} onClick={() => setPeriod(p)} className={`adm-period-pill${period===p?' active':''}`}>
                {p.charAt(0).toUpperCase()+p.slice(1)}
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
      </div>

      <div className="adm-two-col">
        <div className="adm-chart-card">
          <div className="adm-chart-title" style={{ marginBottom: 14 }}>Top items sold</div>
          {topItems.length === 0
            ? <p className="adm-muted">No data yet.</p>
            : topItems.map(([name, qty], i) => (
                <div key={name} className="adm-top-row">
                  <span className="adm-top-rank">#{i+1}</span>
                  <span className="adm-top-name">{name}</span>
                  <div className="adm-top-bar-bg">
                    <div className="adm-top-bar-fill" style={{ width: `${Math.round(qty/(topItems[0]?.[1]||1)*100)}%` }} />
                  </div>
                  <span className="adm-top-qty">{qty} sold</span>
                </div>
              ))
          }
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
                  <span className="adm-donut-dot" style={{ background: STATUS_COLORS[s] }} />
                  <span className="adm-donut-legend-lbl">{s}</span>
                  <span className="adm-donut-legend-cnt">{statusCounts[s]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Link href="/admin" className="adm-back-link">← Admin home</Link>
    </div>
  )
}