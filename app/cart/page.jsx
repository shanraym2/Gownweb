'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { loadCart, saveCart, setQuantity, removeItem, loadCartNote, saveCartNote } from '../utils/cartClient'
import { GOWNS } from '../data/gowns'

function parsePrice(priceStr) {
  if (!priceStr) return 0
  const s = String(priceStr).replace(/[₱,\s]/g, '')
  return parseFloat(s) || 0
}

function formatPeso(n) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const BRAND = 'JCE Bridal'

export default function CartPage() {
  const [items, setItems] = useState([])
  const [note, setNote] = useState('')

  useEffect(() => {
    setItems(loadCart())
    setNote(loadCartNote())
  }, [])

  const detailedItems = useMemo(() => {
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

  const handleQuantityChange = (id, delta) => {
    const entry = items.find((e) => e.id === id)
    if (!entry) return
    const newQty = Math.max(1, entry.qty + delta)
    setItems(setQuantity(id, newQty))
  }

  const handleQuantityInput = (id, value) => {
    const n = parseInt(value, 10)
    if (isNaN(n) || n < 1) return
    setItems(setQuantity(id, n))
  }

  const handleRemove = (id) => {
    setItems(removeItem(id))
  }

  return (
    <main className="auth-page">
      <Header />
      <section className="gowns-header-spacer" />

      <section className="cart-section">
        <div className="container">
          <nav className="cart-breadcrumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span className="cart-breadcrumb-sep">&gt;</span>
            <span>Shopping Cart</span>
          </nav>
          <h1 className="cart-title">SHOPPING CART</h1>

          {detailedItems.length === 0 ? (
            <div className="cart-empty">
              <p>You do not have any items in your cart yet.</p>
              <Link href="/gowns" className="btn btn-cart-primary">
                CONTINUE SHOPPING
              </Link>
            </div>
          ) : (
            <div className="cart-layout">
              <div className="cart-products-col">
                <div className="cart-bar cart-bar-product">PRODUCT</div>
                <ul className="cart-item-list">
                  {detailedItems.map((item) => (
                    <li key={item.id} className="cart-row">
                      <div className="cart-row-image">
                        <img src={item.image} alt={item.alt ?? item.name} />
                      </div>
                      <div className="cart-row-details">
                        <p className="cart-row-title">
                          {item.name} – {item.color}
                        </p>
                        <p className="cart-row-variant">{item.color}</p>
                        <p className="cart-row-brand">{BRAND}</p>
                        <p className="cart-row-price">{item.price}</p>
                        <div className="cart-row-qty">
                          <span className="cart-qty-label">Quantity</span>
                          <div className="cart-qty-controls">
                            <button
                              type="button"
                              className="cart-qty-btn"
                              onClick={() => handleQuantityChange(item.id, -1)}
                              aria-label="Decrease quantity"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={1}
                              value={item.qty}
                              onChange={(e) => handleQuantityInput(item.id, e.target.value)}
                              className="cart-qty-input"
                              aria-label="Quantity"
                            />
                            <button
                              type="button"
                              className="cart-qty-btn"
                              onClick={() => handleQuantityChange(item.id, 1)}
                              aria-label="Increase quantity"
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
                            REMOVE
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <Link href="/gowns" className="btn btn-cart-primary">
                  CONTINUE SHOPPING
                </Link>
              </div>

              <div className="cart-summary-col">
                <div className="cart-bar cart-bar-subtotal">SUBTOTAL</div>
                <p className="cart-subtotal-amount">{formatPeso(subtotal)}</p>
                <div className="cart-note-block">
                  <span className="cart-note-tag">NOTE</span>
                  <span className="cart-note-label">Additional comments</span>
                  <textarea
                    className="cart-note-textarea"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={() => saveCartNote(note)}
                    placeholder="Add any special requests or notes…"
                    rows={4}
                  />
                </div>
                <Link href="/checkout" className="btn btn-cart-primary btn-cart-checkout">
                  PROCEED TO CHECKOUT
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
