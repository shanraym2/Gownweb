'use client'

import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'

export default function ProductCard({ product, delay }) {
  const { ref, isVisible } = useIntersectionObserver({ threshold: 0.15 })

  return (
    <div
      ref={ref}
      className={`product-card ${isVisible ? 'active' : ''} reveal-up`}
      style={{ transitionDelay: `${delay}s` }}
    >
      <div className="product-img-wrapper">
        <img src={product.image} alt={product.alt} style={product.style} />
      </div>
      <div className="product-info">
        <h3>{product.name}</h3>
        <p className="price">{product.price}</p>
      </div>
    </div>
  )
}
