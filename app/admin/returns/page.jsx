'use client'

// app/admin/returns/page.jsx
// Changes vs original:
//   • ReturnDrawer: new "Evidence" section that renders uploaded photos/videos
//   • GET response now includes evidenceUrls — displayed as a thumbnail grid
//     with lightbox-style full-size links

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRoleGuard } from '../../utils/useRoleGuard'
import { adminFetch }   from '../adminFetch'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_META = {
  pending:   { label: 'Pending',   bg: '#fff3cd', color: '#856404' },
  approved:  { label: 'Approved',  bg: '#d4edda', color: '#155724' },
  rejected:  { label: 'Rejected',  bg: '#f8d7da', color: '#721c24' },
  completed: { label: 'Completed', bg: '#d4edda', color: '#155724' },
  cancelled: { label: 'Cancelled', bg: '#e2e3e5', color: '#383d41' },
}

const TYPE_META = {
  return:   { label: 'Return',   icon: '↩', bg: '#e8f0ff', color: '#2d5be3' },
  refund:   { label: 'Refund',   icon: '₱', bg: '#fce8d4', color: '#7a3608' },
  exchange: { label: 'Exchange', icon: '⇄', bg: '#e2d9f3', color: '#4a2c82' },
}

const VALID_ACTIONS = {
  pending:  ['approve', 'reject'],
  approved: ['complete', 'reject', 'cancel'],
}

