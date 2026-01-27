'use client'

import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'

export default function Testimonial() {
  const { ref: textRef, isVisible: textVisible } = useIntersectionObserver({ threshold: 0.15 })
  const { ref: imageRef, isVisible: imageVisible } = useIntersectionObserver({ threshold: 0.15 })

  return (
    <section className="testimonial-section">
      <div className="container split-layout">
        <div ref={textRef} className={`text-col ${textVisible ? 'active' : ''} reveal-left`}>
          <p className="testimonial-text">"I have always had difficulties with buying clothes for every-day wear. Therefore, together with Linda, we decided to create our own brand."</p>
          <p className="author">— Karina Ayacocho</p>
        </div>
        <div ref={imageRef} className={`image-col ${imageVisible ? 'active' : ''} reveal-right`}>
          <img src="/images/image2.png" alt="Detail shot" className="detail-img" />
        </div>
      </div>
    </section>
  )
}
