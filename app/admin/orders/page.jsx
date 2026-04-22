'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { getAdminSecret } from '../layout'
import { useRoleGuard } from '../../utils/useRoleGuard'

// ── Status machine ────────────────────────────────────────────────────────────

const PAYMENT_GATED = new Set(['processing', 'ready', 'shipped'])

const STATUS_FLOW = {
  placed:          { next: 'pending_payment', prev: null },
  pending_payment: { next: 'paid',            prev: 'placed' },
  paid:            { next: 'processing',      prev: null },
  processing:      { next: 'ready',           prev: 'paid' },
  ready:           { next: 'shipped',         prev: 'processing' },
  shipped:         { next: 'completed',       prev: null },
  completed:       { next: null,              prev: null },
  cancelled:       { next: null,              prev: null },
  refunded:        { next: null,              prev: null },
}

const ESCAPE_TRANSITIONS = {
  placed:          ['cancelled'],
  pending_payment: ['cancelled'],
  paid:            ['cancelled', 'refunded'],
  processing:      ['cancelled', 'refunded'],
  ready:           ['cancelled', 'refunded'],
  shipped:         ['refunded'],
}

function getAllowedTransitions(status, paymentStatus) {
  const flow = STATUS_FLOW[status]
  if (!flow) return { next: null, prev: null, escapes: [] }
  let next = flow.next
  const prev = flow.prev
  if (next && PAYMENT_GATED.has(next) && paymentStatus !== 'paid') next = null
  const escapes = ESCAPE_TRANSITIONS[status] || []
  return { next, prev, escapes }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_META = {
  placed:          { label: 'Placed',          bg: '#e8f0ff', color: '#2d5be3', step: 0 },
  pending_payment: { label: 'Pending Payment', bg: '#fff3cd', color: '#856404', step: 1 },
  paid:            { label: 'Paid',            bg: '#d4edda', color: '#155724', step: 2 },
  processing:      { label: 'Processing',      bg: '#e2d9f3', color: '#4a2c82', step: 3 },
  ready:           { label: 'Ready',           bg: '#cff4fc', color: '#0a5276', step: 4 },
  shipped:         { label: 'Shipped',         bg: '#d1ecf1', color: '#0c5460', step: 5 },
  completed:       { label: 'Completed',       bg: '#d4edda', color: '#155724', step: 6 },
  cancelled:       { label: 'Cancelled',       bg: '#f8d7da', color: '#721c24', step: -1 },
  refunded:        { label: 'Refunded',        bg: '#fce8d4', color: '#7a3608', step: -1 },
}

const PAYMENT_STATUS_META = {
  unpaid:   { bg: '#f8d7da', color: '#721c24' },
  pending:  { bg: '#fff3cd', color: '#856404' },
  paid:     { bg: '#d4edda', color: '#155724' },
  failed:   { bg: '#f8d7da', color: '#721c24' },
  refunded: { bg: '#fce8d4', color: '#7a3608' },
}

const PAYMENT_METHOD_LABEL = { gcash: 'GCash', bdo: 'BDO', cash: 'Cash' }
const DELIVERY_LABEL       = { pickup: 'Store Pickup', lalamove: 'Lalamove' }

function fmtPhp(n) { return '₱' + Number(n || 0).toLocaleString('en-PH') }
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status, type = 'order' }) {
  const meta   = type === 'payment' ? PAYMENT_STATUS_META[status] : STATUS_META[status]
  const colors = meta || { bg: '#f0e6d3', color: '#6b3f2a' }
  const label  = type === 'order' ? (STATUS_META[status]?.label || status) : status
  return (
    <span className="adm-badge" style={{ background: colors.bg, color: colors.color }}>
      {label.replace(/_/g, ' ')}
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
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])
  return (
    <div className="adm-confirm-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="adm-confirm-box">
        <p className="adm-confirm-title">{title}</p>
        <p className="adm-confirm-msg">{message}</p>
        {children}
        <div className="adm-confirm-actions">
          <button className="adm-btn-outline" onClick={onClose}>Cancel</button>
          <button className={danger ? 'adm-btn-danger armed' : 'adm-btn'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ProofModal ────────────────────────────────────────────────────────────────

function ProofModal({ order, onVerify, onReject, onClose }) {
  const [refNo,      setRefNo     ] = useState(order.proofReferenceNo || '')
  const [reason,     setReason    ] = useState('')
  const [loading,    setLoading   ] = useState(false)
  const [proofImage, setProofImage] = useState(null)
  const [proofMeta,  setProofMeta ] = useState(null)
  const [fetching,   setFetching  ] = useState(true)

  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  useEffect(() => {
    async function load() {
      try {
        const res  = await fetch(`/api/orders/upload-proof?orderId=${order.id}`, {
          headers: { 'X-Admin-Secret': getAdminSecret() || '' },
        })
        const data = await res.json()
        if (data.ok) {
          setProofImage(data.proofImage)
          setProofMeta({ uploadedAt: data.uploadedAt, referenceNo: data.referenceNo })
          if (data.referenceNo) setRefNo(data.referenceNo)
        }
      } catch (e) {
        console.warn('Failed to load proof', e)
      } finally {
        setFetching(false)
      }
    }
    load()
  }, [order.id])

  return (
    <div className="adm-confirm-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="adm-proof-modal">
        <div className="adm-proof-header">
          <div>
            <p className="adm-proof-eyebrow">Payment Proof</p>
            <h2 className="adm-proof-title">{order.orderNumber}</h2>
            <p className="adm-proof-meta">
              {order.customerName} · {fmtPhp(order.total)} · {PAYMENT_METHOD_LABEL[order.paymentMethod]}
            </p>
          </div>
          <button className="adm-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="adm-proof-body">
          <div className="adm-proof-img-wrap">
            {fetching ? (
              <div className="adm-proof-no-img">Loading proof…</div>
            ) : proofImage ? (
              <img src={proofImage} alt="Payment proof" className="adm-proof-img" />
            ) : (
              <div className="adm-proof-no-img">No proof image uploaded yet</div>
            )}
          </div>
          <div className="adm-proof-details">
            <div className="adm-proof-detail-row">
              <span>Uploaded</span>
              <span>{proofMeta?.uploadedAt ? fmtDate(proofMeta.uploadedAt) : 'Not yet'}</span>
            </div>
            <div className="adm-proof-detail-row">
              <span>Proof status</span>
              <StatusBadge status={order.proofStatus || 'none'} type="payment" />
            </div>
            <div className="adm-proof-detail-row">
              <span>Customer ref no.</span>
              <span>{proofMeta?.referenceNo || '—'}</span>
            </div>
          </div>
          <div className="adm-proof-refno">
            <label className="adm-label">
              Confirmed reference / transaction number
              <span className="adm-label-hint"> (optional)</span>
            </label>
            <input className="adm-input" type="text" value={refNo}
              onChange={e => setRefNo(e.target.value)}
              placeholder="e.g. GCash ref 123456789" />
          </div>
          {proofImage && (
            <div className="adm-proof-refno">
              <label className="adm-label">
                Rejection reason
                <span className="adm-label-hint"> (optional — sent to customer)</span>
              </label>
              <input className="adm-input" type="text" value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="e.g. Amount doesn't match, blurry image" />
            </div>
          )}
          <div className="adm-proof-actions">
            <button className="adm-btn" disabled={loading || !proofImage}
              onClick={async () => { setLoading(true); await onVerify(order.id, refNo); setLoading(false) }}>
              {loading ? 'Verifying…' : '✓ Verify payment'}
            </button>
            {proofImage && (
              <button className="adm-btn-danger armed" disabled={loading}
                onClick={async () => { setLoading(true); await onReject(order.id, reason); setLoading(false) }}>
                ✕ Reject proof
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── StatusControls ────────────────────────────────────────────────────────────

function StatusControls({ order, onAction, onRefresh }) {
  const [note,    setNote   ] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [saving,  setSaving ] = useState(false)

  const { next, prev, escapes } = getAllowedTransitions(order.status, order.paymentStatus)
  const isTerminal = !next && !prev && escapes.length === 0

  function requestChange(toStatus) {
    if (PAYMENT_GATED.has(toStatus) && order.paymentStatus !== 'paid') return
    const meta       = STATUS_META[toStatus]
    const isDanger   = ['cancelled', 'refunded'].includes(toStatus)
    const isBackward = prev === toStatus
    setConfirm({
      toStatus,
      title:   `Change to "${meta?.label || toStatus}"?`,
      message: isDanger
        ? toStatus === 'cancelled'
          ? 'This will cancel the order, release reserved inventory, and notify the customer. This cannot be undone.'
          : 'This will mark the order as refunded and notify the customer. This cannot be undone.'
        : isBackward
          ? `This will move the order back to "${meta?.label}". The customer will be notified.`
          : `This will advance the order to "${meta?.label}". The customer will be notified by email.`,
      danger: isDanger,
    })
  }

  async function doChange() {
    if (!confirm) return
    setSaving(true)
    setConfirm(null)
    await onAction(order.id, 'status', { status: confirm.toStatus, note })
    setNote('')
    setSaving(false)
    onRefresh()
  }

  return (
    <>
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={`Yes, ${STATUS_META[confirm.toStatus]?.label || confirm.toStatus}`}
          danger={confirm.danger}
          onConfirm={doChange}
          onClose={() => setConfirm(null)}
        >
          {!confirm.danger && (
            <input className="adm-input" placeholder="Internal note (optional)"
              value={note} onChange={e => setNote(e.target.value)}
              style={{ marginBottom: 16 }} />
          )}
        </ConfirmModal>
      )}
      <p className="adm-drawer-section-title">Update Status</p>
      <p className="adm-drawer-section-hint">Customer receives an email on every change.</p>
      {isTerminal ? (
        <p className="adm-muted" style={{ fontStyle: 'italic', fontSize: 14 }}>
          This order is in a terminal state ({STATUS_META[order.status]?.label || order.status}) and cannot be changed.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {prev && (
            <button className="adm-btn-outline" disabled={saving} onClick={() => requestChange(prev)}>
              ← {STATUS_META[prev]?.label}
            </button>
          )}
          {next ? (
            <button
              className="adm-btn"
              disabled={saving || (PAYMENT_GATED.has(next) && order.paymentStatus !== 'paid')}
              onClick={() => requestChange(next)}
              title={PAYMENT_GATED.has(next) && order.paymentStatus !== 'paid' ? 'Payment must be verified before processing' : `Advance to ${STATUS_META[next]?.label}`}
            >
              {STATUS_META[next]?.label} →
              {PAYMENT_GATED.has(next) && order.paymentStatus !== 'paid' && (
                <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.85 }}>🔒 Verify payment first</span>
              )}
            </button>
          ) : (!isTerminal && <p className="adm-muted" style={{ fontSize: 13 }}>No further steps available.</p>)}
          {escapes.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 10, marginTop: 2, borderTop: '1px solid var(--adm-border)' }}>
              {escapes.map(s => (
                <button key={s} className="adm-btn-danger" disabled={saving} onClick={() => requestChange(s)}>
                  {STATUS_META[s]?.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {saving && <p className="adm-muted" style={{ fontSize: 13, marginTop: 8 }}>Saving…</p>}
    </>
  )
}

// ── OrderDrawer ───────────────────────────────────────────────────────────────

function OrderDrawer({ order, onAction, onOpenProof, onClose, onRefresh }) {
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const totalItems = (order.items || []).reduce((s, i) => s + (i.quantity || 1), 0)

  return (
    <div className="adm-drawer-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="adm-drawer">
        <div className="adm-drawer-header">
          <div>
            <p className="adm-drawer-eyebrow">Order</p>
            <h2 className="adm-drawer-title">{order.orderNumber}</h2>
            <p className="adm-drawer-meta">{fmtDate(order.placedAt)}</p>
          </div>
          <button className="adm-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="adm-drawer-body">
          <div className="adm-drawer-badges">
            <StatusBadge status={order.status} />
            <StatusBadge status={order.paymentStatus} type="payment" />
            {order.proofStatus === 'pending' && (
              <span className="adm-badge adm-badge--pulse" style={{ background: '#fff3cd', color: '#856404' }}>
                Proof pending review
              </span>
            )}
          </div>
          <div className="adm-drawer-section">
            <p className="adm-drawer-section-title">Customer</p>
            <div className="adm-drawer-rows">
              <div className="adm-drawer-row"><span>Name</span><span>{order.customerName}</span></div>
              <div className="adm-drawer-row">
                <span>Email</span>
                <a href={`mailto:${order.customerEmail}`} className="adm-drawer-link">{order.customerEmail}</a>
              </div>
              {order.customerPhone && <div className="adm-drawer-row"><span>Phone</span><span>{order.customerPhone}</span></div>}
            </div>
          </div>
          <div className="adm-drawer-section">
            <p className="adm-drawer-section-title">Items ({totalItems})</p>
            <div className="adm-drawer-items">
              {(order.items || []).map((item, i) => (
                <div key={i} className="adm-drawer-item">
                  <span className="adm-drawer-item-name">{item.gownName}{item.sizeLabel ? ` — ${item.sizeLabel}` : ''}</span>
                  <span className="adm-drawer-item-qty">×{item.quantity || 1}</span>
                  <span className="adm-drawer-item-price">{fmtPhp(item.lineTotal || (item.unitPrice * (item.quantity || 1)))}</span>
                </div>
              ))}
            </div>
            <div className="adm-drawer-total"><span>Total</span><span>{fmtPhp(order.total)}</span></div>
          </div>
          <div className="adm-drawer-section">
            <p className="adm-drawer-section-title">Delivery</p>
            <div className="adm-drawer-rows">
              <div className="adm-drawer-row"><span>Method</span><span>{DELIVERY_LABEL[order.deliveryMethod] || order.deliveryMethod}</span></div>
              {order.deliveryAddress && <div className="adm-drawer-row adm-drawer-row--col"><span>Address</span><span>{order.deliveryAddress}</span></div>}
            </div>
          </div>
          <div className="adm-drawer-section">
            <p className="adm-drawer-section-title">Payment</p>
            <div className="adm-drawer-rows">
              <div className="adm-drawer-row"><span>Method</span><span>{PAYMENT_METHOD_LABEL[order.paymentMethod] || order.paymentMethod}</span></div>
              <div className="adm-drawer-row"><span>Status</span><StatusBadge status={order.paymentStatus} type="payment" /></div>
              {order.proofReferenceNo && <div className="adm-drawer-row"><span>Reference</span><span>{order.proofReferenceNo}</span></div>}
            </div>
            {order.proofStatus === 'pending' && (
              <button className="adm-btn-sm" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }} onClick={() => onOpenProof(order)}>
                Review payment proof →
              </button>
            )}
          </div>
          {order.notes && (
            <div className="adm-drawer-section">
              <p className="adm-drawer-section-title">Notes</p>
              <p className="adm-drawer-note">{order.notes}</p>
            </div>
          )}
          <div className="adm-drawer-section adm-drawer-section--action">
            <StatusControls order={order} onAction={onAction} onRefresh={() => { onRefresh(); onClose() }} />
          </div>
        </div>
      </aside>
    </div>
  )
}

// ── AdminOrdersPage ───────────────────────────────────────────────────────────

export default function AdminOrdersPage() {
  const { user: authUser, ready } = useRoleGuard(['admin', 'staff'], '/')

  const [orders,       setOrders      ] = useState([])
  const [loading,      setLoading     ] = useState(true)
  const [error,        setError       ] = useState('')
  const [search,       setSearch      ] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [toast,        setToast       ] = useState(null)
  const [proofOrder,   setProofOrder  ] = useState(null)
  const [drawerOrder,  setDrawerOrder ] = useState(null)
  const [stats,        setStats       ] = useState(null)
  const [sortKey,      setSortKey     ] = useState('placedAt')
  const [sortDir,      setSortDir     ] = useState('desc')

  // FIX: Mirror filterStatus in a ref so useCallback closures always read
  // the current value without needing it in their dependency array.
  // This prevents the stale-closure bug where handleAction called
  // loadOrders(filterStatus) but captured the filterStatus from when
  // the callback was last created rather than the current value.
  const filterStatusRef = useRef(filterStatus)
  useEffect(() => { filterStatusRef.current = filterStatus }, [filterStatus])

  // FIX: headers() moved outside render — stable reference, no closure issues.
  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    'X-Admin-Secret': getAdminSecret() || '',
  }), [])

  function showToast(msg, type = 'success') { setToast({ message: msg, type }) }

  const loadOrders = useCallback(async (status = '') => {
    setLoading(true)
    setError('')
    try {
      const url  = `/api/admin/orders${status ? `?status=${status}` : ''}`
      const res  = await fetch(url, { headers: headers() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      const all = data.orders || []
      setOrders(all)
      setStats({
        total:          all.length,
        pendingProof:   all.filter(o => o.proofStatus === 'pending').length,
        pendingPayment: all.filter(o => ['placed', 'pending_payment'].includes(o.status) && o.paymentMethod !== 'cash').length,
        processing:     all.filter(o => ['processing', 'ready', 'shipped'].includes(o.status)).length,
        revenue:        all.filter(o => o.paymentStatus === 'paid').reduce((s, o) => s + Number(o.total || 0), 0),
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [headers])

  useEffect(() => { loadOrders() }, [loadOrders])

  // FIX: handleAction now reads filterStatus from the ref (always current)
  // rather than from the closure (potentially stale). This means calling
  // loadOrders after verify/reject always uses the filter that is actually
  // visible on screen, not the one captured at callback creation time.
  const handleAction = useCallback(async (orderId, action, payload = {}) => {
    try {
      const res  = await fetch('/api/admin/orders', {
        method:  'PATCH',
        headers: headers(),
        body:    JSON.stringify({ action, orderId, ...payload }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')

      if (action === 'status') {
        const { status } = payload
        setOrders(p => p.map(o => o.id === orderId ? { ...o, status, updatedAt: new Date().toISOString() } : o))
        setDrawerOrder(p => p?.id === orderId ? { ...p, status } : p)
        showToast(`Status updated to "${STATUS_META[status]?.label || status}"`)
      } else if (action === 'verify-payment') {
        const { referenceNo } = payload
        setOrders(p => p.map(o => o.id === orderId
          ? { ...o, paymentStatus: 'paid', status: 'paid', proofStatus: 'verified', proofReferenceNo: referenceNo || o.proofReferenceNo }
          : o
        ))
        setDrawerOrder(p => p?.id === orderId ? { ...p, paymentStatus: 'paid', status: 'paid', proofStatus: 'verified' } : p)
        setProofOrder(null)
        showToast('Payment verified — customer notified')
        // Read from ref — always the current filter value
        loadOrders(filterStatusRef.current)
      } else if (action === 'reject-payment') {
        setOrders(p => p.map(o => o.id === orderId
          ? { ...o, paymentStatus: 'unpaid', status: 'placed', proofStatus: 'rejected' }
          : o
        ))
        setDrawerOrder(p => p?.id === orderId ? { ...p, paymentStatus: 'unpaid', status: 'placed', proofStatus: 'rejected' } : p)
        setProofOrder(null)
        showToast('Proof rejected — customer notified', 'error')
        // Read from ref — always the current filter value
        loadOrders(filterStatusRef.current)
      }
    } catch (e) {
      showToast(e.message, 'error')
    }
  }, [headers, loadOrders])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function sortIcon(key) {
    if (sortKey !== key) return <span style={{ opacity: 0.4, marginLeft: 4, fontSize: 11 }}>↕</span>
    return <span style={{ marginLeft: 4, fontSize: 11 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const filtered = orders
    .filter(o => {
      const matchStatus = !filterStatus || o.status === filterStatus
      const q = search.toLowerCase()
      const matchSearch = !q ||
        o.orderNumber?.toLowerCase().includes(q) ||
        o.customerName?.toLowerCase().includes(q) ||
        o.customerEmail?.toLowerCase().includes(q)
      return matchStatus && matchSearch
    })
    .sort((a, b) => {
      let av, bv
      if (sortKey === 'placedAt')    { av = new Date(a.placedAt).getTime(); bv = new Date(b.placedAt).getTime() }
      else if (sortKey === 'total')  { av = a.total;                        bv = b.total }
      else if (sortKey === 'status') { av = STATUS_META[a.status]?.step ?? 99; bv = STATUS_META[b.status]?.step ?? 99 }
      else                           { av = a.customerName?.toLowerCase();  bv = b.customerName?.toLowerCase() }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ?  1 : -1
      return 0
    })

  const pendingProofOrders = orders.filter(o => o.proofStatus === 'pending')

  const thStyle = {
    fontSize: 11, fontWeight: 700, color: 'var(--adm-text-3)',
    letterSpacing: '0.07em', textTransform: 'uppercase',
    padding: '6px 18px', cursor: 'pointer', userSelect: 'none',
  }

  if (!ready) return null

  return (
    <div className="adm-orders-page">
      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
      {proofOrder && (
        <ProofModal
          order={proofOrder}
          onVerify={(id, ref)    => handleAction(id, 'verify-payment', { referenceNo: ref })}
          onReject={(id, reason) => handleAction(id, 'reject-payment', { reason })}
          onClose={() => setProofOrder(null)}
        />
      )}
      {drawerOrder && (
        <OrderDrawer
          order={drawerOrder}
          onAction={handleAction}
          onOpenProof={o => { setDrawerOrder(null); setProofOrder(o) }}
          onClose={() => setDrawerOrder(null)}
          onRefresh={() => loadOrders(filterStatusRef.current)}
        />
      )}

      <div className="adm-topbar">
        <h1 className="adm-page-title">Orders</h1>
        <button className="adm-btn-sm" onClick={() => loadOrders(filterStatus)}>↻ Refresh</button>
      </div>

      {stats && (
        <div className="adm-stats-row">
          <div className="adm-stat"><div className="adm-stat-val">{stats.total}</div><div className="adm-stat-lbl">Total orders</div></div>
          <div className={`adm-stat${stats.pendingProof > 0 ? ' warn' : ''}`}><div className="adm-stat-val">{stats.pendingProof}</div><div className="adm-stat-lbl">Proofs to review</div></div>
          <div className={`adm-stat${stats.pendingPayment > 0 ? ' warn' : ''}`}><div className="adm-stat-val">{stats.pendingPayment}</div><div className="adm-stat-lbl">Awaiting payment</div></div>
          <div className="adm-stat"><div className="adm-stat-val">{stats.processing}</div><div className="adm-stat-lbl">In progress</div></div>
          <div className="adm-stat"><div className="adm-stat-val">{fmtPhp(stats.revenue)}</div><div className="adm-stat-lbl">Verified revenue</div></div>
        </div>
      )}

      {pendingProofOrders.length > 0 && (
        <div className="adm-proof-alert">
          <p className="adm-proof-alert-title">
            ⚠ {pendingProofOrders.length} order{pendingProofOrders.length > 1 ? 's' : ''} with proof awaiting review
          </p>
          <div className="adm-proof-alert-list">
            {pendingProofOrders.slice(0, 4).map(o => (
              <div key={o.id} className="adm-proof-alert-item">
                <span className="adm-proof-alert-name">{o.orderNumber} · {o.customerName}</span>
                <span style={{ fontWeight: 700, color: 'var(--adm-text)' }}>{fmtPhp(o.total)}</span>
                <button className="adm-proof-alert-btn" onClick={() => setProofOrder(o)}>Review</button>
              </div>
            ))}
            {pendingProofOrders.length > 4 && (
              <p className="adm-muted" style={{ fontSize: 13 }}>+{pendingProofOrders.length - 4} more — use filters below</p>
            )}
          </div>
        </div>
      )}

      <div className="adm-filter-row">
        <input className="adm-search" placeholder="Search by order no., name, or email…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <div className="adm-filter-status">
          <button className={`adm-filter-pill${!filterStatus ? ' active' : ''}`}
            onClick={() => { setFilterStatus(''); loadOrders('') }}>All</button>
          {['pending_payment', 'paid', 'processing', 'ready', 'shipped', 'completed', 'cancelled'].map(s => (
            <button key={s}
              className={`adm-filter-pill${filterStatus === s ? ' active' : ''}`}
              onClick={() => { setFilterStatus(s); loadOrders(s) }}>
              {STATUS_META[s]?.label || s}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="adm-error-msg">{error}</p>}

      {loading ? (
        <p className="adm-muted">Loading orders…</p>
      ) : filtered.length === 0 ? (
        <p className="adm-muted">No orders found.</p>
      ) : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 140px 110px 110px 90px', gap: 14 }}>
            <div style={thStyle}>Order</div>
            <div style={thStyle} onClick={() => toggleSort('customerName')}>Customer {sortIcon('customerName')}</div>
            <div style={thStyle} onClick={() => toggleSort('status')}>Status {sortIcon('status')}</div>
            <div style={{ ...thStyle, cursor: 'default' }}>Payment</div>
            <div style={{ ...thStyle, textAlign: 'right' }} onClick={() => toggleSort('total')}>Total {sortIcon('total')}</div>
            <div style={thStyle} onClick={() => toggleSort('placedAt')}>Date {sortIcon('placedAt')}</div>
          </div>
          {filtered.map(order => (
            <div key={order.id}
              className={`adm-order-row${order.proofStatus === 'pending' ? ' has-proof' : ''}`}
              onClick={() => setDrawerOrder(order)}>
              <div className="adm-order-num">
                {order.orderNumber}
                {order.proofStatus === 'pending' && (
                  <span style={{ marginLeft: 6, fontSize: 9, background: '#fff3cd', color: '#856404', padding: '1px 5px', borderRadius: 3, fontWeight: 700, letterSpacing: '0.04em' }}>
                    PROOF
                  </span>
                )}
              </div>
              <div className="adm-order-customer">
                <div className="adm-order-customer-name">{order.customerName}</div>
                <div className="adm-order-customer-email">{order.customerEmail}</div>
              </div>
              <div><StatusBadge status={order.status} /></div>
              <div><StatusBadge status={order.paymentStatus} type="payment" /></div>
              <div className="adm-order-total">{fmtPhp(order.total)}</div>
              <div className="adm-order-actions" onClick={e => e.stopPropagation()}>
                {order.proofStatus === 'pending' && (
                  <button className="adm-btn-sm" onClick={() => setProofOrder(order)}>Verify</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Link href="/admin" className="adm-back-link">← Dashboard</Link>
    </div>
  )
}