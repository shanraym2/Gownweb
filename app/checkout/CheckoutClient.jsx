'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { loadCart, clearCart } from '../utils/cartClient'
import { getCurrentUser } from '../utils/authClient'

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = ['Review order', 'Delivery', 'Payment', 'Confirm']

const DELIVERY_OPTIONS = [
  {
    id:       'pickup',
    label:    'Store Pickup',
    sub:      'Collect at JCE Bridal Boutique',
    fee:      0,
    feeLabel: 'Free',
    icon:     '🏪',
  },
  {
    id:       'lalamove',
    label:    'Lalamove',
    sub:      'Same-day or scheduled delivery',
    fee:      null,          // variable — customer enters address, fee shown at confirmation
    feeLabel: 'Quote on address',
    icon:     '🛵',
  },
]

const PAYMENT_METHODS = [
  {
    id:      'gcash',
    label:   'GCash',
    icon:    '📱',
    detail:  'GCash Number: 09XX-XXX-XXXX · Name: JCE Bridal Boutique',
  },
  {
    id:      'bdo',
    label:   'BDO Bank Transfer',
    icon:    '🏦',
    detail:  'BDO Account: 0123-4567-8901 · Account Name: JCE Bridal Boutique',
  },
  {
    id:      'cash',
    label:   'Cash on Pickup',
    icon:    '💵',
    detail:  'Pay in full when you collect your order at the boutique.',
    onlyWith: 'pickup',
  },
]

const TNC_TEXT = `TERMS AND CONDITIONS — JCE BRIDAL BOUTIQUE

1. ORDER & PAYMENT
   All orders are subject to availability. Full payment is required before your order is processed. For GCash and BDO transfers, please upload your proof of payment within 24 hours of placing your order. Orders without payment confirmation within 24 hours may be cancelled.

2. PAYMENT PROOF
   Upload a clear screenshot of your payment confirmation showing the reference number, amount, and date. Tampered or fraudulent proof of payment will result in immediate order cancellation and may be reported to authorities.

3. DELIVERY
   Store pickup orders must be collected within 7 days of the ready notification. For Lalamove deliveries, a delivery fee will be quoted based on your address and added to your order. JCE Bridal Boutique is not responsible for delays caused by the courier.

4. SIZING & ALTERATIONS
   All gowns are ready-to-wear. Sizes are as listed per item. Alteration services are available upon request and at additional cost. We recommend selecting your correct size using our FitMatcher tool before ordering.

5. CANCELLATIONS
   Orders may be cancelled before payment is confirmed. Once payment is verified, cancellations are subject to our return and refund policy.

6. RETURNS & REFUNDS
   Returns are accepted within 48 hours of receipt only if the item is defective or significantly different from what was ordered. Items must be unworn, unaltered, and in original condition with tags attached. Refunds will be processed within 7–14 business days via the original payment method.

7. PRIVACY
   Your personal information is used only to process and deliver your order. We do not share your data with third parties except as necessary to fulfil your order (e.g. courier services).

8. CONTACT
   For order inquiries, contact us at the boutique or through our website contact form.

By placing an order, you confirm that you have read, understood, and agree to these Terms and Conditions.`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(n) {
  if (n == null) return '—'
  return '₱' + Number(n).toLocaleString('en-PH')
}

function parsePrice(str) {
  if (!str) return 0
  return parseFloat(String(str).replace(/[^\d.]/g, '')) || 0
}

function stepClass(idx, current) {
  if (idx < current)  return 'ck-step ck-step--done'
  if (idx === current) return 'ck-step ck-step--active'
  return 'ck-step'
}

// ─── T&C Modal ────────────────────────────────────────────────────────────────

