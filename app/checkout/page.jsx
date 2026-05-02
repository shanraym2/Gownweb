'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { loadCart, saveCart } from '../utils/cartClient'
import { getCurrentUser } from '../utils/authClient'

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = ['Review order', 'Delivery', 'Payment', 'Confirm']

const BIZ_TAX_RATE  = 0.03   // 3% business tax

// JCE Bridal store coordinates — 168 Mall Recto, Manila
const STORE_LAT = 14.5995
const STORE_LNG = 120.9842

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
    fee:      null,
    feeLabel: 'Calculated from address',
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
  Store pickup orders must be collected within 7 days of the ready notification. For Lalamove deliveries, the delivery fee shown is an estimate based on distance; the final fee may vary slightly. JCE Bridal Boutique is not responsible for delays caused by the courier.

4. SIZING & ALTERATIONS
  All gowns are ready-to-wear. Sizes are as listed per item. Alteration services are available upon request and at additional cost. We recommend selecting your correct size using our FitMatcher tool before ordering.

5. CANCELLATIONS
  Orders may be cancelled before payment is confirmed. Once payment is verified, cancellations are subject to our return and refund policy.

6. RETURNS & REFUNDS
  Returns are accepted within 48 hours of receipt only if the item is defective or significantly different from what was ordered. Items must be unworn, unaltered, and in original condition with tags attached. Refunds will be processed within 7–14 business days via the original payment method.

7. TAXES
  Prices shown are inclusive of 3% business tax, itemised in your order summary. JCE Bridal Boutique is not VAT-registered (annual gross sales below ₱3,000,000).

8. PRIVACY
  Your personal information is used only to process and deliver your order. We do not share your data with third parties except as necessary to fulfil your order (e.g. courier services).

9. CONTACT
  For order inquiries, contact us at the boutique or through our website contact form.

