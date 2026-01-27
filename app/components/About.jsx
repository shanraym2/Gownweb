'use client'

import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'

export default function About() {
  const { ref: imageRef, isVisible: imageVisible } = useIntersectionObserver({ threshold: 0.15 })
  const { ref: textRef, isVisible: textVisible } = useIntersectionObserver({ threshold: 0.15 })

  return (
    <section id="about" className="about-section">
      <div className="container split-layout">
        <div ref={imageRef} className={`image-col ${imageVisible ? 'active' : ''} reveal-left`}>
          <img src="/images/aboutus.png" alt="Designer working on a dress" className="feature-img" />
          <div className="quote-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="var(--color-gold)" xmlns="http://www.w3.org/2000/svg">
              <path d="M14.017 21L14.017 18C14.017 16.8954 14.9124 16 16.017 16H19.017C19.5693 16 20.017 15.5523 20.017 15V9C20.017 8.44772 19.5693 8 19.017 8H15.017C14.4647 8 14.017 8.44772 14.017 9V11C14.017 11.5523 13.5693 12 13.017 12H12.017V5H22.017V15C22.017 18.3137 19.3307 21 16.017 21H14.017ZM5.01697 21L5.01697 18C5.01697 16.8954 5.9124 16 7.01697 16H10.017C10.5693 16 11.017 15.5523 11.017 15V9C11.017 8.44772 10.5693 8 10.017 8H6.01697C5.46468 8 5.01697 8.44772 5.01697 9V11C5.01697 11.5523 4.56925 12 4.01697 12H3.01697V5H13.017V15C13.017 18.3137 10.3307 21 7.01697 21H5.01697Z" />
            </svg>
          </div>
        </div>
        <div ref={textRef} className={`text-col ${textVisible ? 'active' : ''} reveal-right`}>
          <span className="subtitle">ABOUT US</span>
          <h2>Comfort and <br />Quality Come First.</h2>
          <p>JCE Bridal has always dreamed of comfortable women's clothing that would look appropriate in any circumstances.</p>
          <p>This is how the JCE Bridal brand appeared — it is a brand for women who like to feel confident, seductive, and stylish in any situation. We use only natural fabrics and pay great attention to details that make the difference.</p>
        </div>
      </div>
    </section>
  )
}
