'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { useGowns, getGownById } from '@/hooks/useGowns'
import {
  loadCart, syncCartFromBackend, addToCart, setQuantity, removeItem, loadCartNote, saveCartNote,
} from '../utils/cartClient'

function parsePrice(priceStr) {
  if (!priceStr || typeof priceStr !== 'string') return 0
  const num = parseInt(priceStr.replace(/[^\d]/g, ''), 10)
  return isNaN(num) ? 0 : num
}
function formatPrice(num) {
  return '₱' + Number(num).toLocaleString('en-PH')
}

// ── Stock status helpers ───────────────────────────────────────────────────────

// Returns { available: number | null } for a specific gown+size from live inventory data.
// inventoryMap shape: { [gownId]: { [sizeLabel]: { stock_qty, reserved_qty } } }
function getAvailable(inventoryMap, gownId, size) {
  const gownInv = inventoryMap?.[String(gownId)]
  if (!gownInv) return null
  const sizeKey = size ?? (Object.keys(gownInv).length === 1 ? Object.keys(gownInv)[0] : null)
  if (!sizeKey) return null
  const row = gownInv?.[sizeKey]
  if (!row) return null
  return Math.max(0, (row.stock_qty ?? 0) - (row.reserved_qty ?? 0))
}

function StockBadge({ available }) {
  if (available === null) return null
  if (available === 0)
    return <span className="cart-stock-badge cart-stock-badge--out">Out of stock</span>
  if (available <= 2)
    return <span className="cart-stock-badge cart-stock-badge--low">Only {available} left</span>
  if (available <= 5)
    return <span className="cart-stock-badge cart-stock-badge--low">{available} in stock</span>
  return null
}

function CartNote() {
  const [note, setNote] = useState(() => {
    if (typeof window === 'undefined') return ''
    return loadCartNote()
  })
  return (
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
  )
}

