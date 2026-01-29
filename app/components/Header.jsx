'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getCurrentUser, logoutUser } from '../utils/authClient'

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const router = useRouter()

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const user = getCurrentUser()
    setCurrentUser(user)

    const handleStorage = (event) => {
      if (!event.key || event.key === 'jce_current_user') {
        setCurrentUser(getCurrentUser())
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const handleSmoothScroll = (e) => {
    e.preventDefault()
    const href = e.currentTarget.getAttribute('href')
    const target = document.querySelector(href)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const handleLogout = () => {
    logoutUser()
    setCurrentUser(null)
    router.push('/')
  }

  return (
    <header className={isScrolled ? 'scrolled' : ''}>
      <div className="nav-container">
        <a href="/" className="logo">JCE Bridal.</a>
        <nav>
          <ul className="nav-links">
            <li><a href="/gowns">Gowns</a></li>
            <li><a href="#catalog" onClick={handleSmoothScroll}>Catalog</a></li>
            <li><a href="#collection" onClick={handleSmoothScroll}>Collection</a></li>
            <li><a href="/contact">Contact Us</a></li>
            {currentUser ? (
              <li className="profile-menu">
                <a href="/profile" className="profile-menu-trigger">Profile</a>
                <div className="profile-dropdown" role="menu">
                  <span className="profile-dropdown-label">Account</span>
                  <Link href="/profile" className="profile-dropdown-item">My Profile</Link>
                  <Link href="/cart" className="profile-dropdown-item profile-dropdown-cart">Cart</Link>
                </div>
              </li>
            ) : (
              <li><a href="/login">Login</a></li>
            )}
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
