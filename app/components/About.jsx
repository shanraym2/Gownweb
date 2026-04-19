'use client'

import { useState, useEffect } from 'react'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'

const OBSERVER_OPTIONS = { threshold: 0.15 }

export default function About() {
  const { ref: imageRef, isVisible: imageVisible } = useIntersectionObserver(OBSERVER_OPTIONS)
  const { ref: textRef,  isVisible: textVisible  } = useIntersectionObserver(OBSERVER_OPTIONS)

  const [content, setContent] = useState({
    eyebrow_label: 'ABOUT US',
    heading:       'Comfort and Quality Come First.',
    body_1:        "JCE Bridal has always dreamed of comfortable women's clothing that would look appropriate in any circumstances.",
    body_2:        'This is how the JCE Bridal brand appeared — it is a brand for women who like to feel confident, seductive, and stylish in any situation. We use only natural fabrics and pay great attention to details that make the difference.',
    image_url:     '/images/aboutus.png',
  })

  useEffect(() => {
    fetch('/api/cms/content?section=about')
      .then(r => r.json())
      .then(d => { if (d.ok && d.fields) setContent(d.fields) })
      .catch(() => {})
  }, [])

  return (
    <section id="about" className="about-section">
      <div className="container split-layout">

        <div
          ref={imageRef}
          className={`image-col reveal-left ${imageVisible ? 'active' : ''}`}
        >
          <img
            src={content.image_url}
            alt="A designer carefully crafting a wedding gown"
            className="feature-img"
          />
          <div className="quote-icon" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="var(--gold)" xmlns="http://www.w3.org/2000/svg">
              <path d="M14.017 21L14.017 18C14.017 16.8954 14.9124 16 16.017 16H19.017C19.5693
                       16 20.017 15.5523 20.017 15V9C20.017 8.44772 19.5693 8 19.017 8H15.017C14.4647
                       8 14.017 8.44772 14.017 9V11C14.017 11.5523 13.5693 12 13.017 12H12.017V5H22.017V15C22.017
                       18.3137 19.3307 21 16.017 21H14.017ZM5.017 21L5.017 18C5.017 16.8954 5.9124 16 7.017
                       16H10.017C10.5693 16 11.017 15.5523 11.017 15V9C11.017 8.44772 10.5693 8 10.017
                       8H6.017C5.4647 8 5.017 8.44772 5.017 9V11C5.017 11.5523 4.5693 12 4.017 12H3.017V5H13.017V15C13.017
                       18.3137 10.3307 21 7.017 21H5.017Z" />
            </svg>
          </div>
        </div>

        <div
          ref={textRef}
          className={`text-col reveal-right ${textVisible ? 'active' : ''}`}
        >
          <span className="subtitle">{content.eyebrow_label}</span>
          <h2>{content.heading}</h2>
          <p>{content.body_1}</p>
          <p>{content.body_2}</p>
        </div>

      </div>
    </section>
  )
}