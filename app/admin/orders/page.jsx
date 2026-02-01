'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const ADMIN_SECRET_KEY = 'jce_admin_secret'

function formatPrice(num) {
  return '₱' + Number(num).toLocaleString('en-PH')
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const secret = typeof window !== 'undefined' ? sessionStorage.getItem(ADMIN_SECRET_KEY) : null
    if (!secret) {
      setError('Enter the admin secret on the dashboard first.')
      setLoading(false)
      return
    }
    fetch('/api/admin/orders', {
      headers: { 'X-Admin-Secret': secret },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load orders')
        return res.json()
      })
      .then((data) => {
        if (data.ok) setOrders(data.orders || [])
        setLoading(false)
      })
      .catch(() => {
        setError('Could not load orders.')
        setLoading(false)
      })
  }, [])

  return (
    <div className="admin-orders">
      <h1>Orders</h1>
      {loading && <p>Loading orders…</p>}
      {error && <p className="auth-error">{error}</p>}
      {!loading && !error && orders.length === 0 && (
        <p className="admin-placeholder">No orders yet.</p>
      )}
      {!loading && !error && orders.length > 0 && (
        <div className="admin-list" style={{ marginTop: 20 }}>
          {orders.map((order) => (
            <div key={order.id} className="admin-list-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <strong>Order #{order.id}</strong>
                <span>{new Date(order.createdAt).toLocaleString()}</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>
                {order.contact?.firstName} {order.contact?.lastName} — {order.contact?.email}
              </p>
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-light)' }}>
                Payment: {order.payment} · Subtotal: {formatPrice(order.subtotal)}
              </p>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {order.items?.map((item, i) => (
                  <li key={i}>{item.name} × {item.qty} — {formatPrice(item.subtotal)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <Link href="/admin" className="btn btn-outline" style={{ marginTop: 16 }}>← Dashboard</Link>
    </div>
  )
}
