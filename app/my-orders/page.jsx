'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser } from '../utils/authClient'
import { useGowns, getGownById } from '@/hooks/useGowns'


function formatPrice(num) {
  return '₱' + Number(num || 0).toLocaleString('en-PH')
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function formatDeliveryLine(delivery) {
  if (!delivery) return '—'
  return (
    [delivery.address, delivery.city, delivery.province].filter(Boolean).join(', ') +
    (delivery.zip ? ` ${delivery.zip}` : '') || '—'
  )
}

function formatContactLine(contact) {
  const name = `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim()
  return name || contact?.email || '—'
}


const STATUS_CONFIG = {
  placed:    { label: 'Placed',    progress: 20,  badgeClass: 'mo-badge-placed',    cancelled: false },
  paid:      { label: 'Paid',      progress: 40,  badgeClass: 'mo-badge-paid',      cancelled: false },
  preparing: { label: 'Preparing', progress: 60,  badgeClass: 'mo-badge-preparing', cancelled: false },
  shipped:   { label: 'Shipped',   progress: 80,  badgeClass: 'mo-badge-shipped',   cancelled: false },
  delivered: { label: 'Delivered', progress: 100, badgeClass: 'mo-badge-delivered', cancelled: false },
  cancelled: { label: 'Cancelled', progress: 20,  badgeClass: 'mo-badge-cancelled', cancelled: true  },
}

const STEPS = ['Placed', 'Paid', 'Preparing', 'Shipped', 'Delivered']

function normalizeStatus(status) {
  const v = String(status || '').toLowerCase()
  return STATUS_CONFIG[v] ? v : 'placed'
}

const FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'placed',    label: 'Placed' },
  { id: 'paid',      label: 'Paid' },
  { id: 'preparing', label: 'Preparing' },
  { id: 'shipped',   label: 'Shipped' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'cancelled', label: 'Cancelled' },
]

function ProgressBar({ status }) {
  const cfg       = STATUS_CONFIG[status] || STATUS_CONFIG.placed
  const stepIdx   = STEPS.findIndex(s => s.toLowerCase() === status)
  const isCancelled = cfg.cancelled

  return (
    <div className="mo-progress">
      <div className="mo-progress-track">
        <div
          className={`mo-progress-fill${isCancelled ? ' cancelled' : ''}`}
          style={{ width: `${cfg.progress}%` }}
        />
      </div>
      <div className="mo-progress-steps">
        {STEPS.map((step, i) => {
          const done         = !isCancelled && i < stepIdx
          const active       = !isCancelled && i === stepIdx
          const cancelledStop = isCancelled && i === 0
          let cls = 'mo-progress-step'
          if (done || cancelledStop) cls += cancelledStop ? ' cancelled-stop' : ' done'
          else if (active) cls += ' active'
          return <span key={step} className={cls}>{step}</span>
        })}
      </div>
    </div>
  )
}

function OrderCard({ order, gowns }) {
  const [expanded, setExpanded] = useState(false)
  const status    = normalizeStatus(order.status)
  const cfg       = STATUS_CONFIG[status]

  return (
    <li className="mo-card">

      <div className="mo-card-head">
        <div>
          <p className="mo-order-id">Order #{order.id}</p>
          <p className="mo-order-date">{formatDate(order.createdAt)}</p>
          <p className="mo-order-contact">{formatContactLine(order.contact)}</p>
        </div>
        <span className={`mo-badge ${cfg.badgeClass}`}>{cfg.label}</span>
      </div>

      <ProgressBar status={status} />

      {expanded && (
        <>
          <div className="mo-info-row">
            <div>
              <span className="mo-info-label">Delivery address</span>
              <p className="mo-info-value">{formatDeliveryLine(order.delivery)}</p>
            </div>
            <div>
              <span className="mo-info-label">Payment method</span>
              <p className="mo-info-value">{order.payment || '—'}</p>
            </div>
            {order.note && (
              <div style={{ gridColumn: '1 / -1' }}>
                <span className="mo-info-label">Note</span>
                <p className="mo-info-value">{order.note}</p>
              </div>
            )}
          </div>

          <div className="mo-items">
            {Array.isArray(order.items) && order.items.length > 0
              ? order.items.map((item, idx) => {
                  const gown = getGownById(gowns, item.id)
                  return (
                    <div key={`${order.id}-${idx}`} className="mo-item">
                      {gown?.image
                        ? <img src={gown.image} alt={gown.alt || item.name || 'Gown'} className="mo-item-img" />
                        : <div className="mo-item-img-placeholder" />
                      }
                      <div className="mo-item-info">
                        <p className="mo-item-name">{item.name || 'Gown'}</p>
                        <p className="mo-item-meta">
                          Qty: {item.qty}{item.price ? ` · Unit: ${item.price}` : ''}
                        </p>
                        <p className="mo-item-sub">{formatPrice(item.subtotal)}</p>
                      </div>
                    </div>
                  )
                })
              : <p className="mo-no-items">No items on record.</p>
            }
          </div>
        </>
      )}

      <div className="mo-card-foot">
        <p className="mo-foot-detail">
          {Array.isArray(order.items) ? order.items.length : 0} item(s)
          {order.payment ? ` · ${order.payment}` : ''}
          {cfg.cancelled ? ' · Cancelled' : ''}
        </p>
        <div className="mo-foot-right">
          <button className="mo-expand-btn" onClick={() => setExpanded(v => !v)}>
            {expanded ? 'Hide details ▲' : 'Show details ▼'}
          </button>
          <span className={`mo-foot-total${cfg.cancelled ? ' cancelled' : ''}`}>
            {formatPrice(order.total ?? order.subtotal)}
          </span>
        </div>
      </div>
    </li>
  )
}


export default function MyOrdersPage() {
  const [user,    setUser]    = useState(null)
  const [orders,  setOrders]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [filter,  setFilter]  = useState('all')
  const { gowns } = useGowns()

  useEffect(() => { setUser(getCurrentUser() || null) }, [])

  const fetchOrders = useCallback(async (signal) => {
    try {
      const res  = await fetch('/api/my-orders', {
        headers: { 'X-Customer-Email': user.email },
        signal,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(data.error || 'Could not load your orders.')
        setOrders([])
      } else {
        setOrders(data.orders || [])
        setError('')
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError('Could not load your orders.')
    } finally {
      setLoading(false)
    }
  }, [user?.email])

  useEffect(() => {
    if (!user?.email) return
    setLoading(true)
    const controller = new AbortController()
    fetchOrders(controller.signal)
    const interval = setInterval(() => fetchOrders(controller.signal), 5000)
    return () => { controller.abort(); clearInterval(interval) }
  }, [fetchOrders, user?.email])

  const filtered = filter === 'all'
    ? orders
    : orders.filter(o => normalizeStatus(o.status) === filter)

  if (!user) return (
    <main className="gowns-page">
      <Header solid />
      <section className="gowns-header-spacer" />
      <section className="checkout-section">
        <div className="checkout-container">
          <h1 className="mo-page-title">My orders</h1>
          <p className="mo-unauthenticated">Please log in to view your orders.</p>
          <Link href="/login" className="btn btn-primary">Log in</Link>
        </div>
      </section>
      <Footer />
    </main>
  )

  return (
    <main className="gowns-page">
      <Header solid />
      <section className="gowns-header-spacer" />
      <section className="checkout-section">
        <div className="checkout-container mo-page">

          <div className="mo-header-row">
            <h1 className="mo-page-title">My orders</h1>
            <span className="mo-order-count">
              {filtered.length} {filtered.length === 1 ? 'order' : 'orders'}
            </span>
          </div>

          <p className="mo-email-hint">
            Purchases placed with <strong>{user.email}</strong> appear here.
          </p>

          <div className="mo-filter-row">
            {FILTERS.map(f => (
              <button
                key={f.id}
                className={`mo-filter-btn${filter === f.id ? ' active' : ''}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loading && <p className="mo-loading">Loading your orders…</p>}
          {error   && <p className="auth-error">{error}</p>}

          {!loading && !error && filtered.length === 0 && (
            <div className="mo-empty">
              <p>
                {filter === 'all'
                  ? "You haven't placed any orders yet."
                  : `No ${filter} orders found.`}
              </p>
              {filter === 'all' && (
                <Link href="/gowns" className="btn btn-primary">Browse gowns</Link>
              )}
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <ul className="mo-list">
              {filtered.map(o => (
                <OrderCard key={o.id} order={o} gowns={gowns} />
              ))}
            </ul>
          )}

          <p className="mo-back-link">
            <Link href="/profile">← Back to profile</Link>
          </p>
        </div>
      </section>
      <Footer />
    </main>
  )
}