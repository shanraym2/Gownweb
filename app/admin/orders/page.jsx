'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useGowns, getGownById } from '@/hooks/useGowns'
import { getAdminSecret } from '../layout'

const ORDER_STATUSES = ['placed','paid','preparing','shipped','delivered','cancelled']
const STATUS_LABELS  = {
  placed:'Placed', paid:'Paid', preparing:'Preparing',
  shipped:'Shipped', delivered:'Delivered', cancelled:'Cancelled',
}
const NEXT_ACTIONS = {
  placed:    [{ label: 'Mark paid',       to: 'paid'      }],
  paid:      [{ label: 'Start preparing', to: 'preparing' }],
  preparing: [{ label: 'Mark shipped',    to: 'shipped'   }],
  shipped:   [{ label: 'Mark delivered',  to: 'delivered' }],
  delivered: [],
  cancelled: [],
}
const CANCEL_ALLOWED = ['placed','paid','preparing']

function fmtPhp(n)    { return '₱' + Number(n || 0).toLocaleString('en-PH') }
function fmtDate(iso) { if (!iso) return ''; return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) }
function normStatus(s){ const v = String(s||'').toLowerCase(); return ORDER_STATUSES.includes(v) ? v : 'placed' }

function StatusBadge({ status }) {
  return <span className={`adm-badge adm-badge-${status}`}>{STATUS_LABELS[status] || status}</span>
}

function OrderCard({ order, gowns, onAction, updating }) {
  const [open, setOpen] = useState(false)
  const status    = normStatus(order.status)
  const actions   = NEXT_ACTIONS[status] || []
  const canCancel = CANCEL_ALLOWED.includes(status)

  return (
    <div className={`adm-order-card${updating ? ' is-updating' : ''}`}>
      <div className="adm-order-head" onClick={() => setOpen(o => !o)}>
        <span className="adm-order-id">#{order.id}</span>
        <StatusBadge status={status} />
        <span className="adm-order-name">{order.contact?.firstName} {order.contact?.lastName}</span>
        <span className="adm-order-amt">{fmtPhp(order.subtotal)}</span>
        <span className="adm-order-date">{fmtDate(order.createdAt)}</span>
        <span className="adm-order-chevron">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="adm-order-body">
          <div className="adm-order-items">
            {order.items?.map((item, i) => {
              const gown = getGownById(gowns, item.id)
              return (
                <div key={i} className="adm-order-item">
                  <div className="adm-order-item-thumb">
                    {gown?.image && <img src={gown.image} alt={item.name} />}
                  </div>
                  <div>
                    <div className="adm-order-item-name">{item.name} × {item.qty}</div>
                    <div className="adm-order-item-meta">{item.price} · subtotal {fmtPhp(item.subtotal)}</div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="adm-order-detail-grid">
            <div>
              <div className="adm-order-detail-head">Customer</div>
              <div className="adm-order-detail-line">{order.contact?.email}</div>
              <div className="adm-order-detail-line">{order.contact?.phone}</div>
            </div>
            <div>
              <div className="adm-order-detail-head">Delivery</div>
              <div className="adm-order-detail-line">{order.delivery?.address}</div>
              <div className="adm-order-detail-line">{order.delivery?.city}, {order.delivery?.province} {order.delivery?.zip}</div>
            </div>
          </div>

          {order.note && <div className="adm-order-note">Note: {order.note}</div>}

          {(actions.length > 0 || canCancel) && (
            <div className="adm-order-action-row">
              {actions.map(a => (
                <button key={a.to} disabled={updating} onClick={() => onAction(order.id, a.to)} className="adm-action-btn">
                  {a.label}
                </button>
              ))}
              {canCancel && (
                <button
                  disabled={updating}
                  onClick={() => { if (confirm('Cancel this order?')) onAction(order.id, 'cancelled') }}
                  className="adm-action-btn-cancel"
                >
                  Cancel order
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AdminOrdersPage() {
  const { gowns }  = useGowns()
  const [orders,       setOrders      ] = useState([])
  const [loading,      setLoading     ] = useState(true)
  const [error,        setError       ] = useState('')
  const [updatingId,   setUpdatingId  ] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search,       setSearch      ] = useState('')

  const load = async () => {
    const secret = getAdminSecret()
    if (!secret) { setError('Enter the admin secret first.'); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const res  = await fetch('/api/admin/orders', { headers: { 'X-Admin-Secret': secret } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed')
      setOrders(Array.isArray(data.orders) ? data.orders : [])
    } catch { setError('Could not load orders.') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const doAction = async (orderId, status) => {
    const secret = getAdminSecret()
    if (!secret) return
    setUpdatingId(orderId)
    try {
      const res  = await fetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
        body: JSON.stringify({ id: orderId, status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) { alert(data.error || 'Could not update.'); return }
      setOrders(prev => prev.map(o => String(o.id) === String(orderId) ? { ...o, status } : o))
    } finally { setUpdatingId(null) }
  }

  const TABS = [{ key: 'all', label: 'All' }, ...ORDER_STATUSES.map(s => ({ key: s, label: STATUS_LABELS[s] }))]

  const filtered = useMemo(() => {
    let list = orders
    if (statusFilter !== 'all') list = list.filter(o => normStatus(o.status) === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(o =>
        o.contact?.email?.toLowerCase().includes(q) ||
        o.contact?.firstName?.toLowerCase().includes(q) ||
        o.contact?.lastName?.toLowerCase().includes(q) ||
        String(o.id).includes(q)
      )
    }
    return list
  }, [orders, statusFilter, search])

  return (
    <div className="adm-orders-page">
      <div className="adm-orders-topbar">
        <h1 className="adm-page-title">Orders</h1>
        <div className="adm-orders-actions">
          <Link href="/admin/dashboard" className="adm-back-link">Sales →</Link>
          <button onClick={load} className="adm-btn-outline">Refresh</button>
        </div>
      </div>

      <div className="adm-pills">
        {TABS.map(tab => {
          const count = tab.key === 'all'
            ? orders.length
            : orders.filter(o => normStatus(o.status) === tab.key).length
          return (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`adm-pill${statusFilter === tab.key ? ' active' : ''}`}
            >
              {tab.label}{count > 0 ? ` (${count})` : ''}
            </button>
          )
        })}
      </div>

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name, email or order ID…"
        className="adm-search"
      />

      {loading && <p className="adm-muted">Loading…</p>}
      {error   && <p className="adm-error-msg">{error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p className="adm-muted">No orders match this filter.</p>
      )}
      {!loading && !error && filtered.map(order => (
        <OrderCard
          key={order.id}
          order={order}
          gowns={gowns}
          onAction={doAction}
          updating={updatingId === order.id}
        />
      ))}

      <Link href="/admin" className="adm-back-link">← Dashboard</Link>
    </div>
  )
}