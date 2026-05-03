'use client'

import { useState, useEffect } from 'react'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'

const OBSERVER_OPTIONS = { threshold: 0.15 }

const FALLBACK = {
  quote_text:  'I have always had difficulties with buying clothes for every-day wear. Therefore, together with Linda, we decided to create our own brand.',
  author_name: 'Karina Ayacocho',
  image_url:   '/images/image2.png',
}

export default function Testimonial() {
  const { ref: textRef,  isVisible: textVisible  } = useIntersectionObserver(OBSERVER_OPTIONS)
  const { ref: imageRef, isVisible: imageVisible } = useIntersectionObserver(OBSERVER_OPTIONS)

  const [testimonial, setTestimonial] = useState(FALLBACK)

  useEffect(() => {
    fetch('/api/cms/testimonials')
      .then(r => r.json())
      .then(d => {
        // The public API already filters WHERE is_active = TRUE in SQL,
        // so we don't need to filter again here — that was causing the bug
        // where is_active wasn't selected and everything was filtered out.
        const list = d.testimonials || []
        if (list.length > 0) setTestimonial(list[0])
      })
      .catch(() => {
        // Network error — silently keep the fallback
      })
  }, [])

  return (
    <section className="testimonial-section" aria-label="Customer testimonial">
      <div className="container split-layout">

        <div
          ref={textRef}
          className={`text-col reveal-left ${textVisible ? 'active' : ''}`}
        >
          <figure>
            <blockquote>
              <p className="testimonial-text">"{testimonial.quote_text}"</p>
            </blockquote>
            <figcaption>
              <cite className="author">{testimonial.author_name}</cite>
            </figcaption>
          </figure>
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