'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { loadCart } from '../utils/cartClient'
import { GOWNS } from '../data/gowns'

function parsePrice(priceStr) {
  if (!priceStr) return 0
  const s = String(priceStr).replace(/[₱,\s]/g, '')
  return parseFloat(s) || 0
}

function formatPeso(n) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const PH_REGIONS = ['Metro Manila', 'Calabarzon', 'Central Luzon', 'Ilocos Region', 'Cagayan Valley', 'Bicol Region', 'Western Visayas', 'Central Visayas', 'Eastern Visayas', 'Zamboanga Peninsula', 'Northern Mindanao', 'Davao Region', 'SOCCSKSARGEN', 'CAR', 'MIMAROPA', 'Caraga', 'BARMM']

const GCASH_LOGO_URL = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS2KsNv1E-CEQ95oQ2KPdGElyoHd1frji8S4w&s'
const BDO_LOGO_URL = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSvJyx0drMGOOt0HOQ4nvb-rj8q2NfLpv91_g&s'

export default function CheckoutPage() {
  const router = useRouter()
  const [items, setItems] = useState(null)
  const [paymentMethod, setPaymentMethod] = useState(null) // 'gcash' | 'bdo' | null
  const [form, setForm] = useState({
    email: '',
    newsOffers: false,
    country: 'Philippines',
    firstName: '',
    lastName: '',
    address: '',
    apartment: '',
    postalCode: '',
    city: '',
    region: 'Metro Manila',
    mobile: '',
    saveInfo: false,
  })

  useEffect(() => {
    setItems(loadCart())
  }, [])

  const detailedItems = useMemo(() => {
    if (!items || !Array.isArray(items)) return []
    return items
      .map((entry) => {
        const gown = GOWNS.find((g) => g.id === entry.id)
        if (!gown) return null
        return { ...gown, qty: entry.qty }
      })
      .filter(Boolean)
  }, [items])

  const subtotal = useMemo(() => {
    return detailedItems.reduce((sum, item) => sum + parsePrice(item.price) * item.qty, 0)
  }, [detailedItems])

  const shippingLabel = 'Enter shipping address'
  const total = subtotal

  const handleInput = (e) => {
    const { name, type, value, checked } = e.target
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!paymentMethod) return
    // In a real app: send order + payment method (GCash/BDO) to backend
    // For now, could redirect to contact or thank-you
    router.push('/contact')
  }

  if (items && items.length === 0) {
    return (
      <main className="auth-page">
        <Header />
        <section className="gowns-header-spacer" />
        <section className="checkout-section">
          <div className="container checkout-container">
            <p className="checkout-empty">Your cart is empty.</p>
            <Link href="/gowns" className="btn btn-cart-primary">Continue to Gowns</Link>
          </div>
        </section>
        <Footer />
      </main>
    )
  }

  if (items === null) {
    return (
      <main className="auth-page">
        <Header />
        <section className="gowns-header-spacer" />
        <section className="checkout-section">
          <div className="container checkout-container">
            <p className="checkout-empty">Loading…</p>
          </div>
        </section>
        <Footer />
      </main>
    )
  }

  return (
    <main className="auth-page checkout-page">
      <Header />
      <section className="gowns-header-spacer" />

      <section className="checkout-section">
        <div className="container checkout-container">
          <form onSubmit={handleSubmit} className="checkout-layout">
            <div className="checkout-form-col">
              <h2 className="checkout-heading">Payment method</h2>
              <div className="checkout-payment-options">
                <button
                  type="button"
                  className={`checkout-payment-btn ${paymentMethod === 'gcash' ? 'active' : ''}`}
                  onClick={() => setPaymentMethod('gcash')}
                  aria-pressed={paymentMethod === 'gcash'}
                >
                  <img src={GCASH_LOGO_URL} alt="" className="checkout-payment-logo" width={80} height={32} />
                  GCash
                </button>
                <button
                  type="button"
                  className={`checkout-payment-btn ${paymentMethod === 'bdo' ? 'active' : ''}`}
                  onClick={() => setPaymentMethod('bdo')}
                  aria-pressed={paymentMethod === 'bdo'}
                >
                  <img src={BDO_LOGO_URL} alt="" className="checkout-payment-logo" width={80} height={32} />
                  BDO Bank Transfer
                </button>
              </div>

              <hr className="checkout-divider" aria-hidden="true" />

              <div className="checkout-block">
                <div className="checkout-block-header">
                  <h2 className="checkout-heading">Contact</h2>
                  <Link href="/login" className="checkout-signin">Sign in</Link>
                </div>
                <div className="checkout-field">
                  <input
                    type="email"
                    name="email"
                    placeholder="Email"
                    value={form.email}
                    onChange={handleInput}
                    required
                  />
                </div>
                <label className="checkout-checkbox">
                  <input type="checkbox" name="newsOffers" checked={form.newsOffers} onChange={handleInput} />
                  Email me with news and offers
                </label>
              </div>

              <div className="checkout-block">
                <h2 className="checkout-heading">Delivery</h2>
                <div className="checkout-field">
                  <select name="country" value={form.country} onChange={handleInput} aria-label="Country/Region">
                    <option value="Philippines">Philippines</option>
                  </select>
                </div>
                <div className="checkout-row">
                  <div className="checkout-field">
                    <input type="text" name="firstName" placeholder="First name" value={form.firstName} onChange={handleInput} required />
                  </div>
                  <div className="checkout-field">
                    <input type="text" name="lastName" placeholder="Last name" value={form.lastName} onChange={handleInput} required />
                  </div>
                </div>
                <div className="checkout-field">
                  <input type="text" name="address" placeholder="Address" value={form.address} onChange={handleInput} required />
                </div>
                <div className="checkout-field">
                  <input type="text" name="apartment" placeholder="Apartment, suite, etc. (optional)" value={form.apartment} onChange={handleInput} />
                </div>
                <div className="checkout-row">
                  <div className="checkout-field">
                    <input type="text" name="postalCode" placeholder="Postal code" value={form.postalCode} onChange={handleInput} />
                  </div>
                  <div className="checkout-field">
                    <input type="text" name="city" placeholder="City" value={form.city} onChange={handleInput} required />
                  </div>
                </div>
                <div className="checkout-field">
                  <select name="region" value={form.region} onChange={handleInput} aria-label="Region">
                    {PH_REGIONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div className="checkout-field checkout-field-mobile">
                  <input type="tel" name="mobile" placeholder="Mobile Number" value={form.mobile} onChange={handleInput} required />
                  <span className="checkout-help" title="We use this to contact you about your order">?</span>
                </div>
                <label className="checkout-checkbox">
                  <input type="checkbox" name="saveInfo" checked={form.saveInfo} onChange={handleInput} />
                  Save this information for next time
                </label>
              </div>
            </div>

            <div className="checkout-summary-col">
              <h2 className="checkout-summary-title">Order summary</h2>
              <ul className="checkout-line-items">
                {detailedItems.map((item) => (
                  <li key={item.id} className="checkout-line-item">
                    <div className="checkout-line-image">
                      <img src={item.image} alt={item.alt ?? item.name} />
                      <span className="checkout-line-qty">{item.qty}</span>
                    </div>
                    <div className="checkout-line-info">
                      <span className="checkout-line-name">{item.name}</span>
                      <span className="checkout-line-variant">{item.color}</span>
                      <span className="checkout-line-price">{formatPeso(parsePrice(item.price) * item.qty)}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="checkout-totals">
                <div className="checkout-total-row">
                  <span>Subtotal</span>
                  <span>{formatPeso(subtotal)}</span>
                </div>
                <div className="checkout-total-row">
                  <span>Shipping</span>
                  <span className="checkout-shipping-placeholder">{shippingLabel}</span>
                </div>
                <div className="checkout-total-row checkout-total-final">
                  <span>Total</span>
                  <span>PHP {formatPeso(total)}</span>
                </div>
              </div>
              <button type="submit" className="btn btn-cart-primary btn-checkout-submit" disabled={!paymentMethod}>
                Pay with {paymentMethod === 'gcash' ? 'GCash' : paymentMethod === 'bdo' ? 'BDO' : '…'}
              </button>
            </div>
          </form>
        </div>
      </section>

      <Footer />
    </main>
  )
}
