'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getCurrentUser, logoutUser } from '../utils/authClient'

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const router = useRouter()
  const profileRef = useRef(null)

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50)
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

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setIsProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLogout = () => {
    logoutUser()
    setCurrentUser(null)
    setIsProfileOpen(false)
    setIsMobileOpen(false)
    router.push('/')
  }

  const toggleMobileMenu = () => setIsMobileOpen(!isMobileOpen)
  const toggleProfileMenu = () => setIsProfileOpen(!isProfileOpen)

  return (
    <header className={isScrolled ? 'scrolled' : ''}>
      <div className="nav-container">
        <Link href="/" className="logo" aria-label="Go to homepage">
          JCE Bridal.
        </Link>

        <button
          className="nav-mobile-toggle"
          aria-label="Toggle navigation menu"
          aria-expanded={isMobileOpen}
          onClick={toggleMobileMenu}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>

        <nav className={isMobileOpen ? 'open' : ''} aria-label="Main navigation">
          <ul className="nav-links">
            <li>
              <Link href="/gowns" onClick={() => setIsMobileOpen(false)}>
                Gowns
              </Link>
            </li>

            <li>
              <Link href="/contact" onClick={() => setIsMobileOpen(false)}>
                Contact Us
              </Link>
            </li>

            <li className="cart-nav">
              <Link href="/cart" onClick={() => setIsMobileOpen(false)}>
                Cart
              </Link>
            </li>

            {currentUser?.role === 'admin' && (
              <li>
                <Link href="/admin" onClick={() => setIsMobileOpen(false)}>
                  Admin Dashboard
                </Link>
              </li>
            )}

            {currentUser ? (
              <li className="profile-menu" ref={profileRef}>
                <button
                  className="profile-menu-trigger nav-link-style"
                  aria-haspopup="true"
                  aria-expanded={isProfileOpen}
                  onClick={toggleProfileMenu}
                >
                  Account
                </button>

                {isProfileOpen && (
                  <div className="profile-dropdown" role="menu">
                    <span className="profile-dropdown-label">
                      Signed in as {currentUser.name}
                    </span>

                    <Link
                      href="/profile"
                      className="profile-dropdown-item"
                      onClick={() => {
                        setIsProfileOpen(false)
                        setIsMobileOpen(false)
                      }}
                    >
                      My Profile
                    </Link>

                    <Link
                      href="/my-orders"
                      className="profile-dropdown-item"
                      onClick={() => {
                        setIsProfileOpen(false)
                        setIsMobileOpen(false)
                      }}
                    >
                      My Orders
                    </Link>

                    <button
                      className="logout-nav"
                      onClick={handleLogout}
                    >
                      Logout
                    </button>
                  </div>
                )}
              </li>
            ) : (
              <li>
                <Link href="/login" onClick={() => setIsMobileOpen(false)}>
                  Login
                </Link>
              </li>
            )}
          </ul>
        </nav>
      </div>
    </header>
  )
}