export default function CartPage() {
  const { gowns } = useGowns()
  const [cartItems,    setCartItems   ] = useState([])
  const [selectedKeys, setSelectedKeys] = useState(new Set())
  const [note,         setNote        ] = useState('')
  const [mounted,      setMounted     ] = useState(false)

  // Live inventory: { [gownId]: { [sizeLabel]: { stock_qty, reserved_qty } } }
  const [inventoryMap, setInventoryMap] = useState({})
  const [stockLoading, setStockLoading] = useState(false)
  const [addSizeSelections, setAddSizeSelections] = useState({})

  const [content, setContent] = useState({
    heading:        'Your Fitting Room',
    empty_title:    'Your cart is empty',
    empty_body:     'Browse our catalogue to add gowns to your fitting room.',
    checkout_label: 'Proceed to Checkout',
    promo_banner:   '',
  })

  useEffect(() => {
    fetch('/api/cms/content?section=cart')
      .then(r => r.json())
      .then(d => { if (d.ok && d.fields) setContent(d.fields) })
      .catch(() => {})
  }, [])
  
  useEffect(() => { setMounted(true) }, [])

// ── Fetch live inventory for all items in cart ─────────────────────────────
  const fetchInventory = useCallback(async (items) => {
    if (!items.length) return
    const gownIds = [...new Set(items.map(i => i.id))]
    setStockLoading(true)
    try {
      const res = await fetch(`/api/gowns?ids=${gownIds.join(',')}`)
      if (!res.ok) return
      const data = await res.json()
      const map = {}
      for (const g of (data.gowns ?? [])) {
        if (!g.sizeStock?.length) continue
        map[String(g.id)] = {}
        for (const s of g.sizeStock) {
          map[String(g.id)][s.size] = {
            stock_qty:    s.stock    ?? s.stock_qty    ?? 0,
            reserved_qty: s.reserved ?? s.reserved_qty ?? 0,
          }
        }
      }
      setInventoryMap(map)
    } catch {
      // Non-fatal — UI degrades gracefully without stock data
    } finally {
      setStockLoading(false)
    }
  }, [])

  useEffect(() => {
    const onFocus = () => {
      if (cartItems.length > 0) fetchInventory(cartItems)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [cartItems, fetchInventory])

  // ── Build cart items from localStorage + gown data ─────────────────────────
  useEffect(() => {
    if (!mounted) return
    
    // Sync cart from backend first (for cross-device sync)
    syncCartFromBackend().then(items => {
      const withGowns = items.map(item => {
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
      fetchInventory(withGowns)
    })
  }, [mounted, gowns, fetchInventory])

  useEffect(() => {
    if (!mounted) return
    setNote(loadCartNote())
  }, [mounted])

  const selectableItems = cartItems.filter(i => {
    const avail = getAvailable(inventoryMap, i.id, i.size)
    return avail === null || avail > 0
  })
  const allSelected  = selectableItems.length > 0 && selectedKeys.size === selectableItems.length
  const someSelected = selectedKeys.size > 0 && selectedKeys.size < selectableItems.length

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedKeys(new Set())
    } else {
      // Only select items that are not out of stock
      const selectable = cartItems
        .filter(i => {
          const avail = getAvailable(inventoryMap, i.id, i.size)
          return avail === null || avail > 0
        })
        .map(i => i.lineKey)
      setSelectedKeys(new Set(selectable))
    }
  }

  const toggleSelect = (lineKey, isOutOfStock) => {
    if (isOutOfStock) return // Cannot select out-of-stock items
    setSelectedKeys(prev => {
      const next = new Set(prev)
      next.has(lineKey) ? next.delete(lineKey) : next.add(lineKey)
      return next
    })
  }

  const handleQtyChange = (id, size, val) => {
    const available = getAvailable(inventoryMap, id, size)
    const maxQty = available !== null ? available : undefined
    const q = Math.max(1, parseInt(String(val), 10) || 1)
    const capped = maxQty !== undefined ? Math.min(q, maxQty) : q
    setQuantity(id, capped, size, maxQty ?? null)
    setCartItems(prev =>
      prev.map(item =>
        item.id === id && (item.size ?? null) === (size ?? null)
          ? { ...item, qty: capped, subtotal: item.priceNum * capped }
          : item
      )
    )
  }

  const handleSizeChange = (item, newSize) => {
    if (newSize === item.size) return
    const gown = getGownById(gowns, item.id)
    if (!gown) return

    const newLineKey = `${item.id}__${newSize ?? ''}`
    const existingLine = cartItems.find(i => i.lineKey === newLineKey)

    if (existingLine) {
      // Target size already has its own row — merge quantities
      const available = getAvailable(inventoryMap, item.id, newSize)
      const mergedQty = available !== null
        ? Math.min(existingLine.qty + item.qty, available)
        : existingLine.qty + item.qty

      setQuantity(existingLine.id, mergedQty, newSize, available)
     // AFTER (else branch, replace the two lines)
      try {
        removeItem(item.id, item.size)
        if (newQty > 0) addToCart(item.id, newQty, { size: newSize, maxQty })
      } catch (err) {
        console.error('Cart storage error during size change:', err)
        return // abort state update — UI stays consistent with storage
      }

      setCartItems(prev =>
        prev
          .filter(i => i.lineKey !== item.lineKey)
          .map(i =>
            i.lineKey === newLineKey
              ? { ...i, qty: mergedQty, subtotal: i.priceNum * mergedQty }
              : i
          )
      )
      setSelectedKeys(prev => {
        const next = new Set(prev)
        next.delete(item.lineKey)
        next.add(newLineKey)
        return next
      })
    } else {
      const newSizeObj = gown.sizeStock?.find(s => s.size === newSize)
      const newAvail = newSizeObj
        ? Math.max(0, (newSizeObj.stock ?? newSizeObj.stock_qty ?? 0) - (newSizeObj.reserved ?? newSizeObj.reserved_qty ?? 0))
        : null
      const maxQty = newAvail !== null ? newAvail : null
      const newQty = maxQty !== null ? Math.min(item.qty, maxQty) : item.qty

      removeItem(item.id, item.size)
      if (newQty > 0) addToCart(item.id, newQty, { size: newSize, maxQty })

      setCartItems(prev =>
        prev.map(i => {
          if (i.lineKey !== item.lineKey) return i
          if (newQty <= 0) return null
          return { ...item, size: newSize, lineKey: newLineKey, qty: newQty, subtotal: item.priceNum * newQty }
        }).filter(Boolean)
      )
      setSelectedKeys(prev => {
        const next = new Set(prev)
        next.delete(item.lineKey)
        if (newQty > 0) next.add(newLineKey)
        return next
      })
    }
  }

  const handleAddSize = (item, newSize) => {
    if (!newSize) return
    const gown = getGownById(gowns, item.id)
    if (!gown) return

    const newLineKey = `${item.id}__${newSize}`
    // If that size is already in cart, just bump its qty
    const existing = cartItems.find(i => i.lineKey === newLineKey)
    if (existing) {
      handleQtyChange(existing.id, existing.size, existing.qty + 1)
      return
    }

    const sizeObj = gown.sizeStock?.find(s => s.size === newSize)
    const avail = sizeObj
      ? Math.max(0, (sizeObj.stock ?? sizeObj.stock_qty ?? 0) - (sizeObj.reserved ?? sizeObj.reserved_qty ?? 0))
      : null

    addToCart(item.id, 1, { size: newSize, maxQty: avail })

    const priceNum = item.priceNum
    const newRow = {
      lineKey:  newLineKey,
      id:       item.id,
      size:     newSize,
      name:     item.name,
      image:    item.image,
      alt:      item.alt,
      price:    item.price,
      priceNum,
      qty:      1,
      subtotal: priceNum,
    }

    // Insert the new row directly below the current one
    setCartItems(prev => {
      const idx = prev.findIndex(i => i.lineKey === item.lineKey)
      const next = [...prev]
      next.splice(idx + 1, 0, newRow)
      return next
    })
    setSelectedKeys(prev => new Set([...prev, newLineKey]))
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

  // ── Derived values ─────────────────────────────────────────────────────────
  const selectedItems = cartItems.filter(i => selectedKeys.has(i.lineKey))
  const subtotal      = selectedItems.reduce((sum, item) => sum + item.subtotal, 0)
  const totalQty      = selectedItems.reduce((s, i) => s + i.qty, 0)

  // Check if any selected item is out of stock
  const selectedOutOfStock = selectedItems.filter(i => {
    const avail = getAvailable(inventoryMap, i.id, i.size)
    return avail !== null && avail === 0
  })
  const canCheckout = selectedItems.length > 0 && selectedOutOfStock.length === 0

  const checkoutHref = `/checkout?items=${selectedItems.map(i => `${i.id}:${encodeURIComponent(i.size ?? '')}`).join(',')}`
  

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
        <span className="cart-hero-eyebrow">The Fitting Room</span>
        <h1 className="cart-hero-h1">{content.heading || 'Your Curated Selection'}</h1>
        <p className="cart-hero-sub">Review your chosen pieces before we begin the fitting process.</p>
      </div>

      <div className="cart-body">
        <nav className="cart-bc">
          <Link href="/">Home</Link>
          <span className="cart-bc-sep">/</span>
          <Link href="/gowns">Collection</Link>
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
            <p>{content.empty_title}</p>
            <p>{content.empty_body}</p>
            <Link href="/gowns" style={{
              display: 'inline-block', padding: '0.85rem 2.5rem',
              background: '#2c2420', color: '#faf7f4',
              fontFamily: "'Jost',sans-serif", fontSize: '0.68rem',
              letterSpacing: '0.3em', textTransform: 'uppercase', textDecoration: 'none',
            }}>Browse Catalogue</Link>
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
                {stockLoading && (
                  <span className="cart-stock-refreshing">Checking stock…</span>
                )}
              </div>

              <div className="cart-col-head">
                <span />
                <span>Product</span> 
              </div>

              <ul className="cart-item-list">
                {cartItems.map(item => {
                  const isSelected  = selectedKeys.has(item.lineKey)
                  const available   = getAvailable(inventoryMap, item.id, item.size)
                  const isOutOfStock = available !== null && available === 0
                  const isLowStock  = available !== null && available > 0 && available <= 5
                  // Cap qty if it exceeds available stock (stock may have changed)
                  const effectiveMax = available !== null ? available : null

                  return (
                    <li
                      key={item.lineKey}
                      className={[
                        'cart-row',
                        !isSelected ? 'deselected' : '',
                        isOutOfStock ? 'cart-row--out-of-stock' : '',
                      ].filter(Boolean).join(' ')}
                    >

                      <div className="cart-row-check">
                        <label className={`cb-wrap${isOutOfStock ? ' cb-wrap--disabled' : ''}`}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isOutOfStock}
                            onChange={() => toggleSelect(item.lineKey, isOutOfStock)}
                          />
                          <span className="cb-box">
                            <span className="cb-box-dash" />
                            <svg viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg>
                          </span>
                        </label>
                      </div>

                      <div className="cart-row-img">
                        <img src={item.image} alt={item.alt} />
                        {isOutOfStock && (
                          <div className="cart-img-oos-overlay">
                            <span>Out of<br/>Stock</span>
                          </div>
                        )}
                      </div>

                      <div className="cart-row-info">
                        <p className="cart-row-name">{item.name}</p>
                        {item.size && (() => {
                          const gown = getGownById(gowns, item.id)
                          const availSizes = gown?.sizeStock ?? []
                          if (availSizes.length <= 1) {
                            return <p className="cart-row-size">Size: {item.size}</p>
                          }
                          return (
                            <div className="cart-size-change">
                              <span className="cart-size-change-label">Size</span>
                              <div className="cart-size-chips">
                                {availSizes.map(({ size, stock, reserved }) => {
                                  const avail = Math.max(0, (stock ?? 0) - (reserved ?? 0))
                                  const isCurrent = size === item.size
                                  const isOos = avail === 0 && !isCurrent
                                  return (
                                    <button
                                      key={size}
                                      type="button"
                                      disabled={isOos}
                                      onClick={() => !isOos && !isCurrent && handleSizeChange(item, size)}
                                      className={[
                                        'cart-size-chip',
                                        isCurrent ? 'cart-size-chip--on' : '',
                                        isOos     ? 'cart-size-chip--oos' : '',
                                      ].filter(Boolean).join(' ')}
                                      title={isOos ? 'Out of stock' : `Switch to size ${size}`}
                                    >
                                      {size}
                                      {avail > 0 && avail <= 2 && !isCurrent && (
                                        <span className="cart-size-chip-stock">{avail}</span>
                                      )}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })()}
                        {/* Add another size */}
                        {(() => {
                          const gown = getGownById(gowns, item.id)
                          const availSizes = gown?.sizeStock ?? []
                          const otherSizes = availSizes.filter(s => {
                            const avail = Math.max(0, (s.stock ?? 0) - (s.reserved ?? 0))
                            const alreadyInCart = cartItems.some(i => i.id === item.id && i.size === s.size)
                            return avail > 0 && !alreadyInCart
                          })
                          if (otherSizes.length === 0) return null
                          return (
                            <div className="cart-add-size">
                              <select
                                value={addSizeSelections[item.lineKey] ?? ''}
                                onChange={e => {
                                  handleAddSize(item, e.target.value)
                                  setAddSizeSelections(prev => ({ ...prev, [item.lineKey]: '' }))
                                }}
                                className="cart-add-size-select"
                              >
                                <option value="" disabled>+ Add another size</option>
                                {otherSizes.map(s => (
                                  <option key={s.size} value={s.size}>{s.size}</option>
                                ))}
                              </select>
                            </div>
                          )
                        })()}
                        <p className="cart-row-unit">{item.price} per gown</p>

                        {/* Stock status badge */}
                        <StockBadge available={available} />

                        {isOutOfStock ? (
                          <p className="cart-oos-msg">
                            This item is currently out of stock and cannot be checked out.
                            Please remove it or wait for restocking.
                          </p>
                        ) : (
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
                                max={effectiveMax ?? undefined}
                                value={item.qty}
                                onChange={e => handleQtyChange(item.id, item.size, e.target.value)}
                              />
                              <button
                                type="button"
                                className="cart-qty-btn"
                                disabled={effectiveMax !== null && item.qty >= effectiveMax}
                                onClick={() => handleQtyChange(item.id, item.size, item.qty + 1)}
                                aria-label="Increase"
                              >+</button>
                            </div>
                            {effectiveMax !== null && item.qty >= effectiveMax && (
                              <span className="cart-qty-max-note">
                                Max available: {effectiveMax}
                              </span>
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          className="cart-remove-btn"
                          onClick={() => handleRemove(item.id, item.size)}
                        >Remove</button>
                      </div>

                      <div className="cart-row-sub">
                        <span className="cart-row-sub-amt">{formatPrice(item.subtotal)}</span>
                        {isOutOfStock && (
                          <span className="cart-row-sub-note cart-row-sub-note--oos">out of stock</span>
                        )}
                        {!isOutOfStock && !isSelected && (
                          <span className="cart-row-sub-note">not included</span>
                        )}
                      </div>

                    </li>
                  )
                })}
              </ul>

              {/* Out-of-stock global warning */}
              {selectedOutOfStock.length > 0 && (
                <div className="cart-oos-banner">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span>
                    {selectedOutOfStock.length === 1
                      ? `"${selectedOutOfStock[0].name}" is out of stock and has been deselected from checkout.`
                      : `${selectedOutOfStock.length} items are out of stock and cannot be checked out.`
                    }{' '}
                    Please remove out-of-stock items or wait for restocking.
                  </span>
                </div>
              )}
            </div>

            {/* ── Summary column ── */}
            <div className="cart-summary">
              <p className="cart-summary-title">Order Summary</p>

              {selectedItems.length === 0 ? (
                <p className="cart-summary-empty-note">No items selected</p>
              ) : (
                <div className="cart-summary-items">
                  {selectedItems.map(item => {
                    const avail = getAvailable(inventoryMap, item.id, item.size)
                    const oos   = avail !== null && avail === 0
                    return (
                      <div key={item.lineKey} className={`cart-summary-item${oos ? ' cart-summary-item--oos' : ''}`}>
                        <span className="cart-summary-item-name">
                          {item.name}{item.size ? ` (${item.size})` : ''} × {item.qty}
                          {oos && <span className="cart-summary-oos-tag"> · Out of stock</span>}
                        </span>
                        <span className="cart-summary-item-price">
                          {oos ? <s>{formatPrice(item.subtotal)}</s> : formatPrice(item.subtotal)}
                        </span>
                      </div>
                    )
                  })}
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

              <CartNote />

              {canCheckout ? (
                <Link href={checkoutHref} className="btn-checkout">
                  {content.checkout_label} {selectedKeys.size === cartItems.length ? '— All' : `(${selectedKeys.size})`} →
                </Link>
              ) : selectedItems.length > 0 ? (
                <>
                  <button disabled className="btn-checkout btn-checkout--blocked">
                    Cannot checkout — items out of stock
                  </button>
                  <p className="cart-checkout-blocked-note">
                    Remove or deselect out-of-stock items to continue.
                  </p>
                </>
              ) : (
                <button disabled className="btn-checkout">Select items to checkout</button>
              )}
              <Link href="/gowns" className="btn-continue">Continue Shopping</Link>
            </div>

          </div>
        )}
      </div>

      <style>{`
        .cart-stock-badge {
          display: inline-block;
          font-size: 10px;
          letter-spacing: .05em;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 20px;
          margin-bottom: 6px;
          font-family: 'Jost', sans-serif;
        }
        .cart-stock-badge--low {
          background: #FEF3C7;
          color: #92400E;
          border: 0.5px solid #FCD34D;
        }
        .cart-stock-badge--out {
          background: #FEE2E2;
          color: #991B1B;
          border: 0.5px solid #FCA5A5;
        }
        .cart-row--out-of-stock {
          opacity: 0.7;
        }
        .cart-img-oos-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: inherit;
        }
        .cart-img-oos-overlay span {
          color: #fff;
          font-size: 11px;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: .1em;
          font-family: 'Jost', sans-serif;
          line-height: 1.4;
        }
        .cart-row-img { position: relative; }
        .cart-oos-msg {
          font-size: 11px;
          color: #991B1B;
          background: #FEF2F2;
          border: 0.5px solid #FCA5A5;
          border-radius: 6px;
          padding: 7px 10px;
          margin: 6px 0;
          font-family: 'Jost', sans-serif;
        }
        .cart-qty-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
        .cart-qty-max-note {
          font-size: 10px;
          color: #92400E;
          margin-left: 6px;
          font-family: 'Jost', sans-serif;
        }
        .cart-oos-banner {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          background: #FEF2F2;
          border: 0.5px solid #FCA5A5;
          border-radius: 8px;
          padding: 12px 16px;
          margin-top: 16px;
          font-family: 'Jost', sans-serif;
          font-size: 12px;
          color: #7F1D1D;
          line-height: 1.6;
        }
        .cart-oos-banner svg { flex-shrink: 0; margin-top: 1px; color: #DC2626; }
        .cart-row-sub-note--oos {
          color: #DC2626 !important;
          font-weight: 500;
        }
        .cart-summary-item--oos .cart-summary-item-name { color: #9a8880; }
        .cart-summary-oos-tag { color: #DC2626; font-size: 10px; }
        .btn-checkout--blocked {
          background: #d4cbc7 !important;
          cursor: not-allowed !important;
          opacity: 1 !important;
        }
        .cart-checkout-blocked-note {
          font-size: 11px;
          color: #DC2626;
          text-align: center;
          margin-top: 6px;
          font-family: 'Jost', sans-serif;
        }
        .cart-stock-refreshing {
          font-size: 10px;
          color: #9a8880;
          font-family: 'Jost', sans-serif;
          letter-spacing: .05em;
          margin-left: auto;
          animation: pulse 1.2s ease-in-out infinite;
        }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        .cb-wrap--disabled { opacity: 0.4; cursor: not-allowed; }

        /* ADD AFTER that line, before the closing backtick: */
        .cart-size-change {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 6px 0 8px;
          flex-wrap: wrap;
        }
        .cart-size-change-label {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: .12em;
          text-transform: uppercase;
          color: #9a8880;
          flex-shrink: 0;
          font-family: 'Jost', sans-serif;
        }
        .cart-size-chips {
          display: flex;
          gap: 5px;
          flex-wrap: wrap;
        }
        .cart-size-chip {
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid #e8ddd6;
          background: #faf7f4;
          font-family: 'Jost', sans-serif;
          font-size: 11px;
          font-weight: 500;
          color: #2c2420;
          cursor: pointer;
          transition: border-color .15s, background .15s, color .15s;
          position: relative;
        }
        .cart-size-chip:hover:not(.cart-size-chip--on):not(.cart-size-chip--oos) {
          border-color: #2c2420;
          background: #f0ebe6;
        }
        .cart-size-chip--on {
          border-color: #2c2420;
          background: #2c2420;
          color: #faf7f4;
          cursor: default;
        }
        .cart-size-chip--oos {
          opacity: 0.35;
          cursor: not-allowed;
          text-decoration: line-through;
        }
        .cart-size-chip-stock {
          position: absolute;
          top: -5px;
          right: -5px;
          background: #c9a96e;
          color: #fff;
          font-size: 8px;
          font-weight: 700;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
          .cart-add-size {
          margin-top: 8px;
        }
        .cart-add-size-select {
          font-family: 'Jost', sans-serif;
          font-size: 11px;
          letter-spacing: .08em;
          color: #2c2420;
          border: 1px dashed #c9b8ae;
          background: transparent;
          border-radius: 6px;
          padding: 4px 10px;
          cursor: pointer;
          outline: none;
          transition: border-color .15s;
        }
        .cart-add-size-select:hover {
          border-color: #2c2420;
        }
      `}</style>

      <Footer />
    </main>
  )
}