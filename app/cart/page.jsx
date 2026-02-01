'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { useGowns, getGownById } from '@/hooks/useGowns'
import {
  loadCart,
  setQuantity,
  removeItem,
  loadCartNote,
  saveCartNote,
} from '../utils/cartClient'

function parsePrice(priceStr) {
  if (!priceStr || typeof priceStr !== 'string') return 0
  const num = parseInt(priceStr.replace(/[^\d]/g, ''), 10)
  return isNaN(num) ? 0 : num
}

function formatPrice(num) {
  return '₱' + Number(num).toLocaleString('en-PH')
}

export default function CartPage() {
  const { gowns } = useGowns()
  const [cartItems, setCartItems] = useState([])
  const [note, setNote] = useState('')
  const [mounted, setMounted] = useState(false)

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
  }, [mounted, gowns])

  useEffect(() => {
    if (!mounted) return
    setNote(loadCartNote())
  }, [mounted])

  const handleNoteBlur = () => {
    saveCartNote(note)
  }

  const handleQtyChange = (gownId, newQty) => {
    const q = Math.max(1, parseInt(String(newQty), 10) || 1)
    setQuantity(gownId, q)
    setCartItems((prev) =>
      prev.map((item) =>
        item.id === gownId ? { ...item, qty: q, subtotal: item.priceNum * q } : item
      )
    )
  }

  const handleRemove = (gownId) => {
    removeItem(gownId)
    setCartItems((prev) => prev.filter((item) => item.id !== gownId))
  }

  const subtotal = cartItems.reduce((sum, item) => sum + item.subtotal, 0)

  if (!mounted) {
    return (
      <main className="gowns-page">
        <Header />
        <section className="gowns-header-spacer" />
        <section className="cart-section">
          <div className="container">
            <p>Loading cart...</p>
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
      <section className="cart-section">
        <div className="container">
          <nav className="cart-breadcrumb">
            <Link href="/">Home</Link>
            <span className="cart-breadcrumb-sep">/</span>
            <span>Cart</span>
          </nav>
          <h1 className="cart-title">Shopping Cart</h1>

          {cartItems.length === 0 ? (
            <div className="cart-empty">
              <p>Your cart is empty.</p>
              <Link href="/gowns" className="btn btn-primary">
                Continue Shopping
              </Link>
            </div>
          ) : (
            <div className="cart-layout">
              <div className="cart-products-col">
                <div className="cart-bar" style={{ display: 'grid', gridTemplateColumns: '1fr 120px' }}>
                  <span className="cart-bar-product">Product</span>
                  <span className="cart-bar-subtotal">Subtotal</span>
                </div>
                <ul className="cart-item-list">
                  {cartItems.map((item) => (
                    <li key={item.id} className="cart-row">
                      <div className="cart-row-image">
                        <img src={item.image} alt={item.alt} />
                      </div>
                      <div className="cart-row-details">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                          <h2 className="cart-row-title">{item.name}</h2>
                          <p className="cart-row-price">{formatPrice(item.subtotal)}</p>
                        </div>
                        <p className="cart-row-variant">{item.price} each</p>
                        <div className="cart-row-qty">
                          <span className="cart-qty-label">Quantity</span>
                          <div className="cart-qty-controls">
                            <button
                              type="button"
                              className="cart-qty-btn"
                              onClick={() => handleQtyChange(item.id, item.qty - 1)}
                              aria-label="Decrease"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              className="cart-qty-input"
                              min={1}
                              value={item.qty}
                              onChange={(e) => handleQtyChange(item.id, e.target.value)}
                            />
                            <button
                              type="button"
                              className="cart-qty-btn"
                              onClick={() => handleQtyChange(item.id, item.qty + 1)}
                              aria-label="Increase"
                            >
                              +
                            </button>
                          </div>
                        </div>
                        <div className="cart-row-actions">
                          <button
                            type="button"
                            className="cart-link cart-link-remove"
                            onClick={() => handleRemove(item.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="cart-summary-col">
                <p className="cart-subtotal-amount">Subtotal: {formatPrice(subtotal)}</p>
                <p className="cart-note-tag">Note</p>
                <div className="cart-note-block">
                  <label htmlFor="cart-note" className="cart-note-label">
                    Order notes (optional)
                  </label>
                  <textarea
                    id="cart-note"
                    className="cart-note-textarea"
                    placeholder="Special requests, delivery notes..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={handleNoteBlur}
                  />
                </div>
                <Link href="/gowns" className="btn btn-outline" style={{ display: 'block', textAlign: 'center' }}>
                  Continue Shopping
                </Link>
                <Link href="/checkout" className="btn btn-cart-primary btn-cart-checkout">
                  Proceed to Checkout
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>
      <Footer />
    </main>
  )
}
