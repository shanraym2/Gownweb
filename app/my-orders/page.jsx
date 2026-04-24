'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser } from '../utils/authClient'

const STATUS_COLORS = {
  placed:          { bg:'#e8f0ff', color:'#2d5be3' },
  pending_payment: { bg:'#fff3cd', color:'#856404' },
  paid:            { bg:'#d4edda', color:'#155724' },
  processing:      { bg:'#e2d9f3', color:'#4a2c82' },
  ready:           { bg:'#cff4fc', color:'#0a5276' },
  shipped:         { bg:'#d1ecf1', color:'#0c5460' },
  completed:       { bg:'#d4edda', color:'#155724' },
  cancelled:       { bg:'#f8d7da', color:'#721c24' },
  refunded:        { bg:'#fce8d4', color:'#7a3608' },
}

const PAYMENT_STATUS_COLORS = {
  unpaid:   { bg:'#f8d7da', color:'#721c24' },
  pending:  { bg:'#fff3cd', color:'#856404' },
  paid:     { bg:'#d4edda', color:'#155724' },
  failed:   { bg:'#f8d7da', color:'#721c24' },
  refunded: { bg:'#fce8d4', color:'#7a3608' },
}

function Badge({ status, type = 'order' }) {
  const map    = type === 'payment' ? PAYMENT_STATUS_COLORS : STATUS_COLORS
  const colors = map[status] || { bg:'#f0e6d3', color:'#6b3f2a' }
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', padding:'2px 8px',
      borderRadius:20, fontSize:10, fontWeight:500, letterSpacing:'.04em',
      textTransform:'capitalize', whiteSpace:'nowrap',
      background: colors.bg, color: colors.color,
    }}>
      {(status||'').replace(/_/g,' ')}
    </span>
  )
}

function fmtPhp(n)    { return '₱' + Number(n||0).toLocaleString('en-PH') }
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' })
}

