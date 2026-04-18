'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { useGowns, getGownById } from '@/hooks/useGowns'
import {
  loadCart, setQuantity, removeItem, loadCartNote, saveCartNote,
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
  const [cartItems,    setCartItems   ] = useState([])
  const [selectedKeys, setSelectedKeys] = useState(new Set())
  const [note,         setNote        ] = useState('')
  const [mounted,      setMounted     ] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!mounted) return
    const raw = loadCart()
    const withGowns = raw.map(item => {
      const gown = getGownById(gowns, item.id)
      if (!gown) return null
      const priceNum = parsePrice(gown.price)
      const lineKey  = `${item.id}__${item.size ?? ''}`
      return {
        lineKey,
        id:       gown.id,
        size:     item.size ?? null,
        name:     gown.name,
        image:    gown.image,
        alt:      gown.alt,
        price:    gown.price,
        priceNum,
        qty:      item.qty,
        subtotal: priceNum * item.qty,
      }
    }).filter(Boolean)
    setCartItems(withGowns)
    setSelectedKeys(new Set(withGowns.map(i => i.lineKey)))
  }, [mounted, gowns])

  useEffect(() => {
    if (!mounted) return
    setNote(loadCartNote())
  }, [mounted])

  const allSelected  = cartItems.length > 0 && selectedKeys.size === cartItems.length
  const someSelected = selectedKeys.size > 0 && selectedKeys.size < cartItems.length

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedKeys(new Set())
    } else {
      setSelectedKeys(new Set(cartItems.map(i => i.lineKey)))
    }
  }

  const toggleSelect = lineKey => {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      next.has(lineKey) ? next.delete(lineKey) : next.add(lineKey)
      return next
    })
  }

  const handleQtyChange = (id, size, val) => {
    const q = Math.max(1, parseInt(String(val), 10) || 1)
    setQuantity(id, q, size)
    setCartItems(prev =>
      prev.map(item =>
        item.id === id && (item.size ?? null) === (size ?? null)
          ? { ...item, qty: q, subtotal: item.priceNum * q }
          : item
      )
    )
  }

  const handleRemove = (id, size) => {
    removeItem(id, size)
    const lineKey = `${id}__${size ?? ''}`
    setCartItems(prev => prev.filter(item => item.lineKey !== lineKey))
    setSelectedKeys(prev => {
      const next = new Set(prev)
      next.delete(lineKey)
      return next
    })
  }

  // ── selectedKeys drives everything ────────────────────────────────────────
  const selectedItems = cartItems.filter(i => selectedKeys.has(i.lineKey))
  const subtotal      = selectedItems.reduce((sum, item) => sum + item.subtotal, 0)
  const totalQty      = selectedItems.reduce((s, i) => s + i.qty, 0)

  // Pass only selected item IDs to checkout
  const checkoutHref = `/checkout?items=${selectedItems.map(i => i.id).join(',')}`

  if (!mounted) return (
    <main>
      <Header solid />
      <div style={{ height: 80 }} />
      <div style={{ padding: '4rem', textAlign: 'center', fontFamily: 'Jost,sans-serif', color: '#9a8880', letterSpacing: '0.2em', fontSize: '0.75rem', textTransform: 'uppercase' }}>
        Loading cart…
      </div>
      <Footer />
    </main>
  )

  return (
    <main className="cart-pg">
      <Header solid />
      <div className="cart-spacer" />

      <div className="cart-hero">
        <p className="cart-hero-eyebrow">Your Selection</p>
        <h1>Shopping Cart</h1>
      </div>

      <div className="cart-body">
        <nav className="cart-bc">
          <Link href="/">Home</Link>
          <span className="cart-bc-sep">/</span>
          <Link href="/gowns">Gowns</Link>
          <span className="cart-bc-sep">/</span>
          <span>Cart</span>
        </nav>

        {cartItems.length === 0 ? (
          <div className="cart-empty-state">
            <svg viewBox="0 0 24 24">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 01-8 0"/>
            </svg>
            <p>Your cart is empty.</p>
            <Link href="/gowns" style={{
              display: 'inline-block', padding: '0.85rem 2.5rem',
              background: '#2c2420', color: '#faf7f4',
              fontFamily: "'Jost',sans-serif", fontSize: '0.68rem',
              letterSpacing: '0.3em', textTransform: 'uppercase', textDecoration: 'none',
            }}>Browse Gowns</Link>
          </div>
        ) : (
          <div className="cart-layout">

            {/* ── Items column ── */}
            <div>
              <div className="cart-select-bar">
                <label className="cb-wrap">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected }}
                    onChange={toggleSelectAll}
                  />
                  <span className="cb-box">
                    <span className="cb-box-dash" />
                    <svg viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg>
                  </span>
                </label>
                <span className="cart-select-bar-label">Select All</span>
                <span className="cart-select-count">
                  {selectedKeys.size} of {cartItems.length} selected
                </span>
              </div>

              <div className="cart-col-head">
                <span />
                <span>Product</span>
                <span style={{ gridColumn: '3', textAlign: 'right' }}>Subtotal</span>
              </div>

              <ul className="cart-item-list">
                {cartItems.map(item => {
                  const isSelected = selectedKeys.has(item.lineKey)
                  return (
                    <li key={item.lineKey} className={`cart-row${!isSelected ? ' deselected' : ''}`}>

                      <div className="cart-row-check">
                        <label className="cb-wrap">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(item.lineKey)}
                          />
                          <span className="cb-box">
                            <span className="cb-box-dash" />
                            <svg viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg>
                          </span>
                        </label>
                      </div>

                      <div className="cart-row-img">
                        <img src={item.image} alt={item.alt} />
                      </div>

                      <div className="cart-row-info">
                        <p className="cart-row-name">{item.name}</p>
                        {item.size && <p className="cart-row-size">Size: {item.size}</p>}
                        <p className="cart-row-unit">{item.price} per gown</p>
                        <div className="cart-qty-wrap">
                          <span className="cart-qty-label-text">Qty</span>
                          <div className="cart-qty-ctrl">
                            <button
                              type="button"
                              className="cart-qty-btn"
                              onClick={() => handleQtyChange(item.id, item.size, item.qty - 1)}
                              aria-label="Decrease"
                            >−</button>
                            <input
                              type="number"
                              className="cart-qty-num"
                              min={1}
                              value={item.qty}
                              onChange={e => handleQtyChange(item.id, item.size, e.target.value)}
                            />
                            <button
                              type="button"
                              className="cart-qty-btn"
                              onClick={() => handleQtyChange(item.id, item.size, item.qty + 1)}
                              aria-label="Increase"
                            >+</button>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="cart-remove-btn"
                          onClick={() => handleRemove(item.id, item.size)}
                        >Remove</button>
                      </div>

                      <div className="cart-row-sub">
                        <span className="cart-row-sub-amt">{formatPrice(item.subtotal)}</span>
                        {!isSelected && <span className="cart-row-sub-note">not included</span>}
                      </div>

                    </li>
                  )
                })}
              </ul>
            </div>

            {/* ── Summary column ── */}
            <div className="cart-summary">
              <p className="cart-summary-title">Order Summary</p>

              {selectedItems.length === 0 ? (
                <p className="cart-summary-empty-note">No items selected</p>
              ) : (
                <div className="cart-summary-items">
                  {selectedItems.map(item => (
                    <div key={item.lineKey} className="cart-summary-item">
                      <span className="cart-summary-item-name">
                        {item.name}{item.size ? ` (${item.size})` : ''} × {item.qty}
                      </span>
                      <span className="cart-summary-item-price">{formatPrice(item.subtotal)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="cart-summary-row">
                <span className="cart-summary-row-label">Items</span>
                <span className="cart-summary-row-val">{totalQty}</span>
              </div>

              <div className="cart-summary-total">
                <span className="cart-summary-total-label">Subtotal</span>
                <span className="cart-summary-total-amt">{formatPrice(subtotal)}</span>
              </div>

              <div className="cart-note-section">
                <label htmlFor="cart-note">Order Notes</label>
                <textarea
                  id="cart-note"
                  className="cart-note-ta"
                  placeholder="Special requests, delivery notes…"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  onBlur={() => saveCartNote(note)}
                />
              </div>

              {selectedItems.length > 0 ? (
                <Link href={checkoutHref} className="btn-checkout">
                  Checkout {selectedKeys.size === cartItems.length ? 'All' : `(${selectedKeys.size})`} →
                </Link>
              ) : (
                <button disabled className="btn-checkout">Select items to checkout</button>
              )}
              <Link href="/gowns" className="btn-continue">Continue Shopping</Link>
            </div>

          </div>
        )}
      </div>
      <Footer />
    </main>
  )
}