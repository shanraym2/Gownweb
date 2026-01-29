'use client'

import { useRouter } from 'next/navigation'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'

export default function ProductCard({ product, delay }) {
  const { ref, isVisible } = useIntersectionObserver({ threshold: 0.15 })
  const router = useRouter()

  const handleViewDetails = () => {
    if (!product?.id) return
    router.push(`/gowns/${product.id}`)
  }

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
        <button type="button" className="btn btn-primary btn-buy" onClick={handleViewDetails}>
          View Details
        </button>
      </div>
    </div>
  )
}
