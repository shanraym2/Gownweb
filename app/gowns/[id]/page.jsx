'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import Header from '../../components/Header'
import Footer from '../../components/Footer'
import { useGowns, getGownById } from '@/hooks/useGowns'
import ProductCard from '../../components/ProductCard'
import { addToCart, loadCart } from '../../utils/cartClient'
import { getCurrentUser } from '../../utils/authClient'

// ─── helpers ──────────────────────────────────────────────────────────────────

function isInCart(cart, id, size) {
  return cart.some(i => String(i.id) === String(id) && (i.size ?? null) === (size ?? null))
}

function countInCart(cart, id) {
  return cart.filter(i => String(i.id) === String(id)).reduce((s, i) => s + (i.qty || 1), 0)
}

function scoreGown(g, ref) {
  let s = 0
  if (ref.type       && g.type       === ref.type)       s += 3
  if (ref.color      && g.color      === ref.color)      s += 2
  if (ref.silhouette && g.silhouette === ref.silhouette) s += 2
  if (ref.category   && g.category   === ref.category)   s += 2
  return s
}

function stockLabel(stock) {
  if (stock === undefined || stock === null) return null
  if (stock === 0) return { text: 'Sold out', cls: 'out' }
  if (stock === 1) return { text: 'Last piece', cls: 'low' }
  if (stock <= 2)  return { text: `${stock} left`, cls: 'low' }
  return { text: `${stock} in stock`, cls: 'ok' }
}

// ─── Size Guide Modal ─────────────────────────────────────────────────────────