export default function MyOrdersPage() {
  const [orders,  setOrders ] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError  ] = useState('')
  const [open,    setOpen   ] = useState(null)  // expanded order id
  

  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    setUser(getCurrentUser())
    setAuthReady(true)
  }, [])

  useEffect(() => {
  if (!authReady) return
  if (!user) {
    setLoading(false)  // no user, nothing to fetch
    return
  }
  fetch(`/api/orders?userId=${user.id}`, { headers: { 'x-user-id': user.id } })
    .then(r => r.json())
    .then(d => {
      if (d.ok) setOrders(d.orders || [])
      else setError(d.error || 'Could not load orders.')
    })
    .catch(() => setError('Could not connect.'))
    .finally(() => setLoading(false))
}, [user, authReady])

  

  const handleConfirmReceipt = async orderId => {
    if (!user) return
    const res  = await fetch('/api/orders', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
      body:    JSON.stringify({ orderId, status: 'completed' }),
    })
    const data = await res.json()
    if (data.ok) setOrders(p => p.map(o => o.id === orderId ? { ...o, status: 'completed' } : o))
  }

  if (!authReady) return null  // or a loading spinner

  if (!user) return (
    <main className="mo-page">
      <Header solid />
      <div className="mo-spacer" />
      <div className="mo-empty">
        <p>Please <Link href="/login">log in</Link> to view your orders.</p>
      </div>
      <Footer />
    </main>
  )

  return (
    <main className="mo-page">
      <Header solid />
      <div className="mo-spacer" />

      <section className="mo-hero">
        <span className="mo-eyebrow">My Account</span>
        <h1 className="mo-h1">My Orders</h1>
        <p className="mo-sub">Track all your orders and upload payment proof here.</p>
      </section>

      <div className="mo-content">
        {loading ? (
          <p className="mo-muted">Loading your orders…</p>
        ) : error ? (
          <p className="mo-error">{error}</p>
        ) : orders.length === 0 ? (
          <div className="mo-empty">
            <p className="mo-empty-title">No orders yet</p>
            <p className="mo-empty-sub">When you place an order it will appear here.</p>
            <Link href="/gowns" className="mo-btn">Browse collection</Link>
          </div>
        ) : (
          <div className="mo-list">
            {orders.map(order => (
              <div key={order.id} className="mo-order">
                {/* Order header — always visible */}
                <div className="mo-order-head" onClick={() => setOpen(p => p === order.id ? null : order.id)}>
                  <div className="mo-order-meta">
                    <p className="mo-order-num">{order.orderNumber}</p>
                    <p className="mo-order-date">{fmtDate(order.placedAt)}</p>
                  </div>
                  <div className="mo-order-badges">
                    <Badge status={order.status} />
                    <Badge status={order.paymentStatus} type="payment" />
                  </div>
                  <div className="mo-order-total">{fmtPhp(order.total)}</div>
                  <span className={`mo-chevron${open === order.id ? ' open' : ''}`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </span>
                </div>

                {/* Expanded detail */}
                {open === order.id && (
                  <div className="mo-order-body">
                    {/* Items */}
                    <div className="mo-order-section">
                      <p className="mo-section-title">Items</p>
                      <div className="mo-items">
                        {(order.items||[]).map((item, i) => (
                          <div key={i} className="mo-item">
                            <span className="mo-item-name">
                              {item.gownName}{item.sizeLabel ? ` — ${item.sizeLabel}` : ''}
                            </span>
                            <span className="mo-item-qty">×{item.quantity||1}</span>
                            <span className="mo-item-price">
                              {fmtPhp((item.unitPrice||0)*(item.quantity||1))}
                            </span>
                          </div>
                        ))}
                        <div className="mo-items-total">
                          <span>Total</span><span>{fmtPhp(order.total)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Delivery */}
                    <div className="mo-order-section">
                      <p className="mo-section-title">Delivery</p>
                      <div className="mo-detail-rows">
                        <div className="mo-detail-row">
                          <span>Method</span>
                          <span>{order.deliveryMethod === 'pickup' ? 'Store Pickup' : 'Lalamove'}</span>
                        </div>
                        {order.deliveryAddress && (
                          <div className="mo-detail-row">
                            <span>Address</span><span>{order.deliveryAddress}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Payment */}
                    <div className="mo-order-section">
                      <p className="mo-section-title">Payment</p>
                      <div className="mo-detail-rows">
                        <div className="mo-detail-row">
                          <span>Method</span>
                          <span>{{ gcash:'GCash', bdo:'BDO', cash:'Cash on Pickup' }[order.paymentMethod] || order.paymentMethod}</span>
                        </div>
                        <div className="mo-detail-row">
                          <span>Status</span><Badge status={order.paymentStatus} type="payment" />
                        </div>
                      </div>

                      {/* Upload proof — only for unpaid GCash/BDO orders */}
                      {order.paymentMethod !== 'cash' &&
                       !['paid','refunded','cancelled'].includes(order.paymentStatus) && (
                        <div className="mo-proof-cta">
                          <p className="mo-proof-hint">
                            {order.paymentStatus === 'pending'
                              ? '✓ Proof uploaded — awaiting admin verification'
                              : 'Proof of payment not yet uploaded.'}
                          </p>
                          {order.paymentStatus !== 'pending' && (
                            <Link href={`/order-confirmation/${order.id}`} className="mo-btn mo-btn--sm">
                              Upload proof →
                            </Link>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Confirm receipt */}
                    {['ready','shipped'].includes(order.status) && (
                      <div className="mo-order-section mo-receipt-section">
                        <p className="mo-section-title">Received your order?</p>
                        <p className="mo-receipt-hint">Confirm once you have your gown in hand.</p>
                        <button className="mo-btn" onClick={() => handleConfirmReceipt(order.id)}>
                          Yes, I've received my order
                        </button>
                      </div>
                    )}

                    {order.status === 'completed' && (
                      <div className="mo-order-section">
                        <p style={{ fontSize:13, color:'#155724', display:'flex', alignItems:'center', gap:6 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                          Order completed — thank you!
                        </p>
                      </div>
                    )}

                    <div className="mo-order-section mo-order-links">
                      <Link href={`/order-confirmation/${order.id}`} className="mo-link">
                        Full order details →
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Footer />
    </main>
  )
}
