'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { useGowns, getGownById } from '@/hooks/useGowns'
import { loadCart, loadCartNote, removeItem } from '../utils/cartClient'
import { getCurrentUser } from '../utils/authClient'

function parsePrice(priceStr) {
  if (!priceStr || typeof priceStr !== 'string') return 0
  const num = parseInt(priceStr.replace(/[^\d]/g, ''), 10)
  return isNaN(num) ? 0 : num
}

function formatPrice(num) {
  return '₱' + Number(num).toLocaleString('en-PH')
}

function loadProfileExtra() {
  try {
    return JSON.parse(localStorage.getItem('jce_profile_extra') || '{}')
  } catch { return {} }
}

const DEFAULT_GOWN_IMAGE =
  'https://images.unsplash.com/photo-1600180758895-02b4fdc936f4?auto=format&fit=crop&w=150&q=80'

function StepIndicator({ current }) {
  const steps = ['Cart', 'Details', 'Confirmation']
  return (
    <div className="ck-step-indicator">
      {steps.map((label, i) => {
        const idx   = i + 1
        const done  = idx < current
        const active = idx === current
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
            <div className={`ck-step${done ? ' done' : active ? ' active' : ''}`}>
              <div className="ck-step-num">{done ? '✓' : idx}</div>
              <span>{label}</span>
            </div>
            {i < steps.length - 1 && <div className="ck-step-sep" />}
          </div>
        )
      })}
    </div>
  )
}

