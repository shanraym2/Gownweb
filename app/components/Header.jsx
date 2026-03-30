'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getCurrentUser, logoutUser } from '../utils/authClient'

export default function Header({ solid = false }) {
  const [isScrolled, setIsScrolled] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const router = useRouter()
  const profileRef = useRef(null)

  useEffect(() => {
    if (solid) return
    const handleScroll = () => setIsScrolled(window.scrollY > 40)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [solid])

  useEffect(() => {
    const user = getCurrentUser()
    setCurrentUser(user)
    const handleStorage = (e) => {
      if (!e.key || e.key === 'jce_current_user') setCurrentUser(getCurrentUser())
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setIsProfileOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    document.body.style.overflow = isMobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isMobileOpen])

  const handleLogout = () => {
    logoutUser()
    setCurrentUser(null)
    setIsProfileOpen(false)
    setIsMobileOpen(false)
    router.push('/')
  }

  const isActive = isScrolled || solid

  return (
    <>
      <header className={`hdr${isActive ? ' scrolled' : ''}`}>
        <div className="hdr-inner">

          <nav className="hdr-nav">
            <Link href="/gowns">Gowns</Link>
            <Link href="/virtual-try-on">Virtual Try-On</Link>
            <Link href="/contact">Contact</Link>
            {currentUser?.role === 'admin' && (
              <Link href="/admin">Admin</Link>
            )}
          </nav>

          <button
            className={`hdr-burger${isMobileOpen ? ' open' : ''}`}
            aria-label="Toggle menu"
            onClick={() => setIsMobileOpen(!isMobileOpen)}
          >
            <span /><span /><span />
          </button>

          <Link href="/" className="hdr-logo" aria-label="JCE Bridal Boutique — Home">
            <img src="/images/jce_logo.svg" alt="" aria-hidden="true" />
            <div className="hdr-logo-text">
              <span className="hdr-logo-main">JCE Bridal</span>
              <span className="hdr-logo-sub">Boutique</span>
            </div>
          </Link>

          <div className="hdr-actions">

            <button className="hdr-icon-btn" aria-label="Search">
              <img src="/images/search_logo.svg" alt="" aria-hidden="true" />
            </button>

            <div className="hdr-divider" />

            <Link href="/cart" className="hdr-icon-btn cart-wrap" aria-label="Cart">
              <img src="/images/cart_logo.svg" alt="" aria-hidden="true" />
              <span className="cart-badge" />
            </Link>

            <div className="hdr-divider" />

            {currentUser ? (
              <div className="profile-wrap" ref={profileRef}>
                <button
                  className={`profile-btn${isProfileOpen ? ' open' : ''}`}
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  aria-haspopup="true"
                  aria-expanded={isProfileOpen}
                >
                  Account
                  <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                {isProfileOpen && (
                  <div className="profile-drop">
                    <span className="drop-label">Signed in as {currentUser.name}</span>
                    <Link href="/profile" className="drop-item" onClick={() => setIsProfileOpen(false)}>My Profile</Link>
                    <Link href="/my-orders" className="drop-item" onClick={() => setIsProfileOpen(false)}>My Orders</Link>
                    <button className="drop-item drop-logout" onClick={handleLogout}>Logout</button>
                  </div>
                )}
              </div>
            ) : (
              <Link href="/login" className="login-icon-btn" aria-label="Login">
                <svg viewBox="0 0 24 24">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className={`mobile-drawer${isMobileOpen ? ' open' : ''}`}>
        <div className="mobile-backdrop" onClick={() => setIsMobileOpen(false)} />
        <div className="mobile-panel">
          <button className="mobile-close" onClick={() => setIsMobileOpen(false)} aria-label="Close menu">
            <svg viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <Link href="/" className="mobile-logo" onClick={() => setIsMobileOpen(false)}>
            <img src="/images/jce_logo.svg" alt="" aria-hidden="true" />
            <div className="mobile-logo-text">
              <span className="mobile-logo-main">JCE Bridal</span>
              <span className="mobile-logo-sub">Boutique</span>
            </div>
          </Link>

          <Link href="/gowns" className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>Gowns</Link>
          <Link href="/virtual-try-on" className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>Virtual Try-On</Link>
          <Link href="/about" className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>About</Link>
          <Link href="/contact" className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>Contact</Link>
          <Link href="/cart" className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>Cart</Link>

          {currentUser?.role === 'admin' && (
            <Link href="/admin" className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>Admin Dashboard</Link>
          )}

          {currentUser ? (
            <>
              <p className="mobile-user-label">Signed in as {currentUser.name}</p>
              <Link href="/profile" className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>My Profile</Link>
              <Link href="/my-orders" className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>My Orders</Link>
              <button
                className="mobile-nav-btn"
                style={{ color: 'var(--rose)' }}
                onClick={handleLogout}
              >
                Logout
              </button>
            </>
          ) : (
            <Link href="/login" className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>Login</Link>
          )}
        </div>
      </div>
    </>
  )
}