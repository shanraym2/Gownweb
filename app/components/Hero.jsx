'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { getCurrentUser } from '../utils/authClient'

const slides = [
  {
    image: '/images/weds.jpg',
    subtitle: 'DESIGNER COLLECTION',
    heading: 'Your New\nDream Look.',
    body: 'JCE Bridal Boutique is your destination for designer and comfortable wedding gowns for your special day.',
  },
  {
    image: '/images/image1.png',
    subtitle: 'LUXURY GOWNS',
    heading: 'Timeless\nElegance.',
    body: 'From classic silhouettes to modern couture — discover the gown that was made for you.',
  },
  {
    image: '/images/image2.png',
    subtitle: 'BRIDAL READY',
    heading: 'Walk Down\nIn Style.',
    body: 'Every stitch crafted with love. Every detail designed to make you shine on your most beautiful day.',
  },
]

function HeroGreeting() {
  const [greeting, setGreeting] = useState(null)

  useEffect(() => {
    const user = getCurrentUser()
    const hour = new Date().getHours()
    const timeGreeting =
      hour < 12 ? 'Good morning' :
      hour < 17 ? 'Good afternoon' :
                  'Good evening'

    setGreeting(
      user?.name
        ? `${timeGreeting}, ${user.name}`
        : timeGreeting
    )
  }, [])

  if (!greeting) return null

  return (
    <p className="hero-greeting" aria-live="polite">
      {greeting}
    </p>
  )
}

export default function Hero() {
  const [current, setCurrent]             = useState(0)
  const [transitioning, setTransitioning] = useState(false)
  const [contentVisible, setContentVisible] = useState(true)
  const timerRef   = useRef(null)
  const currentRef = useRef(current)

  useEffect(() => { currentRef.current = current }, [current])

  const clearAutoplay = () => {
    if (timerRef.current) clearInterval(timerRef.current)
  }

  const startAutoplay = useCallback(() => {
    clearAutoplay()
    timerRef.current = setInterval(() => {
      navigate((currentRef.current + 1) % slides.length)
    }, 5500)
  }, [])

  const navigate = useCallback((index) => {
    if (transitioning || index === currentRef.current) return
    setTransitioning(true)
    setContentVisible(false)
    setTimeout(() => {
      setCurrent(index)
      setContentVisible(true)
      setTransitioning(false)
    }, 500)
  }, [transitioning])

  const next = useCallback(() => {
    navigate((currentRef.current + 1) % slides.length)
    startAutoplay()
  }, [navigate, startAutoplay])

  const prev = useCallback(() => {
    navigate((currentRef.current - 1 + slides.length) % slides.length)
    startAutoplay()
  }, [navigate, startAutoplay])

  useEffect(() => {
    startAutoplay()
    return clearAutoplay
  }, [startAutoplay])

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [next, prev])

  const slide = slides[current]

  return (
    <section className="hero" aria-label="Featured collection slideshow">

      {slides.map((s, i) => (
        <div
          key={i}
          className={`hero-slide ${i === current ? 'hero-slide--active' : ''}`}
          aria-hidden={i !== current}
        >
          <img src={s.image} alt="" role="presentation" />
        </div>
      ))}

      <div className="hero-content">
        <div className={`hero-card ${contentVisible ? 'hero-card--shown' : 'hero-card--hidden'}`}>
          <HeroGreeting />
          <span className="hero-subtitle">{slide.subtitle}</span>
          <h1 className="hero-heading">{slide.heading}</h1>
          <p className="hero-body">{slide.body}</p>
          <div className="hero-buttons">
            <a href="#collection" className="btn btn-primary">Shop Now +</a>
            <a href="#about" className="btn btn-outline">About Us</a>
          </div>
        </div>
      </div>

      <button className="hero-arrow hero-arrow-prev" onClick={prev} aria-label="Previous slide" disabled={transitioning}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <button className="hero-arrow hero-arrow-next" onClick={next} aria-label="Next slide" disabled={transitioning}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      <nav className="hero-dots" aria-label="Slide navigation">
        {slides.map((_, i) => (
          <button
            key={i}
            className={`hero-dot ${i === current ? 'hero-dot--active' : ''}`}
            onClick={() => { navigate(i); startAutoplay() }}
            aria-label={`Go to slide ${i + 1}`}
            aria-current={i === current ? 'true' : undefined}
          />
        ))}
      </nav>

      <div className="hero-counter" aria-live="polite" aria-atomic="true">
        <span>0{current + 1}</span>
        <span className="hero-counter-sep"> / </span>
        <span>0{slides.length}</span>
      </div>

      <div key={current} className="hero-progress" aria-hidden="true" />
    </section>
  )
}