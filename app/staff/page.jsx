'use client'

/**
 * app/staff/page.jsx
 *
 * Staff dashboard — a scoped view of the admin panel.
 *
 * Staff can:
 *   ✓ Add / edit products (not archive)
 *   ✓ View and update order status
 *   ✓ Verify / reject payment proofs
 *   ✓ View customer accounts (read-only)
 *   ✓ View sales dashboard (read-only, no export)
 *
 * Staff cannot:
 *   ✗ Archive products
 *   ✗ Export reports
 *   ✗ Edit CMS content
 *   ✗ Create / delete / deactivate accounts
 *   ✗ Access the danger zone
 */

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getCurrentUser } from '../utils/authClient'
import { getAdminSecret } from '../admin/layout'

// Must match the actual status machine in orders
const ORDER_STATUSES = [
  'placed', 'pending_payment', 'paid', 'processing',
  'ready', 'shipped', 'completed', 'cancelled', 'refunded',
]

export default function StaffDashboardPage() {
  const router = useRouter()
  const [user,       setUser      ] = useState(null)
  const [orderStats, setOrderStats] = useState(null)
  const [gownCount,  setGownCount ] = useState(null)
  const [ready,      setReady     ] = useState(false)

  // ── Auth guard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const currentUser = getCurrentUser()

    if (!currentUser) {
      router.replace('/login')
      return
    }

    // Admins have their own dashboard
    if (currentUser.role === 'admin') {
      router.replace('/admin')
      return
    }

    // Only staff may proceed
    if (currentUser.role !== 'staff') {
      router.replace('/')
      return
    }

    setUser(currentUser)
    setReady(true)
  }, [])

  // ── Fetch snapshot data ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    const secret = getAdminSecret()
    if (!secret) return

    Promise.all([
      fetch('/api/admin/orders', { headers: { 'X-Admin-Secret': secret } })
        .then(r => r.json()).catch(() => null),
      fetch('/api/admin/gowns',  { headers: { 'X-Admin-Secret': secret } })
        .then(r => r.json()).catch(() => null),
    ]).then(([od, gd]) => {
      if (od?.ok) {
        const orders = od.orders || []
        const counts = {}
        for (const s of ORDER_STATUSES) counts[s] = 0
        for (const o of orders) if (o.status in counts) counts[o.status]++

        // Use `total`, exclude cancelled + refunded — consistent with sales dashboard
        const revenue = orders
          .filter(o => !['cancelled', 'refunded'].includes(o.status))
          .reduce((s, o) => s + Number(o.total || 0), 0)

        setOrderStats({ total: orders.length, counts, revenue })
      }
      if (gd?.ok) setGownCount((gd.gowns || []).length)
    })
  }, [ready])

  if (!ready) return null

  const fmtPhp = n => '₱' + Math.round(n).toLocaleString('en-PH')

  // Pending proof count — staff need to action these
  const pendingProof = orderStats
    ? (orderStats.counts.pending_payment || 0)
    : 0

  return (
    <div className="adm-dash-page">

      {/* ── Header ── */}
      <div>
        <h1 className="adm-dash-heading">Staff Dashboard</h1>
        {user && <p className="adm-dash-user">Signed in as {user.email}</p>}
      </div>

      {/* ── Snapshot ── */}
      {orderStats && (
        <div className="adm-snapshot">
          <p className="adm-snapshot-eyebrow">Snapshot</p>
          <div className="adm-snapshot-stats">
            <div className="adm-stat">
              <span className="adm-stat-val">{orderStats.total}</span>
              <span className="adm-stat-lbl">Total orders</span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat-val adm-stat-val-purple">
                {(orderStats.counts.paid       || 0) +
                 (orderStats.counts.processing || 0) +
                 (orderStats.counts.shipped    || 0)}
              </span>
              <span className="adm-stat-lbl">In progress</span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat-val adm-stat-val-green">
                {orderStats.counts.completed || 0}
              </span>
              <span className="adm-stat-lbl">Completed</span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat-val adm-stat-val-amber">
                {(orderStats.counts.placed           || 0) +
                 (orderStats.counts.pending_payment  || 0)}
              </span>
              <span className="adm-stat-lbl">Awaiting payment</span>
            </div>
            {gownCount !== null && (
              <div className="adm-stat">
                <span className="adm-stat-val">{gownCount}</span>
                <span className="adm-stat-lbl">Gowns listed</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Nav cards (staff-scoped) ── */}
      <div className="adm-nav-cards">
        {[
          {
            href:  '/admin/gowns',
            title: 'Products',
            desc:  'Add or edit product listings. Archiving is admin-only.',
          },
          {
            href:  '/admin/orders',
            title: 'Orders',
            desc:  'View all orders, update status, and verify payment proofs.',
          },
          {
            href:  '/admin/dashboard',
            title: 'Sales Overview',
            desc:  'View revenue charts and order statistics (read-only).',
          },
          {
            href:  '/admin/users',
            title: 'Customers',
            desc:  'Browse registered customer accounts.',
          },
        ].map(({ href, title, desc }) => (
          <Link key={href} href={href} className="adm-nav-card">
            <div className="adm-nav-card-title">{title}</div>
            <div className="adm-nav-card-desc">{desc}</div>
          </Link>
        ))}
      </div>

    </div>
  )
}