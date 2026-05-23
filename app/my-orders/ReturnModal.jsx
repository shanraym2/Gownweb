'use client'

// app/my-orders/ReturnModal.jsx
// Slide-in modal for customers to submit return / refund / exchange requests.
// Integrated into my-orders/page.jsx — open via:
//   <ReturnModal order={order} onClose={() => setReturnOrder(null)} onSuccess={reloadOrders} />

import { useState, useEffect, useCallback } from 'react'

const REQUEST_TYPES = [
  {
    id:    'return',
    label: 'Return',
    icon:  '↩',
    desc:  'Send item(s) back to the boutique.',
  },
  {
    id:    'refund',
    label: 'Refund',
    icon:  '₱',
    desc:  'Request your money back.',
  },
  {
    id:    'exchange',
    label: 'Exchange',
    icon:  '⇄',
    desc:  'Swap for a different size or style.',
  },
]

const REASONS = [
  'Item is defective or damaged',
  'Item differs significantly from description',
  'Wrong size received',
  'Wrong item received',
  'Other',
]

function fmtPhp(n) {
  return '₱' + Number(n || 0).toLocaleString('en-PH')
}

export default function ReturnModal({ order, onClose, onSuccess }) {
  const [type,        setType       ] = useState('return')
  const [reason,      setReason     ] = useState('')
  const [details,     setDetails    ] = useState('')
  const [selectedIds, setSelectedIds] = useState(() =>
    (order.items || []).map((_, i) => i)
  )
  const [submitting,  setSubmitting ] = useState(false)
  const [error,       setError      ] = useState('')
  const [done,        setDone       ] = useState(false)

  // Escape key closes
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const toggleItem = useCallback((idx) => {
    setSelectedIds(prev =>
      prev.includes(idx)
        ? prev.filter(i => i !== idx)
        : [...prev, idx]
    )
  }, [])

  const handleSubmit = async () => {
    setError('')
    if (!reason) { setError('Please select a reason.'); return }
    if (selectedIds.length === 0) { setError('Select at least one item.'); return }

    setSubmitting(true)
    try {
      const items = selectedIds.map(idx => {
        const item = order.items[idx]
        return {
          gownId:    item.id    || item.gownId,
          gownName:  item.name  || item.gownName,
          sizeLabel: item.size  || item.sizeLabel || null,
          quantity:  item.qty   || item.quantity  || 1,
        }
      })

      const res  = await fetch('/api/returns', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id':    order.userId || '',
        },
        body: JSON.stringify({
          orderId: order.id,
          type,
          reason,
          details: details.trim(),
          items,
        }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error || 'Submission failed. Please try again.'); return }
      setDone(true)
      if (onSuccess) setTimeout(onSuccess, 1600)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(44,36,32,.45)',
          zIndex: 1200,
          backdropFilter: 'blur(2px)',
          animation: 'mo-fade-in .18s ease',
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Submit after-sales request"
        style={{
          position:  'fixed',
          top: 0, right: 0, bottom: 0,
          width: 'min(460px, 100vw)',
          background: 'var(--iv, #faf7f4)',
          zIndex: 1201,
          display:       'flex',
          flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(44,26,16,.12)',
          animation: 'mo-slide-in .22s ease',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '24px 28px 20px',
          borderBottom: '1px solid var(--ch, #e8e0da)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        }}>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase', color: 'var(--mu, #9a8880)', fontFamily: 'Jost, sans-serif' }}>
              After-Sales Request
            </p>
            <h2 style={{
              margin: '0 0 4px',
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 22, fontWeight: 400, color: 'var(--es, #2c2420)',
            }}>
              {order.orderNumber}
            </h2>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--mu, #9a8880)', fontFamily: 'Jost, sans-serif' }}>
              {fmtPhp(order.total)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 6, color: 'var(--mu, #9a8880)',
              fontSize: 18, lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {done ? (
            <div style={{ textAlign: 'center', paddingTop: 60 }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: '#d4edda',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24, margin: '0 auto 18px',
              }}>
                ✓
              </div>
              <p style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: 20, fontWeight: 400, color: 'var(--es, #2c2420)',
                margin: '0 0 10px',
              }}>
                Request submitted
              </p>
              <p style={{ fontSize: 13, color: 'var(--mu, #9a8880)', lineHeight: 1.7, margin: 0 }}>
                We&rsquo;ll review your request within 1&ndash;2 business days and notify you by email.
              </p>
            </div>
          ) : (
            <>
              {/* Policy reminder */}
              <div style={{
                padding: '12px 14px', marginBottom: 24,
                background: '#fff8f0', border: '1px solid #f0ddc0',
                borderRadius: 4,
                fontSize: 11, color: '#7a5a2a', lineHeight: 1.6,
                fontFamily: 'Jost, sans-serif',
              }}>
                <strong>Policy:</strong> Returns accepted within 48 hours of order completion for defective or significantly different items. Items must be unworn, unaltered, with tags attached.
              </div>

              {/* Request type */}
              <fieldset style={{ border: 'none', margin: '0 0 24px', padding: 0 }}>
                <legend style={{
                  fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase',
                  color: 'var(--mu, #9a8880)', marginBottom: 10,
                  fontFamily: 'Jost, sans-serif',
                }}>
                  Request type
                </legend>
                <div style={{ display: 'flex', gap: 8 }}>
                  {REQUEST_TYPES.map(rt => (
                    <button
                      key={rt.id}
                      onClick={() => setType(rt.id)}
                      style={{
                        flex: 1, padding: '10px 6px',
                        border: `1px solid ${type === rt.id ? 'var(--wb, #7a5a44)' : 'var(--ch, #e8e0da)'}`,
                        borderRadius: 4, background: type === rt.id ? 'var(--ch, #e8e0da)' : 'transparent',
                        cursor: 'pointer', textAlign: 'center',
                        transition: 'all .15s',
                        fontFamily: 'Jost, sans-serif',
                      }}
                    >
                      <div style={{ fontSize: 16, marginBottom: 4 }}>{rt.icon}</div>
                      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--es, #2c2420)' }}>{rt.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--mu, #9a8880)', lineHeight: 1.4, marginTop: 2 }}>{rt.desc}</div>
                    </button>
                  ))}
                </div>
              </fieldset>

              {/* Items */}
              <fieldset style={{ border: 'none', margin: '0 0 24px', padding: 0 }}>
                <legend style={{
                  fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase',
                  color: 'var(--mu, #9a8880)', marginBottom: 10,
                  fontFamily: 'Jost, sans-serif',
                }}>
                  Items included
                </legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(order.items || []).map((item, idx) => {
                    const checked = selectedIds.includes(idx)
                    return (
                      <label
                        key={idx}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 12px',
                          border: `1px solid ${checked ? 'var(--wb, #7a5a44)' : 'var(--ch, #e8e0da)'}`,
                          borderRadius: 4, cursor: 'pointer',
                          background: checked ? 'rgba(122,90,68,.05)' : 'transparent',
                          transition: 'all .15s',
                          fontFamily: 'Jost, sans-serif',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleItem(idx)}
                          style={{ accentColor: 'var(--wb, #7a5a44)', width: 15, height: 15 }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: 'var(--es, #2c2420)', fontWeight: 400 }}>
                            {item.name || item.gownName}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--mu, #9a8880)' }}>
                            {[item.size || item.sizeLabel, `×${item.qty || item.quantity || 1}`].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </fieldset>

              {/* Reason */}
              <div style={{ marginBottom: 20 }}>
                <label style={{
                  display: 'block', fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase',
                  color: 'var(--mu, #9a8880)', marginBottom: 8,
                  fontFamily: 'Jost, sans-serif',
                }}>
                  Reason <span style={{ color: '#e24b4a' }}>*</span>
                </label>
                <select
                  value={reason}
                  onChange={e => { setReason(e.target.value); setError('') }}
                  style={{
                    width: '100%', padding: '10px 12px',
                    border: '1px solid var(--ch, #e8e0da)', borderRadius: 4,
                    background: 'transparent', color: reason ? 'var(--es, #2c2420)' : 'var(--mu, #9a8880)',
                    fontSize: 13, fontFamily: 'Jost, sans-serif',
                    appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239a8880' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 12px center',
                  }}
                >
                  <option value="">Select a reason…</option>
                  {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* Details */}
              <div style={{ marginBottom: 24 }}>
                <label style={{
                  display: 'block', fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase',
                  color: 'var(--mu, #9a8880)', marginBottom: 8,
                  fontFamily: 'Jost, sans-serif',
                }}>
                  Additional details <span style={{ fontSize: 9, fontWeight: 300, opacity: .7 }}>(optional)</span>
                </label>
                <textarea
                  value={details}
                  onChange={e => setDetails(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Describe the issue in more detail…"
                  style={{
                    width: '100%', padding: '10px 12px',
                    border: '1px solid var(--ch, #e8e0da)', borderRadius: 4,
                    background: 'transparent', color: 'var(--es, #2c2420)',
                    fontSize: 13, fontFamily: 'Jost, sans-serif',
                    resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6,
                  }}
                />
                <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--mu, #9a8880)', textAlign: 'right' }}>
                  {details.length}/500
                </p>
              </div>

              {error && (
                <p style={{ fontSize: 12, color: '#a32d2d', marginBottom: 16, fontFamily: 'Jost, sans-serif' }}>
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!done && (
          <div style={{
            padding: '18px 28px',
            borderTop: '1px solid var(--ch, #e8e0da)',
            display: 'flex', gap: 10,
          }}>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                flex: 1, padding: '12px 0',
                background: submitting ? 'var(--mu, #9a8880)' : 'var(--es, #2c2420)',
                color: 'var(--iv, #faf7f4)',
                border: 'none', borderRadius: 0, cursor: submitting ? 'not-allowed' : 'pointer',
                fontSize: 10, letterSpacing: '.3em', textTransform: 'uppercase',
                fontFamily: 'Jost, sans-serif', fontWeight: 500,
                transition: 'background .15s',
              }}
            >
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
            <button
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '12px 20px',
                background: 'transparent',
                border: '1px solid var(--ch, #e8e0da)',
                borderRadius: 0, cursor: 'pointer',
                fontSize: 10, letterSpacing: '.3em', textTransform: 'uppercase',
                fontFamily: 'Jost, sans-serif', color: 'var(--mu, #9a8880)',
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes mo-fade-in  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes mo-slide-in { from { transform: translateX(100%) } to { transform: translateX(0) } }
      `}</style>
    </>
  )
}