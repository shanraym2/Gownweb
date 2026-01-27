'use client'

import { useState, useEffect } from 'react'

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const handleSmoothScroll = (e) => {
    e.preventDefault()
    const href = e.currentTarget.getAttribute('href')
    const target = document.querySelector(href)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <header className={isScrolled ? 'scrolled' : ''}>
      <div className="nav-container">
        <a href="#" className="logo">JCE Bridal.</a>
        <nav>
          <ul className="nav-links">
            <li><a href="#about" onClick={handleSmoothScroll}>About Us</a></li>
            <li><a href="#catalog" onClick={handleSmoothScroll}>Catalog</a></li>
            <li><a href="#collection" onClick={handleSmoothScroll}>Collection</a></li>
            <li><a href="#contact" onClick={handleSmoothScroll}>Contact Us</a></li>
          </ul>
        </nav>
        <div className="nav-mobile-toggle">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </header>
  )
}
