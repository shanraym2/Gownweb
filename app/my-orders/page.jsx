'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser } from '../utils/authClient'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  placed:          { bg: '#e8f0ff', color: '#2d5be3' },
  pending_payment: { bg: '#fff3cd', color: '#856404' },
  paid:            { bg: '#d4edda', color: '#155724' },
  processing:      { bg: '#e2d9f3', color: '#4a2c82' },
  ready:           { bg: '#cff4fc', color: '#0a5276' },
  shipped:         { bg: '#d1ecf1', color: '#0c5460' },
  completed:       { bg: '#d4edda', color: '#155724' },
  cancelled:       { bg: '#f8d7da', color: '#721c24' },
  refunded:        { bg: '#fce8d4', color: '#7a3608' },
}

const STATUS_LABEL = {
  placed:          'Order Placed',
  pending_payment: 'Awaiting Payment',
  paid:            'Payment Confirmed',
  processing:      'Processing',
  ready:           'Ready',
  shipped:         'Out for Delivery',
  completed:       'Completed',
  cancelled:       'Cancelled',
  refunded:        'Refunded',
}

const STATUS_LABEL_SHORT = {
  placed:          'Placed',
  pending_payment: 'Pending',
  paid:            'Paid',
  processing:      'Processing',
  ready:           'Ready',
  shipped:         'Shipped',
  completed:       'Completed',
  cancelled:       'Cancelled',
  refunded:        'Refunded',
}

const STATUS_ICON = {
  placed:          '📋',
  pending_payment: '⏳',
  paid:            '✓',
  processing:      '⚙',
  ready:           '✦',
  shipped:         '🚚',
  completed:       '✓',
  cancelled:       '✕',
  refunded:        '↩',
}

const STATUS_DESC = {
  placed:          'Your order has been received.',
  pending_payment: 'Upload your proof of payment to proceed.',
  paid:            'Your payment has been verified.',
  processing:      "We're preparing your gown.",
  ready:           'Your gown is ready.',
  shipped:         'Your order is on its way.',
  completed:       'Order delivered — thank you!',
  cancelled:       'This order has been cancelled.',
  refunded:        'A refund has been issued.',
}

const STATUS_COLOR_HEX = {
  placed:          '#2d5be3',
  pending_payment: '#856404',
  paid:            '#155724',
  processing:      '#4a2c82',
  ready:           '#0a5276',
  shipped:         '#0c5460',
  completed:       '#c9a96e',
  cancelled:       '#721c24',
  refunded:        '#7a3608',
}

const ONGOING_STATUSES  = new Set(['placed', 'pending_payment', 'paid', 'processing', 'ready', 'shipped'])
const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'refunded'])
const DELIVERY_LABEL    = { pickup: 'Store Pickup', lalamove: 'Lalamove Delivery' }
const PAYMENT_LABEL     = { gcash: 'GCash', bdo: 'BDO Transfer', cash: 'Cash on Pickup' }

const PROGRESS_STEPS = {
  pickup:   ['placed', 'pending_payment', 'paid', 'processing', 'ready', 'completed'],
  lalamove: ['placed', 'pending_payment', 'paid', 'processing', 'ready', 'shipped', 'completed'],
}

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

function fmtDateRelative(iso) {
  if (!iso) return '—'
  const d   = new Date(iso)
  const now = new Date()
  const diff = now - d
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 2)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7)   return `${days}d ago`
  return fmtDate(iso)
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function Badge({ status }) {
  const c = STATUS_COLORS[status] || { bg: '#f0e6d3', color: '#6b3f2a' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 20,
      fontSize: 10, fontWeight: 600, letterSpacing: '.05em',
      textTransform: 'uppercase', whiteSpace: 'nowrap',
      background: c.bg, color: c.color,
    }}>
      {STATUS_LABEL_SHORT[status] || status.replace(/_/g, ' ')}
    </span>
  )
}

// ── Progress Steps ────────────────────────────────────────────────────────────