export default function CheckoutClient() {
  const searchParams = useSearchParams()
  const { gowns }   = useGowns()

  const [cartItems,  setCartItems]  = useState([])
  const [note,       setNote]       = useState('')
  const [mounted,    setMounted]    = useState(false)
  const [payment,    setPayment]    = useState('gcash')
  const [submitting, setSubmitting] = useState(false)
  const [orderDone,  setOrderDone]  = useState(false)
  const [shippingFee]               = useState(200)
  const [form, setForm] = useState({
    email: '', firstName: '', lastName: '', phone: '',
    address: '', city: '', province: '', zip: '',
  })
  const [errors, setErrors] = useState({})

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!mounted) return
    const user      = getCurrentUser()
    const extra     = loadProfileExtra()
    const nameParts = (user?.name || '').trim().split(/\s+/)
    setForm(prev => ({
      ...prev,
      email:     user?.email   || prev.email,
      firstName: nameParts[0]  || prev.firstName,
      lastName:  nameParts.slice(1).join(' ') || prev.lastName,
      phone:     extra.phone   || prev.phone,
      address:   extra.address || prev.address,
      city:      extra.city    || prev.city,
      province:  extra.province || prev.province,
      zip:       extra.zip     || prev.zip,
    }))
  }, [mounted])

  useEffect(() => {
    if (!mounted) return
    const itemsParam  = searchParams.get('items')
    const selectedIds = itemsParam
      ? new Set(itemsParam.split(',').map(s => s.trim()).filter(Boolean))
      : null
    const withGowns = loadCart()
      .map(item => {
        if (selectedIds && !selectedIds.has(String(item.id))) return null
        const gown = getGownById(gowns, item.id)
        if (!gown) return null
        const priceNum = parsePrice(gown.price)
        return { id: gown.id, name: gown.name, image: gown.image || DEFAULT_GOWN_IMAGE,
          alt: gown.alt || gown.name, price: gown.price, priceNum,
          qty: item.qty, subtotal: priceNum * item.qty }
      })
      .filter(Boolean)
    setCartItems(withGowns)
    setNote(loadCartNote())
  }, [mounted, gowns, searchParams])

  const subtotal = cartItems.reduce((sum, i) => sum + i.subtotal, 0)
  const taxes    = Math.round(subtotal * 0.12)
  const total    = subtotal + shippingFee + taxes

  const validateField = (name, value) => {
    switch (name) {
      case 'firstName': case 'lastName': case 'city': case 'province':
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
        if (!/^\d{7,11}$/.test(value)) return 'Must be 7–11 digits'
        return ''
      case 'zip':
        if (!value) return 'Required'
        if (!/^\d{4,6}$/.test(value)) return 'Must be 4–6 digits'
        return ''
      default: return ''
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    const val = name === 'phone' || name === 'zip' ? value.replace(/\D/g, '') : value
    setForm(prev => ({ ...prev, [name]: val }))
    setErrors(prev => ({ ...prev, [name]: validateField(name, val) }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!cartItems.length) return
    const newErrors = {}
    Object.keys(form).forEach(key => {
      const err = validateField(key, form[key])
      if (err) newErrors[key] = err
    })
    if (Object.keys(newErrors).length) { setErrors(newErrors); return }
    setSubmitting(true)
    try {
      const order = {
        contact:  { ...form },
        delivery: { address: form.address, city: form.city, province: form.province, zip: form.zip },
        payment,
        items: cartItems.map(i => ({ id: i.id, name: i.name, qty: i.qty, price: i.price, subtotal: i.subtotal })),
        note, subtotal, shippingFee, taxes, total,
        createdAt: new Date().toISOString(),
      }
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      })
      if (res.ok) {
        try {
          const existing = JSON.parse(localStorage.getItem('jce_orders') || '[]')
          localStorage.setItem('jce_orders', JSON.stringify([order, ...existing].slice(0, 20)))
        } catch {}
        cartItems.forEach(item => removeItem(item.id))
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

  const field = (name, label, props = {}) => (
    <div className="ck-field">
      <label className="ck-label" htmlFor={`f-${name}`}>{label}</label>
      <input
        id={`f-${name}`}
        name={name}
        value={form[name]}
        onChange={handleChange}
        className={errors[name] ? 'input-error' : ''}
        {...props}
      />
      {errors[name] && <span className="ck-field-error">{errors[name]}</span>}
    </div>
  )

  if (!mounted) return <main className="gowns-page"><Header solid /><Footer /></main>

  if (orderDone) return (
    <main className="gowns-page">
      <Header solid />
      <section className="gowns-header-spacer" />
      <section className="checkout-section">
        <div className="checkout-container">
          <StepIndicator current={3} />
          <div className="ck-success">
            <p className="ck-success-eyebrow">Order confirmed</p>
            <h1 className="ck-success-title">Thank you</h1>
            <div className="ck-success-rule" />
            <p className="ck-success-body">
              Your order has been received. We will contact{' '}
              <strong>{form.email}</strong> with{' '}
              {payment === 'gcash' ? 'GCash' : 'BDO'} payment instructions
              and confirm your delivery details shortly.
            </p>
            <div className="ck-success-actions">
              <Link href="/my-orders" className="btn btn-outline">View my orders</Link>
              <Link href="/gowns" className="btn btn-primary">Continue shopping</Link>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  )

  if (!cartItems.length) return (
    <main className="gowns-page">
      <Header solid />
      <section className="gowns-header-spacer" />
      <section className="checkout-section">
        <div className="checkout-container">
          <p className="checkout-empty">No items selected for checkout.</p>
          <Link href="/cart" className="btn btn-primary">Back to cart</Link>
        </div>
      </section>
      <Footer />
    </main>
  )

  const itemCount = cartItems.reduce((n, i) => n + i.qty, 0)

  return (
    <main className="gowns-page">
      <Header solid />
      <section className="gowns-header-spacer" />
      <section className="checkout-section">
        <div className="checkout-container">
          <h1 className="ck-page-title">Checkout</h1>
          <StepIndicator current={2} />
          <form onSubmit={handleSubmit} className="ck-layout" noValidate>
            <div className="ck-form-col">
              <div className="ck-block">
                <span className="ck-block-title">Contact information</span>
                <div className="ck-row">
                  {field('firstName', 'First name', { placeholder: 'Maria' })}
                  {field('lastName',  'Last name',  { placeholder: 'Santos' })}
                </div>
                {field('email', 'Email', { type: 'email', placeholder: 'maria@example.com' })}
                {field('phone', 'Phone', { type: 'tel', placeholder: '09171234567', maxLength: 11 })}
              </div>
              <div className="ck-block">
                <span className="ck-block-title">Delivery address</span>
                {field('address', 'Street / Barangay', { placeholder: '123 Rizal St, Brgy San Antonio' })}
                <div className="ck-row">
                  {field('city',     'City / Municipality', { placeholder: 'Taguig' })}
                  {field('province', 'Province',            { placeholder: 'Metro Manila' })}
                </div>
                {field('zip', 'ZIP / Postal code', { placeholder: '1630', maxLength: 6 })}
              </div>
              <div className="ck-block">
                <span className="ck-block-title">Payment method</span>
                <p className="ck-payment-hint">
                  Select your preferred method. We will send payment instructions
                  to your email after your order is confirmed.
                </p>
                <div className="ck-payment-grid">
                  {[
                    { id: 'gcash', label: 'GCash', short: 'G',   bg: '#007DFF' },
                    { id: 'bdo',   label: 'BDO',   short: 'BDO', bg: '#c0392b' },
                  ].map(({ id, label, short, bg }) => (
                    <button
                      key={id}
                      type="button"
                      className={`ck-pay-btn${payment === id ? ' active' : ''}`}
                      onClick={() => setPayment(id)}
                    >
                      <div className="ck-pay-icon" style={{ background: bg }}>{short}</div>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="ck-summary-col">
              <span className="ck-summary-header">
                Order summary &middot; {itemCount} {itemCount === 1 ? 'item' : 'items'}
              </span>
              <ul className="ck-items">
                {cartItems.map(item => (
                  <li key={item.id} className="ck-item">
                    <div className="ck-item-img-wrap">
                      <img src={item.image} alt={item.alt} className="ck-item-img" />
                      <span className="ck-item-qty">{item.qty}</span>
                    </div>
                    <div className="ck-item-info">
                      <p className="ck-item-name">{item.name}</p>
                      <p className="ck-item-variant">{item.qty} × {item.price}</p>
                      <p className="ck-item-price">{formatPrice(item.subtotal)}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="ck-divider" />
              <div className="ck-totals">
                <div className="ck-total-row"><span>Subtotal</span><span>{formatPrice(subtotal)}</span></div>
                <div className="ck-total-row"><span>Shipping</span><span>{formatPrice(shippingFee)}</span></div>
                <div className="ck-total-row"><span>Tax (12% VAT)</span><span>{formatPrice(taxes)}</span></div>
                <div className="ck-total-row ck-total-grand">
                  <span>Total</span>
                  <span className="ck-total-final">{formatPrice(total)}</span>
                </div>
              </div>
              <div className="ck-submit-wrap">
                <button type="submit" className="ck-submit-btn" disabled={submitting}>
                  {submitting ? 'Placing order…' : 'Place order'}
                </button>
              </div>
              <p className="ck-secure-note">
                <svg width="9" height="11" viewBox="0 0 9 11" fill="none" aria-hidden="true">
                  <rect x="0.6" y="4.6" width="7.8" height="5.8" rx="0" stroke="currentColor" strokeWidth="1.1"/>
                  <path d="M2.5 4.6V3A2 2 0 016.5 3v1.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="square"/>
                </svg>
                Secure checkout
              </p>
            </div>
          </form>
        </div>
      </section>
      <Footer />
    </main>
  )
}