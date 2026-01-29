'use client'

import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'
import ProductCard from './ProductCard'
import { GOWNS } from '../data/gowns'

export default function Collection() {
  const { ref: headerRef, isVisible: headerVisible } = useIntersectionObserver({ threshold: 0.15 })

  const products = GOWNS.slice(0, 3)

  return (
    <section id="collection" className="collection-section">
      <div className="container">
        <div ref={headerRef} className={`section-header ${headerVisible ? 'active' : ''} reveal-up`}>
          <span className="subtitle">THE COLLECTION</span>
          <h2>Handpicked Elegance</h2>
        </div>
        <div className="product-grid">
          {products.map((product, index) => (
            <ProductCard key={product.id} product={product} delay={index * 0.1} />
          ))}
        </div>
      </div>
    </section>
  )
}
