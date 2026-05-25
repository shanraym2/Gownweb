'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { getCurrentUser, logoutUser } from '../utils/authClient'
import { loadCart } from '../utils/cartClient'

export default function Header({ solid = false, cmsTheme = null }) {
  const [isScrolled,    setIsScrolled   ] = useState(false)
  const [currentUser,   setCurrentUser  ] = useState(null)
  const [cartCount,     setCartCount    ] = useState(0)
  const [isMobileOpen,  setIsMobileOpen ] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [isSearchOpen,  setIsSearchOpen ] = useState(false)
  const [searchQuery,   setSearchQuery  ] = useState('')
  const router     = useRouter()
  const pathname   = usePathname()
  const profileRef = useRef(null)
  const searchRef  = useRef(null)
  const searchInputRef = useRef(null)

  // ── CMS state ──────────────────────────────────────────────────────────────
  const [navLabels, setNavLabels] = useState({
    nav_catalogue_label: 'Catalogue',
    nav_fitting_label:   'My Fitting room',
    nav_contact_label:   'Contact',
  })
  const [announcementBar, setAnnouncementBar] = useState({
    enabled:    'false',
    text:       '',
    link_url:   '',
    link_label: '',
    bg_color:   '#1a1a2e',
    txt_color:  '#f5e9d0',
  })
  // theme-config: colours, font, logo text, custom logo image
  const [theme, setTheme] = useState({
    colors:    { navBg: '', primary: '' },
    fonts:     { body: '' },
    site_name: '',   // replaces "JCE Bridal" in the logo
    logo_sub:  '',   // replaces "Boutique"
    logo_url:  '',   // optional custom logo image path
  })

  useEffect(() => {
    Promise.allSettled([
      fetch('/api/cms/content?section=header').then(r => r.json()),
      fetch('/api/cms/content?section=announcement-bar').then(r => r.json()),
      fetch('/api/cms/content?section=theme-config').then(r => r.json()),
    ]).then(([headerResult, annResult, themeResult]) => {
      if (headerResult.status === 'fulfilled' && headerResult.value?.ok) {
        const f = headerResult.value.fields || {}
        setNavLabels(prev => ({
          nav_catalogue_label: f.nav_catalogue_label || prev.nav_catalogue_label,
          nav_fitting_label:   f.nav_fitting_label   || prev.nav_fitting_label,
          nav_contact_label:   f.nav_contact_label   || prev.nav_contact_label,
        }))
      }
      if (annResult.status === 'fulfilled' && annResult.value?.ok) {
        const f = annResult.value.fields || {}
        setAnnouncementBar(prev => ({ ...prev, ...f }))
      }
      if (themeResult.status === 'fulfilled' && themeResult.value?.ok) {
        const f = themeResult.value.fields || {}
        setTheme(prev => ({
          colors: {
            navBg:   f.colors?.navBg   || prev.colors.navBg,
            primary: f.colors?.primary || prev.colors.primary,
          },
          fonts: {
            body: f.fonts?.body || prev.fonts.body,
          },
          site_name: f.site_name || prev.site_name,
          logo_sub:  f.logo_sub  || prev.logo_sub,
          logo_url:  f.logo_url  || prev.logo_url,
        }))
      }
    })
  }, [])
  // ──────────────────────────────────────────────────────────────────────────

  const refreshCartCount = () => {
    try {
      const items = loadCart()
      setCartCount(items.reduce((s, i) => s + (Number(i.qty) || 1), 0))
    } catch {
      setCartCount(0)
    }
  }

  useEffect(() => { refreshCartCount() }, [pathname])

  useEffect(() => {
    if (solid) return
    const handleScroll = () => setIsScrolled(window.scrollY > 40)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [solid])

  useEffect(() => {
    const user = getCurrentUser()
    setCurrentUser(user)
    refreshCartCount()
    const handleStorage = (e) => {
      if (!e.key || e.key === 'jce_current_user') setCurrentUser(getCurrentUser())
      refreshCartCount()
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  useEffect(() => {
    window.addEventListener('focus', refreshCartCount)
    return () => window.removeEventListener('focus', refreshCartCount)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setIsProfileOpen(false)
      if (searchRef.current  && !searchRef.current.contains(e.target))  closeSearch()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    document.body.style.overflow = isMobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isMobileOpen])

  useEffect(() => {
    if (isSearchOpen) setTimeout(() => searchInputRef.current?.focus(), 50)
  }, [isSearchOpen])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') closeSearch() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function openSearch()  { setIsSearchOpen(true); setIsProfileOpen(false) }
  function closeSearch() { setIsSearchOpen(false); setSearchQuery('') }

  function handleSearchSubmit(e) {
    e.preventDefault()
    const q = searchQuery.trim()
    if (!q) return
    closeSearch()
    router.push(`/gowns?search=${encodeURIComponent(q)}`)
  }

  const handleLogout = () => {
    logoutUser()
    setCurrentUser(null)
    setIsProfileOpen(false)
    setIsMobileOpen(false)
    refreshCartCount()
    router.push('/')
  }

  const isActive = isScrolled || solid

  // ── Resolved theme values: prop cmsTheme wins, then CMS fetch, then hardcoded defaults
  const resolvedNavBg  = cmsTheme?.colors?.navBg  || cmsTheme?.colors?.secondary || theme.colors.navBg  || '#1e1008'
  const resolvedPrimary = cmsTheme?.colors?.primary || theme.colors.primary || '#c8a96e'
  const resolvedFont   = cmsTheme?.fonts?.body     || theme.fonts.body      || "'Jost', sans-serif"

  const cmsVars = {
    '--cms-nav-bg':    resolvedNavBg,
    '--cms-primary':   resolvedPrimary,
    '--cms-font-body': resolvedFont,
  }

  const headerBgOverride = isActive ? { backgroundColor: resolvedNavBg } : {}

  // ── Logo values: CMS fields fall back to hardcoded strings ────────────────
  const logoMain = theme.site_name || 'JCE Bridal'
  const logoSub  = theme.logo_sub  || 'Boutique'
  const logoImg  = theme.logo_url  || '/images/jce_logo.svg'

  // ── Role-based dashboard link ─────────────────────────────────────────────
  const dashboardLink = currentUser?.role === 'admin'
    ? { href: '/admin', label: 'Admin' }
    : currentUser?.role === 'staff'
      ? { href: '/staff', label: 'Staff' }
      : null

  const showAnnouncement = announcementBar.enabled === 'true' && !!announcementBar.text

  return (
    <>
      {/* Announcement Bar */}
      {showAnnouncement && (
        <div
          style={{
            backgroundColor: announcementBar.bg_color || '#1a1a2e',
            color:           announcementBar.txt_color || '#f5e9d0',
            textAlign:       'center',
            fontSize:        '13px',
            fontWeight:      500,
            padding:         '9px 16px',
            lineHeight:      1.4,
          }}
        >
          {announcementBar.text}
          {announcementBar.link_url && announcementBar.link_label && (
            <>
              {' '}
              <a
                href={announcementBar.link_url}
                style={{
                  color:          announcementBar.txt_color || '#f5e9d0',
                  fontWeight:     700,
                  textDecoration: 'underline',
                  marginLeft:     4,
                }}
              >
                {announcementBar.link_label}
              </a>
            </>
          )}
        </div>
      )}

      <header
        className={`hdr${isActive ? ' scrolled' : ''}`}
        style={{ ...cmsVars, ...headerBgOverride }}
      >
        <div className="hdr-inner">

          {/* Nav links */}
          <nav className="hdr-nav">
            <Link href="/gowns">{navLabels.nav_catalogue_label}</Link>
          {/*   <Link href="/virtual-try-on">Virtual Try-On</Link>  */}
            <Link href="/fitting-room">{navLabels.nav_fitting_label}</Link>
            <Link href="/contact">{navLabels.nav_contact_label}</Link>
            {dashboardLink && (
              <Link href={dashboardLink.href} className="nav-admin">
                {dashboardLink.label}
              </Link>
            )}
          </nav>

          {/* Burger */}
          <button
            className={`hdr-burger${isMobileOpen ? ' open' : ''}`}
            aria-label="Toggle menu"
            onClick={() => setIsMobileOpen(!isMobileOpen)}
          >
            <span /><span /><span />
          </button>

          {/* Logo */}
          <Link href="/" className="hdr-logo" aria-label={`${logoMain} ${logoSub} — Home`}>
            <img src={logoImg} alt="" aria-hidden="true" />
            <div className="hdr-logo-text">
              <span className="hdr-logo-main">{logoMain}</span>
              <span className="hdr-logo-sub">{logoSub}</span>
            </div>
          </Link>

          {/* Actions */}
          <div className="hdr-actions">
            <button className="hdr-icon-btn" aria-label="Search" onClick={openSearch}>
              <img src="/images/search_logo.svg" alt="" aria-hidden="true" />
            </button>

            <div className="hdr-divider" />

            <Link
              href="/cart"
              className="hdr-icon-btn cart-wrap"
              aria-label={cartCount > 0 ? `Cart — ${cartCount} item${cartCount !== 1 ? 's' : ''}` : 'Cart'}
              onClick={refreshCartCount}
            >
              <img src="/images/cart_logo.svg" alt="" aria-hidden="true" />
              {cartCount > 0 && (
                <span className="cart-badge" aria-hidden="true">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              )}
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
                    <Link href="/profile"   className="drop-item" onClick={() => setIsProfileOpen(false)}>My Profile</Link>
                    <Link href="/my-orders"  className="drop-item" onClick={() => setIsProfileOpen(false)}>My Orders</Link>
                    <Link href="/favorites"  className="drop-item" onClick={() => setIsProfileOpen(false)}>Saved Gowns</Link>
                    {dashboardLink && (
                      <Link href={dashboardLink.href} className="drop-item" onClick={() => setIsProfileOpen(false)}>
                        {dashboardLink.label} Dashboard
                      </Link>
                    )}
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

      {/* Search overlay */}
      {isSearchOpen && (
        <div className="search-overlay" onClick={e => { if (e.target === e.currentTarget) closeSearch() }}>
          <div className="search-box" ref={searchRef}>
            <form className="search-form" onSubmit={handleSearchSubmit}>
              <span className="search-icon-inner" aria-hidden="true">
                <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </span>
              <input
                ref={searchInputRef}
                className="search-input"
                type="search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search catalogue…"
                autoComplete="off"
              />
              <button type="submit" className="search-submit">Search</button>
            </form>
            <div className="search-hint">
              Press <kbd>Enter</kbd> to search · <kbd>Esc</kbd> to close
            </div>
          </div>
        </div>
      )}

      {/* Mobile drawer */}
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
            <img src={logoImg} alt="" aria-hidden="true" />
            <div className="mobile-logo-text">
              <span className="mobile-logo-main">{logoMain}</span>
              <span className="mobile-logo-sub">{logoSub}</span>
            </div>
          </Link>

          <Link href="/gowns"        className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>{navLabels.nav_catalogue_label}</Link>
      {/*     <Link href="/virtual-try-on" className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>Virtual Try-On</Link> */}
          <Link href="/fitting-room" className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>{navLabels.nav_fitting_label}</Link>
          <Link href="/contact"      className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>{navLabels.nav_contact_label}</Link>
          <Link href="/cart"         className="mobile-nav-link" onClick={() => { setIsMobileOpen(false); refreshCartCount() }}>
            Cart{cartCount > 0 ? ` (${cartCount})` : ''}
          </Link>

          <form
            onSubmit={e => {
              e.preventDefault()
              const q = searchQuery.trim()
              if (!q) return
              setIsMobileOpen(false)
              closeSearch()
              router.push(`/gowns?search=${encodeURIComponent(q)}`)
            }}
            style={{ display: 'flex', gap: 8, margin: '12px 0' }}
          >
            <input
              type="search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search catalogue..."
              autoComplete="off"
              style={{
                flex: 1, padding: '10px 14px', borderRadius: 10,
                border: '1.5px solid #e0e0e0', fontSize: '.9rem',
                fontFamily: 'inherit', outline: 'none',
              }}
            />
            <button
              type="submit"
              style={{
                padding: '10px 16px', borderRadius: 10, border: 'none',
                background: '#111', color: '#fff', fontWeight: 600,
                fontSize: '.85rem', fontFamily: 'inherit', cursor: 'pointer',
              }}
            >Go</button>
          </form>

          {dashboardLink && (
            <Link href={dashboardLink.href} className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>
              {dashboardLink.label} Dashboard
            </Link>
          )}

          {currentUser ? (
            <>
              <p className="mobile-user-label">Signed in as {currentUser.name}</p>
              <Link href="/profile"   className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>My Profile</Link>
              <Link href="/my-orders"  className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>My Orders</Link>
              <Link href="/favorites"  className="mobile-nav-link" onClick={() => setIsMobileOpen(false)}>Saved Gowns</Link>
              <button className="mobile-nav-btn" style={{ color: 'var(--rose)' }} onClick={handleLogout}>
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