function SizeGuideModal({ onClose }) {
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const rows = [
    { size: 'XS',  bust: '32"', waist: '24"', hips: '35"', ph: '0–2'   },
    { size: 'S',   bust: '34"', waist: '26"', hips: '37"', ph: '4–6'   },
    { size: 'M',   bust: '36"', waist: '28"', hips: '39"', ph: '8–10'  },
    { size: 'L',   bust: '38"', waist: '30"', hips: '41"', ph: '12–14' },
    { size: 'XL',  bust: '40"', waist: '32"', hips: '43"', ph: '16–18' },
    { size: '2XL', bust: '42"', waist: '34"', hips: '45"', ph: '20–22' },
  ]

  return (
    <div className="sg-back" onClick={onClose} role="dialog" aria-modal aria-label="Size guide">
      <div className="sg-box" onClick={e => e.stopPropagation()}>
        <button className="sg-x" onClick={onClose} aria-label="Close">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <p className="sg-eye">Sizing Reference</p>
        <h2 className="sg-h">General Size Guide</h2>
        <p className="sg-desc">Measurements in inches. Each dress is sourced from a different supplier — available sizes vary per piece and are listed on each product.</p>
        <div className="sg-notice">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Between sizes? Alteration services are available — we recommend sizing up and having it tailored to your measurements.
        </div>
        <table className="sg-tbl">
          <thead>
            <tr>{['Size', 'Bust', 'Waist', 'Hips', 'PH Size'].map(h => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.size}>
                <td className="sg-sz">{r.size}</td>
                <td>{r.bust}</td>
                <td>{r.waist}</td>
                <td>{r.hips}</td>
                <td>{r.ph}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Link href="/fit-matcher" className="sg-fm" onClick={onClose}>
          Use FitMatcher for a personalised recommendation
        </Link>
      </div>
    </div>
  )
}

// ─── Auth Toast ───────────────────────────────────────────────────────────────

function AuthToast({ onClose }) {
  return (
    <div className="at-wrap" role="alert">
      <div className="at-box">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <div className="at-text">
          <p className="at-title">Account required</p>
          <p className="at-sub">Please log in to add items to your cart.</p>
        </div>
        <Link href="/login" className="at-login">Log in</Link>
        <button className="at-close" onClick={onClose} aria-label="Dismiss">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

// ─── Add to Cart Toast ────────────────────────────────────────────────────────

function AddedToast({ name, size, qty, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div className="at-wrap" role="status">
      <div className="at-box at-box--success">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 01-8 0"/>
        </svg>
        <div className="at-text">
          <p className="at-title">Added to cart</p>
          <p className="at-sub">{name} — Size {size} × {qty}</p>
        </div>
        <Link href="/cart" className="at-login">View cart</Link>
        <button className="at-close" onClick={onClose} aria-label="Dismiss">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GownDetailPage() {
  const params = useParams()
  const id = params?.id ?? null
  const { gowns, loading, error } = useGowns()
  const gown = id != null ? getGownById(gowns, id) : null

  const [cart,         setCart        ] = useState([])
  const [selectedSize, setSelectedSize] = useState(null)
  const [qty,          setQty         ] = useState(1)
  const [sizeErr,      setSizeErr     ] = useState(false)
  const [showGuide,    setShowGuide   ] = useState(false)
  const [showAuth,     setShowAuth    ] = useState(false)
  const [addedToast,   setAddedToast  ] = useState(null) // { name, size, qty }
  const [activeImg,    setActiveImg   ] = useState(0)

  // Sync cart state
  const refreshCart = () => setCart(loadCart())

  // Reset state when navigating to a different gown
  useEffect(() => {
    if (id == null) return
    setSelectedSize(null)
    setQty(1)
    setSizeErr(false)
    refreshCart()
    try {
      const rv = JSON.parse(localStorage.getItem('jce_recently_viewed') || '[]')
      const s  = String(id)
      if (!rv.includes(s))
        localStorage.setItem('jce_recently_viewed', JSON.stringify([s, ...rv].slice(0, 20)))
    } catch {}
  }, [id])

  // Re-check cart whenever size changes
  useEffect(() => {
    refreshCart()
  }, [selectedSize])

  const thisInCart   = isInCart(cart, id, selectedSize)
  const totalInCart  = countInCart(cart, id)

  const handleAdd = () => {
    if (!getCurrentUser()) { setShowAuth(true); return }
    if (!selectedSize)     { setSizeErr(true);  return }
    const sizeObj = gown?.sizeStock?.find(s => s.size === selectedSize)
    if (sizeObj && sizeObj.stock === 0) { setSizeErr(true); return }
    addToCart(gown.id, qty, { size: selectedSize })
    refreshCart()
    setAddedToast({ name: gown.name, size: selectedSize, qty })
    // Reset qty to 1 after adding, keep size selected
    setQty(1)
  }

  // ── untouched recommender logic ────────────────────────────────────────────
  const recs = gown
    ? [...gowns]
        .filter(g => String(g.id) !== String(gown.id))
        .map(g    => ({ ...g, _s: scoreGown(g, gown) }))
        .sort((a, b) => b._s - a._s)
        .slice(0, 3)
    : []

  const images    = gown ? [gown.image, ...(gown.images || [])].filter(Boolean) : []
  const specs     = gown ? [
    { key: 'Category',   val: gown.category  || gown.type       },
    { key: 'Silhouette', val: gown.silhouette                    },
    { key: 'Color',      val: gown.color                         },
    { key: 'Style',      val: gown.styleName || gown.style?.name },
    { key: 'Fabric',     val: gown.fabric                        },
    { key: 'Occasion',   val: gown.occasion                      },
  ].filter(s => s.val) : []

  const sizeStock  = gown?.sizeStock?.length
    ? gown.sizeStock
    : (gown?.sizes || []).map(s => ({ size: s, stock: null }))
  const allSoldOut = sizeStock.length > 0 && sizeStock.every(s => s.stock === 0)

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <main className="dp">
      <Header />
      <div className="dp-spacer" />
      <div className="dp-sk">
        <div className="dp-sk-img" />
        <div className="dp-sk-body">
          {[240, 80, 320, 200, 140].map((w, i) => (
            <div key={i} className="dp-sk-line" style={{ width: w, height: i === 0 ? 44 : 12, animationDelay: `${i * 0.08}s` }} />
          ))}
        </div>
      </div>
      <Footer />
    </main>
  )

  // ── 404 ───────────────────────────────────────────────────────────────────
  if (error || !gown) return (
    <main className="dp">
      <Header />
      <div className="dp-spacer" />
      <div className="dp-404">
        <p className="dp-404-n">404</p>
        <h1 className="dp-404-h">Gown not found</h1>
        <p className="dp-404-s">{error || 'This piece may no longer be available.'}</p>
        <Link href="/gowns" className="dp-404-btn">Back to collection</Link>
      </div>
      <Footer />
    </main>
  )

  return (
    <main className="dp">

      {showAuth    && <AuthToast onClose={() => setShowAuth(false)} />}
      {addedToast  && <AddedToast {...addedToast} onClose={() => setAddedToast(null)} />}
      {showGuide   && <SizeGuideModal onClose={() => setShowGuide(false)} />}

      <Header solid />
      <div className="dp-spacer" />

      <nav className="dp-bc container">
        <Link href="/">Home</Link>
        <span>/</span>
        <Link href="/gowns">Collection</Link>
        <span>/</span>
        <span>{gown.name}</span>
      </nav>

      <div className="dp-layout">

        {/* ── Image column ── */}
        <div className="dp-img-col">
          <div className="dp-img-main">
            <img
              src={images[activeImg] || gown.image}
              alt={gown.alt || gown.name}
              className="dp-img-main-img"
            />
            {(gown.category || gown.type) && (
              <span className="dp-img-cat">{gown.category || gown.type}</span>
            )}
            {/* Cart badge on image */}
            {totalInCart > 0 && (
              <Link href="/cart" className="dp-cart-badge" aria-label={`${totalInCart} in cart`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 01-8 0"/>
                </svg>
                {totalInCart} in cart
              </Link>
            )}
          </div>

          {images.length > 1 && (
            <div className="dp-thumbs">
              {images.map((src, i) => (
                <button
                  key={i}
                  className={`dp-thumb${i === activeImg ? ' dp-thumb--on' : ''}`}
                  onClick={() => setActiveImg(i)}
                  aria-label={`View image ${i + 1}`}
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          )}

          <div className="dp-tryon">
            <div className="dp-tryon-left">
              <span className="dp-tryon-eye">Virtual Try-On</span>
              <p className="dp-tryon-txt">See how this dress looks on your body type before you visit.</p>
            </div>
            <Link href={`/virtual-try-on?gown=${gown.id}`} className="dp-tryon-btn">
              Try it on →
            </Link>
          </div>
        </div>

        {/* ── Info column ── */}
        <div className="dp-info-col">

          <div className="dp-info-head">
            <p className="dp-overline">{gown.category || gown.type || 'Bridal Collection'}</p>
            <h1 className="dp-name">{gown.name}</h1>
            <p className="dp-price">{gown.price}</p>
          </div>

          {gown.description && (
            <div className="dp-section">
              <p className="dp-desc">{gown.description}</p>
            </div>
          )}

          {specs.length > 0 && (
            <div className="dp-section">
              <p className="dp-sec-title">Details</p>
              <div className="dp-specs">
                {specs.map(({ key, val }) => (
                  <div key={key} className="dp-spec">
                    <span className="dp-spec-k">{key}</span>
                    <span className="dp-spec-v">{val}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Size & Stock selector ── */}
          <div className="dp-section" id="sizes">
            <div className="dp-size-hd">
              <p className="dp-sec-title">Available Sizes</p>
              <button className="dp-size-guide-btn" onClick={() => setShowGuide(true)} type="button">
                Size guide ↗
              </button>
            </div>

            {sizeStock.length > 0 ? (
              <>
                <div className="dp-sizes">
                  {sizeStock.map(({ size, stock }) => {
                    const lbl     = stockLabel(stock)
                    const soldOut = stock === 0
                    const inCart  = isInCart(cart, id, size)
                    return (
                      <button
                        key={size}
                        type="button"
                        disabled={soldOut}
                        className={[
                          'dp-size-btn',
                          selectedSize === size ? 'dp-size-btn--on' : '',
                          soldOut ? 'dp-size-btn--out' : '',
                          inCart  ? 'dp-size-btn--incart' : '',
                        ].join(' ')}
                        onClick={() => { if (!soldOut) { setSelectedSize(size); setSizeErr(false) } }}
                      >
                        <span className="dp-size-label">{size}</span>
                        {inCart && !soldOut && (
                          <span className="dp-size-incart-dot" title="In your cart">
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                            </svg>
                          </span>
                        )}
                        {lbl && (
                          <span className={`dp-size-stock dp-size-stock--${lbl.cls}`}>
                            {lbl.text}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* Cart indicator for selected size */}
                {selectedSize && thisInCart && (
                  <p className="dp-size-incart-note">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                      <line x1="3" y1="6" x2="21" y2="6"/>
                      <path d="M16 10a4 4 0 01-8 0"/>
                    </svg>
                    Size {selectedSize} is already in your cart —{' '}
                    <Link href="/cart" className="dp-size-incart-link">view cart</Link>
                    {' '}or add more below.
                  </p>
                )}

                {sizeErr && (
                  <p className="dp-size-err">
                    {sizeStock.find(s => s.size === selectedSize)?.stock === 0
                      ? 'This size is sold out.'
                      : 'Please select a size to continue.'}
                  </p>
                )}

                <div className="dp-alteration-note">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>
                  </svg>
                  <span>Alteration services available — between sizes? Size up and we'll tailor it to fit you perfectly.</span>
                </div>
              </>
            ) : (
              <p className="dp-no-sizes">Contact us to confirm available sizes for this piece.</p>
            )}
          </div>

          {/* ── FitMatcher ── */}
          <div className="dp-section">
            <div className="dp-fm">
              <div className="dp-fm-content">
                <p className="dp-fm-eye">FitMatcher AI</p>
                <p className="dp-fm-title">Not sure which size to pick?</p>
                <p className="dp-fm-desc">
                  Enter your measurements and our AI will match you to the best available size for this dress — and suggest alterations if needed.
                </p>
                <Link href={`/fit-matcher?gown=${gown.id}`} className="dp-fm-btn">
                  Get my size recommendation →
                </Link>
              </div>
            </div>
          </div>

          {/* ── Actions ── */}
          <div className="dp-section dp-actions">
            {allSoldOut ? (
              <>
                <div className="dp-soldout-banner">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                  </svg>
                  All sizes are currently sold out
                </div>
                <Link href="/contact" className="dp-btn-inquire">
                  Inquire for restock or custom order
                </Link>
              </>
            ) : (
              <>
                {/* Quantity + Add to Cart row */}
                <div className="dp-add-row">
                  {/* Qty stepper */}
                  <div className="dp-qty">
                    <button
                      type="button"
                      className="dp-qty-btn"
                      onClick={() => setQty(q => Math.max(1, q - 1))}
                      aria-label="Decrease quantity"
                    >−</button>
                    <span className="dp-qty-val">{qty}</span>
                    <button
                      type="button"
                      className="dp-qty-btn"
                      onClick={() => setQty(q => q + 1)}
                      aria-label="Increase quantity"
                    >+</button>
                  </div>

                  {/* Add to cart button with icon */}
                  <button
                    className="dp-btn-add"
                    onClick={handleAdd}
                    type="button"
                    aria-label="Add to cart"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                      <line x1="3" y1="6" x2="21" y2="6"/>
                      <path d="M16 10a4 4 0 01-8 0"/>
                    </svg>
                    {thisInCart ? 'Add more to cart' : 'Add to cart'}
                  </button>

                  {/* Quick cart link if anything in cart */}
                  {totalInCart > 0 && (
                    <Link href="/cart" className="dp-btn-cart-icon" aria-label="View cart">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                        <line x1="3" y1="6" x2="21" y2="6"/>
                        <path d="M16 10a4 4 0 01-8 0"/>
                      </svg>
                      <span className="dp-btn-cart-count">{totalInCart}</span>
                    </Link>
                  )}
                </div>

                <Link href="/contact" className="dp-btn-inquire">
                  Inquire About This Piece
                </Link>
              </>
            )}
          </div>

          <p className="dp-footnote">
            This is a ready-to-wear piece. Each dress has limited stock — sizes vary by supplier.
            Custom orders and alteration services are available upon inquiry.
          </p>

        </div>
      </div>

      {recs.length > 0 && (
        <section className="dp-recs">
          <div className="container">
            <div className="dp-recs-hd">
              <span className="dp-recs-eye">Curated for you</span>
              <h2 className="dp-recs-h">You may also love</h2>
            </div>
            <div className="dp-recs-grid">
              {recs.map((g, i) => <ProductCard key={g.id} product={g} delay={i * 0.1} />)}
            </div>
          </div>
        </section>
      )}

      <Footer />
    </main>
  )
}