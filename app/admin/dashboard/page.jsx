'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const ADMIN_SECRET_KEY = 'jce_admin_secret'
const STATUSES = ['placed','paid','preparing','shipped','delivered','cancelled']
const STATUS_COLORS = {
  placed:    '#378ADD',
  paid:      '#639922',
  preparing: '#7F77DD',
  shipped:   '#1D9E75',
  delivered: '#3B6D11',
  cancelled: '#E24B4A',
}

function fmtPhp(n) {
  return '₱' + Math.round(n).toLocaleString('en-PH')
}

function MetricCard({ label, value, sub, subClass }) {
  return (
    <div style={{ flex: 1, minWidth: 130, background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6, letterSpacing: '.02em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, marginTop: 5, color: subClass === 'up' ? '#3B6D11' : subClass === 'down' ? '#A32D2D' : 'var(--color-text-tertiary)' }}>{sub}</div>}
    </div>
  )
}

function PeriodPills({ period, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {['daily','monthly','yearly'].map(p => (
        <button key={p} onClick={() => onChange(p)} style={{
          fontSize: 11, padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
          border: '0.5px solid var(--color-border-secondary)',
          background: period === p ? 'var(--color-text-primary)' : 'transparent',
          color: period === p ? 'var(--color-background-primary)' : 'var(--color-text-secondary)',
          fontWeight: period === p ? 500 : 400,
        }}>
          {p.charAt(0).toUpperCase() + p.slice(1)}
        </button>
      ))}
    </div>
  )
}

function buildRevenueData(orders, period) {
  const paid = orders.filter(o => o.status !== 'cancelled')
  const now = new Date()

  if (period === 'daily') {
    const days = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      days.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), total: 0 })
    }
    for (const o of paid) {
      const k = o.createdAt?.slice(0, 10)
      const day = days.find(d => d.key === k)
      if (day) day.total += Number(o.subtotal || 0)
    }
    return { labels: days.map(d => d.label), data: days.map(d => d.total) }
  }

  if (period === 'monthly') {
    const months = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }), total: 0 })
    }
    for (const o of paid) {
      const d = new Date(o.createdAt)
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const m = months.find(x => x.key === k)
      if (m) m.total += Number(o.subtotal || 0)
    }
    return { labels: months.map(m => m.label), data: months.map(m => m.total) }
  }

  // yearly
  const years = {}
  for (const o of paid) {
    const y = new Date(o.createdAt).getFullYear()
    years[y] = (years[y] || 0) + Number(o.subtotal || 0)
  }
  const ks = Object.keys(years).sort()
  return { labels: ks, data: ks.map(k => years[k]) }
}

