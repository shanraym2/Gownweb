'use client'

import { useState, useEffect, useMemo } from 'react'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'
import ProductCard from './ProductCard'
import { useGowns } from '@/hooks/useGowns'

const OBSERVER_OPTIONS = { threshold: 0.15 }
const FEATURED_COUNT  = 3

export default function Collection() {
  const { ref: headerRef, isVisible: headerVisible } = useIntersectionObserver(OBSERVER_OPTIONS)
  const { gowns, loading } = useGowns()

  const [spotlight, setSpotlight] = useState({
    eyebrow_label: 'THE COLLECTION',
    heading: 'Handpicked Elegance',
  })

  useEffect(() => {
    fetch('/api/cms/content?section=collection-spotlight')
      .then(r => r.json())
      .then(d => { if (d.ok && d.fields) setSpotlight(d.fields) })
      .catch(() => {})
  }, [])

  const featured = useMemo(() => gowns.slice(0, FEATURED_COUNT), [gowns])
  return (
    <section id="collection" className="collection-section">
      <div className="container">

        <div
          ref={headerRef}
          className={`section-header reveal-up ${headerVisible ? 'active' : ''}`}
        >
          <span className="subtitle">{spotlight.eyebrow_label}</span>
          <h2>{spotlight.heading}</h2>
        </div>

        {loading ? (
          <div className="product-grid" aria-busy="true" aria-label="Loading products">
            {Array.from({ length: FEATURED_COUNT }).map((_, i) => (
              <div key={i} className="product-card product-card--skeleton" aria-hidden="true" />
            ))}
          </div>
        ) : (
          <div className="product-grid">
            {featured.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                delay={index * 0.12}
              />
            ))}
          </div>
        )}

      </div>
    </section>
  )
}
