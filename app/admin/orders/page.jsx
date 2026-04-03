'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useGowns, getGownById } from '@/hooks/useGowns'

const ADMIN_SECRET_KEY = 'jce_admin_secret'
const ORDER_STATUSES = ['placed','paid','preparing','shipped','delivered','cancelled']
const STATUS_LABELS = { placed:'Placed', paid:'Paid', preparing:'Preparing', shipped:'Shipped', delivered:'Delivered', cancelled:'Cancelled' }
const STATUS_STYLE = {
  placed:    { background:'#E6F1FB', color:'#0C447C' },
  paid:      { background:'#EAF3DE', color:'#27500A' },
  preparing: { background:'#EEEDFE', color:'#3C3489' },
  shipped:   { background:'#E1F5EE', color:'#085041' },
  delivered: { background:'#EAF3DE', color:'#27500A' },
  cancelled: { background:'#FCEBEB', color:'#791F1F' },
}
// Only show the next logical step — no full dropdown
const NEXT_ACTIONS = {
  placed:    [{ label:'Mark paid',      to:'paid'      }],
  paid:      [{ label:'Start preparing',to:'preparing' }],
  preparing: [{ label:'Mark shipped',   to:'shipped'   }],
  shipped:   [{ label:'Mark delivered', to:'delivered' }],
  delivered: [],
  cancelled: [],
}
const CANCEL_ALLOWED = ['placed','paid','preparing']

function fmtPhp(n) { return '₱' + Number(n || 0).toLocaleString('en-PH') }
function fmtDate(iso) { if (!iso) return ''; return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) }
function normalizeStatus(s) { const v = String(s || '').toLowerCase(); return ORDER_STATUSES.includes(v) ? v : 'placed' }

function StatusBadge({ status }) {
  const st = STATUS_STYLE[status] || { background: '#eee', color: '#555' }
  return (
    <span style={{ ...st, display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

function OrderCard({ order, gowns, onAction, updating }) {
  const [open, setOpen] = useState(false)
  const status = normalizeStatus(order.status)
  const actions = NEXT_ACTIONS[status] || []
  const canCancel = CANCEL_ALLOWED.includes(status)

  return (
    <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', overflow: 'hidden', opacity: updating ? 0.55 : 1, transition: 'opacity .2s' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', background: 'var(--color-background-secondary)' }}>
        <span style={{ fontSize: 12, fontWeight: 500, minWidth: 68, color: 'var(--color-text-secondary)' }}>#{order.id}</span>
        <StatusBadge status={status} />
        <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {order.contact?.firstName} {order.contact?.lastName}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, flexShrink: 0 }}>{fmtPhp(order.subtotal)}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', flexShrink: 0, minWidth: 70, textAlign: 'right' }}>{fmtDate(order.createdAt)}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 4 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--color-background-primary)' }}>

          {/* Items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {order.items?.map((item, i) => {
              const gown = getGownById(gowns, item.id)
              return (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 8, background: 'var(--color-background-tertiary)', overflow: 'hidden', flexShrink: 0 }}>
                    {gown?.image && <img src={gown.image} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{item.name} × {item.qty}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{item.price} · subtotal {fmtPhp(item.subtotal)}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Contact + delivery */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            <div>
              <div style={{ fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 3 }}>Customer</div>
              <div>{order.contact?.email}</div>
              <div>{order.contact?.phone}</div>
            </div>
            <div>
              <div style={{ fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 3 }}>Delivery</div>
              <div>{order.delivery?.address}</div>
              <div>{order.delivery?.city}, {order.delivery?.province} {order.delivery?.zip}</div>
            </div>
          </div>

          {order.note && (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', padding: '8px 12px', background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)' }}>
              Note: {order.note}
            </div>
          )}

          {/* Actions */}
          {(actions.length > 0 || canCancel) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {actions.map(a => (
                <button key={a.to} disabled={updating} onClick={() => onAction(order.id, a.to)} style={{
                  padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  border: 'none', background: '#7F77DD', color: '#fff',
                }}>
                  {a.label}
                </button>
              ))}
              {canCancel && (
                <button disabled={updating} onClick={() => { if (confirm('Cancel this order?')) onAction(order.id, 'cancelled') }} style={{
                  padding: '7px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                  border: '0.5px solid var(--color-border-secondary)', background: 'transparent', color: 'var(--color-text-danger)',
                }}>
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
  const { gowns } = useGowns()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatingId, setUpdatingId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  const load = async () => {
    const secret = sessionStorage.getItem(ADMIN_SECRET_KEY)
    if (!secret) { setError('Enter the admin secret on the dashboard first.'); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/admin/orders', { headers: { 'X-Admin-Secret': secret } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed')
      setOrders(Array.isArray(data.orders) ? data.orders : [])
    } catch { setError('Could not load orders.') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const doAction = async (orderId, status) => {
    const secret = sessionStorage.getItem(ADMIN_SECRET_KEY)
    if (!secret) return
    setUpdatingId(orderId)
    try {
      const res = await fetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
        body: JSON.stringify({ id: orderId, status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) { alert(data.error || 'Could not update.'); return }
      setOrders(prev => prev.map(o => String(o.id) === String(orderId) ? { ...o, status } : o))
    } finally { setUpdatingId(null) }
  }

  const TABS = [
    { key: 'all', label: 'All' },
    ...ORDER_STATUSES.map(s => ({ key: s, label: STATUS_LABELS[s] })),
  ]

  const filtered = useMemo(() => {
    let list = orders
    if (statusFilter !== 'all') list = list.filter(o => normalizeStatus(o.status) === statusFilter)
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
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>Orders</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/admin/dashboard" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Sales dashboard →</Link>
          <button onClick={load} style={{ fontSize: 13, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', border: '0.5px solid var(--color-border-secondary)', background: 'transparent', color: 'var(--color-text-primary)' }}>Refresh</button>
        </div>
      </div>

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map(tab => {
          const count = tab.key === 'all' ? orders.length : orders.filter(o => normalizeStatus(o.status) === tab.key).length
          return (
            <button key={tab.key} onClick={() => setStatusFilter(tab.key)} style={{
              fontSize: 12, padding: '4px 11px', borderRadius: 20, cursor: 'pointer',
              border: '0.5px solid var(--color-border-secondary)',
              background: statusFilter === tab.key ? 'var(--color-text-primary)' : 'transparent',
              color: statusFilter === tab.key ? 'var(--color-background-primary)' : 'var(--color-text-secondary)',
            }}>
              {tab.label}{count > 0 ? ` (${count})` : ''}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name, email or order ID…"
        style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13, border: '0.5px solid var(--color-border-secondary)', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)' }}
      />

      {loading && <p style={{ color: 'var(--color-text-secondary)' }}>Loading…</p>}
      {error   && <p style={{ color: 'var(--color-text-danger)' }}>{error}</p>}
      {!loading && !error && filtered.length === 0 && <p style={{ color: 'var(--color-text-secondary)' }}>No orders match this filter.</p>}

      {!loading && !error && filtered.map(order => (
        <OrderCard
          key={order.id}
          order={order}
          gowns={gowns}
          onAction={doAction}
          updating={updatingId === order.id}
        />
      ))}

      <Link href="/admin" style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>← Admin home</Link>
    </div>
  )
}