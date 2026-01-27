'use client'

import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'
import ProductCard from './ProductCard'

export default function Collection() {
  const { ref: headerRef, isVisible: headerVisible } = useIntersectionObserver({ threshold: 0.15 })

  const products = [
    {
      id: 1,
      name: 'The Isabella',
      price: '₱65,000',
      image: '/images/image1.png',
      alt: 'Lace Detail Gown'
    },
    {
      id: 2,
      name: 'The Victoria',
      price: '₱102,000',
      image: '/images/image2.png',
      alt: 'Royal Satin Gown'
    },
    {
      id: 3,
      name: 'The Sophia',
      price: '₱80,000',
      image: '/images/image1.png',
      alt: 'Floral Garden Gown',
      style: { filter: 'brightness(0.9)' }
    }
  ]

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
