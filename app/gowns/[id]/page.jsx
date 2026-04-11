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

// ─── helpers ─────────────────────────────────────────────────────────────────

function isInCart(cart, id) {
  return cart.some(i => i.id === id)
}

function scoreGown(g, ref) {
  let s = 0
  if (ref.type       && g.type       === ref.type)       s += 3
  if (ref.color      && g.color      === ref.color)      s += 2
  if (ref.silhouette && g.silhouette === ref.silhouette) s += 2
  if (ref.category   && g.category   === ref.category)   s += 2
  return s
}

// Stock label helper — each size has limited units (often ≤4 total across all sizes)
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GownDetailPage() {
  const params = useParams()
  const id = params?.id ?? null
  const { gowns, loading, error } = useGowns()
  const gown = id != null ? getGownById(gowns, id) : null

  const [added,        setAdded]        = useState(false)
  const [selectedSize, setSelectedSize] = useState(null)
  const [sizeErr,      setSizeErr]      = useState(false)
  const [showGuide,    setShowGuide]    = useState(false)
  const [showAuth,     setShowAuth]     = useState(false)
  const [activeImg,    setActiveImg]    = useState(0)

  useEffect(() => {
    if (id == null) return
    setAdded(isInCart(loadCart(), id))
    try {
      const rv = JSON.parse(localStorage.getItem('jce_recently_viewed') || '[]')
      const s  = String(id)
      if (!rv.includes(s))
        localStorage.setItem('jce_recently_viewed', JSON.stringify([s, ...rv].slice(0, 20)))
    } catch {}
  }, [id])

  useEffect(() => { setSelectedSize(null); setSizeErr(false) }, [id])

  const handleAdd = () => {
    if (!getCurrentUser()) { setShowAuth(true); return }
    if (!selectedSize)     { setSizeErr(true);  return }
    // Check stock for chosen size
    const sizeObj = gown?.sizeStock?.find(s => s.size === selectedSize)
    if (sizeObj && sizeObj.stock === 0) { setSizeErr(true); return }
    addToCart(gown.id, 1, { size: selectedSize })
    setAdded(true)
    setSizeErr(false)
  }

  const recs = gown
    ? [...gowns]
        .filter(g => Number(g.id) !== Number(gown.id))
        .map(g    => ({ ...g, _s: scoreGown(g, gown) }))
        .sort((a, b) => b._s - a._s)
        .slice(0, 3)
    : []

  const images = gown ? [gown.image, ...(gown.images || [])].filter(Boolean) : []

  const specs = gown ? [
    { key: 'Category',   val: gown.category  || gown.type        },
    { key: 'Silhouette', val: gown.silhouette                     },
    { key: 'Color',      val: gown.color                          },
    { key: 'Style',      val: gown.styleName || gown.style?.name  },
    { key: 'Fabric',     val: gown.fabric                         },
    { key: 'Occasion',   val: gown.occasion                       },
  ].filter(s => s.val) : []

  // Sizes come from gown.sizeStock (array of {size, stock}) or gown.sizes (plain array)
  // sizeStock is preferred — gives us per-size availability
  const sizeStock = gown?.sizeStock || (gown?.sizes || []).map(s => ({ size: s, stock: null }))
  const hasAnyStock = sizeStock.some(s => s.stock === null || s.stock > 0)

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) return (
    <main className="dp">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
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

  // ── 404 ──────────────────────────────────────────────────────────────────
  if (error || !gown) return (
    <main className="dp">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
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
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {showAuth  && <AuthToast onClose={() => setShowAuth(false)} />}
      {showGuide && <SizeGuideModal onClose={() => setShowGuide(false)} />}

      <Header solid />
      <div className="dp-spacer" />

      {/* Breadcrumb */}
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
            <Link href={`/try-on?gown=${gown.id}`} className="dp-tryon-btn">
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
          <div className="dp-section">
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
                    return (
                      <button
                        key={size}
                        type="button"
                        disabled={soldOut}
                        className={[
                          'dp-size-btn',
                          selectedSize === size ? 'dp-size-btn--on' : '',
                          soldOut ? 'dp-size-btn--out' : '',
                        ].join(' ')}
                        onClick={() => { if (!soldOut) { setSelectedSize(size); setSizeErr(false) } }}
                      >
                        <span className="dp-size-label">{size}</span>
                        {lbl && (
                          <span className={`dp-size-stock dp-size-stock--${lbl.cls}`}>
                            {lbl.text}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>

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
            {!hasAnyStock ? (
              <>
                <div className="dp-soldout-banner">All sizes are currently sold out.</div>
                <Link href="/contact" className="dp-btn-inquire">
                  Inquire for restock or custom order
                </Link>
              </>
            ) : added ? (
              <Link href="/cart" className="dp-btn-add dp-btn-add--done">
                ✓ Added to Cart — View Cart
              </Link>
            ) : (
              <button className="dp-btn-add" onClick={handleAdd} type="button">
                Add to Cart
              </button>
            )}
            {hasAnyStock && (
              <Link href="/contact" className="dp-btn-inquire">
                Inquire About This Piece
              </Link>
            )}
          </div>

          {/* ── Footer note ── */}
          <p className="dp-footnote">
            This is a ready-to-wear piece. Each dress has limited stock — sizes vary by supplier.
            Custom orders and alteration services are available upon inquiry.
          </p>

        </div>
      </div>

      {/* Recommendations */}
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

// ─── CSS (inside module scope to avoid hydration mismatch) ────────────────────

const CSS = [
  "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Jost:wght@200;300;400&display=swap');",
  `.dp{--iv:#faf7f4;--ch:#f0e6d3;--bl:#d4a5a0;--es:#2c1a10;--wb:#6b3f2a;--mu:#9b8880;--go:#c9a96e;--ro:#c0816e;background:var(--iv);font-family:'Jost',sans-serif;color:var(--es);}`,
  `.dp-spacer{height:80px;}`,

  /* Breadcrumb */
  `.dp-bc{padding:18px 0;display:flex;gap:10px;font-size:10.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--mu);}`,
  `.dp-bc a{color:var(--mu);text-decoration:none;transition:color .2s;}`,
  `.dp-bc a:hover{color:var(--wb);}`,
  `.dp-bc span:last-child{color:var(--es);}`,

  /* Layout */
  `.dp-layout{display:grid;grid-template-columns:1fr 1fr;gap:0;max-width:1320px;margin:0 auto;}`,

  /* Image column */
  `.dp-img-col{position:sticky;top:80px;height:calc(100vh - 80px);display:flex;flex-direction:column;background:var(--ch);overflow:hidden;}`,
  `.dp-img-main{position:relative;flex:1;overflow:hidden;}`,
  `.dp-img-main-img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block;transition:transform .9s cubic-bezier(.25,.46,.45,.94);}`,
  `.dp-img-col:hover .dp-img-main-img{transform:scale(1.04);}`,
  `.dp-img-cat{position:absolute;top:20px;left:20px;background:rgba(250,247,244,.93);backdrop-filter:blur(6px);font-size:8px;letter-spacing:.35em;text-transform:uppercase;color:var(--wb);padding:5px 12px;}`,

  /* Thumbs */
  `.dp-thumbs{display:flex;gap:2px;padding:2px;background:var(--es);flex-shrink:0;}`,
  `.dp-thumb{width:60px;height:72px;padding:0;border:2px solid transparent;background:none;cursor:pointer;overflow:hidden;flex-shrink:0;transition:border-color .2s;}`,
  `.dp-thumb--on{border-color:var(--go);}`,
  `.dp-thumb img{width:100%;height:100%;object-fit:cover;object-position:top;}`,

  /* Try-on strip */
  `.dp-tryon{display:flex;align-items:center;justify-content:space-between;gap:16px;background:var(--es);padding:14px 20px;flex-shrink:0;}`,
  `.dp-tryon-left{flex:1;}`,
  `.dp-tryon-eye{font-size:8px;letter-spacing:.35em;text-transform:uppercase;color:var(--go);display:block;margin-bottom:3px;}`,
  `.dp-tryon-txt{font-size:11px;font-weight:300;color:rgba(250,247,244,.5);margin:0;}`,
  `.dp-tryon-btn{flex-shrink:0;background:var(--go);color:var(--es);font-family:'Jost',sans-serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;padding:9px 18px;text-decoration:none;transition:opacity .2s;white-space:nowrap;}`,
  `.dp-tryon-btn:hover{opacity:.85;}`,

  /* Info column */
  `.dp-info-col{padding:0;overflow-y:auto;scrollbar-width:none;max-height:calc(100vh - 80px);position:sticky;top:80px;}`,
  `.dp-info-col::-webkit-scrollbar{display:none;}`,
  `.dp-info-head{padding:40px 48px 28px;border-bottom:1px solid var(--ch);background:var(--iv);}`,
  `.dp-overline{font-size:8.5px;letter-spacing:.4em;text-transform:uppercase;color:var(--bl);margin:0 0 12px;}`,
  `.dp-name{font-family:'Cormorant Garamond',serif;font-size:clamp(2rem,3.5vw,3rem);font-weight:300;line-height:1.05;color:var(--es);margin:0 0 12px;}`,
  `.dp-price{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:400;color:var(--wb);margin:0;letter-spacing:.02em;}`,

  /* Sections */
  `.dp-section{padding:24px 48px;border-bottom:1px solid var(--ch);}`,
  `.dp-sec-title{font-size:9px;letter-spacing:.35em;text-transform:uppercase;color:var(--mu);margin:0 0 14px;}`,
  `.dp-desc{font-size:13.5px;font-weight:300;line-height:1.9;color:var(--mu);margin:0;}`,

  /* Specs */
  `.dp-specs{display:flex;flex-direction:column;}`,
  `.dp-spec{display:flex;align-items:baseline;padding:10px 0;border-bottom:1px solid rgba(240,230,211,.6);}`,
  `.dp-spec:last-child{border-bottom:none;}`,
  `.dp-spec-k{width:100px;flex-shrink:0;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--mu);}`,
  `.dp-spec-v{font-family:'Cormorant Garamond',serif;font-size:17px;color:var(--es);font-weight:300;}`,

  /* Size selector */
  `.dp-size-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}`,
  `.dp-size-guide-btn{background:none;border:none;font-family:'Jost',sans-serif;font-size:11px;color:var(--wb);cursor:pointer;padding:0;letter-spacing:.06em;text-decoration:underline;text-underline-offset:3px;transition:color .2s;}`,
  `.dp-size-guide-btn:hover{color:var(--es);}`,
  `.dp-sizes{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;}`,
  `.dp-size-btn{display:flex;flex-direction:column;align-items:center;gap:3px;font-family:'Jost',sans-serif;padding:10px 14px;border:1px solid rgba(44,26,16,.18);background:transparent;cursor:pointer;transition:all .2s;min-width:58px;}`,
  `.dp-size-btn:hover:not(:disabled){border-color:var(--wb);}`,
  `.dp-size-btn--on{background:var(--es);border-color:var(--es);}`,
  `.dp-size-btn--on .dp-size-label{color:var(--iv);}`,
  `.dp-size-btn--out{opacity:.45;cursor:not-allowed;text-decoration:line-through;}`,
  `.dp-size-label{font-size:12px;letter-spacing:.08em;color:var(--es);font-weight:400;}`,
  `.dp-size-stock{font-size:8.5px;letter-spacing:.05em;white-space:nowrap;}`,
  `.dp-size-stock--ok{color:var(--mu);}`,
  `.dp-size-stock--low{color:#c0692b;}`,
  `.dp-size-stock--out{color:rgba(44,26,16,.35);}`,
  `.dp-size-btn--on .dp-size-stock{color:rgba(250,247,244,.6);}`,
  `.dp-size-err{font-size:11px;color:var(--ro);margin-top:2px;}`,
  `.dp-no-sizes{font-size:12px;color:var(--mu);font-style:italic;}`,

  /* Alteration note */
  `.dp-alteration-note{display:flex;align-items:flex-start;gap:8px;margin-top:4px;font-size:11px;font-weight:300;color:var(--mu);line-height:1.6;}`,
  `.dp-alteration-note svg{flex-shrink:0;margin-top:2px;color:var(--bl);}`,

  /* FitMatcher */
  `.dp-fm{background:linear-gradient(135deg,#fdf9f5 0%,#f5e8db 100%);border:1px solid var(--ch);padding:22px 24px;position:relative;overflow:hidden;}`,
  `.dp-fm::after{content:'';position:absolute;bottom:-20px;right:-20px;width:100px;height:100px;border-radius:50%;background:radial-gradient(circle,rgba(201,169,110,.18) 0%,transparent 70%);pointer-events:none;}`,
  `.dp-fm-content{position:relative;z-index:1;}`,
  `.dp-fm-eye{font-size:8px;letter-spacing:.4em;text-transform:uppercase;color:var(--go);margin:0 0 5px;}`,
  `.dp-fm-title{font-family:'Cormorant Garamond',serif;font-size:19px;font-weight:400;color:var(--es);margin:0 0 5px;}`,
  `.dp-fm-desc{font-size:12px;font-weight:300;color:var(--mu);margin:0 0 14px;line-height:1.65;}`,
  `.dp-fm-btn{display:inline-block;background:var(--es);color:var(--iv);font-family:'Jost',sans-serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;padding:9px 20px;text-decoration:none;transition:background .2s;}`,
  `.dp-fm-btn:hover{background:var(--wb);}`,

  /* Actions */
  `.dp-actions{display:flex;flex-direction:column;gap:10px;}`,
  `.dp-soldout-banner{background:var(--ch);padding:12px 16px;font-size:12px;letter-spacing:.1em;color:var(--mu);text-align:center;border:1px solid rgba(44,26,16,.08);}`,
  `.dp-btn-add{display:block;width:100%;padding:16px 24px;background:var(--es);color:var(--iv);font-family:'Jost',sans-serif;font-size:10px;letter-spacing:.35em;text-transform:uppercase;text-align:center;text-decoration:none;border:none;cursor:pointer;transition:background .2s,transform .15s;box-sizing:border-box;}`,
  `.dp-btn-add:hover{background:var(--wb);transform:translateY(-1px);}`,
  `.dp-btn-add--done{background:var(--wb);}`,
  `.dp-btn-inquire{display:block;width:100%;padding:14px 24px;background:transparent;color:var(--es);font-family:'Jost',sans-serif;font-size:10px;letter-spacing:.35em;text-transform:uppercase;text-align:center;text-decoration:none;border:1px solid var(--ch);cursor:pointer;transition:border-color .2s,color .2s;box-sizing:border-box;}`,
  `.dp-btn-inquire:hover{border-color:var(--bl);color:var(--wb);}`,
  `.dp-footnote{padding:20px 48px 40px;font-size:11px;font-weight:300;color:var(--mu);line-height:1.75;letter-spacing:.03em;}`,

  /* Auth toast */
  `.at-wrap{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);z-index:300;width:min(500px,92vw);animation:atIn .35s cubic-bezier(.34,1.56,.64,1);}`,
  `@keyframes atIn{from{opacity:0;transform:translateX(-50%) translateY(18px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`,
  `.at-box{background:var(--es);padding:16px 20px;display:flex;align-items:center;gap:14px;}`,
  `.at-box svg{color:var(--go);flex-shrink:0;}`,
  `.at-text{flex:1;}`,
  `.at-title{font-size:12px;letter-spacing:.08em;color:var(--iv);margin:0 0 2px;}`,
  `.at-sub{font-size:11px;color:rgba(250,247,244,.5);margin:0;}`,
  `.at-login{background:var(--go);color:var(--es);font-family:'Jost',sans-serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;padding:8px 16px;text-decoration:none;flex-shrink:0;transition:opacity .2s;}`,
  `.at-login:hover{opacity:.85;}`,
  `.at-close{background:none;border:none;color:rgba(250,247,244,.4);cursor:pointer;padding:4px;display:flex;flex-shrink:0;}`,
  `.at-close:hover{color:var(--iv);}`,

  /* Size guide modal */
  `.sg-back{position:fixed;inset:0;background:rgba(44,26,16,.6);backdrop-filter:blur(5px);z-index:400;display:flex;align-items:center;justify-content:center;padding:1.5rem;animation:sgFade .2s ease;}`,
  `@keyframes sgFade{from{opacity:0}to{opacity:1}}`,
  `.sg-box{background:var(--iv);width:100%;max-width:580px;padding:2.5rem;position:relative;max-height:90vh;overflow-y:auto;animation:sgUp .28s ease;}`,
  `@keyframes sgUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}`,
  `.sg-x{position:absolute;top:1.2rem;right:1.2rem;background:none;border:none;cursor:pointer;color:rgba(44,26,16,.35);padding:.3rem;}`,
  `.sg-x:hover{color:var(--es);}`,
  `.sg-eye{display:block;font-size:8px;letter-spacing:.4em;text-transform:uppercase;color:var(--bl);margin-bottom:6px;}`,
  `.sg-h{font-family:'Cormorant Garamond',serif;font-weight:300;font-size:2rem;color:var(--es);margin:0 0 6px;}`,
  `.sg-desc{font-size:12px;color:var(--mu);margin:0 0 16px;line-height:1.6;}`,
  `.sg-notice{display:flex;align-items:flex-start;gap:8px;background:var(--ch);padding:12px 14px;margin-bottom:20px;font-size:12px;color:var(--wb);line-height:1.55;}`,
  `.sg-notice svg{flex-shrink:0;margin-top:1px;}`,
  `.sg-tbl{width:100%;border-collapse:collapse;font-size:13px;}`,
  `.sg-tbl th{background:var(--es);color:var(--iv);font-family:'Jost',sans-serif;font-size:8.5px;letter-spacing:.25em;text-transform:uppercase;padding:10px 14px;text-align:left;font-weight:400;}`,
  `.sg-tbl td{padding:10px 14px;border-bottom:1px solid var(--ch);color:var(--es);}`,
  `.sg-tbl tr:last-child td{border-bottom:none;}`,
  `.sg-sz{font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:400;}`,
  `.sg-fm{display:inline-flex;align-items:center;gap:8px;margin-top:20px;background:var(--es);color:var(--iv);font-family:'Jost',sans-serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;padding:10px 20px;text-decoration:none;transition:background .2s;}`,
  `.sg-fm:hover{background:var(--wb);}`,

  /* Recommendations */
  `.dp-recs{padding:72px 0;border-top:1px solid var(--ch);}`,
  `.dp-recs-hd{display:flex;align-items:baseline;gap:18px;margin-bottom:36px;}`,
  `.dp-recs-eye{font-size:9px;letter-spacing:.4em;text-transform:uppercase;color:var(--bl);}`,
  `.dp-recs-h{font-family:'Cormorant Garamond',serif;font-size:2.2rem;font-weight:300;color:var(--es);margin:0;}`,
  `.dp-recs-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;}`,

  /* Skeleton / 404 */
  `.dp-sk{display:grid;grid-template-columns:1fr 1fr;min-height:80vh;}`,
  `.dp-sk-img{background:var(--ch);animation:sk 1.5s ease-in-out infinite alternate;}`,
  `.dp-sk-body{padding:48px;display:flex;flex-direction:column;gap:20px;}`,
  `.dp-sk-line{background:var(--ch);border-radius:2px;animation:sk 1.5s ease-in-out infinite alternate;}`,
  `@keyframes sk{from{opacity:.4}to{opacity:1}}`,
  `.dp-404{min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:80px 24px;}`,
  `.dp-404-n{font-family:'Cormorant Garamond',serif;font-size:110px;font-weight:300;color:var(--ch);line-height:1;margin:0 0 8px;}`,
  `.dp-404-h{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:400;color:var(--es);margin:0 0 10px;}`,
  `.dp-404-s{font-size:13px;color:var(--mu);margin:0 0 28px;}`,
  `.dp-404-btn{display:inline-block;padding:12px 32px;background:var(--es);color:var(--iv);font-family:'Jost',sans-serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;text-decoration:none;transition:background .2s;}`,
  `.dp-404-btn:hover{background:var(--wb);}`,

  /* Responsive */
  `@media(max-width:900px){.dp-layout{grid-template-columns:1fr;}.dp-img-col{position:static;height:auto;max-height:none;}.dp-img-main{height:68vw;max-height:520px;}.dp-info-col{position:static;max-height:none;}.dp-info-head,.dp-section,.dp-footnote{padding-left:24px;padding-right:24px;}.dp-recs-grid{grid-template-columns:repeat(2,1fr);}}`,
  `@media(max-width:480px){.dp-recs-grid{grid-template-columns:1fr;}.dp-name{font-size:2rem;}.dp-info-head{padding:28px 20px 20px;}.dp-section,.dp-footnote{padding-left:20px;padding-right:20px;}}`,
].join('\n')