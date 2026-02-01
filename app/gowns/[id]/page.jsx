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

  if (loading) {
    return (
      <main className="gowns-page">
        <Header />
        <section className="gowns-header-spacer" />
        <section className="gown-detail">
          <div className="container">
            <p>Loading…</p>
          </div>
        </section>
        <Footer />
      </main>
    )
  }

  if (error || gown == null) {
    return (
      <main className="gowns-page">
        <Header />
        <section className="gowns-header-spacer" />
        <section className="gown-detail">
          <div className="container">
            <p>{error || 'Gown not found.'}</p>
            <Link href="/gowns" className="btn btn-primary" style={{ marginTop: 16 }}>
              Back to Gowns
            </Link>
          </div>
        </section>
        <Footer />
      </main>
    )
  }

  const others = gowns.filter((g) => Number(g.id) !== Number(gown.id)).slice(0, 3)

  return (
    <main className="gowns-page">
      <Header />
      <section className="gowns-header-spacer" />
      <section className="gown-detail">
        <div className="container">
          <div className="gown-detail-layout">
            <div className="gown-detail-image-wrapper">
              <img
                src={gown.image}
                alt={gown.alt}
                className="gown-detail-image"
                style={gown.style}
              />
            </div>
            <div className="gown-detail-info">
              <h1>{gown.name}</h1>
              <p className="gown-detail-price">{gown.price}</p>
              <p className="gown-detail-description">{gown.description}</p>
              <div className="gown-detail-meta">
                <p><strong>Type:</strong> {gown.type}</p>
                <p><strong>Color:</strong> {gown.color}</p>
                <p><strong>Silhouette:</strong> {gown.silhouette}</p>
              </div>
              <p className="gown-detail-note">
                Inquire about sizing, availability, and customizations through our contact page.
              </p>
              <div className="gown-detail-actions">
                {added ? (
                  <Link href="/cart" className="btn btn-primary">
                    Added – View cart
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      addToCart(gown.id)
                      setAdded(true)
                    }}
                  >
                    Add to cart
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
      {others.length > 0 && (
        <section className="gown-recommendations">
          <div className="container">
            <div className="gown-recommendations-header">
              <span className="subtitle">MORE LOOKS</span>
              <h2>You may also like</h2>
            </div>
            <div className="product-grid">
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
