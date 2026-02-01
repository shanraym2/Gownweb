'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { useGowns, getGownById } from '@/hooks/useGowns'
import { loadCart, loadCartNote, clearCart } from '../utils/cartClient'

function parsePrice(priceStr) {
  if (!priceStr || typeof priceStr !== 'string') return 0
  const num = parseInt(priceStr.replace(/[^\d]/g, ''), 10)
  return isNaN(num) ? 0 : num
}

function formatPrice(num) {
  return '₱' + Number(num).toLocaleString('en-PH')
}

const GCASH_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/GCash_Logo.svg/120px-GCash_Logo.svg.png'
const BDO_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/BDO_Unibank_%282015%29.svg/120px-BDO_Unibank_%282015%29.svg.png'

export default function CheckoutPage() {
  const { gowns } = useGowns()
  const [cartItems, setCartItems] = useState([])
  const [note, setNote] = useState('')
  const [mounted, setMounted] = useState(false)
  const [payment, setPayment] = useState('gcash')
  const [submitting, setSubmitting] = useState(false)
  const [orderDone, setOrderDone] = useState(false)
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    phone: '',
    address: '',
    city: '',
    province: '',
    zip: '',
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const raw = loadCart()
    const withGowns = raw
      .map((item) => {
        const gown = getGownById(gowns, item.id)
        if (!gown) return null
        const priceNum = parsePrice(gown.price)
        return {
          id: gown.id,
          name: gown.name,
          image: gown.image,
          alt: gown.alt,
          price: gown.price,
          priceNum,
          qty: item.qty,
          subtotal: priceNum * item.qty,
        }
      })
      .filter(Boolean)
    setCartItems(withGowns)
    setNote(loadCartNote())
  }, [mounted, gowns])

  const subtotal = cartItems.reduce((sum, item) => sum + item.subtotal, 0)

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (cartItems.length === 0) return
    setSubmitting(true)
    try {
      const order = {
        contact: { email: form.email, firstName: form.firstName, lastName: form.lastName, phone: form.phone },
        delivery: { address: form.address, city: form.city, province: form.province, zip: form.zip },
        payment,
        items: cartItems.map((i) => ({ id: i.id, name: i.name, qty: i.qty, price: i.price, subtotal: i.subtotal })),
        note,
        subtotal,
        createdAt: new Date().toISOString(),
      }
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      })
      if (res.ok) {
        clearCart()
        setOrderDone(true)
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Could not place order. Try again.')
      }
    } catch {
      alert('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!mounted) {
    return (
      <main className="gowns-page">
        <Header />
        <section className="gowns-header-spacer" />
        <section className="checkout-section">
          <div className="checkout-container">
            <p>Loading...</p>
          </div>
        </section>
        <Footer />
      </main>
    )
  }

  if (orderDone) {
    return (
      <main className="gowns-page">
        <Header />
        <section className="gowns-header-spacer" />
        <section className="checkout-section">
          <div className="checkout-container">
            <h1>Thank you</h1>
            <p>Your order has been received. We will contact you for payment (GCash or BDO) and delivery details.</p>
            <Link href="/gowns" className="btn btn-primary" style={{ marginTop: 20 }}>Continue Shopping</Link>
          </div>
        </section>
        <Footer />
      </main>
    )
  }

  if (cartItems.length === 0) {
    return (
      <main className="gowns-page">
        <Header />
        <section className="gowns-header-spacer" />
        <section className="checkout-section">
          <div className="checkout-container">
            <p className="checkout-empty">Your cart is empty.</p>
            <Link href="/gowns" className="btn btn-primary">Continue Shopping</Link>
          </div>
        </section>
        <Footer />
      </main>
    )
  }

  return (
    <main className="gowns-page">
      <Header />
      <section className="gowns-header-spacer" />
      <section className="checkout-section">
        <div className="checkout-container">
          <h1 className="cart-title">Checkout</h1>
          <form onSubmit={handleSubmit} className="checkout-layout">
            <div className="checkout-form-col">
              <div className="checkout-block">
                <h2 className="checkout-heading">Contact</h2>
                <div className="checkout-row">
                  <div className="checkout-field">
                    <input
                      type="text"
                      name="firstName"
                      placeholder="First name"
                      value={form.firstName}
                      onChange={handleChange}
                      required
                    />
                  </div>
                  <div className="checkout-field">
                    <input
                      type="text"
                      name="lastName"
                      placeholder="Last name"
                      value={form.lastName}
                      onChange={handleChange}
                      required
                    />
                  </div>
                </div>
                <div className="checkout-field">
                  <input
                    type="email"
                    name="email"
                    placeholder="Email"
                    value={form.email}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="checkout-field">
                  <input
                    type="tel"
                    name="phone"
                    placeholder="Phone"
                    value={form.phone}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="checkout-block">
                <h2 className="checkout-heading">Delivery address</h2>
                <div className="checkout-field">
                  <input
                    type="text"
                    name="address"
                    placeholder="Address"
                    value={form.address}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="checkout-row">
                  <div className="checkout-field">
                    <input
                      type="text"
                      name="city"
                      placeholder="City"
                      value={form.city}
                      onChange={handleChange}
                      required
                    />
                  </div>
                  <div className="checkout-field">
                    <input
                      type="text"
                      name="province"
                      placeholder="Province"
                      value={form.province}
                      onChange={handleChange}
                    />
                  </div>
                </div>
                <div className="checkout-field">
                  <input
                    type="text"
                    name="zip"
                    placeholder="ZIP / Postal code"
                    value={form.zip}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="checkout-block">
                <h2 className="checkout-heading">Payment</h2>
                <p style={{ fontSize: '0.9rem', color: 'var(--color-text-light)', marginBottom: 12 }}>
                  GCash or BDO bank transfer only.
                </p>
                <div className="checkout-payment-options">
                  <button
                    type="button"
                    className={`checkout-payment-btn ${payment === 'gcash' ? 'active' : ''}`}
                    onClick={() => setPayment('gcash')}
                  >
                    <img src={GCASH_LOGO} alt="GCash" className="checkout-payment-logo" />
                    <span>GCash</span>
                  </button>
                  <button
                    type="button"
                    className={`checkout-payment-btn ${payment === 'bdo' ? 'active' : ''}`}
                    onClick={() => setPayment('bdo')}
                  >
                    <img src={BDO_LOGO} alt="BDO" className="checkout-payment-logo" />
                    <span>BDO Bank Transfer</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="checkout-summary-col">
              <h2 className="checkout-summary-title">Order summary</h2>
              <ul className="checkout-line-items">
                {cartItems.map((item) => (
                  <li key={item.id} className="checkout-line-item">
                    <div className="checkout-line-image">
                      <img src={item.image} alt={item.alt} />
                      <span className="checkout-line-qty">{item.qty}</span>
                    </div>
                    <div className="checkout-line-info">
                      <span className="checkout-line-name">{item.name}</span>
                      <span className="checkout-line-variant">{item.qty} × {item.price}</span>
                      <span className="checkout-line-price">{formatPrice(item.subtotal)}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="checkout-totals">
                <div className="checkout-total-row">
                  <span>Subtotal</span>
                  <span className="checkout-total-final">{formatPrice(subtotal)}</span>
                </div>
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-checkout-submit"
                disabled={submitting}
              >
                {submitting ? 'Placing order…' : 'Place order'}
              </button>
            </div>
          </form>
        </div>
      </section>
      <Footer />
    </main>
  )
}