const ACTION_META = {
  approve:  { label: 'Approve',  danger: false },
  reject:   { label: 'Reject',   danger: true  },
  complete: { label: 'Complete', danger: false },
  cancel:   { label: 'Cancel',   danger: true  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPhp(n) {
  return '₱' + Number(n || 0).toLocaleString('en-PH')
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function fmtRelative(iso) {
  if (!iso) return '—'
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins  < 2)   return 'Just now'
  if (mins  < 60)  return `${mins}m ago`
  if (hours < 24)  return `${hours}h ago`
  if (days  < 7)   return `${days}d ago`
  return fmtDate(iso)
}

function isVideo(type) {
  return (type || '').startsWith('video/')
}

// ── Shared hook ───────────────────────────────────────────────────────────────

function useModalEscape(onClose) {
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status, type }) {
  if (type === 'type') {
    const m = TYPE_META[status] || { label: status, bg: '#f0e6d3', color: '#6b3f2a' }
    return (
      <span className="adm-badge" style={{ background: m.bg, color: m.color }}>
        {m.icon} {m.label}
      </span>
    )
  }
  const m = STATUS_META[status] || { label: status, bg: '#f0e6d3', color: '#6b3f2a' }
  return (
    <span className="adm-badge" style={{ background: m.bg, color: m.color }}>
      {m.label}
    </span>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type = 'success', onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className={`adm-toast adm-toast--${type}`} role="status">
      {type === 'success'
        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
      }
      {message}
    </div>
  )
}

// ── ConfirmModal ──────────────────────────────────────────────────────────────

function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onClose, children }) {
  useModalEscape(onClose)
  return (
    <div className="adm-confirm-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="adm-confirm-box">
        <p className="adm-confirm-title">{title}</p>
        <p className="adm-confirm-msg">{message}</p>
        {children}
        <div className="adm-confirm-actions">
          <button className="adm-btn-outline" onClick={onClose}>Cancel</button>
          <button
            className={danger ? 'adm-btn-danger armed' : 'adm-btn'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── EvidenceGallery (admin read-only view) ────────────────────────────────────

function EvidenceGallery({ evidenceUrls }) {
  if (!evidenceUrls?.length) return null

  return (
    <div className="adm-drawer-section">
      <p className="adm-drawer-section-title">
        Evidence ({evidenceUrls.length} file{evidenceUrls.length !== 1 ? 's' : ''})
      </p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
        gap: 8,
      }}>
        {evidenceUrls.map((f, i) => (
          <a
            key={i}
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            title={f.name || `File ${i + 1}`}
            style={{
              display: 'block', position: 'relative',
              borderRadius: 4, overflow: 'hidden',
              border: '1px solid var(--adm-border)',
              aspectRatio: '1',
              background: '#f5f5f5',
            }}
          >
            {isVideo(f.type) ? (
              <>
                <video
                  src={f.url}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  muted
                  preload="metadata"
                />
                <span style={{
                  position: 'absolute', bottom: 4, left: 4,
                  fontSize: 9, background: 'rgba(0,0,0,.6)', color: '#fff',
                  borderRadius: 2, padding: '1px 4px',
                }}>
                  VIDEO
                </span>
              </>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={f.url}
                alt={f.name || `Evidence ${i + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            )}
            {/* Open icon overlay */}
            <span style={{
              position: 'absolute', top: 4, right: 4,
              fontSize: 10, background: 'rgba(0,0,0,.45)', color: '#fff',
              borderRadius: 2, padding: '2px 4px', lineHeight: 1,
            }}>
              ↗
            </span>
          </a>
        ))}
      </div>
      <p style={{ fontSize: 11, color: 'var(--adm-text-3)', marginTop: 6 }}>
        Click any file to open full size in a new tab.
      </p>
    </div>
  )
}

// ── ReturnDrawer ──────────────────────────────────────────────────────────────

function ReturnDrawer({ ret, onAction, onClose, onRefresh }) {
  useModalEscape(onClose)
  const [confirm,      setConfirm     ] = useState(null)
  const [adminNote,    setAdminNote   ] = useState(ret.adminNote || '')
  const [refundAmount, setRefundAmount] = useState(ret.refundAmount ?? '')
  const [saving,       setSaving      ] = useState(false)

  const allowedActions = VALID_ACTIONS[ret.status] || []

  function requestAction(action) {
    const meta     = ACTION_META[action]
    const needsAmt = action === 'complete' && ['return', 'refund'].includes(ret.type)
    setConfirm({ action, meta, needsAmt })
  }

  async function doAction() {
    if (!confirm) return
    setSaving(true)
    setConfirm(null)
    await onAction(ret.id, confirm.action, {
      adminNote:    adminNote.trim() || undefined,
      refundAmount: confirm.needsAmt && refundAmount !== '' ? Number(refundAmount) : undefined,
    })
    setSaving(false)
    onRefresh()
  }

  return (
    <div
      className="adm-drawer-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {confirm && (
        <ConfirmModal
          title={`${confirm.meta.label} this request?`}
          message={
            confirm.action === 'approve'  ? `This will approve the ${ret.type} request and notify the customer to return their item(s).` :
            confirm.action === 'complete' ? `This will mark the request as completed. ${['return','refund'].includes(ret.type) ? 'The parent order will be marked as Refunded.' : ''}` :
            confirm.action === 'reject'   ? 'This will reject the request and notify the customer.' :
            'This will cancel the request.'
          }
          confirmLabel={confirm.meta.label}
          danger={confirm.meta.danger}
          onConfirm={doAction}
          onClose={() => setConfirm(null)}
        >
          {confirm.needsAmt && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--adm-text-3)', marginBottom: 6 }}>
                Refund amount (₱) <span style={{ opacity: .6 }}>(optional)</span>
              </label>
              <input
                className="adm-input"
                type="number"
                min="0"
                step="0.01"
                placeholder={`e.g. ${ret.orderTotal ?? ''}`}
                value={refundAmount}
                onChange={e => setRefundAmount(e.target.value)}
              />
            </div>
          )}
          <input
            className="adm-input"
            placeholder="Admin note for customer (optional)"
            value={adminNote}
            onChange={e => setAdminNote(e.target.value)}
            style={{ marginBottom: 16 }}
          />
        </ConfirmModal>
      )}

      <aside className="adm-drawer">
        {/* Header */}
        <div className="adm-drawer-header">
          <div>
            <p className="adm-drawer-eyebrow">Return Request</p>
            <h2 className="adm-drawer-title">{ret.orderNumber}</h2>
            <p className="adm-drawer-meta">{fmtDate(ret.createdAt)}</p>
          </div>
          <button className="adm-modal-close" onClick={onClose} aria-label="Close drawer">✕</button>
        </div>

        <div className="adm-drawer-body">
          {/* Badges */}
          <div className="adm-drawer-badges">
            <StatusBadge status={ret.type}   type="type" />
            <StatusBadge status={ret.status} />
          </div>

          {/* Customer */}
          <div className="adm-drawer-section">
            <p className="adm-drawer-section-title">Customer</p>
            <div className="adm-drawer-rows">
              <div className="adm-drawer-row">
                <span>Name</span>
                <span>{ret.customerName}</span>
              </div>
              <div className="adm-drawer-row">
                <span>Email</span>
                <a href={`mailto:${ret.customerEmail}`} className="adm-drawer-link">{ret.customerEmail}</a>
              </div>
            </div>
          </div>

          {/* Order info */}
          <div className="adm-drawer-section">
            <p className="adm-drawer-section-title">Order</p>
            <div className="adm-drawer-rows">
              <div className="adm-drawer-row">
                <span>Order number</span>
                <span>{ret.orderNumber}</span>
              </div>
              {ret.orderTotal != null && (
                <div className="adm-drawer-row">
                  <span>Order total</span>
                  <span>{fmtPhp(ret.orderTotal)}</span>
                </div>
              )}
              {ret.paymentMethod && (
                <div className="adm-drawer-row">
                  <span>Payment</span>
                  <span style={{ textTransform: 'capitalize' }}>{ret.paymentMethod}</span>
                </div>
              )}
            </div>
          </div>

          {/* Items */}
          <div className="adm-drawer-section">
            <p className="adm-drawer-section-title">Items requested ({(ret.items || []).length})</p>
            <div className="adm-drawer-items">
              {(ret.items || []).map((item, i) => (
                <div key={i} className="adm-drawer-item">
                  <span className="adm-drawer-item-name">
                    {item.gownName}{item.sizeLabel ? ` — ${item.sizeLabel}` : ''}
                  </span>
                  <span className="adm-drawer-item-qty">×{item.quantity || 1}</span>
                  <span className="adm-drawer-item-price" />
                </div>
              ))}
            </div>
          </div>

          {/* Reason */}
          <div className="adm-drawer-section">
            <p className="adm-drawer-section-title">Reason</p>
            <p style={{ fontSize: 13, color: 'var(--adm-text)', margin: 0 }}>{ret.reason}</p>
            {ret.details && (
              <p style={{ fontSize: 12, color: 'var(--adm-text-3)', marginTop: 6, lineHeight: 1.6, fontStyle: 'italic' }}>
                {ret.details}
              </p>
            )}
          </div>

          {/* ── Evidence gallery (NEW) ── */}
          <EvidenceGallery evidenceUrls={ret.evidenceUrls} />

          {/* Admin note / refund amount (resolved) */}
          {(ret.adminNote || ret.refundAmount != null) && (
            <div className="adm-drawer-section">
              <p className="adm-drawer-section-title">Resolution</p>
              {ret.refundAmount != null && (
                <div className="adm-drawer-row" style={{ marginBottom: 6 }}>
                  <span>Refund issued</span>
                  <span style={{ fontWeight: 600, color: '#155724' }}>{fmtPhp(ret.refundAmount)}</span>
                </div>
              )}
              {ret.adminNote && (
                <p style={{ fontSize: 12, color: 'var(--adm-text-3)', margin: 0, lineHeight: 1.6 }}>
                  {ret.adminNote}
                </p>
              )}
              {ret.resolvedAt && (
                <p style={{ fontSize: 11, color: 'var(--adm-text-3)', marginTop: 4 }}>
                  Resolved {fmtDate(ret.resolvedAt)}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          {allowedActions.length > 0 && (
            <div className="adm-drawer-section adm-drawer-section--action">
              <p className="adm-drawer-section-title">Actions</p>
              <p className="adm-drawer-section-hint">Customer receives an email on every change.</p>

              <div style={{ marginBottom: 12 }}>
                <input
                  className="adm-input"
                  placeholder="Admin note for customer (optional)"
                  value={adminNote}
                  onChange={e => setAdminNote(e.target.value)}
                />
              </div>

              {ret.status === 'approved' && ['return', 'refund'].includes(ret.type) && (
                <div style={{ marginBottom: 12 }}>
                  <input
                    className="adm-input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={`Refund amount ₱ (optional, e.g. ${ret.orderTotal ?? ''})`}
                    value={refundAmount}
                    onChange={e => setRefundAmount(e.target.value)}
                  />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {allowedActions.filter(a => !ACTION_META[a].danger).map(action => (
                  <button
                    key={action}
                    className="adm-btn"
                    disabled={saving}
                    onClick={() => requestAction(action)}
                  >
                    {ACTION_META[action].label} →
                  </button>
                ))}
                {allowedActions.filter(a => ACTION_META[a].danger).length > 0 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid var(--adm-border)' }}>
                    {allowedActions.filter(a => ACTION_META[a].danger).map(action => (
                      <button
                        key={action}
                        className="adm-btn-danger"
                        disabled={saving}
                        onClick={() => requestAction(action)}
                      >
                        {ACTION_META[action].label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {saving && <p className="adm-muted" style={{ fontSize: 13, marginTop: 8 }}>Saving…</p>}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

// ── AdminReturnsPage ──────────────────────────────────────────────────────────

export default function AdminReturnsPage() {
  const { ready } = useRoleGuard(['admin', 'staff'], '/')

  const [returns,      setReturns     ] = useState([])
  const [loading,      setLoading     ] = useState(true)
  const [error,        setError       ] = useState('')
  const [toast,        setToast       ] = useState(null)
  const [drawerRet,    setDrawerRet   ] = useState(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType,   setFilterType  ] = useState('')
  const [search,       setSearch      ] = useState('')
  const [sortKey,      setSortKey     ] = useState('createdAt')
  const [sortDir,      setSortDir     ] = useState('desc')
  const [stats,        setStats       ] = useState(null)

  const filterRef = useRef(filterStatus)
  useEffect(() => { filterRef.current = filterStatus }, [filterStatus])

  const adminHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
  }), [])

  function showToast(msg, type = 'success') {
    setToast({ message: msg, type })
  }

  const loadReturns = useCallback(async (status = '') => {
    setLoading(true)
    setError('')
    try {
      const url  = `/api/admin/returns${status ? `?status=${encodeURIComponent(status)}` : ''}`
      const res  = await adminFetch(url, { headers: adminHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load returns')
      const all = data.returns || []
      setReturns(all)
      setStats({
        total:     all.length,
        pending:   all.filter(r => r.status === 'pending').length,
        approved:  all.filter(r => r.status === 'approved').length,
        completed: all.filter(r => r.status === 'completed').length,
        refunds:   all
          .filter(r => r.refundAmount != null)
          .reduce((s, r) => s + Number(r.refundAmount || 0), 0),
      })
      return all
    } catch (e) {
      setError(e.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [adminHeaders])

  useEffect(() => { loadReturns() }, [loadReturns])

  const handleAction = useCallback(async (returnId, action, payload = {}) => {
    const prevReturns = returns
    const prevDrawer  = drawerRet

    try {
      const res  = await adminFetch('/api/admin/returns', {
        method:  'PATCH',
        headers: adminHeaders(),
        body:    JSON.stringify({ returnId, action, ...payload }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Action failed')

      const STATUS_MAP = { approve: 'approved', reject: 'rejected', complete: 'completed', cancel: 'cancelled' }
      const newStatus  = STATUS_MAP[action]

      const patch = r => r.id !== returnId ? r : {
        ...r,
        status:       newStatus,
        adminNote:    payload.adminNote   || r.adminNote,
        refundAmount: payload.refundAmount != null ? payload.refundAmount : r.refundAmount,
        resolvedAt:   new Date().toISOString(),
      }
      setReturns(p => p.map(patch))
      setDrawerRet(p => p?.id === returnId ? patch(p) : p)

      const labels = { approve: 'approved', reject: 'rejected', complete: 'completed', cancel: 'cancelled' }
      showToast(`Request ${labels[action]} — customer notified`, action === 'reject' || action === 'cancel' ? 'error' : 'success')

    } catch (e) {
      setReturns(prevReturns)
      setDrawerRet(prevDrawer)
      showToast(e.message, 'error')
    }
  }, [adminHeaders, returns, drawerRet])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function sortIcon(key) {
    if (sortKey !== key) return <span style={{ opacity: 0.4, marginLeft: 4, fontSize: 11 }}>↕</span>
    return <span style={{ marginLeft: 4, fontSize: 11 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const filtered = returns
    .filter(r => {
      const matchStatus = !filterStatus || r.status === filterStatus
      const matchType   = !filterType   || r.type   === filterType
      const q = search.toLowerCase().trim()
      const matchSearch = !q
        || (r.orderNumber   || '').toLowerCase().includes(q)
        || (r.customerName  || '').toLowerCase().includes(q)
        || (r.customerEmail || '').toLowerCase().includes(q)
      return matchStatus && matchType && matchSearch
    })
    .sort((a, b) => {
      let av, bv
      if      (sortKey === 'createdAt') { av = new Date(a.createdAt || 0).getTime(); bv = new Date(b.createdAt || 0).getTime() }
      else if (sortKey === 'status')    { av = a.status;     bv = b.status }
      else if (sortKey === 'type')      { av = a.type;       bv = b.type }
      else                              { av = (a.customerName || '').toLowerCase(); bv = (b.customerName || '').toLowerCase() }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ?  1 : -1
      return 0
    })

  const pendingReturns = returns.filter(r => r.status === 'pending')

  const thStyle = {
    fontSize: 11, fontWeight: 700,
    color: 'var(--adm-text-3)',
    letterSpacing: '0.07em', textTransform: 'uppercase',
    padding: '6px 18px',
    cursor: 'pointer', userSelect: 'none',
  }

  if (!ready) return null

  return (
    <div className="adm-orders-page">

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDone={() => setToast(null)}
        />
      )}

      {drawerRet && (
        <ReturnDrawer
          ret={drawerRet}
          onAction={handleAction}
          onClose={() => setDrawerRet(null)}
          onRefresh={async () => {
            const fresh = await loadReturns(filterRef.current)
            setDrawerRet(prev =>
              prev ? (fresh.find(r => r.id === prev.id) ?? prev) : prev
            )
          }}
        />
      )}

      {/* Top bar */}
      <div className="adm-topbar">
        <h1 className="adm-page-title">Returns &amp; Refunds</h1>
        <button className="adm-btn-sm" onClick={() => loadReturns(filterRef.current)}>
          ↻ Refresh
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="adm-stats-row">
          <div className="adm-stat">
            <div className="adm-stat-val">{stats.total}</div>
            <div className="adm-stat-lbl">Total requests</div>
          </div>
          <div className={`adm-stat${stats.pending > 0 ? ' warn' : ''}`}>
            <div className="adm-stat-val">{stats.pending}</div>
            <div className="adm-stat-lbl">Pending review</div>
          </div>
          <div className="adm-stat">
            <div className="adm-stat-val">{stats.approved}</div>
            <div className="adm-stat-lbl">Approved</div>
          </div>
          <div className="adm-stat">
            <div className="adm-stat-val">{stats.completed}</div>
            <div className="adm-stat-lbl">Completed</div>
          </div>
          <div className="adm-stat">
            <div className="adm-stat-val">{fmtPhp(stats.refunds)}</div>
            <div className="adm-stat-lbl">Refunds issued</div>
          </div>
        </div>
      )}

      {/* Pending alert */}
      {pendingReturns.length > 0 && (
        <div className="adm-proof-alert">
          <p className="adm-proof-alert-title">
            ⚠ {pendingReturns.length} request{pendingReturns.length > 1 ? 's' : ''} awaiting review
          </p>
          <div className="adm-proof-alert-list">
            {pendingReturns.slice(0, 4).map(r => (
              <div key={r.id} className="adm-proof-alert-item">
                <span className="adm-proof-alert-name">
                  {r.orderNumber} · {r.customerName}
                </span>
                <StatusBadge status={r.type} type="type" />
                <button
                  className="adm-proof-alert-btn"
                  onClick={() => setDrawerRet(r)}
                >
                  Review
                </button>
              </div>
            ))}
            {pendingReturns.length > 4 && (
              <p className="adm-muted" style={{ fontSize: 13 }}>
                +{pendingReturns.length - 4} more — use the Pending filter below
              </p>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="adm-filter-row">
        <input
          className="adm-search"
          placeholder="Search by order no., name, or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search returns"
        />
        <div className="adm-filter-status" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button className={`adm-filter-pill${!filterStatus ? ' active' : ''}`} onClick={() => setFilterStatus('')}>All</button>
          {Object.entries(STATUS_META).map(([key, m]) => (
            <button
              key={key}
              className={`adm-filter-pill${filterStatus === key ? ' active' : ''}`}
              onClick={() => setFilterStatus(filterStatus === key ? '' : key)}
            >
              {m.label}{key === 'pending' && stats?.pending > 0 ? ` (${stats.pending})` : ''}
            </button>
          ))}
          <span style={{ width: 1, height: 20, background: 'var(--adm-border)', margin: '0 4px', alignSelf: 'center' }} />
          {Object.entries(TYPE_META).map(([key, m]) => (
            <button
              key={key}
              className={`adm-filter-pill${filterType === key ? ' active' : ''}`}
              onClick={() => setFilterType(filterType === key ? '' : key)}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="adm-error-msg" role="alert">{error}</p>}

      {/* Table */}
      {loading ? (
        <p className="adm-muted">Loading returns…</p>
      ) : filtered.length === 0 ? (
        <p className="adm-muted">No return requests found.</p>
      ) : (
        <div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '160px 1fr 110px 120px 80px 100px',
            gap: 14,
          }}>
            <div style={thStyle}>Order</div>
            <div style={thStyle} onClick={() => toggleSort('customerName')}>Customer {sortIcon('customerName')}</div>
            <div style={thStyle} onClick={() => toggleSort('type')}>Type {sortIcon('type')}</div>
            <div style={thStyle} onClick={() => toggleSort('status')}>Status {sortIcon('status')}</div>
            <div style={{ ...thStyle, cursor: 'default' }}>Items</div>
            <div style={thStyle} onClick={() => toggleSort('createdAt')}>Submitted {sortIcon('createdAt')}</div>
          </div>

          {filtered.map(ret => (
            <div
              key={ret.id}
              className={`adm-order-row${ret.status === 'pending' ? ' has-proof' : ''}`}
              onClick={() => setDrawerRet(ret)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setDrawerRet(ret)}
              aria-label={`Open return request for ${ret.orderNumber}`}
            >
              <div className="adm-order-num">
                {ret.orderNumber}
                {ret.status === 'pending' && (
                  <span style={{
                    marginLeft: 6, fontSize: 9,
                    background: '#fff3cd', color: '#856404',
                    padding: '1px 5px', borderRadius: 3,
                    fontWeight: 700, letterSpacing: '0.04em',
                  }}>
                    NEW
                  </span>
                )}
                {/* Evidence indicator */}
                {(ret.evidenceUrls?.length > 0) && (
                  <span style={{
                    marginLeft: 5, fontSize: 9,
                    background: '#e8f0ff', color: '#2d5be3',
                    padding: '1px 5px', borderRadius: 3,
                    fontWeight: 600, letterSpacing: '0.04em',
                  }}
                    title={`${ret.evidenceUrls.length} evidence file(s) attached`}
                  >
                    📎 {ret.evidenceUrls.length}
                  </span>
                )}
              </div>
              <div className="adm-order-customer">
                <div className="adm-order-customer-name">{ret.customerName}</div>
                <div className="adm-order-customer-email">{ret.reason}</div>
              </div>
              <div><StatusBadge status={ret.type} type="type" /></div>
              <div><StatusBadge status={ret.status} /></div>
              <div style={{ fontSize: 13, color: 'var(--adm-text-3)', padding: '12px 18px' }}>
                {(ret.items || []).length} item{(ret.items || []).length !== 1 ? 's' : ''}
              </div>
              <div
                className="adm-order-actions"
                onClick={e => e.stopPropagation()}
                title={fmtDate(ret.createdAt)}
              >
                <span style={{ fontSize: 12, color: 'var(--adm-text-3)' }}>
                  {fmtRelative(ret.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Link href="/admin" className="adm-back-link">← Dashboard</Link>
    </div>
  )
}