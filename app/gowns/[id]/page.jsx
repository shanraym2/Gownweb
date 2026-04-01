'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import Header from '../../components/Header'
import Footer from '../../components/Footer'
import { useGowns, getGownById } from '@/hooks/useGowns'
import ProductCard from '../../components/ProductCard'
import { addToCart, loadCart } from '../../utils/cartClient'

function isInCart(cart, gownId) {
  return cart.some((item) => item.id === gownId)
}

export default function GownDetailPage() {
  const params = useParams()
  const id = params?.id ? Number(params.id) : null
  const { gowns, loading, error } = useGowns()
  const gown = id != null ? getGownById(gowns, id) : null
  const [added, setAdded] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || id == null) return
    const cart = loadCart()
    setAdded(isInCart(cart, id))
  }, [id])

  const sharedStyles = `
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Jost:wght@300;400;500&display=swap');

    .detail-page {
      --ivory: #faf7f4;
      --champagne: #f0e6d3;
      --blush: #d4a5a0;
      --espresso: #2c1a10;
      --warm-brown: #6b3f2a;
      --muted: #9b8880;
      background: var(--ivory);
      font-family: 'Jost', sans-serif;
      color: var(--espresso);
    }
  `

  if (loading) {
    return (
      <main className="detail-page gowns-page">
        <style>{sharedStyles + `
          .detail-skeleton {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2px;
            min-height: 80vh;
          }
          .detail-skeleton-img {
            background: #f0e6d3;
            animation: sk-pulse 1.5s ease-in-out infinite alternate;
          }
          .detail-skeleton-info {
            padding: 48px;
            display: flex;
            flex-direction: column;
            gap: 20px;
          }
          .detail-skeleton-line {
            background: #f0e6d3;
            border-radius: 2px;
            animation: sk-pulse 1.5s ease-in-out infinite alternate;
          }
          @keyframes sk-pulse { from { opacity: 0.4; } to { opacity: 1; } }
        `}</style>
        <Header />
        <section className="gowns-header-spacer" />
        <div className="detail-skeleton">
          <div className="detail-skeleton-img" />
          <div className="detail-skeleton-info">
            {[200, 80, 320, 240, 120].map((w, i) => (
              <div
                key={i}
                className="detail-skeleton-line"
                style={{
                  height: i === 0 ? 48 : i === 1 ? 20 : 14,
                  width: `${w}px`,
                  maxWidth: '100%',
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
        </div>
        <Footer />
      </main>
    )
  }

  if (error || gown == null) {
    return (
      <main className="detail-page gowns-page">
        <style>{sharedStyles + `
          .detail-not-found {
            min-height: 60vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 80px 24px;
          }
          .not-found-num {
            font-family: 'Cormorant Garamond', serif;
            font-size: 120px;
            font-weight: 300;
            color: #f0e6d3;
            line-height: 1;
            margin: 0 0 8px;
          }
          .not-found-title {
            font-family: 'Cormorant Garamond', serif;
            font-size: 32px;
            font-weight: 400;
            color: #2c1a10;
            margin: 0 0 12px;
          }
          .not-found-sub {
            font-size: 13px;
            color: #9b8880;
            margin: 0 0 32px;
            letter-spacing: 0.04em;
          }
          .not-found-btn {
            display: inline-block;
            padding: 12px 32px;
            background: #2c1a10;
            color: #faf7f4;
            font-family: 'Jost', sans-serif;
            font-size: 10px;
            letter-spacing: 0.3em;
            text-transform: uppercase;
            text-decoration: none;
            transition: background 0.2s;
          }
          .not-found-btn:hover { background: #6b3f2a; }
        `}</style>
        <Header />
        <section className="gowns-header-spacer" />
        <div className="detail-not-found">
          <p className="not-found-num">404</p>
          <h1 className="not-found-title">Gown not found</h1>
          <p className="not-found-sub">{error || 'This piece may no longer be available.'}</p>
          <Link href="/gowns" className="not-found-btn">
            Back to collection
          </Link>
        </div>
        <Footer />
      </main>
    )
  }

  const others = gowns.filter((g) => Number(g.id) !== Number(gown.id)).slice(0, 3)

  return (
    <main className="detail-page gowns-page">
      <style>{sharedStyles + `
        /* ── Breadcrumb ── */
        .detail-breadcrumb {
          padding: 20px 0 0;
        }
        .detail-breadcrumb-inner {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .detail-breadcrumb-inner a {
          color: var(--muted);
          text-decoration: none;
          transition: color 0.2s;
        }
        .detail-breadcrumb-inner a:hover { color: var(--warm-brown); }
        .detail-breadcrumb-inner span { color: var(--blush); }
        .detail-breadcrumb-inner strong {
          color: var(--espresso);
          font-weight: 400;
        }

        /* ── Main split layout ── */
        .detail-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
          min-height: 80vh;
          margin-top: 24px;
        }

        /* ── Image side ── */
        .detail-image-side {
          position: relative;
          background: var(--champagne);
          overflow: hidden;
        }
        .detail-image-side img {
          width: 100%;
          height: 100%;
          max-height: 90vh;
          object-fit: cover;
          object-position: top center;
          display: block;
          transition: transform 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }
        .detail-image-side:hover img {
          transform: scale(1.03);
        }
        .detail-image-badge {
          position: absolute;
          top: 24px;
          left: 24px;
          background: rgba(250, 247, 244, 0.92);
          backdrop-filter: blur(6px);
          font-size: 8px;
          font-weight: 500;
          letter-spacing: 0.35em;
          text-transform: uppercase;
          color: var(--warm-brown);
          padding: 6px 14px;
        }

        /* ── Info panel ── */
        .detail-info-side {
          position: sticky;
          top: 0;
          height: fit-content;
          max-height: 100vh;
          overflow-y: auto;
          padding: 56px 56px 64px;
          display: flex;
          flex-direction: column;
          scrollbar-width: none;
        }
        .detail-info-side::-webkit-scrollbar { display: none; }

        .detail-overline {
          font-size: 9px;
          letter-spacing: 0.4em;
          text-transform: uppercase;
          color: var(--blush);
          margin-bottom: 16px;
        }
        .detail-name {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(36px, 4vw, 56px);
          font-weight: 300;
          line-height: 1.05;
          color: var(--espresso);
          margin: 0 0 12px;
        }
        .detail-price {
          font-family: 'Cormorant Garamond', serif;
          font-size: 22px;
          font-weight: 400;
          color: var(--warm-brown);
          margin: 0 0 28px;
          letter-spacing: 0.02em;
        }
        .detail-divider {
          width: 40px;
          height: 1px;
          background: var(--blush);
          margin: 0 0 28px;
        }
        .detail-description {
          font-size: 14px;
          font-weight: 300;
          line-height: 1.85;
          color: var(--muted);
          margin: 0 0 36px;
          letter-spacing: 0.02em;
        }

        /* ── Meta tags ── */
        .detail-meta {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 36px;
        }
        .detail-meta-row {
          display: flex;
          align-items: baseline;
          gap: 12px;
        }
        .detail-meta-key {
          font-size: 9px;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          color: var(--muted);
          width: 80px;
          flex-shrink: 0;
        }
        .detail-meta-val {
          font-family: 'Cormorant Garamond', serif;
          font-size: 17px;
          color: var(--espresso);
        }

        /* ── FitMatcher CTA banner ── */
        .fit-matcher-cta {
          border: 1px solid var(--champagne);
          padding: 20px 24px;
          margin-bottom: 32px;
          background: linear-gradient(135deg, #fdf9f5 0%, #f7ede3 100%);
          position: relative;
          overflow: hidden;
        }
        .fit-matcher-cta::before {
          content: '';
          position: absolute;
          top: -20px;
          right: -20px;
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(212,165,160,0.25) 0%, transparent 70%);
        }
        .fit-matcher-label {
          font-size: 8px;
          letter-spacing: 0.4em;
          text-transform: uppercase;
          color: var(--blush);
          margin-bottom: 6px;
        }
        .fit-matcher-title {
          font-family: 'Cormorant Garamond', serif;
          font-size: 20px;
          font-weight: 400;
          color: var(--espresso);
          margin: 0 0 6px;
        }
        .fit-matcher-sub {
          font-size: 12px;
          font-weight: 300;
          color: var(--muted);
          margin: 0 0 14px;
          line-height: 1.6;
        }
        .fit-matcher-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--espresso);
          color: var(--ivory);
          font-family: 'Jost', sans-serif;
          font-size: 9px;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          padding: 9px 20px;
          text-decoration: none;
          transition: background 0.2s;
          border: none;
          cursor: pointer;
        }
        .fit-matcher-btn:hover { background: var(--warm-brown); }
        .fit-matcher-btn svg { flex-shrink: 0; }

        /* ── Actions ── */
        .detail-actions {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 28px;
        }
        .detail-btn-primary {
          display: block;
          width: 100%;
          padding: 16px 24px;
          background: var(--espresso);
          color: var(--ivory);
          font-family: 'Jost', sans-serif;
          font-size: 10px;
          letter-spacing: 0.35em;
          text-transform: uppercase;
          text-align: center;
          text-decoration: none;
          border: none;
          cursor: pointer;
          transition: background 0.2s, transform 0.15s;
        }
        .detail-btn-primary:hover {
          background: var(--warm-brown);
          transform: translateY(-1px);
        }
        .detail-btn-primary:active { transform: translateY(0); }
        .detail-btn-primary.added {
          background: var(--warm-brown);
        }
        .detail-btn-secondary {
          display: block;
          width: 100%;
          padding: 14px 24px;
          background: transparent;
          color: var(--espresso);
          font-family: 'Jost', sans-serif;
          font-size: 10px;
          letter-spacing: 0.35em;
          text-transform: uppercase;
          text-align: center;
          text-decoration: none;
          border: 1px solid var(--champagne);
          cursor: pointer;
          transition: border-color 0.2s, color 0.2s;
        }
        .detail-btn-secondary:hover {
          border-color: var(--blush);
          color: var(--warm-brown);
        }
        .detail-note {
          font-size: 11px;
          font-weight: 300;
          color: var(--muted);
          letter-spacing: 0.04em;
          line-height: 1.7;
          padding-top: 16px;
          border-top: 1px solid var(--champagne);
        }

        /* ── Recommendations ── */
        .detail-recommendations {
          padding: 80px 0;
          background: var(--ivory);
          border-top: 1px solid var(--champagne);
        }
        .reco-header {
          display: flex;
          align-items: baseline;
          gap: 20px;
          margin-bottom: 40px;
        }
        .reco-label {
          font-size: 9px;
          letter-spacing: 0.4em;
          text-transform: uppercase;
          color: var(--blush);
        }
        .reco-title {
          font-family: 'Cormorant Garamond', serif;
          font-size: 36px;
          font-weight: 300;
          color: var(--espresso);
          margin: 0;
        }
        .reco-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2px;
        }

        /* ── Mobile ── */
        @media (max-width: 860px) {
          .detail-layout {
            grid-template-columns: 1fr;
            margin-top: 0;
          }
          .detail-image-side {
            height: 70vw;
            max-height: 480px;
          }
          .detail-image-side img { max-height: 100%; height: 100%; }
          .detail-info-side {
            position: static;
            max-height: none;
            padding: 36px 24px 48px;
          }
          .reco-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 480px) {
          .reco-grid { grid-template-columns: 1fr; }
          .detail-name { font-size: 36px; }
        }
      `}</style>

      <Header solid/>
      <section className="gowns-header-spacer" />

      <div className="container detail-breadcrumb">
        <nav className="detail-breadcrumb-inner">
          <Link href="/">Home</Link>
          <span>/</span>
          <Link href="/gowns">Collection</Link>
          <span>/</span>
          <strong>{gown.name}</strong>
        </nav>
      </div>

      <section>
        <div className="detail-layout">
          <div className="detail-image-side">
            <img
              src={gown.image}
              alt={gown.alt || gown.name}
              style={gown.style}
            />
            {gown.type && (
              <span className="detail-image-badge">{gown.type}</span>
            )}
          </div>

          <div className="detail-info-side">
            <p className="detail-overline">JCE Bridal — {gown.type || 'Bridal Collection'}</p>
            <h1 className="detail-name">{gown.name}</h1>
            <p className="detail-price">{gown.price}</p>
            <div className="detail-divider" />

            {gown.description && (
              <p className="detail-description">{gown.description}</p>
            )}

            <div className="detail-meta">
              {gown.type && (
                <div className="detail-meta-row">
                  <span className="detail-meta-key">Type</span>
                  <span className="detail-meta-val">{gown.type}</span>
                </div>
              )}
              {gown.color && (
                <div className="detail-meta-row">
                  <span className="detail-meta-key">Color</span>
                  <span className="detail-meta-val">{gown.color}</span>
                </div>
              )}
              {gown.silhouette && (
                <div className="detail-meta-row">
                  <span className="detail-meta-key">Silhouette</span>
                  <span className="detail-meta-val">{gown.silhouette}</span>
                </div>
              )}
            </div>

            <div className="fit-matcher-cta">
              <p className="fit-matcher-label">FitMatcher</p>
              <p className="fit-matcher-title">Find your perfect fit</p>
              <p className="fit-matcher-sub">
                Not sure about your size? Our AI-powered FitMatcher will recommend the
                right size and style based on your measurements.
              </p>
              <Link href="/fit-matcher" className="fit-matcher-btn">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
                </svg>
                Get size recommendation
              </Link>
            </div>

            <div className="detail-actions">
              {added ? (
                <Link href="/cart" className="detail-btn-primary added">
                  ✓ Added — View cart
                </Link>
              ) : (
                <button
                  type="button"
                  className="detail-btn-primary"
                  onClick={() => {
                    addToCart(gown.id)
                    setAdded(true)
                  }}
                >
                  Add to cart
                </button>
              )}
              <Link href="/contact" className="detail-btn-secondary">
                Inquire about this piece
              </Link>
            </div>

            <p className="detail-note">
              Sizing, availability, and customization options are available upon inquiry.
              Each gown is made to order — contact us to begin your fitting.
            </p>
          </div>
        </div>
      </section>

      {others.length > 0 && (
        <section className="detail-recommendations">
          <div className="container">
            <div className="reco-header">
              <span className="reco-label">More looks</span>
              <h2 className="reco-title">You may also like</h2>
            </div>
            <div className="reco-grid">
              {others.map((product, index) => (
                <ProductCard key={product.id} product={product} delay={index * 0.1} />
              ))}
            </div>
          </div>
        </section>
      )}

      <Footer />
    </main>
  )
}