'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getCurrentUser } from '../utils/authClient'
import { getAdminSecret, setAdminSecret } from './adminSecret'

const ORDER_STATUSES = ['placed', 'pending_payment', 'paid', 'processing', 'ready', 'shipped', 'completed', 'cancelled', 'refunded']

export default function AdminDashboardPage() {
  const router = useRouter()
  const [user,         setUser        ] = useState(null)
  const [ready,        setReady       ] = useState(false)
  const [orderStats,   setOrderStats  ] = useState(null)
  const [gownCount,    setGownCount   ] = useState(null)
  const [secretPrompt, setSecretPrompt] = useState(false)   // show the secret input box?
  const [secretInput,  setSecretInput ] = useState('')
  const [secretError,  setSecretError ] = useState('')

  // ── Auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    const u = getCurrentUser()
    if (!u || !['admin', 'staff'].includes(u.role)) { router.replace('/login'); return }
    if (u.role !== 'admin')                          { router.replace('/staff'); return }
    setUser(u)
    setReady(true)
  }, [router])

  // ── Data fetch ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    const secret = getAdminSecret()
    if (!secret) { setSecretPrompt(true); return }   // no secret stored → show prompt
    loadData(secret)
  }, [ready])

  function loadData(secret) {
    Promise.all([
      fetch('/api/admin/orders', { headers: { 'X-Admin-Secret': secret } }).then(r => r.json()).catch(() => null),
      fetch('/api/admin/gowns',  { headers: { 'X-Admin-Secret': secret } }).then(r => r.json()).catch(() => null),
    ]).then(([od, gd]) => {
      if (od?.ok) {
        const orders  = od.orders || []
        const counts  = {}
        for (const s of ORDER_STATUSES) counts[s] = 0
        for (const o of orders) if (o.status in counts) counts[o.status]++
        const revenue = orders
          .filter(o => !['cancelled', 'refunded'].includes(o.status))
          .reduce((s, o) => s + Number(o.total || 0), 0)
        setOrderStats({ total: orders.length, counts, revenue })
      } else if (od?.error === 'unauthorized') {
        // Stored secret is wrong → force re-prompt
        setSecretError('Incorrect secret. Please try again.')
        setSecretPrompt(true)
      }
      if (gd?.ok) setGownCount((gd.gowns || []).length)
    })
  }

  function handleSecretSubmit(e) {
    e.preventDefault()
    const val = secretInput.trim()
    if (!val) { setSecretError('Secret cannot be empty.'); return }
    setAdminSecret(val)
    setSecretPrompt(false)
    setSecretError('')
    setSecretInput('')
    loadData(val)
  }

  if (!ready) return null

  const fmtPhp = n => '₱' + Math.round(n).toLocaleString('en-PH')

  return (
    <div className="adm-dash-page">
      <div>
        <h1 className="adm-dash-heading">Dashboard</h1>
        {user && <p className="adm-dash-user">Signed in as {user.email}</p>}
      </div>

      {/* ── Secret prompt / change-secret ── */}
      {secretPrompt ? (
        <form className="adm-secret-prompt" onSubmit={handleSecretSubmit}>
          <p className="adm-secret-title">Enter admin secret</p>
          {secretError && <p className="adm-secret-error">{secretError}</p>}
          <input
            className="adm-secret-input"
            type="password"
            placeholder="Admin secret"
            value={secretInput}
            onChange={e => setSecretInput(e.target.value)}
            autoFocus
          />
          <div className="adm-secret-actions">
            <button type="submit" className="adm-secret-btn-primary">Confirm</button>
            <button
              type="button"
              className="adm-secret-btn-secondary"
              onClick={() => router.push('/admin/change-secret')}
            >
              Change secret
            </button>
          </div>
        </form>
      ) : null}

      {orderStats && (
        <div className="adm-snapshot">
          <p className="adm-snapshot-eyebrow">Snapshot</p>
          <div className="adm-snapshot-stats">
            <div className="adm-stat">
              <span className="adm-stat-val">{fmtPhp(orderStats.revenue)}</span>
              <span className="adm-stat-lbl">Total revenue</span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat-val">{orderStats.total}</span>
              <span className="adm-stat-lbl">Total orders</span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat-val adm-stat-val-purple">
                {(orderStats.counts.paid || 0) + (orderStats.counts.processing || 0) + (orderStats.counts.shipped || 0)}
              </span>
              <span className="adm-stat-lbl">In progress</span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat-val adm-stat-val-green">{orderStats.counts.completed || 0}</span>
              <span className="adm-stat-lbl">Completed</span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat-val adm-stat-val-amber">
                {(orderStats.counts.placed || 0) + (orderStats.counts.pending_payment || 0)}
              </span>
              <span className="adm-stat-lbl">Awaiting payment</span>
            </div>
            {gownCount !== null && (
              <div className="adm-stat">
                <span className="adm-stat-val">{gownCount}</span>
                <span className="adm-stat-lbl">Products listed</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="adm-nav-cards">
        {[
          { href: '/admin/gowns',         title: 'Catalogue',       desc: 'Add, edit, or remove listings.'           },
          { href: '/admin/orders',        title: 'Orders',          desc: 'View and manage all orders.'              },
          { href: '/admin/dashboard',     title: 'Sales dashboard', desc: 'Revenue charts and analytics.'            },
          { href: '/admin/users',         title: 'Users',           desc: 'View registered accounts.'                },
          { href: '/admin/contents',      title: 'Content',         desc: 'Edit homepage slides, copy, and theme.'   },
          { href: '/admin/change-secret', title: 'Change secret',   desc: 'Update the admin secret with 2FA verification.' },
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