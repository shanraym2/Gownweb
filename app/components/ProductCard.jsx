'use client'

import { useCallback } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'

const OBSERVER_OPTIONS = { threshold: 0.12 }

export default function ProductCard({ product, delay = 0 }) {
  const { ref, isVisible } = useIntersectionObserver(OBSERVER_OPTIONS)
  const router = useRouter()

  const handleViewDetails = useCallback(() => {
    if (product?.id) router.push(`/gowns/${product.id}`)
  }, [product?.id, router])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleViewDetails()
    }
  }, [handleViewDetails])

  if (!product) return null

  return (
    <article
      ref={ref}
      className={`product-card reveal-up ${isVisible ? 'active' : ''}`}
      style={{ transitionDelay: `${delay}s` }}
      aria-label={product.name}
    >
      <div className="product-img-wrapper">
        <Image
          src={product.image}
          alt={product.alt ?? product.name}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          style={{ ...product.style, objectFit: 'cover' }}
          quality={75}
          draggable="false"
        />
      </div>

      <div className="product-info">
        <h3>{product.name}</h3>
        <p className="price">{product.price}</p>
        <button
          type="button"
          className="btn btn-buy"
          onClick={handleViewDetails}
          onKeyDown={handleKeyDown}
          aria-label={`View details for ${product.name}`}
        >
          View Details
        </button>
      </div>
    </article>
  )
}
