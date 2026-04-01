'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser } from '../utils/authClient'
import { useGowns, getGownById } from '@/hooks/useGowns'

function formatPrice(num) {
  return '₱' + Number(num || 0).toLocaleString('en-PH')
}

const ORDER_STATUS_LABELS = {
  placed: 'Placed',
  paid: 'Paid',
  preparing: 'Preparing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

function normalizeStatus(status) {
  const v = String(status || '').toLowerCase()
  return Object.keys(ORDER_STATUS_LABELS).includes(v) ? v : 'placed'
}

function formatDeliveryLine(delivery) {
  if (!delivery) return '—'
  const parts = [delivery.address, delivery.city, delivery.province].filter(Boolean)
  let line = parts.join(', ')
  if (delivery.zip) line += ` ${delivery.zip}`
  return line || '—'
}

function formatContactLine(contact) {
  const first = contact?.firstName || ''
  const last = contact?.lastName || ''
  const name = `${first} ${last}`.trim()
  const email = contact?.email || ''
  return name || email || '—'
}

export default function MyOrdersPage() {
  const [user, setUser] = useState(null)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { gowns } = useGowns()

  useEffect(() => {
    const u = getCurrentUser()
    if (!u) {
      setUser(null)
      setLoading(false)
      return
    }
    setUser(u)
  }, [])

  useEffect(() => {
    if (!user?.email) return

    let cancelled = false
    let isFirst = true

    const fetchOrders = async () => {
      try {
        const res = await fetch('/api/my-orders', {
          headers: { 'X-Customer-Email': user.email },
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || !data.ok) {
          setError(data.error || 'Could not load your orders.')
          setOrders([])
          return
        }
        setOrders(data.orders || [])
      } catch {
        if (!cancelled) setError('Could not load your orders.')
      } finally {
        if (!cancelled) {
          if (isFirst) setLoading(false)
          isFirst = false
        }
      }
    }

    setLoading(true)
    setError('')
    fetchOrders()
    const interval = setInterval(fetchOrders, 5000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [user?.email])

  if (!user) {
    return (
      <main className="gowns-page">
        <Header  solid/>
        <section className="gowns-header-spacer" />
        <section className="checkout-section">
          <div className="checkout-container">
            <h1 className="cart-title">My orders</h1>
            <p className="order-detail-hint">
              Please log in to see your orders.
            </p>
            <Link href="/login" className="btn btn-primary">
              Log in
            </Link>
          </div>
        </section>
        <Footer />
      </main>
    )
  }

  return (
    <main className="gowns-page">
      <Header />
      <section className="gowns-header-spacer" />
      <section className="checkout-section">
        <div className="checkout-container my-orders-page">
          <h1 className="cart-title">My orders</h1>
          <p className="my-orders-intro">
            Purchases placed with <strong>{user.email}</strong> at checkout appear here.
          </p>

          {loading && <p>Loading your orders…</p>}
          {error && <p className="auth-error">{error}</p>}

          {!loading && !error && orders.length === 0 && (
            <div className="my-orders-empty">
              <p>You have no orders yet.</p>
              <Link href="/gowns" className="btn btn-primary" style={{ marginTop: 16 }}>
                Browse gowns
              </Link>
            </div>
          )}

          {!loading && !error && orders.length > 0 && (
            <ul className="my-orders-list">
              {orders.map((o) => (
                <li key={o.id} className="my-orders-card">
                  <div className="my-orders-card-top">
                    <div>
                      <strong>Order #{o.id}</strong>
                      <p className="my-orders-date">
                        {o.createdAt ? new Date(o.createdAt).toLocaleString() : '—'}
                      </p>
                      <p className="my-orders-summary" style={{ marginTop: 6 }}>
                        Contact: {formatContactLine(o.contact)}
                      </p>
                    </div>
                    {(() => {
                      const status = normalizeStatus(o.status)
                      return (
                        <span className={`order-status-badge order-status-${status}`}>
                          {ORDER_STATUS_LABELS[status] || status}
                        </span>
                      )
                    })()}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <p className="my-orders-payment" style={{ margin: '6px 0' }}>
                      Delivery: {formatDeliveryLine(o.delivery)}
                    </p>
                    <p className="my-orders-payment" style={{ margin: '6px 0' }}>
                      Payment: {o.payment || '—'}
                    </p>
                    {o.note ? (
                      <p className="my-orders-payment" style={{ margin: '6px 0' }}>
                        Note: {o.note}
                      </p>
                    ) : null}
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <h3 className="checkout-heading" style={{ margin: '0 0 12px', fontSize: '1.1rem' }}>
                      Items
                    </h3>
                    {Array.isArray(o.items) && o.items.length > 0 ? (
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {o.items.map((item, idx) => {
                          const gown = getGownById(gowns, item.id)
                          return (
                            <li key={`${o.id}-${idx}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                              {gown?.image ? (
                                <img
                                  src={gown.image}
                                  alt={gown.alt || item.name || 'Gown'}
                                  style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', background: '#f0ebe5' }}
                                />
                              ) : (
                                <div style={{ width: 64, height: 64, borderRadius: 10, background: '#f0ebe5' }} />
                              )}
                              <div style={{ flex: 1 }}>
                                <strong>{item.name || 'Gown'}</strong>
                                <p style={{ margin: '4px 0', color: 'var(--color-text-light)' }}>
                                  Qty: {item.qty} {item.price ? `· Unit: ${item.price}` : ''}
                                </p>
                                <p style={{ margin: '6px 0 0', fontWeight: 600 }}>
                                  Subtotal: {formatPrice(item.subtotal)}
                                </p>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    ) : (
                      <p className="my-orders-payment" style={{ margin: 0 }}>
                        No items found.
                      </p>
                    )}
                  </div>

                  <div className="my-orders-card-bottom">
                    <span className="my-orders-total">{formatPrice(o.subtotal)}</span>
                    <span className="my-orders-payment">Status: {ORDER_STATUS_LABELS[normalizeStatus(o.status)]}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p style={{ marginTop: 28 }}>
            <Link href="/profile">← Profile</Link>
          </p>
        </div>
      </section>
      <Footer />
    </main>
  )
}

