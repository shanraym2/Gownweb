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

  const user = typeof window !== 'undefined' ? getCurrentUser() : null

  useEffect(() => {
    if (!user) return
    fetch(`/api/orders?userId=${user.id}`, { headers: { 'x-user-id': user.id } })
      .then(r => r.json())
      .then(d => {
        if (d.ok) setOrders(d.orders || [])
        else setError(d.error || 'Could not load orders.')
      })
      .catch(() => setError('Could not connect.'))
      .finally(() => setLoading(false))
  }, [])

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

  if (!user) return (
    <main className="mo-page">
      <style>{CSS}</style>
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
      <style suppressHydrationWarning>{CSS}</style>
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

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Jost:wght@200;300;400;500&display=swap');
.mo-page{--iv:#faf7f4;--ch:#f0e6d3;--es:#2c1a10;--wb:#6b3f2a;--mu:#9b8880;--go:#c9a96e;background:var(--iv);font-family:'Jost',sans-serif;color:var(--es);min-height:100vh;}
.mo-spacer{height:80px;}
.mo-hero{background:var(--es);padding:48px clamp(1.5rem,6vw,5rem) 40px;}
.mo-eyebrow{font-size:9px;letter-spacing:.45em;text-transform:uppercase;color:var(--go);display:block;margin-bottom:12px;}
.mo-h1{font-family:'Cormorant Garamond',serif;font-size:clamp(2rem,4vw,3rem);font-weight:300;color:var(--iv);margin:0 0 10px;}
.mo-sub{font-size:13px;color:rgba(250,247,244,.45);margin:0;}
.mo-content{max-width:780px;margin:0 auto;padding:40px 24px 80px;}
.mo-muted{font-size:13px;color:var(--mu);}
.mo-error{font-size:13px;color:#a32d2d;}
.mo-empty{text-align:center;padding:60px 0;}
.mo-empty-title{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:300;margin-bottom:8px;}
.mo-empty-sub{font-size:13px;color:var(--mu);margin-bottom:20px;}
.mo-btn{display:inline-block;padding:11px 24px;background:var(--es);color:var(--iv);font-family:'Jost',sans-serif;font-size:10px;letter-spacing:.25em;text-transform:uppercase;text-decoration:none;border:none;cursor:pointer;transition:background .2s;}
.mo-btn:hover{background:var(--wb);}
.mo-btn--sm{padding:8px 16px;font-size:9px;}

.mo-list{display:flex;flex-direction:column;gap:10px;}
.mo-order{border:1px solid var(--ch);background:var(--iv);}
.mo-order-head{display:flex;align-items:center;gap:12px;padding:16px 18px;cursor:pointer;user-select:none;}
.mo-order-head:hover{background:var(--ch);}
.mo-order-meta{flex:1;min-width:0;}
.mo-order-num{font-size:13px;font-weight:500;letter-spacing:.04em;}
.mo-order-date{font-size:11px;color:var(--mu);}
.mo-order-badges{display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0;}
.mo-order-total{font-size:14px;font-weight:500;white-space:nowrap;flex-shrink:0;}
.mo-chevron{flex-shrink:0;color:var(--mu);transition:transform .2s;}
.mo-chevron.open{transform:rotate(180deg);}

.mo-order-body{border-top:1px solid var(--ch);padding:0 18px;}
.mo-order-section{padding:16px 0;border-bottom:1px solid var(--ch);}
.mo-order-section:last-child{border-bottom:none;}
.mo-section-title{font-size:9px;letter-spacing:.3em;text-transform:uppercase;color:var(--mu);margin-bottom:10px;}

.mo-items{display:flex;flex-direction:column;gap:6px;}
.mo-item{display:flex;gap:8px;font-size:13px;align-items:baseline;}
.mo-item-name{flex:1;}
.mo-item-qty{font-size:11px;color:var(--mu);}
.mo-item-price{font-weight:500;}
.mo-items-total{display:flex;justify-content:space-between;font-size:13px;font-weight:500;padding-top:8px;border-top:1px solid var(--ch);margin-top:4px;}

.mo-detail-rows{display:flex;flex-direction:column;gap:6px;}
.mo-detail-row{display:flex;justify-content:space-between;align-items:center;font-size:12px;gap:8px;}
.mo-detail-row span:first-child{color:var(--mu);}

.mo-proof-cta{margin-top:12px;padding:12px;background:var(--ch);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.mo-proof-hint{font-size:12px;color:var(--wb);}

.mo-receipt-section{background:var(--ch);padding:16px;margin:0 -18px;}
.mo-receipt-hint{font-size:12px;color:var(--mu);margin-bottom:12px;}

.mo-order-links{display:flex;gap:16px;}
.mo-link{font-size:12px;color:var(--wb);text-decoration:underline;text-underline-offset:3px;}
`