function ProgressSteps({ status, deliveryMethod }) {
  const steps   = PROGRESS_STEPS[deliveryMethod] || PROGRESS_STEPS.lalamove
  const curIdx  = steps.indexOf(status)
  const isBad   = status === 'cancelled' || status === 'refunded'

  if (isBad) return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '10px 14px', borderRadius: 6,
      background: STATUS_COLORS[status]?.bg,
      color: STATUS_COLORS[status]?.color,
      fontSize: 12, fontWeight: 500,
    }}>
      <span style={{ fontSize: 14 }}>{STATUS_ICON[status]}</span>
      {STATUS_LABEL[status]}
    </div>
  )

  return (
    <div style={{ margin: '4px 0' }}>
      {/* Step dots */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 6 }}>
        {steps.map((step, i) => {
          const done    = i < curIdx
          const current = i === curIdx
          const hex     = done || current ? STATUS_COLOR_HEX[status] || '#c9a96e' : 'var(--ch)'
          const lineHex = i < curIdx ? STATUS_COLOR_HEX[status] || '#c9a96e' : 'var(--ch)'
          return (
            <div key={step} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 'none' }}>
              <div title={STATUS_LABEL_SHORT[step]} style={{
                width: current ? 10 : 7,
                height: current ? 10 : 7,
                borderRadius: '50%',
                background: done ? hex : current ? hex : 'transparent',
                border: `2px solid ${hex}`,
                flexShrink: 0,
                boxSizing: 'border-box',
                transition: 'all .3s',
                boxShadow: current ? `0 0 0 3px ${hex}22` : 'none',
              }} />
              {i < steps.length - 1 && (
                <div style={{
                  flex: 1, height: 1.5,
                  background: i < curIdx ? lineHex : 'var(--ch)',
                  transition: 'background .4s',
                  margin: '0 1px',
                }} />
              )}
            </div>
          )
        })}
      </div>
      {/* Current label */}
      <div style={{
        fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase',
        color: STATUS_COLOR_HEX[status] || '#c9a96e',
        fontWeight: 600,
      }}>
        {STATUS_LABEL[status] || status}
        {status === 'pending_payment' && ' · upload proof to continue'}
        {status === 'ready' && deliveryMethod === 'pickup' && ' · visit our store'}
      </div>
    </div>
  )
}

// ── Status Timeline ───────────────────────────────────────────────────────────

