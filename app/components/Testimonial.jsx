'use client'

import { useState, useEffect } from 'react'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'

const OBSERVER_OPTIONS = { threshold: 0.15 }

export default function Testimonial() {
  const { ref: textRef,  isVisible: textVisible  } = useIntersectionObserver(OBSERVER_OPTIONS)
  const { ref: imageRef, isVisible: imageVisible } = useIntersectionObserver(OBSERVER_OPTIONS)

  const [testimonial, setTestimonial] = useState({
    quote_text:  'I have always had difficulties with buying clothes for every-day wear. Therefore, together with Linda, we decided to create our own brand.',
    author_name: 'Karina Ayacocho',
    image_url:   '/images/image2.png',
  })

  useEffect(() => {
    fetch('/api/cms/testimonials')
      .then(r => r.json())
      .then(d => {
        const active = (d.testimonials || []).filter(t => t.is_active)
        if (active.length) setTestimonial(active[0])
      })
      .catch(() => {})
  }, [])

  return (
    <section className="testimonial-section" aria-label="Customer testimonial">
      <div className="container split-layout">

        <div
          ref={textRef}
          className={`text-col reveal-left ${textVisible ? 'active' : ''}`}
        >
          <blockquote>
            <p className="testimonial-text">"{testimonial.quote_text}"</p>
            <footer>
              <cite className="author">{testimonial.author_name}</cite>
            </footer>
          </blockquote>
        </div>

        <div
          ref={imageRef}
          className={`image-col reveal-right ${imageVisible ? 'active' : ''}`}
        >
          <img
            src={testimonial.image_url}
            alt="Close-up detail of a wedding gown's embroidery"
            className="detail-img"
          />
        </div>

      </div>
    </section>
  )
}