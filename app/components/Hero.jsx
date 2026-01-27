'use client'

import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'

export default function Hero() {
  const { ref, isVisible } = useIntersectionObserver({ threshold: 0.15 })

  return (
    <section className="hero">
      <div className="hero-image-container">
        <img src="/images/weds.jpg" alt="Bride in luxury gown" className="hero-img" />
      </div>

      <div ref={ref} className={`hero-overlay-card ${isVisible ? 'active' : ''} reveal-up`}>
        <span className="subtitle">DESIGNER COLLECTION</span>
        <h1>Your New <br />Dream Look.</h1>
        <p>JCE Bridal Boutique is your destination for designer and comfortable wedding gowns for your special day.</p>

        <div className="hero-buttons">
          <a href="#collection" className="btn btn-primary">Shop Now +</a>
          <a href="#about" className="btn btn-outline">About Us</a>
        </div>
      </div>
    </section>
  )
}