function StatusTimeline({ history, status, deliveryMethod }) {
  // Full ordered list of steps for this delivery method
  const steps = PROGRESS_STEPS[deliveryMethod] || PROGRESS_STEPS.lalamove

  // For cancelled / refunded: show logged history + terminal entry
  const isBad = status === 'cancelled' || status === 'refunded'

  // Build a map of status → logged event (most recent wins if dupes)
  const logMap = {}
  ;(history || []).forEach(entry => {
    if (!logMap[entry.status] || new Date(entry.changedAt) > new Date(logMap[entry.status].changedAt)) {
      logMap[entry.status] = entry
    }
  })

  const curIdx = steps.indexOf(status)

  let rows

  if (isBad) {
    const loggedSteps = (history || [])
      .slice()
      .sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt))
    const alreadyHasTerminal = loggedSteps.some(e => e.status === status)
    rows = alreadyHasTerminal
      ? loggedSteps
      : [{ status, changedAt: null }, ...loggedSteps]
  } else {
    rows = steps.map((step, i) => {
      const logged = logMap[step]
      let state
      if (i < curIdx)        state = 'done'
      else if (i === curIdx) state = 'current'
      else                   state = 'upcoming'
      return { status: step, changedAt: logged?.changedAt || null, note: logged?.note || null, state }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {rows.map((entry, i) => {
        const isCurrent  = !isBad && entry.state === 'current'
        const isDone     = !isBad && entry.state === 'done'
        const isUpcoming = !isBad && entry.state === 'upcoming'
        const isFirst    = isBad && i === 0
        const isLast     = i === rows.length - 1

        const hex = isDone || isCurrent || isFirst
          ? STATUS_COLOR_HEX[isBad ? entry.status : status] || '#c9a96e'
          : '#d4c4bc'

        const dotBg     = isDone || isCurrent || isFirst ? hex : 'var(--iv)'
        const dotBorder = isUpcoming ? 'var(--ch)' : hex
        const textColor = isUpcoming ? 'var(--mu)' : isCurrent || isFirst ? 'var(--es)' : 'var(--mu)'
        const lineColor = isDone ? hex : 'var(--ch)'

        return (
          <div key={`${entry.status}-${i}`} style={{
            display: 'flex', gap: 14, position: 'relative',
            paddingBottom: isLast ? 0 : 18,
          }}>
            {!isLast && (
              <div style={{
                position: 'absolute', left: 10, top: 22, bottom: 0,
                width: 1.5, background: lineColor, transition: 'background .3s',
              }} />
            )}

            <div style={{
              width: 21, height: 21, borderRadius: '50%',
              flexShrink: 0, zIndex: 1, marginTop: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: dotBg,
              border: `1.5px solid ${dotBorder}`,
              fontSize: 9,
              color: (isDone || isCurrent || isFirst) ? '#fff' : 'var(--mu)',
              boxShadow: (isCurrent || isFirst) ? `0 0 0 3px ${hex}20` : 'none',
              transition: 'all .25s',
              opacity: isUpcoming ? 0.45 : 1,
            }}>
              {(isCurrent || isFirst) && (STATUS_ICON[entry.status] || '·')}
              {isDone && '✓'}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <p style={{
                  margin: 0,
                  fontSize: isCurrent || isFirst ? 13 : 12,
                  fontWeight: isCurrent || isFirst ? 500 : 300,
                  color: textColor, lineHeight: 1.3,
                  opacity: isUpcoming ? 0.55 : 1,
                }}>
                  {STATUS_LABEL[entry.status] || entry.status}
                </p>
                {entry.changedAt ? (
                  <span title={fmtDate(entry.changedAt)} style={{
                    fontSize: 10,
                    color: isCurrent || isFirst ? hex : 'var(--mu)',
                    whiteSpace: 'nowrap', fontWeight: 300, flexShrink: 0,
                    opacity: isUpcoming ? 0.5 : 1,
                  }}>
                    {fmtDateRelative(entry.changedAt)}
                  </span>
                ) : isUpcoming ? (
                  <span style={{ fontSize: 9, color: 'var(--mu)', opacity: 0.4, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                    upcoming
                  </span>
                ) : null}
              </div>

              {entry.changedAt && (
                <p style={{ margin: '1px 0 0', fontSize: 10, color: 'var(--mu)', fontWeight: 300, opacity: isUpcoming ? 0.5 : 1 }}>
                  {fmtDate(entry.changedAt)}
                </p>
              )}

              {(entry.note || STATUS_DESC[entry.status]) && (
                <p style={{
                  margin: '3px 0 0', fontSize: 11,
                  color: isCurrent || isFirst ? 'var(--wb)' : 'var(--mu)',
                  fontWeight: 300, fontStyle: 'italic', lineHeight: 1.5,
                  opacity: isUpcoming ? 0.45 : 1,
                }}>
                  {entry.note || STATUS_DESC[entry.status]}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar({ tab, setTab, ongoingCount, completedCount }) {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--ch)', marginBottom: 28, gap: 0 }}>
      {[
        { key: 'ongoing',   label: 'Active',  count: ongoingCount },
        { key: 'completed', label: 'History', count: completedCount },
      ].map(({ key, label, count }) => (
        <button
          key={key}
          onClick={() => setTab(key)}
          style={{
            padding: '12px 0',
            marginRight: 32,
            fontSize: 10, letterSpacing: '.3em', textTransform: 'uppercase',
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'Jost, sans-serif',
            color: tab === key ? 'var(--es)' : 'var(--mu)',
            borderBottom: `2px solid ${tab === key ? 'var(--go)' : 'transparent'}`,
            transition: 'color .15s, border-color .15s',
            display: 'flex', alignItems: 'center', gap: 7,
          }}
        >
          {label}
          {count > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 18, height: 18, borderRadius: '50%',
              background: tab === key ? 'var(--go)' : 'var(--ch)',
              color: tab === key ? '#fff' : 'var(--mu)',
              fontSize: 9, fontWeight: 700,
            }}>
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ── Order card ────────────────────────────────────────────────────────────────

function OrderCard({ order, expanded, onToggle, onConfirmReceipt }) {
  const isOngoing   = ONGOING_STATUSES.has(order.status)
  const isCancelled = order.status === 'cancelled' || order.status === 'refunded'
  const paymentMethod = order.payment || order.paymentMethod
  const needsProof    = order.status === 'pending_payment' && paymentMethod !== 'cash'

  return (
    <div
      className="mo-order"
      style={{
        opacity: isCancelled ? 0.75 : 1,
        border: '1px solid var(--ch)',
        borderRadius: 4,
        marginBottom: 10,
        overflow: 'hidden',
        transition: 'box-shadow .2s',
        boxShadow: expanded ? '0 4px 24px rgba(44,26,16,.07)' : 'none',
      }}
    >

      {/* ── Pending payment warning strip ── */}
      {needsProof && (
        <div style={{
          background: '#fff3cd', borderBottom: '1px solid #ffe08a',
          padding: '8px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: '#856404', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>⚠</span> Proof of payment required within 24 hours
          </span>
          <Link href={`/order-confirmation/${order.id}`}
            style={{ fontSize: 10, letterSpacing: '.2em', textTransform: 'uppercase', color: '#856404', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            Upload now →
          </Link>
        </div>
      )}

      {/* ── Header row ── */}
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onToggle()}
        style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '18px 20px',
          cursor: 'pointer',
          background: expanded ? 'rgba(240,230,211,.18)' : 'transparent',
          transition: 'background .15s',
        }}
      >
        {/* Status color accent */}
        <div style={{
          width: 3, height: 36, borderRadius: 2, flexShrink: 0,
          background: isCancelled
            ? STATUS_COLORS[order.status]?.color || '#ccc'
            : (isOngoing ? STATUS_COLOR_HEX[order.status] || '#c9a96e' : 'var(--ch)'),
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3, flexWrap: 'wrap' }}>
            <p style={{
              margin: 0,
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 17, fontWeight: 400, color: 'var(--es)',
            }}>
              {order.orderNumber}
            </p>
            <Badge status={order.status} />
          </div>
          <p style={{ margin: 0, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--mu)' }}>
            {fmtDate(order.createdAt || order.placedAt)}
          </p>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{
            margin: 0,
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 19, fontWeight: 400, color: 'var(--wb)',
          }}>
            {fmtPhp(order.total)}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 10, color: 'var(--mu)' }}>
            {(order.items || []).length} item{(order.items || []).length !== 1 ? 's' : ''}
          </p>
        </div>

        <span style={{
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform .2s',
          color: 'var(--mu)',
          flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>

      {/* ── Collapsed: progress bar for ongoing ── */}
      {!expanded && isOngoing && (
        <div style={{ padding: '0 20px 16px' }}>
          <ProgressSteps status={order.status} deliveryMethod={order.deliveryMethod} />
        </div>
      )}

      {/* ── Expanded body ── */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--ch)' }}>

          {/* Progress */}
          {!isCancelled && (
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--ch)' }}>
              <p style={{ margin: '0 0 12px', fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase', color: 'var(--mu)' }}>
                Order Progress
              </p>
              <ProgressSteps status={order.status} deliveryMethod={order.deliveryMethod} />
            </div>
          )}

          {/* Two-column body */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,.9fr)',
            gap: 0,
          }}>

            {/* Left col */}
            <div style={{ padding: '20px 20px', borderRight: '1px solid var(--ch)' }}>

              {/* Items */}
              <p style={{ margin: '0 0 12px', fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase', color: 'var(--mu)' }}>Items</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {(order.items || []).map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 300, color: 'var(--es)', lineHeight: 1.4 }}>
                      {item.name || item.gownName}
                      {(item.size || item.sizeLabel) ? (
                        <span style={{ color: 'var(--mu)', fontWeight: 300 }}> · {item.size || item.sizeLabel}</span>
                      ) : null}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--mu)' }}>×{item.qty || item.quantity || 1}</span>
                    <span style={{
                      fontFamily: "'Cormorant Garamond', serif",
                      fontSize: 15, color: 'var(--wb)',
                    }}>
                      {typeof item.subtotal === 'number'
                        ? fmtPhp(item.subtotal)
                        : item.price || fmtPhp((item.unitPrice || 0) * (item.quantity || 1))}
                    </span>
                  </div>
                ))}
              </div>

              {/* Totals row */}
              <div style={{
                display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 16,
                paddingTop: 12, borderTop: '1px solid var(--ch)',
                marginBottom: 20,
              }}>
                {Number(order.shippingFee) > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--mu)' }}>
                    Shipping: {fmtPhp(order.shippingFee)}
                  </span>
                )}
                <span style={{ fontSize: 10, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--mu)' }}>Total</span>
                <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: 'var(--wb)' }}>
                  {fmtPhp(order.total)}
                </span>
              </div>

              {/* Delivery + payment */}
              <p style={{ margin: '0 0 10px', fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase', color: 'var(--mu)' }}>Delivery & Payment</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  ['Method',  DELIVERY_LABEL[order.deliveryMethod] || order.deliveryMethod],
                  ['Payment', PAYMENT_LABEL[paymentMethod] || paymentMethod],
                  ...(order.delivery?.address || order.deliveryAddress
                    ? [['Address', order.delivery?.address || order.deliveryAddress]]
                    : []),
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 300 }}>
                    <span style={{ fontSize: 10, letterSpacing: '.15em', textTransform: 'uppercase', color: 'var(--mu)' }}>{k}</span>
                    <span style={{ maxWidth: '60%', textAlign: 'right', lineHeight: 1.4 }}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Note */}
              {(order.note || order.notes) && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ margin: '0 0 6px', fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase', color: 'var(--mu)' }}>Note</p>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 300, fontStyle: 'italic', color: 'var(--mu)', lineHeight: 1.6 }}>
                    {order.note || order.notes}
                  </p>
                </div>
              )}

              {/* Confirm receipt */}
              {['ready', 'shipped'].includes(order.status) && (
                <div style={{
                  marginTop: 20, padding: '14px 16px',
                  background: 'var(--ch)', borderRadius: 3,
                }}>
                  <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 500, color: 'var(--es)' }}>Received your order?</p>
                  <p style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--mu)', fontWeight: 300, lineHeight: 1.5 }}>
                    Confirm once you have your gown in hand.
                  </p>
                  <button
                    onClick={() => onConfirmReceipt(order.id)}
                    style={{
                      display: 'inline-block', padding: '10px 20px',
                      background: 'var(--es)', color: 'var(--iv)',
                      fontFamily: 'Jost, sans-serif',
                      fontSize: 10, letterSpacing: '.3em', textTransform: 'uppercase',
                      border: 'none', cursor: 'pointer',
                      transition: 'background .2s',
                    }}
                  >
                    Yes, I've received my order
                  </button>
                </div>
              )}

              {/* Completed */}
              {order.status === 'completed' && (
                <div style={{
                  marginTop: 20, display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 12, color: '#155724', fontWeight: 300,
                }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: '#d4edda', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, flexShrink: 0,
                  }}>✓</span>
                  Order completed — thank you for choosing JCE Bridal!
                </div>
              )}

              {/* Links */}
              <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--ch)' }}>
                <Link
                  href={`/order-confirmation/${order.id}`}
                  style={{
                    fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase',
                    color: 'var(--wb)', textDecoration: 'underline', textUnderlineOffset: 3,
                    transition: 'color .2s',
                  }}
                >
                  View full order details →
                </Link>
              </div>
            </div>

            {/* Right col — Status history */}
            <div style={{ padding: '20px 20px' }}>
              <p style={{ margin: '0 0 16px', fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase', color: 'var(--mu)' }}>
                Status History
              </p>
              <StatusTimeline history={order.statusHistory} status={order.status} deliveryMethod={order.deliveryMethod} />
            </div>
          </div>

          {/* Pending payment CTA (full-width) */}
          {needsProof && (
            <div style={{
              padding: '16px 20px',
              borderTop: '1px solid var(--ch)',
              background: '#fffdf5',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
            }}>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 500, color: '#856404' }}>
                  Awaiting proof of payment
                </p>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 300, color: '#856404', opacity: 0.8 }}>
                  Upload your GCash / BDO screenshot to continue processing your order.
                </p>
              </div>
              <Link
                href={`/order-confirmation/${order.id}`}
                style={{
                  display: 'inline-block', padding: '10px 20px',
                  background: '#856404', color: '#fff',
                  fontFamily: 'Jost, sans-serif',
                  fontSize: 10, letterSpacing: '.3em', textTransform: 'uppercase',
                  border: 'none', cursor: 'pointer', textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                Upload proof →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MyOrdersPage() {
  const [user,       setUser      ] = useState(null)
  const [authReady,  setAuthReady ] = useState(false)
  const [orders,     setOrders    ] = useState([])
  const [loading,    setLoading   ] = useState(true)
  const [error,      setError     ] = useState('')
  const [tab,        setTab       ] = useState('ongoing')
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    setUser(getCurrentUser())
    setAuthReady(true)
  }, [])

  const loadOrders = useCallback(async (currentUser) => {
    if (!currentUser) { setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/my-orders', {
        headers: { 'x-user-id': currentUser.id },
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Failed to load orders')
      const list = data.orders || []
      setOrders(list)
      const firstOngoing = list.find(o => ONGOING_STATUSES.has(o.status))
      if (firstOngoing) setExpandedId(firstOngoing.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authReady) loadOrders(user)
  }, [authReady, user, loadOrders])

  const handleConfirmReceipt = async (orderId) => {
    if (!user) return
    const res  = await fetch('/api/orders', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
      body:    JSON.stringify({ orderId, status: 'completed' }),
    })
    const data = await res.json()
    if (data.ok) setOrders(p => p.map(o => o.id === orderId ? { ...o, status: 'completed' } : o))
  }

  const ongoing   = orders.filter(o => ONGOING_STATUSES.has(o.status))
  const completed = orders.filter(o => TERMINAL_STATUSES.has(o.status))
  const shown     = tab === 'ongoing' ? ongoing : completed

  if (!authReady) return null

  return (
    <main className="mo-page">
      <Header solid />
      <div className="mo-spacer" />

      <section className="mo-hero">
        <span className="mo-eyebrow">My Account</span>
        <h1 className="mo-h1">My Orders</h1>
        <p className="mo-sub">Track your orders and manage payment proofs.</p>
      </section>

      <div className="mo-content">
        {!user ? (
          <div className="mo-empty">
            <p className="mo-empty-title">Sign in to view your orders</p>
            <p className="mo-empty-sub">Please <Link href="/login">log in</Link> to see your order history.</p>
          </div>
        ) : (
          <div className="mo-list">

            <TabBar
              tab={tab}
              setTab={setTab}
              ongoingCount={ongoing.length}
              completedCount={completed.length}
            />

            {/* Pending payment banner */}
            {tab === 'ongoing' && ongoing.filter(o => o.status === 'pending_payment').length > 0 && (
              <div style={{
                marginBottom: 20, padding: '12px 16px',
                background: '#fff3cd', border: '1px solid #ffe08a', borderRadius: 3,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ fontSize: 16 }}>⚠</span>
                <div>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: '#856404' }}>
                    {ongoing.filter(o => o.status === 'pending_payment').length} order{ongoing.filter(o => o.status === 'pending_payment').length > 1 ? 's' : ''} awaiting payment proof
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 300, color: '#856404' }}>
                    Upload within 24 hours to avoid cancellation.
                  </p>
                </div>
              </div>
            )}

            {loading ? (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--mu)', letterSpacing: '.1em' }}>Loading your orders…</p>
              </div>
            ) : error ? (
              <p style={{ fontSize: 13, color: 'var(--ro)' }}>{error}</p>
            ) : shown.length === 0 ? (
              <div className="mo-empty" style={{ padding: '60px 0' }}>
                <p className="mo-empty-title">{tab === 'ongoing' ? 'No active orders' : 'No completed orders yet'}</p>
                <p className="mo-empty-sub">
                  {tab === 'ongoing'
                    ? 'Orders you place will appear here while in progress.'
                    : 'Completed, cancelled, and refunded orders will appear here.'}
                </p>
                {tab === 'ongoing' && (
                  <Link href="/gowns" className="mo-btn">Browse collection</Link>
                )}
              </div>
            ) : (
              shown.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  expanded={expandedId === order.id}
                  onToggle={() => setExpandedId(p => p === order.id ? null : order.id)}
                  onConfirmReceipt={handleConfirmReceipt}
                />
              ))
            )}

          </div>
        )}
      </div>

      <Footer />
    </main>
  )
}