By placing an order, you confirm that you have read, understood, and agree to these Terms and Conditions.`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(n) {
  if (n == null || isNaN(Number(n))) return '—'
  return '₱' + Number(n).toLocaleString('en-PH')
}

function parsePrice(str) {
  if (str == null) return 0
  const parsed = parseFloat(String(str).replace(/[^\d.]/g, ''))
  return isNaN(parsed) ? 0 : parsed
}

function stepClass(idx, current) {
  if (idx < current)  return 'ck-step ck-step--done'
  if (idx === current) return 'ck-step ck-step--active'
  return 'ck-step'
}

function computeItemsSubtotal(items, gowns) {
  return items.reduce((sum, item) => {
    const gown = gowns[String(item.id)]
    const qty  = Number(item.qty) || 1
    return sum + (gown ? parsePrice(gown.price) * qty : 0)
  }, 0)
}

// ── Shipping helpers ───────────────────────────────────────────────────────────

const SHIPPING_BASE_KM  = 3
const SHIPPING_BASE_FEE = 98
const SHIPPING_PER_KM   = 20
const SHIPPING_BUFFER   = 15
const SHIPPING_MIN      = 98

function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function estimateShippingFee(distanceKm) {
  const hour = new Date().getHours()
  const nightSurcharge = (hour >= 22 || hour < 6) ? 1.20 : 1.00
  const extraKm = Math.max(0, distanceKm - SHIPPING_BASE_KM)
  const raw     = (SHIPPING_BASE_FEE + extraKm * SHIPPING_PER_KM + SHIPPING_BUFFER) * nightSurcharge
  return Math.max(SHIPPING_MIN, Math.ceil(raw / 5) * 5)
}

async function geocodeAddress(address) {
  try {
    const res  = await fetch('/api/geocode', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ address }),
    })
    const data = await res.json()
    if (res.status === 503 && data.noKey) {
      console.warn('[checkout] Geocoding not configured — flat rate will be used')
      return null
    }
    if (!res.ok || !data.ok) { console.warn('[checkout] Geocode failed:', data.error); return null }
    if (!data.found)          { console.warn('[checkout] Address not found:', address); return null }
    return { lat: data.lat, lng: data.lng }
  } catch (err) {
    console.warn('[checkout] geocodeAddress network error:', err)
    return null
  }
}

function buildAddressString({ street, city, province, zip }) {
  return [street, city, province, zip].filter(Boolean).join(', ')
}

// ── Tax helpers ────────────────────────────────────────────────────────────────

function computeTax(subtotal, shipping) {
  const taxable = subtotal + shipping
  const bizTax  = Math.round(taxable * BIZ_TAX_RATE)
  return { vat: 0, bizTax, tax: bizTax }
}

// ─── Address field validation ─────────────────────────────────────────────────

function validateAddressFields({ street, city, province, zip }) {
  const errors = {}
  if (!street.trim())   errors.street   = 'Street / Barangay is required.'
  if (!city.trim())     errors.city     = 'City is required.'
  if (!province.trim()) errors.province = 'Province is required.'
  if (zip && !/^\d{4,6}$/.test(zip.trim())) errors.zip = 'Enter a valid 4–6 digit ZIP code.'
  return errors
}

// ─── T&C Modal ────────────────────────────────────────────────────────────────

function TncModal({ onAccept, onClose }) {
  const [scrolled, setScrolled] = useState(false)
  const bodyRef = useRef(null)

  const handleScroll = useCallback(() => {
    const el = bodyRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) setScrolled(true)
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
        {!scrolled && <p className="ck-tnc-hint">Scroll to the bottom to continue</p>}
        <div className="ck-modal-footer">
          <button
            className={`ck-btn-primary${scrolled ? '' : ' ck-btn-disabled'}`}
            disabled={!scrolled}
            onClick={scrolled ? onAccept : undefined}
          >
            I have read and agree
          </button>
          <button className="ck-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── Step 1: Review ───────────────────────────────────────────────────────────

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

  const subtotal = computeItemsSubtotal(items, gowns)

  return (
    <div className="ck-step-body">
      <h2 className="ck-section-title">Review your order</h2>
      <div className="ck-item-list">
        {items.map(item => {
          const gown = gowns[String(item.id)]
          if (!gown) return null
          return (
            <div key={`${item.id}__${item.size ?? ''}`} className="ck-item">
              <div className="ck-item-img">
                <img src={gown.image} alt={gown.name} onError={e => { e.target.style.display = 'none' }} />
              </div>
              <div className="ck-item-info">
                <p className="ck-item-name">{gown.name}</p>
                <p className="ck-item-meta">
                  {item.size ? `Size: ${item.size}` : <span className="ck-item-warn">No size selected</span>}
                  {' · '}Qty: {Number(item.qty) || 1}
                </p>
                <p className="ck-item-price">{gown.price}</p>
              </div>
              <button
                className="ck-item-remove"
                onClick={() => onRemove(item.id, item.size ?? null)}
                aria-label="Remove item"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6"/><path d="M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
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
      <p className="ck-summary-note">Delivery fee and 3% business tax calculated in the next steps</p>
      <div className="ck-actions">
        <button className="ck-btn-primary" onClick={onNext}>Continue to delivery →</button>
        <Link href="/gowns" className="ck-btn-ghost">← Keep browsing</Link>
      </div>
    </div>
  )
}

// ─── Step 2: Delivery ─────────────────────────────────────────────────────────

function StepDelivery({
  delivery, setDelivery,
  addrStreet, setAddrStreet,
  addrCity, setAddrCity,
  addrProvince, setAddrProvince,
  addrZip, setAddrZip,
  shippingFee, setShippingFee,
  shippingLoading, setShippingLoading,
  shippingError, setShippingError,
  onNext, onBack,
}) {
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError,   setFormError  ] = useState('')

  const estimateShipping = useCallback(async ({ street, city, province, zip }) => {
    const full = buildAddressString({ street, city, province, zip })
    if (!full.trim()) return
    setShippingLoading(true)
    setShippingError('')
    try {
      const coords = await geocodeAddress(full)
      if (!coords) {
        setShippingFee(150)
        setShippingError('Could not geocode address — using flat estimate of ₱150.')
        return
      }
      const distKm = haversineKm(STORE_LAT, STORE_LNG, coords.lat, coords.lng)
      setShippingFee(estimateShippingFee(distKm))
    } catch {
      setShippingFee(150)
      setShippingError('Shipping estimate unavailable — ₱150 flat used.')
    } finally {
      setShippingLoading(false)
    }
  }, [setShippingFee, setShippingLoading, setShippingError])

  useEffect(() => {
    if (delivery !== 'lalamove') return
    if (!addrStreet && !addrCity && !addrProvince) return
    const t = setTimeout(() => estimateShipping({
      street: addrStreet, city: addrCity, province: addrProvince, zip: addrZip,
    }), 900)
    return () => clearTimeout(t)
  }, [addrStreet, addrCity, addrProvince, addrZip, delivery, estimateShipping])

  const handleNext = () => {
    setFormError('')
    if (!delivery) { setFormError('Please select a delivery method.'); return }
    if (delivery === 'lalamove') {
      const errors = validateAddressFields({ street: addrStreet, city: addrCity, province: addrProvince, zip: addrZip })
      if (Object.keys(errors).length) {
        setFieldErrors(errors)
        setFormError('Please fill in all required delivery address fields.')
        return
      }
    }
    setFieldErrors({})
    onNext()
  }

  const handleFieldChange = (setter, key) => e => {
    const val = key === 'zip' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value
    setter(val)
    if (fieldErrors[key]) setFieldErrors(p => { const n = { ...p }; delete n[key]; return n })
    setFormError('')
  }

  return (
    <div className="ck-step-body">
      <h2 className="ck-section-title">Delivery method</h2>
      <div className="ck-options">
        {DELIVERY_OPTIONS.map(opt => (
          <button
            key={opt.id}
            className={`ck-option${delivery === opt.id ? ' ck-option--selected' : ''}`}
            onClick={() => { setDelivery(opt.id); setFormError(''); setFieldErrors({}) }}
          >
            <span className="ck-option-icon">{opt.icon}</span>
            <div className="ck-option-text">
              <span className="ck-option-label">{opt.label}</span>
              <span className="ck-option-sub">{opt.sub}</span>
            </div>
            <span className="ck-option-fee">
              {opt.id === 'lalamove' && shippingFee > 0 ? formatPrice(shippingFee) : opt.feeLabel}
            </span>
            <span className={`ck-option-radio${delivery === opt.id ? ' on' : ''}`} />
          </button>
        ))}
      </div>

      {delivery === 'lalamove' && (
        <div className="ck-addr-form">
          <p className="ck-addr-form-title">Delivery address</p>

          <div className={`ck-field${fieldErrors.street ? ' ck-field--error' : ''}`}>
            <label className="ck-label">Street / Barangay <span className="ck-required">*</span></label>
            <input className="ck-input" type="text" placeholder="e.g. 123 Rizal St, Brgy. San Antonio"
              value={addrStreet} onChange={handleFieldChange(setAddrStreet, 'street')} maxLength={120} />
            {fieldErrors.street && <p className="ck-field-error">{fieldErrors.street}</p>}
          </div>

          <div className="ck-addr-row">
            <div className={`ck-field${fieldErrors.city ? ' ck-field--error' : ''}`}>
              <label className="ck-label">City <span className="ck-required">*</span></label>
              <input className="ck-input" type="text" placeholder="e.g. Quezon City"
                value={addrCity} onChange={handleFieldChange(setAddrCity, 'city')} maxLength={60} />
              {fieldErrors.city && <p className="ck-field-error">{fieldErrors.city}</p>}
            </div>
            <div className={`ck-field${fieldErrors.province ? ' ck-field--error' : ''}`}>
              <label className="ck-label">Province <span className="ck-required">*</span></label>
              <input className="ck-input" type="text" placeholder="e.g. Metro Manila"
                value={addrProvince} onChange={handleFieldChange(setAddrProvince, 'province')} maxLength={60} />
              {fieldErrors.province && <p className="ck-field-error">{fieldErrors.province}</p>}
            </div>
          </div>

          <div className={`ck-field ck-field--zip${fieldErrors.zip ? ' ck-field--error' : ''}`}>
            <label className="ck-label">ZIP / Postal code</label>
            <input className="ck-input" type="text" inputMode="numeric" placeholder="e.g. 1100"
              value={addrZip} onChange={handleFieldChange(setAddrZip, 'zip')} maxLength={6} />
            {fieldErrors.zip && <p className="ck-field-error">{fieldErrors.zip}</p>}
          </div>

          <div className="ck-shipping-est">
            {shippingLoading && (
              <span className="ck-shipping-calc">
                <span className="ck-shipping-spinner" />
                Calculating Lalamove fee…
              </span>
            )}
            {!shippingLoading && shippingFee > 0 && (
              <span className="ck-shipping-result">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                Estimated Lalamove fee: <strong>{formatPrice(shippingFee)}</strong>
                <span className="ck-shipping-note"> · Final fee confirmed before dispatch</span>
              </span>
            )}
            {shippingError && <span className="ck-shipping-warn">⚠ {shippingError}</span>}
          </div>

          <p className="ck-field-hint">
            Estimate is based on straight-line distance from our store. The actual Lalamove fee may vary slightly and will be confirmed before dispatch.
          </p>
        </div>
      )}

      {delivery === 'pickup' && (
        <div className="ck-info-box">
          <p>
            <strong>Store hours:</strong> Mon–Sat 9AM–6PM<br/>
            <strong>Address:</strong> 4I-19 Soler Wing 168 Mall Recto Mla, Manila<br/>
            Please wait for your Ready for Pickup notification before visiting.
          </p>
        </div>
      )}

      {formError && <p className="ck-error">{formError}</p>}

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
  const available = PAYMENT_METHODS.filter(m => !m.onlyWith || m.onlyWith === delivery)

  useEffect(() => {
    if (paymentMethod && !available.some(m => m.id === paymentMethod)) setPaymentMethod('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delivery])

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
              {paymentMethod === opt.id && <span className="ck-option-detail">{opt.detail}</span>}
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
  items, gowns, delivery,
  addrStreet, addrCity, addrProvince, addrZip,
  paymentMethod, shippingFee,
  tncAccepted, setTncAccepted,
  onPlace, onBack, placing, placeError,
}) {
  const [showTnc, setShowTnc] = useState(false)

  const deliveryOpt    = DELIVERY_OPTIONS.find(o => o.id === delivery)
  const paymentOpt     = PAYMENT_METHODS.find(p => p.id === paymentMethod)
  const itemsSub       = computeItemsSubtotal(items, gowns)
  const shipping       = delivery === 'lalamove' ? (shippingFee || 0) : 0
  const { vat, bizTax, tax } = computeTax(itemsSub, shipping)
  const total          = itemsSub + shipping + tax
  const addressDisplay = [addrStreet, addrCity, addrProvince, addrZip].filter(Boolean).join(', ')

  const handlePlaceOrder = () => {
    if (!tncAccepted) { setShowTnc(true); return }
      onPlace({ itemsSub, shipping, bizTax, tax, total })
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

        <div className="ck-confirm-section">
          <p className="ck-confirm-label">Items</p>
          {items.map(item => {
            const gown = gowns[String(item.id)]
            if (!gown) return null
            const qty = Number(item.qty) || 1
            return (
              <div key={`${item.id}__${item.size ?? ''}`} className="ck-confirm-item">
                <span>{gown.name}{item.size ? ` — ${item.size}` : ''} ×{qty}</span>
                <span>{formatPrice(parsePrice(gown.price) * qty)}</span>
              </div>
            )
          })}
        </div>

        <div className="ck-confirm-section">
          <p className="ck-confirm-label">Delivery</p>
          <p className="ck-confirm-value">{deliveryOpt?.label ?? '—'}</p>
          {addressDisplay && <p className="ck-confirm-sub">{addressDisplay}</p>}
          {delivery === 'lalamove' && (
            <p className="ck-confirm-sub ck-confirm-note">
              Estimated delivery fee: {formatPrice(shipping)} · Final fee confirmed before dispatch.
            </p>
          )}
        </div>

        <div className="ck-confirm-section">
          <p className="ck-confirm-label">Payment</p>
          <p className="ck-confirm-value">{paymentOpt?.label ?? '—'}</p>
          {paymentMethod !== 'cash' && (
            <p className="ck-confirm-sub ck-confirm-note">
              Upload your proof of payment after placing the order.
            </p>
          )}
        </div>

        {/* ── Order total breakdown ── */}
        <div className="ck-confirm-section ck-confirm-totals">
          <div className="ck-confirm-total-row">
            <span>Subtotal</span>
            <span>{formatPrice(itemsSub)}</span>
          </div>
          <div className="ck-confirm-total-row">
            <span>Shipping{delivery === 'lalamove' ? ' (Lalamove est.)' : ''}</span>
            <span>{delivery === 'pickup' ? <span className="ck-free">Free</span> : formatPrice(shipping)}</span>
          </div>
          <div className="ck-confirm-total-row ck-confirm-total-row--tax">
            <span>Business tax (3%)</span>
            <span>{formatPrice(bizTax)}</span>
          </div>
          <div className="ck-confirm-total-row ck-confirm-total-row--grand">
            <span>Total</span>
            <span>{formatPrice(total)}</span>
          </div>
        </div>

        <div className="ck-tnc-row">
          <label className="ck-tnc-check">
            <input
              type="checkbox"
              checked={tncAccepted}
              onChange={e => { if (e.target.checked) setShowTnc(true); else setTncAccepted(false) }}
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

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function OrderSummarySidebar({ items, gowns, delivery, shippingFee }) {
  const itemsSub   = computeItemsSubtotal(items, gowns)
  const shipping   = delivery === 'lalamove' ? (shippingFee || 0) : 0
  const { tax }    = computeTax(itemsSub, shipping)
  const total      = itemsSub + shipping + tax
  const feeUnknown = delivery === 'lalamove' && shippingFee === 0

  return (
    <aside className="ck-sidebar">
      <p className="ck-sidebar-title">Order summary</p>
      <div className="ck-sidebar-items">
        {items.map(item => {
          const gown = gowns[String(item.id)]
          if (!gown) return null
          return (
            <div key={`${item.id}__${item.size ?? ''}`} className="ck-sidebar-item">
              <img src={gown.image} alt={gown.name} onError={e => { e.target.style.display = 'none' }} />
              <div>
                <p className="ck-sidebar-name">{gown.name}</p>
                <p className="ck-sidebar-meta">
                  {item.size ? `Size ${item.size}` : 'No size'} · ×{Number(item.qty) || 1}
                </p>
                <p className="ck-sidebar-price">{gown.price ?? '—'}</p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="ck-sidebar-totals">
        <div className="ck-sidebar-total-row">
          <span>Subtotal</span>
          <span>{formatPrice(itemsSub)}</span>
        </div>
        <div className="ck-sidebar-total-row">
          <span>Shipping</span>
          <span>
            {delivery === 'pickup'
              ? <span className="ck-free">Free</span>
              : feeUnknown
                ? <em className="ck-tbd">TBD</em>
                : formatPrice(shipping)
            }
          </span>
        </div>
        <div className="ck-sidebar-total-row ck-sidebar-total-row--tax">
          <span>Business tax <span className="ck-tax-detail">(3%)</span></span>
          <span>{feeUnknown ? <em className="ck-tbd">TBD</em> : formatPrice(tax)}</span>
        </div>
        <div className="ck-sidebar-divider" />
        <div className="ck-sidebar-total-row ck-sidebar-total-row--grand">
          <span>Total{feeUnknown ? '*' : ''}</span>
          <span>{feeUnknown ? <em className="ck-tbd">TBD</em> : formatPrice(total)}</span>
        </div>
      </div>

      {feeUnknown && (
        <p className="ck-sidebar-note">* Enter your address to calculate shipping and total</p>
      )}
    </aside>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CheckoutPage() {
  const router = useRouter()
  const [user,           setUser          ] = useState(null)
  const [userChecked,    setUserChecked   ] = useState(false)
  const [step,           setStep          ] = useState(0)
  const [items,          setItems         ] = useState([])
  const [gowns,          setGowns         ] = useState({})
  const [loadingGowns,   setLoadingGowns  ] = useState(true)

  const [delivery,        setDelivery       ] = useState('pickup')
  const [addrStreet,      setAddrStreet     ] = useState('')
  const [addrCity,        setAddrCity       ] = useState('')
  const [addrProvince,    setAddrProvince   ] = useState('')
  const [addrZip,         setAddrZip        ] = useState('')
  const [shippingFee,     setShippingFee    ] = useState(0)
  const [shippingLoading, setShippingLoading] = useState(false)
  const [shippingError,   setShippingError  ] = useState('')

  const [paymentMethod, setPaymentMethod] = useState('')
  const [tncAccepted,   setTncAccepted  ] = useState(false)
  const [placing,       setPlacing      ] = useState(false)
  const [placeError,    setPlaceError   ] = useState('')

  useEffect(() => {
    const u = getCurrentUser()
    setUserChecked(true)
    if (!u) { router.replace('/login?redirect=/checkout'); return }
    setUser(u)

    try {
      const extra = JSON.parse(localStorage.getItem('jce_profile_extra') || '{}')
      if (extra.address)  setAddrStreet(extra.address)
      if (extra.city)     setAddrCity(extra.city)
      if (extra.province) setAddrProvince(extra.province)
      if (extra.zip)      setAddrZip(extra.zip)
    } catch {}

    const cart       = loadCart()
    const allItems   = (Array.isArray(cart) ? cart : []).map(item => ({
      ...item, id: String(item.id), qty: Number(item.qty) || 1,
    }))
    const params     = new URLSearchParams(window.location.search)
    const selectedIds = params.get('items')?.split(',').filter(Boolean) ?? []
    const normalised  = selectedIds.length > 0
      ? allItems.filter(item => selectedIds.includes(String(item.id)))
      : allItems

    setItems(normalised)
    if (!normalised.length) { setLoadingGowns(false); return }

    setLoadingGowns(true)
    fetch('/api/gowns')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(d => {
        const map = {}
        for (const g of (Array.isArray(d.gowns) ? d.gowns : [])) map[String(g.id)] = g
        setGowns(map)
      })
      .catch(() => setGowns({}))
      .finally(() => setLoadingGowns(false))
  }, [router])

  const handleRemove = useCallback((id, size) => {
    setItems(prev => {
      const next = prev.filter(i => !(String(i.id) === String(id) && (i.size ?? null) === (size ?? null)))
      saveCart(next)
      return next
    })
  }, [])

 const handlePlaceOrder = async ({ itemsSub, shipping, bizTax, tax, total }) => {
    if (!user) return
    setPlacing(true)
    setPlaceError('')

    const deliveryAddress = delivery === 'lalamove'
      ? buildAddressString({ street: addrStreet, city: addrCity, province: addrProvince, zip: addrZip })
      : null

    try {
      const orderItems = items.map(item => ({
        gownId:    item.id,
        gownName:  gowns[String(item.id)]?.name || 'Unknown',
        sizeLabel: item.size || null,
        quantity:  Number(item.qty) || 1,
        unitPrice: parsePrice(gowns[String(item.id)]?.price),
      }))

      const body = {
        userId:         user.id,
        customerEmail:  user.email,
        customerName:   `${user.firstName || user.name || ''} ${user.lastName || ''}`.trim(),
        paymentMethod,
        deliveryMethod:  delivery,
        deliveryAddress,
        items:           orderItems,
        subtotal:        itemsSub,
        shippingFee:     shipping,
        tax,
        total,
        notes:           '',
      }

      const res  = await fetch('/api/orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': String(user.id) },
        body:    JSON.stringify(body),
      })

      let data = {}
      try { data = await res.json() } catch {}

      if (!res.ok || !data.ok) {
        setPlaceError(data.error || 'Failed to place order. Please try again.')
        return
      }

      const cart       = loadCart()
      const orderedIds = new Set(items.map(i => String(i.id)))
      saveCart(cart.filter(i => !orderedIds.has(String(i.id))))
      router.push(`/order-confirmation/${data.orderId}`)
    } catch {
      setPlaceError('Could not connect to the server. Please try again.')
    } finally {
      setPlacing(false)
    }
  }

  const isLoadingUser = !userChecked
  const isLoggedOut   = userChecked && !user
  const showSidebar   = items.length > 0 && !loadingGowns

  return (
    <main className="ck-page">
      <Header solid />
      <div className="ck-spacer" />

      {isLoadingUser ? (
        <div className="ck-loading">Checking session…</div>
      ) : isLoggedOut ? (
        <div className="ck-loading">Redirecting…</div>
      ) : (
        <>
          <section className="ck-hero">
            <h1 className="ck-hero-title">Checkout</h1>
            <p className="ck-hero-sub">Complete your order below.</p>
          </section>

          <div className="ck-steps-bar">
            {STEPS.map((label, idx) => (
              <div key={label} className={stepClass(idx, step)}>
                <span className="ck-step-n">{idx < step ? '✓' : idx + 1}</span>
                <span className="ck-step-label">{label}</span>
                {idx < STEPS.length - 1 && <span className="ck-step-line" />}
              </div>
            ))}
          </div>

          <div className="ck-layout">
            <div className="ck-main">
              {loadingGowns && items.length > 0 ? (
                <div className="ck-loading">Loading cart…</div>
              ) : (
                <>
                  {step === 0 && (
                    <StepReview items={items} gowns={gowns} onNext={() => setStep(1)} onRemove={handleRemove} />
                  )}
                  {step === 1 && (
                    <StepDelivery
                      delivery={delivery}         setDelivery={setDelivery}
                      addrStreet={addrStreet}     setAddrStreet={setAddrStreet}
                      addrCity={addrCity}         setAddrCity={setAddrCity}
                      addrProvince={addrProvince} setAddrProvince={setAddrProvince}
                      addrZip={addrZip}           setAddrZip={setAddrZip}
                      shippingFee={shippingFee}             setShippingFee={setShippingFee}
                      shippingLoading={shippingLoading}     setShippingLoading={setShippingLoading}
                      shippingError={shippingError}         setShippingError={setShippingError}
                      onNext={() => setStep(2)} onBack={() => setStep(0)}
                    />
                  )}
                  {step === 2 && (
                    <StepPayment
                      paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
                      delivery={delivery}
                      onNext={() => setStep(3)} onBack={() => setStep(1)}
                    />
                  )}
                  {step === 3 && (
                    <StepConfirm
                      items={items} gowns={gowns}
                      delivery={delivery}
                      addrStreet={addrStreet} addrCity={addrCity}
                      addrProvince={addrProvince} addrZip={addrZip}
                      paymentMethod={paymentMethod} shippingFee={shippingFee}
                      tncAccepted={tncAccepted} setTncAccepted={setTncAccepted}
                      onPlace={handlePlaceOrder}
                      onBack={() => setStep(2)}
                      placing={placing} placeError={placeError}
                    />
                  )}
                </>
              )}
            </div>

            {showSidebar && (
              <OrderSummarySidebar
                items={items} gowns={gowns}
                delivery={delivery} shippingFee={shippingFee}
              />
            )}
          </div>

          <style>{`
            /* Address form */
            .ck-addr-form { margin-top:18px; background:#faf9f7; border:0.5px solid #e8e0db; border-radius:10px; padding:18px 20px; display:flex; flex-direction:column; gap:12px; }
            .ck-addr-form-title { font-size:13px; font-weight:500; color:#4a3a34; margin-bottom:2px; }
            .ck-addr-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
            @media (max-width:520px) { .ck-addr-row { grid-template-columns:1fr; } }
            .ck-field--zip { max-width:180px; }
            .ck-field--error .ck-input { border-color:#E24B4A; }
            .ck-field-error { font-size:11px; color:#A32D2D; margin-top:4px; }
            .ck-required { color:#E24B4A; margin-left:2px; }

            /* Shipping estimate */
            .ck-shipping-est { font-size:13px; min-height:20px; }
            .ck-shipping-calc { display:flex; align-items:center; gap:7px; color:#9a8880; }
            .ck-shipping-spinner { width:12px; height:12px; border:1.5px solid #ccc; border-top-color:#9a8880; border-radius:50%; animation:ck-spin .7s linear infinite; flex-shrink:0; }
            @keyframes ck-spin { to { transform:rotate(360deg) } }
            .ck-shipping-result { display:flex; align-items:center; gap:6px; color:#2c6e3f; }
            .ck-shipping-note { color:#9a8880; font-size:11px; }
            .ck-shipping-warn { color:#92400E; font-size:12px; }

            /* Shared helpers */
            .ck-free { color:#2c6e3f; font-size:11px; }
            .ck-tbd  { font-style:italic; color:#aaa; font-size:11px; }

            /* Confirm step totals */
            .ck-confirm-totals { border-top:0.5px solid #e8e0db; padding-top:10px; }
            .ck-confirm-total-row { display:flex; justify-content:space-between; font-size:13px; color:#5a4a44; padding:3px 0; }
            .ck-confirm-total-row--tax { color:#9a8880; font-size:12px; }
            .ck-confirm-total-row--grand { font-size:15px; font-weight:600; color:#2c2420; padding-top:6px; border-top:0.5px solid #e8e0db; margin-top:4px; }

            /* Sidebar totals */
            .ck-sidebar-totals { margin-top:12px; border-top:0.5px solid #e8e0db; padding-top:10px; }
            .ck-sidebar-total-row { display:flex; justify-content:space-between; font-size:12px; color:#7a6a64; padding:3px 0; }
            .ck-sidebar-total-row--tax { color:#aaa; font-size:11px; }
            .ck-sidebar-total-row--grand { font-size:14px; font-weight:600; color:#2c2420; padding-top:6px; }
            .ck-sidebar-divider { border-top:0.5px solid #e8e0db; margin:6px 0; }
            .ck-tax-detail { color:#aaa; font-size:10px; margin-left:3px; }
          `}</style>
        </>
      )}
      <Footer />
    </main>
  )
}