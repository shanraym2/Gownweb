'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useGowns, getGownById } from '@/hooks/useGowns'

const ADMIN_SECRET_KEY = 'jce_admin_secret'

const ORDER_STATUSES = ['placed', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled']
const ORDER_STATUS_LABELS = {
  placed: 'Placed',
  paid: 'Paid',
  preparing: 'Preparing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

function formatPrice(num) {
  return '₱' + Number(num).toLocaleString('en-PH')
}

function normalizeStatus(status) {
  const v = String(status || '').toLowerCase()
  return ORDER_STATUSES.includes(v) ? v : 'placed'
}

export default function AdminOrdersPage() {
  const { gowns } = useGowns()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatingId, setUpdatingId] = useState(null)

  const loadOrders = async () => {
    const secret = sessionStorage.getItem(ADMIN_SECRET_KEY)
    if (!secret) {
      setError('Enter the admin secret on the dashboard first.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/orders', { headers: { 'X-Admin-Secret': secret } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load orders')
      setOrders(Array.isArray(data.orders) ? data.orders : [])
    } catch {
      setError('Could not load orders.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Load once (gowns are loaded by the hook as well).
    loadOrders()
  }, [])

  const updateOrderStatus = async (orderId, status) => {
    const secret = sessionStorage.getItem(ADMIN_SECRET_KEY)
    if (!secret) return

    const nextStatus = normalizeStatus(status)
    setUpdatingId(orderId)
    try {
      const res = await fetch('/api/admin/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': secret,
        },
        body: JSON.stringify({ id: orderId, status: nextStatus }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        alert(data.error || 'Could not update status.')
        return
      }

      setOrders((prev) =>
        prev.map((o) => (String(o.id) === String(orderId) ? { ...o, status: nextStatus } : o))
      )
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="admin-orders">
      <h1>Orders</h1>
      {loading && <p>Loading orders…</p>}
      {error && <p className="auth-error">{error}</p>}
      {!loading && !error && orders.length === 0 && <p className="admin-placeholder">No orders yet.</p>}

      {!loading && !error && orders.length > 0 && (
        <div className="admin-list" style={{ marginTop: 20 }}>
          {orders.map((order) => {
            const status = normalizeStatus(order.status)
            return (
              <div
                key={order.id}
                className="admin-list-item"
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 12 }}>
                  <div>
                    <strong>Order #{order.id}</strong>
                    <div style={{ fontSize: '0.9rem', color: 'var(--color-text-light)' }}>
                      {order.contact?.firstName} {order.contact?.lastName} — {order.contact?.email}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.9rem', color: 'var(--color-text-light)' }}>
                      {order.createdAt ? new Date(order.createdAt).toLocaleString() : ''}
                    </div>
                    <div style={{ marginTop: 6, fontSize: '0.9rem', fontWeight: 700 }}>
                      {formatPrice(order.subtotal)}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label htmlFor={`admin-status-${order.id}`} style={{ fontSize: '0.9rem' }}>
                    Status
                  </label>
                  <select
                    id={`admin-status-${order.id}`}
                    value={status}
                    disabled={updatingId === order.id}
                    onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--color-border, #ddd)',
                      background: 'var(--color-bg, #fff)',
                    }}
                  >
                    {ORDER_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {ORDER_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  {updatingId === order.id && <span style={{ fontSize: '0.85rem' }}>Saving…</span>}
                </div>

                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-light)' }}>
                  Payment: {order.payment} · Subtotal: {formatPrice(order.subtotal)}
                </p>

                <ul style={{ margin: 0, paddingLeft: 20, width: '100%' }}>
                  {order.items?.map((item, i) => {
                    const gown = getGownById(gowns, item.id)
                    return (
                      <li key={i} style={{ margin: '8px 0' }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          {gown?.image ? (
                            <img
                              src={gown.image}
                              alt={gown.alt || item.name || 'Gown'}
                              style={{
                                width: 42,
                                height: 42,
                                borderRadius: 8,
                                objectFit: 'cover',
                                background: '#f0ebe5',
                              }}
                            />
                          ) : (
                            <div style={{ width: 42, height: 42, borderRadius: 8, background: '#f0ebe5' }} />
                          )}
                          <div>
                            <div>
                              <strong>{item.name}</strong> × {item.qty}
                            </div>
                            <div style={{ fontSize: '0.9rem', color: 'var(--color-text-light)' }}>
                              {item.price ? `Unit: ${item.price} · ` : ''}
                              Subtotal: {formatPrice(item.subtotal)}
                            </div>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      <Link href="/admin" className="btn btn-outline" style={{ marginTop: 16 }}>
        ← Dashboard
      </Link>
    </div>
  )
}
