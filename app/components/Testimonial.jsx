'use client'

import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'

const OBSERVER_OPTIONS = { threshold: 0.15 }

export default function Testimonial() {
  const { ref: textRef,  isVisible: textVisible  } = useIntersectionObserver(OBSERVER_OPTIONS)
  const { ref: imageRef, isVisible: imageVisible } = useIntersectionObserver(OBSERVER_OPTIONS)

  return (
    <section className="testimonial-section" aria-label="Customer testimonial">
      <div className="container split-layout">

        <div
          ref={textRef}
          className={`text-col reveal-left ${textVisible ? 'active' : ''}`}
        >
          <blockquote>
            <p className="testimonial-text">
              "I have always had difficulties with buying clothes for every-day wear.
              Therefore, together with Linda, we decided to create our own brand."
            </p>
            <footer>
              <cite className="author">Karina Ayacocho</cite>
            </footer>
          </blockquote>
        </div>

        <div
          ref={imageRef}
          className={`image-col reveal-right ${imageVisible ? 'active' : ''}`}
        >
          <img
            src="/images/image2.png"
            alt="Close-up detail of a wedding gown's embroidery"
            className="detail-img"
          />
        </div>

      </div>
    </section>
  )
}