function TncModal({ onAccept, onClose }) {
  const [scrolled,  setScrolled ] = useState(false)
  const bodyRef = useRef(null)

  const handleScroll = useCallback(() => {
    const el = bodyRef.current
    if (!el) return
    // Accept once user has scrolled within ~80px of the bottom
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      setScrolled(true)
    }
  }, [])

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.addEventListener('scroll', handleScroll)
    return () => { if (el) el.removeEventListener('scroll', handleScroll) }
  }, [handleScroll])

  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  return (
    <div className="ck-modal-back" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ck-modal" role="dialog" aria-modal aria-label="Terms and Conditions">
        <div className="ck-modal-header">
          <div>
            <p className="ck-modal-eye">Before you continue</p>
            <h2 className="ck-modal-title">Terms &amp; Conditions</h2>
          </div>
          <button className="ck-modal-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="ck-tnc-body" ref={bodyRef}>
          <pre className="ck-tnc-text">{TNC_TEXT}</pre>
        </div>

        {!scrolled && (
          <p className="ck-tnc-hint">Scroll to the bottom to continue</p>
        )}

        <div className="ck-modal-footer">
          <button
            className={`ck-btn-primary${scrolled ? '' : ' ck-btn-disabled'}`}
            disabled={!scrolled}
            onClick={scrolled ? onAccept : undefined}
          >
            I have read and agree
          </button>
          <button className="ck-btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Step 1: Review cart ──────────────────────────────────────────────────────

function StepReview({ items, gowns, onNext, onRemove }) {
  if (items.length === 0) {
    return (
      <div className="ck-empty">
        <p className="ck-empty-title">Your cart is empty</p>
        <p className="ck-empty-sub">Add some gowns before checking out.</p>
        <Link href="/gowns" className="ck-btn-primary">Browse collection</Link>
      </div>
    )
  }

  const subtotal = items.reduce((sum, item) => {
    const gown = gowns[item.id]
    return sum + (gown ? parsePrice(gown.price) * (item.qty || 1) : 0)
  }, 0)

  return (
    <div className="ck-step-body">
      <h2 className="ck-section-title">Review your order</h2>
      <div className="ck-item-list">
        {items.map(item => {
          const gown = gowns[item.id]
          if (!gown) return null
          return (
            <div key={item.id} className="ck-item">
              <div className="ck-item-img">
                <img src={gown.image} alt={gown.name} onError={e => { e.target.style.display = 'none' }} />
              </div>
              <div className="ck-item-info">
                <p className="ck-item-name">{gown.name}</p>
                <p className="ck-item-meta">
                  {item.size ? `Size: ${item.size}` : <span className="ck-item-warn">No size selected</span>}
                  {' · '}Qty: {item.qty || 1}
                </p>
                <p className="ck-item-price">{gown.price}</p>
              </div>
              <button className="ck-item-remove" onClick={() => onRemove(item.id)} aria-label="Remove item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </button>
            </div>
          )
        })}
      </div>

      <div className="ck-summary-row ck-summary-total">
        <span>Subtotal</span>
        <span>{formatPrice(subtotal)}</span>
      </div>
      <p className="ck-summary-note">Delivery fee calculated in the next step</p>

      <div className="ck-actions">
        <button className="ck-btn-primary" onClick={onNext}>
          Continue to delivery →
        </button>
        <Link href="/gowns" className="ck-btn-ghost">← Keep browsing</Link>
      </div>
    </div>
  )
}

// ─── Step 2: Delivery ─────────────────────────────────────────────────────────

function StepDelivery({ delivery, setDelivery, address, setAddress, onNext, onBack }) {
  const [error, setError] = useState('')

  const handleNext = () => {
    if (!delivery) { setError('Please select a delivery method.'); return }
    if (delivery === 'lalamove' && !address.trim()) { setError('Please enter your delivery address.'); return }
    setError('')
    onNext()
  }

  return (
    <div className="ck-step-body">
      <h2 className="ck-section-title">Delivery method</h2>
      <div className="ck-options">
        {DELIVERY_OPTIONS.map(opt => (
          <button
            key={opt.id}
            className={`ck-option${delivery === opt.id ? ' ck-option--selected' : ''}`}
            onClick={() => { setDelivery(opt.id); setError('') }}
          >
            <span className="ck-option-icon">{opt.icon}</span>
            <div className="ck-option-text">
              <span className="ck-option-label">{opt.label}</span>
              <span className="ck-option-sub">{opt.sub}</span>
            </div>
            <span className="ck-option-fee">{opt.feeLabel}</span>
            <span className={`ck-option-radio${delivery === opt.id ? ' on' : ''}`} />
          </button>
        ))}
      </div>

      {delivery === 'lalamove' && (
        <div className="ck-field">
          <label className="ck-label">Delivery address</label>
          <textarea
            className="ck-input"
            rows={3}
            placeholder="Street, Barangay, City, Province"
            value={address}
            onChange={e => { setAddress(e.target.value); setError('') }}
          />
          <p className="ck-field-hint">
            Lalamove delivery fee will be communicated to you before dispatch and must be settled separately.
          </p>
        </div>
      )}

      {delivery === 'pickup' && (
        <div className="ck-info-box">
          <p>
            <strong>Store hours:</strong> Mon–Sat 9AM–6PM<br/>
            <strong>Address:</strong> JCE Bridal Boutique — please contact us for the exact address.<br/>
            Please wait for your Ready for Pickup notification before visiting.
          </p>
        </div>
      )}

      {error && <p className="ck-error">{error}</p>}

      <div className="ck-actions">
        <button className="ck-btn-primary" onClick={handleNext}>Continue to payment →</button>
        <button className="ck-btn-ghost" onClick={onBack}>← Back</button>
      </div>
    </div>
  )
}

// ─── Step 3: Payment ──────────────────────────────────────────────────────────

function StepPayment({ paymentMethod, setPaymentMethod, delivery, onNext, onBack }) {
  const [error, setError] = useState('')

  const available = PAYMENT_METHODS.filter(m =>
    !m.onlyWith || m.onlyWith === delivery
  )

  const handleNext = () => {
    if (!paymentMethod) { setError('Please select a payment method.'); return }
    setError('')
    onNext()
  }

  return (
    <div className="ck-step-body">
      <h2 className="ck-section-title">Payment method</h2>
      <div className="ck-options">
        {available.map(opt => (
          <button
            key={opt.id}
            className={`ck-option${paymentMethod === opt.id ? ' ck-option--selected' : ''}`}
            onClick={() => { setPaymentMethod(opt.id); setError('') }}
          >
            <span className="ck-option-icon">{opt.icon}</span>
            <div className="ck-option-text">
              <span className="ck-option-label">{opt.label}</span>
              {paymentMethod === opt.id && (
                <span className="ck-option-detail">{opt.detail}</span>
              )}
            </div>
            <span className={`ck-option-radio${paymentMethod === opt.id ? ' on' : ''}`} />
          </button>
        ))}
      </div>

      {paymentMethod && paymentMethod !== 'cash' && (
        <div className="ck-info-box ck-info-box--gold">
          <p>
            <strong>How to pay:</strong><br/>
            1. Send the exact amount to the account shown above.<br/>
            2. Screenshot your payment confirmation.<br/>
            3. Upload your proof on the next page after placing your order.<br/>
            <strong>Orders without proof within 24 hours may be cancelled.</strong>
          </p>
        </div>
      )}

      {error && <p className="ck-error">{error}</p>}

      <div className="ck-actions">
        <button className="ck-btn-primary" onClick={handleNext}>Review &amp; confirm →</button>
        <button className="ck-btn-ghost" onClick={onBack}>← Back</button>
      </div>
    </div>
  )
}

// ─── Step 4: Confirm ──────────────────────────────────────────────────────────

function StepConfirm({
  items, gowns, delivery, address, paymentMethod,
  tncAccepted, setTncAccepted,
  onPlace, onBack, placing, placeError
}) {
  const [showTnc, setShowTnc] = useState(false)

  const deliveryOpt  = DELIVERY_OPTIONS.find(o => o.id === delivery)
  const paymentOpt   = PAYMENT_METHODS.find(p => p.id === paymentMethod)
  const subtotal     = items.reduce((s, i) => s + parsePrice(gowns[i.id]?.price) * (i.qty || 1), 0)

  const handlePlaceOrder = () => {
    if (!tncAccepted) { setShowTnc(true); return }
    onPlace()
  }

  return (
    <>
      {showTnc && (
        <TncModal
          onAccept={() => { setTncAccepted(true); setShowTnc(false) }}
          onClose={() => setShowTnc(false)}
        />
      )}

      <div className="ck-step-body">
        <h2 className="ck-section-title">Review &amp; place order</h2>

        {/* Order summary */}
        <div className="ck-confirm-section">
          <p className="ck-confirm-label">Items</p>
          {items.map(item => {
            const gown = gowns[item.id]
            if (!gown) return null
            return (
              <div key={item.id} className="ck-confirm-item">
                <span>{gown.name}{item.size ? ` — ${item.size}` : ''} ×{item.qty || 1}</span>
                <span>{formatPrice(parsePrice(gown.price) * (item.qty || 1))}</span>
              </div>
            )
          })}
        </div>

        <div className="ck-confirm-section">
          <p className="ck-confirm-label">Delivery</p>
          <p className="ck-confirm-value">{deliveryOpt?.label}</p>
          {address && <p className="ck-confirm-sub">{address}</p>}
          {delivery === 'lalamove' && (
            <p className="ck-confirm-sub ck-confirm-note">
              Delivery fee will be communicated before dispatch.
            </p>
          )}
        </div>

        <div className="ck-confirm-section">
          <p className="ck-confirm-label">Payment</p>
          <p className="ck-confirm-value">{paymentOpt?.label}</p>
          {paymentMethod !== 'cash' && (
            <p className="ck-confirm-sub ck-confirm-note">
              Upload your proof of payment after placing the order.
            </p>
          )}
        </div>

        <div className="ck-confirm-section ck-confirm-total">
          <span>Subtotal</span>
          <span>{formatPrice(subtotal)}</span>
        </div>

        {/* T&C */}
        <div className="ck-tnc-row">
          <label className="ck-tnc-check">
            <input
              type="checkbox"
              checked={tncAccepted}
              onChange={e => {
                if (e.target.checked) setShowTnc(true)
                else setTncAccepted(false)
              }}
            />
            <span className="ck-tnc-box" />
            <span>
              I have read and agree to the{' '}
              <button className="ck-tnc-link" type="button" onClick={() => setShowTnc(true)}>
                Terms &amp; Conditions
              </button>
            </span>
          </label>
        </div>

        {placeError && <p className="ck-error">{placeError}</p>}

        <div className="ck-actions">
          <button
            className={`ck-btn-primary ck-btn-place${placing ? ' ck-btn-loading' : ''}`}
            onClick={handlePlaceOrder}
            disabled={placing}
          >
            {placing ? 'Placing order…' : 'Place order'}
          </button>
          <button className="ck-btn-ghost" onClick={onBack} disabled={placing}>← Back</button>
        </div>

        {!tncAccepted && (
          <p className="ck-tnc-reminder">
            You must read and accept the Terms &amp; Conditions before placing your order.
          </p>
        )}
      </div>
    </>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CheckoutPage() {
  const router = useRouter()
  const [user,          setUser         ] = useState(null)
  const [step,          setStep         ] = useState(0)
  const [items,         setItems        ] = useState([])
  const [gowns,         setGowns        ] = useState({})
  const [loadingGowns,  setLoadingGowns ] = useState(true)

  // Step state
  const [delivery,       setDelivery      ] = useState('pickup')
  const [address,        setAddress       ] = useState('')
  const [paymentMethod,  setPaymentMethod ] = useState('')
  const [tncAccepted,    setTncAccepted   ] = useState(false)
  const [placing,        setPlacing       ] = useState(false)
  const [placeError,     setPlaceError    ] = useState('')

  // Load user + cart on mount
  useEffect(() => {
    const u = getCurrentUser()
    if (!u) { router.replace('/login?redirect=/checkout'); return }
    setUser(u)

    const cart = loadCart()
    setItems(cart)
    if (!cart.length) return

    // Fetch gown details for all cart items
    setLoadingGowns(true)
    fetch('/api/gowns')
      .then(r => r.json())
      .then(d => {
        const map = {}
        for (const g of (d.gowns || [])) map[String(g.id)] = g
        setGowns(map)
      })
      .catch(() => {})
      .finally(() => setLoadingGowns(false))
  }, [router])

  const handleRemove = useCallback(id => {
    setItems(prev => {
      const next = prev.filter(i => i.id !== id)
      // Also update localStorage
      const { saveCart } = require('../utils/cartClient')
      saveCart(next)
      return next
    })
  }, [])

  const handlePlaceOrder = async () => {
    if (!user) return
    setPlacing(true); setPlaceError('')

    try {
      const orderItems = items.map(item => ({
        gownId:    item.id,
        gownName:  gowns[item.id]?.name || 'Unknown',
        sizeLabel: item.size || null,
        quantity:  item.qty  || 1,
        unitPrice: parsePrice(gowns[item.id]?.price),
      }))

      const subtotal = orderItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0)

      const body = {
        userId:        user.id,
        customerEmail: user.email,
        customerName:  `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        paymentMethod,
        deliveryMethod: delivery,
        deliveryAddress: address || null,
        items:         orderItems,
        subtotal,
        total:         subtotal,    // delivery fee added later
        notes:         '',
      }

      const res  = await fetch('/api/orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body:    JSON.stringify(body),
      })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        setPlaceError(data.error || 'Failed to place order. Please try again.')
        return
      }

      // Clear cart and redirect to confirmation
      clearCart()
      router.push(`/order-confirmation/${data.orderId}`)
    } catch (e) {
      setPlaceError('Could not connect to the server. Please try again.')
    } finally {
      setPlacing(false)
    }
  }

  // Don't render checkout until we know the user
  if (!user && typeof window !== 'undefined') return null

  return (
    <main className="ck-page">
      <Header solid />
      <div className="ck-spacer" />

      {/* Hero */}
      <section className="ck-hero">
        <h1 className="ck-hero-title">Checkout</h1>
        <p className="ck-hero-sub">Complete your order below. All sizes and quantities are as added to your cart.</p>
      </section>

      {/* Step indicator */}
      <div className="ck-steps-bar">
        {STEPS.map((label, idx) => (
          <div key={label} className={stepClass(idx, step)}>
            <span className="ck-step-n">{idx < step ? '✓' : idx + 1}</span>
            <span className="ck-step-label">{label}</span>
            {idx < STEPS.length - 1 && <span className="ck-step-line" />}
          </div>
        ))}
      </div>

      {/* Main content */}
      <div className="ck-layout">
        <div className="ck-main">
          {loadingGowns && items.length > 0 ? (
            <div className="ck-loading">Loading cart…</div>
          ) : (
            <>
              {step === 0 && (
                <StepReview
                  items={items}
                  gowns={gowns}
                  onNext={() => setStep(1)}
                  onRemove={handleRemove}
                />
              )}
              {step === 1 && (
                <StepDelivery
                  delivery={delivery}
                  setDelivery={setDelivery}
                  address={address}
                  setAddress={setAddress}
                  onNext={() => setStep(2)}
                  onBack={() => setStep(0)}
                />
              )}
              {step === 2 && (
                <StepPayment
                  paymentMethod={paymentMethod}
                  setPaymentMethod={setPaymentMethod}
                  delivery={delivery}
                  onNext={() => setStep(3)}
                  onBack={() => setStep(1)}
                />
              )}
              {step === 3 && (
                <StepConfirm
                  items={items}
                  gowns={gowns}
                  delivery={delivery}
                  address={address}
                  paymentMethod={paymentMethod}
                  tncAccepted={tncAccepted}
                  setTncAccepted={setTncAccepted}
                  onPlace={handlePlaceOrder}
                  onBack={() => setStep(2)}
                  placing={placing}
                  placeError={placeError}
                />
              )}
            </>
          )}
        </div>

        {/* Sidebar summary — always visible */}
        {items.length > 0 && !loadingGowns && (
          <aside className="ck-sidebar">
            <p className="ck-sidebar-title">Order summary</p>
            <div className="ck-sidebar-items">
              {items.map(item => {
                const gown = gowns[item.id]
                if (!gown) return null
                return (
                  <div key={item.id} className="ck-sidebar-item">
                    <img src={gown.image} alt={gown.name} onError={e => { e.target.style.display = 'none' }} />
                    <div>
                      <p className="ck-sidebar-name">{gown.name}</p>
                      <p className="ck-sidebar-meta">
                        {item.size ? `Size ${item.size}` : 'No size'} · ×{item.qty || 1}
                      </p>
                      <p className="ck-sidebar-price">{gown.price}</p>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="ck-sidebar-total">
              <span>Subtotal</span>
              <span>
                {formatPrice(items.reduce((s, i) =>
                  s + parsePrice(gowns[i.id]?.price) * (i.qty || 1), 0
                ))}
              </span>
            </div>
            {delivery === 'lalamove' && (
              <p className="ck-sidebar-note">+ Lalamove fee (quoted separately)</p>
            )}
          </aside>
        )}
      </div>

      <Footer />
    </main>
  )
}