export default function AdminDashboardPage() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState('daily')

  useEffect(() => {
    const secret = sessionStorage.getItem(ADMIN_SECRET_KEY)
    if (!secret) { setError('Enter the admin secret first.'); setLoading(false); return }
    fetch('/api/admin/orders', { headers: { 'X-Admin-Secret': secret } })
      .then(r => r.json())
      .then(data => { if (data.ok) setOrders(data.orders || []); else setError(data.error || 'Failed') })
      .catch(() => setError('Could not load orders.'))
      .finally(() => setLoading(false))
  }, [])

  const paid = useMemo(() => orders.filter(o => o.status !== 'cancelled'), [orders])
  const revenue = useMemo(() => paid.reduce((s, o) => s + Number(o.subtotal || 0), 0), [paid])
  const aov = paid.length ? revenue / paid.length : 0
  const delivered = useMemo(() => orders.filter(o => o.status === 'delivered').length, [orders])
  const fulfillRate = orders.length ? Math.round(delivered / orders.length * 100) : 0

  const revenueData = useMemo(() => buildRevenueData(orders, period), [orders, period])

  const topItems = useMemo(() => {
    const counts = {}
    for (const o of paid) {
      for (const it of (o.items || [])) {
        counts[it.name] = (counts[it.name] || 0) + (it.qty || 1)
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [paid])

  const statusCounts = useMemo(() => {
    const c = {}
    for (const s of STATUSES) c[s] = 0
    for (const o of orders) if (c[o.status] !== undefined) c[o.status]++
    return c
  }, [orders])

  const chartColors = { grid: 'rgba(128,128,128,0.08)', tick: '#888780' }

  const barOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtPhp(ctx.parsed.y) } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: chartColors.tick, font: { size: 10 }, maxTicksLimit: 12, maxRotation: 45 } },
      y: { grid: { color: chartColors.grid }, ticks: { color: chartColors.tick, font: { size: 10 }, callback: v => v >= 1e6 ? '₱' + (v / 1e6).toFixed(1) + 'M' : v >= 1000 ? '₱' + (v / 1000).toFixed(0) + 'k' : '₱' + v } },
    },
  }

  const statusLabels = STATUSES.filter(s => statusCounts[s] > 0)
  const donutData = {
    labels: statusLabels,
    datasets: [{ data: statusLabels.map(s => statusCounts[s]), backgroundColor: statusLabels.map(s => STATUS_COLORS[s]), borderWidth: 0, hoverOffset: 4 }],
  }
  const donutOptions = {
    responsive: true, maintainAspectRatio: false, cutout: '70%',
    plugins: { legend: { display: false } },
  }

  const card = { background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', padding: '16px 18px' }

  if (loading) return <p style={{ color: 'var(--color-text-secondary)', padding: '24px 0' }}>Loading dashboard…</p>
  if (error)   return <p style={{ color: 'var(--color-text-danger)', padding: '24px 0' }}>{error}</p>

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>Sales dashboard</h1>
        <Link href="/admin/orders" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>View orders →</Link>
      </div>

      {/* Metric cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <MetricCard label="Total revenue" value={fmtPhp(revenue)} sub="Excl. cancelled" />
        <MetricCard label="Total orders" value={orders.length} sub={`${paid.length} active`} />
        <MetricCard label="Avg order value" value={fmtPhp(aov)} sub="Per paid order" />
        <MetricCard label="Fulfillment rate" value={`${fulfillRate}%`} sub={`${delivered} delivered`} subClass={fulfillRate >= 70 ? 'up' : 'down'} />
      </div>

      {/* Revenue chart */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)' }}>Revenue over time</span>
          <PeriodPills period={period} onChange={setPeriod} />
        </div>
        <div style={{ position: 'relative', width: '100%', height: 220 }}>
          <Bar
            data={{ labels: revenueData.labels, datasets: [{ data: revenueData.data, backgroundColor: '#7F77DD', borderRadius: 4, borderSkipped: false }] }}
            options={barOptions}
          />
        </div>
      </div>

      {/* Top items + Status donut */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>

        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 14 }}>Top items sold</div>
          {topItems.length === 0 && <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>No data yet.</p>}
          {topItems.map(([name, qty], i) => {
            const pct = Math.round(qty / (topItems[0]?.[1] || 1) * 100)
            return (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < topItems.length - 1 ? '0.5px solid var(--color-border-tertiary)' : 'none' }}>
                <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-tertiary)', minWidth: 18 }}>#{i + 1}</span>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                <div style={{ width: 60, height: 5, background: 'var(--color-border-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: '#7F77DD', borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', minWidth: 48, textAlign: 'right' }}>{qty} sold</span>
              </div>
            )
          })}
        </div>

        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 14 }}>Orders by status</div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ position: 'relative', width: 110, height: 110, flexShrink: 0 }}>
              <Doughnut data={donutData} options={donutOptions} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
              {statusLabels.map(s => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[s], flexShrink: 0 }} />
                  <span style={{ flex: 1, textTransform: 'capitalize' }}>{s}</span>
                  <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{statusCounts[s]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      <Link href="/admin" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>← Admin home</Link>
    </div>
  )
}