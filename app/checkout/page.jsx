'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { useGowns, getGownById } from '@/hooks/useGowns'
import { loadCart, loadCartNote, clearCart } from '../utils/cartClient'
import { getCurrentUser } from '../utils/authClient'

function parsePrice(priceStr) {
  if (!priceStr || typeof priceStr !== 'string') return 0
  const num = parseInt(priceStr.replace(/[^\d]/g, ''), 10)
  return isNaN(num) ? 0 : num
}

function formatPrice(num) {
  return '₱' + Number(num).toLocaleString('en-PH')
}

const DEFAULT_GOWN_IMAGE =
  'https://images.unsplash.com/photo-1600180758895-02b4fdc936f4?auto=format&fit=crop&w=150&q=80'

const GCASH_LOGO =
  'https://logodix.com/logo/2206206.png'
const BDO_LOGO =
  'https://cdn.brandfetch.io/idcWXsRcl7/theme/dark/logo.svg?c=1dxbfHSJFAPEGdCLU4o5B'

export default function CheckoutPage() {
  const { gowns } = useGowns()
  const [cartItems, setCartItems] = useState([])
  const [note, setNote] = useState('')
  const [mounted, setMounted] = useState(false)
  const [payment, setPayment] = useState('gcash')
  const [submitting, setSubmitting] = useState(false)
  const [orderDone, setOrderDone] = useState(false)
  const [shippingFee] = useState(200)
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
  const [errors, setErrors] = useState({})

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!mounted) return
    const loggedIn = getCurrentUser()
    if (loggedIn?.email) setForm((prev) => ({ ...prev, email: loggedIn.email }))
  }, [mounted])

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
          image: gown.image || DEFAULT_GOWN_IMAGE,
          alt: gown.alt || gown.name,
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
  const taxes = Math.round(subtotal * 0.12)
  const total = subtotal + shippingFee + taxes

  const validateField = (name, value) => {
    switch (name) {
      case 'firstName':
      case 'lastName':
      case 'city':
      case 'province':
        if (!value.trim()) return 'Required'
        if (!/^[a-zA-Z\s.'-]+$/.test(value)) return 'Invalid characters'
        return ''
      case 'address':
        return value.trim() ? '' : 'Required'
      case 'email':
        if (!value.trim()) return 'Required'
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Invalid email'
        return ''
      case 'phone':
        if (!value) return 'Required'
        if (!/^\d{7,11}$/.test(value)) return 'Phone must be 7-11 digits'
        return ''
      case 'zip':
        if (!value) return 'Required'
        if (!/^\d{4,6}$/.test(value)) return 'ZIP must be 4-6 digits'
        return ''
      default:
        return ''
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    let val =
      name === 'phone' || name === 'zip'
        ? value.replace(/\D/g, '')
        : value

    // Limit phone to 11 digits
    if (name === 'phone') {
      val = val.slice(0, 11)
    }

    setForm((prev) => ({ ...prev, [name]: val }))
    setErrors((prev) => ({ ...prev, [name]: validateField(name, val) }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!cartItems.length) return

    const newErrors = {}
    Object.keys(form).forEach((key) => {
      const err = validateField(key, form[key])
      if (err) newErrors[key] = err
    })
    if (Object.keys(newErrors).length) {
      setErrors(newErrors)
      return
    }

    setSubmitting(true)
    try {
      const order = {
        contact: { ...form },
        delivery: {
          address: form.address,
          city: form.city,
          province: form.province,
          zip: form.zip,
        },
        payment,
        items: cartItems.map((i) => ({
          id: i.id,
          name: i.name,
          qty: i.qty,
          price: i.price,
          subtotal: i.subtotal,
        })),
        note,
        subtotal,
        shippingFee,
        taxes,
        total,
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

  const showError = (field) =>
    errors[field] ? <div className="form-error">{errors[field]}</div> : null

  if (!mounted)
    return (
      <main className="gowns-page">
        <Header />
        <Footer />
      </main>
    )

  if (orderDone)
    return (
      <main className="gowns-page">
        <Header />
        <section className="gowns-header-spacer" />
        <section className="checkout-section">
          <div className="checkout-container">
            <h1>Thank you</h1>
            <p>
              Your order has been received. We will contact you for payment
              (GCash or BDO) and delivery details.
            </p>
            <Link href="/my-orders" className="btn btn-outline mt-3">
              View my orders
            </Link>
            <Link href="/gowns" className="btn btn-primary mt-3">
              Continue Shopping
            </Link>
          </div>
        </section>
        <Footer />
      </main>
    )

  if (!cartItems.length)
    return (
      <main className="gowns-page">
        <Header />
        <section className="gowns-header-spacer" />
        <section className="checkout-section">
          <div className="checkout-container">
            <p className="checkout-empty">Your cart is empty.</p>
            <Link href="/gowns" className="btn btn-primary">
              Continue Shopping
            </Link>
          </div>
        </section>
        <Footer />
      </main>
    )

  return (
    <main className="gowns-page">
      <Header />
      <section className="gowns-header-spacer" />
      <section className="checkout-section">
        <div className="checkout-container">
          <h1 className="cart-title">Checkout</h1>
          <form onSubmit={handleSubmit} className="checkout-layout">

            {/* FORM COLUMN */}
            <div className="checkout-form-col">

              {/* Contact */}
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
                      className={errors.firstName ? 'input-error' : ''}
                    />
                    {showError('firstName')}
                  </div>
                  <div className="checkout-field">
                    <input 
                      type="text" 
                      name="lastName" 
                      placeholder="Last name" 
                      value={form.lastName} 
                      onChange={handleChange} 
                      className={errors.lastName ? 'input-error' : ''}
                    />
                    {showError('lastName')}
                  </div>
                </div>
                <div className="checkout-field">
                  <input 
                    type="email" 
                    name="email" 
                    placeholder="Email" 
                    value={form.email} 
                    onChange={handleChange} 
                    className={errors.email ? 'input-error' : ''}
                  />
                  {showError('email')}
                </div>
                <div className="checkout-field">
                  <input 
                    type="tel" 
                    name="phone" 
                    placeholder="Phone" 
                    value={form.phone} 
                    onChange={handleChange} 
                    className={errors.phone ? 'input-error' : ''}
                    maxLength={11}

                  />
                  {showError('phone')}
                </div>
              </div>

              {/* Delivery */}
              <div className="checkout-block">
                <h2 className="checkout-heading">Delivery address</h2>
                <div className="checkout-field">
                  <input 
                    type="text" 
                    name="address" 
                    placeholder="Street / Barangay" 
                    value={form.address} 
                    onChange={handleChange} 
                    className={errors.address ? 'input-error' : ''}
                  />
                  {showError('address')}
                </div>
                <div className="checkout-row">
                  <div className="checkout-field">
                    <input 
                      type="text" 
                      name="city" 
                      placeholder="City" 
                      value={form.city} 
                      onChange={handleChange} 
                      className={errors.city ? 'input-error' : ''}
                    />
                    {showError('city')}
                  </div>
                  <div className="checkout-field">
                    <input 
                      type="text" 
                      name="province" 
                      placeholder="Province" 
                      value={form.province} 
                      onChange={handleChange} 
                      className={errors.province ? 'input-error' : ''}
                    />
                    {showError('province')}
                  </div>
                </div>
                <div className="checkout-field">
                  <input 
                    type="text" 
                    name="zip" 
                    placeholder="ZIP / Postal code" 
                    value={form.zip} 
                    onChange={handleChange} 
                    className={errors.zip ? 'input-error' : ''}
                  />
                  {showError('zip')}
                </div>
              </div>

              {/* Payment */}
              <div className="checkout-block">
                <h2 className="checkout-heading">Payment</h2>
                <div className="checkout-payment-options">
                  <button type="button" className={`checkout-payment-btn ${payment==='gcash'?'active':''}`} onClick={() => setPayment('gcash')}>
                    <img src={GCASH_LOGO} alt="GCash" className="checkout-payment-logo" /> GCash
                  </button>
                  <button type="button" className={`checkout-payment-btn ${payment==='bdo'?'active':''}`} onClick={() => setPayment('bdo')}>
                    <img src={BDO_LOGO} alt="BDO" className="checkout-payment-logo" /> BDO
                  </button>
                </div>
              </div>
            </div>

            {/* SUMMARY COLUMN */}
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
                <div className="checkout-total-row"><span>Subtotal</span><span className="checkout-total-final">{formatPrice(subtotal)}</span></div>
                <div className="checkout-total-row"><span>Shipping</span><span className="checkout-shipping-placeholder">{formatPrice(shippingFee)}</span></div>
                <div className="checkout-total-row"><span>Taxes (12%)</span><span>{formatPrice(taxes)}</span></div>
                <div className="checkout-total-row grand-total"><span>Total</span><span className="checkout-total-final">{formatPrice(total)}</span></div>
              </div>

              <button type="submit" className="btn btn-primary btn-checkout-submit" disabled={submitting}>
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