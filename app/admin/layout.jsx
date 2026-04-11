'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getCurrentUser, setCurrentUserRole } from '../utils/authClient'

const ADMIN_SECRET_KEY = 'jce_admin_secret'

export function getAdminSecret() {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(ADMIN_SECRET_KEY)
}
export function setAdminSecret(secret) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(ADMIN_SECRET_KEY, secret)
}

const NAV_LINKS = [
  { href: '/admin',           label: 'Dashboard', exact: true },
  { href: '/admin/gowns',     label: 'Gowns'     },
  { href: '/admin/orders',    label: 'Orders'    },
  { href: '/admin/dashboard', label: 'Sales'     },
  { href: '/admin/users',     label: 'Users'     },
]

export default function AdminLayout({ children }) {
  const pathname = usePathname()
  const [user,           setUser          ] = useState(null)
  const [secret,         setSecret        ] = useState('')
  const [secretError,    setSecretError   ] = useState('')
  const [checking,       setChecking      ] = useState(true)
  const [refreshingRole, setRefreshingRole] = useState(false)
  const [roleError,      setRoleError     ] = useState('')
  const [sidebarOpen,    setSidebarOpen   ] = useState(false)

  useEffect(() => { setUser(getCurrentUser()); setChecking(false) }, [])

  // Close sidebar on route change
  useEffect(() => { setSidebarOpen(false) }, [pathname])

  // Prevent body scroll when sidebar is open on mobile
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = sidebarOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [sidebarOpen])

  const handleSecretSubmit = (e) => {
    e.preventDefault()
    if (!secret.trim()) { setSecretError('Enter the admin secret.'); return }
    setAdminSecret(secret.trim())
    setSecret('')
    window.location.reload()
  }

  const handleRefreshRole = async () => {
    const u = getCurrentUser()
    if (!u?.email) { setRoleError('You are not logged in.'); return }
    setRefreshingRole(true); setRoleError('')
    try {
      const res  = await fetch(`/api/auth/role?email=${encodeURIComponent(u.email)}`)
      const data = await res.json()
      if (data.ok && data.role) {
        setCurrentUserRole(data.role)
        if (data.role === 'admin') { window.location.reload(); return }
        setRoleError(
          data.adminEmailConfigured === false
            ? `ADMIN_EMAIL not set. Add ADMIN_EMAIL=${u.email} to .env.local and restart.`
            : `Email mismatch. Use ADMIN_EMAIL=${u.email} in .env.local (no quotes) and restart.`
        )
      } else {
        setRoleError('Could not fetch role. Is the server running?')
      }
    } catch { setRoleError('Request failed.') }
    finally  { setRefreshingRole(false) }
  }

  if (checking) return (
    <div className="adm-loading-screen">
      <span className="adm-loading-text">Loading…</span>
    </div>
  )

  if (!user || user.role !== 'admin') return (
    <div className="adm-access-screen">
      <div className="adm-access-card">
        <div className="adm-access-icon">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24"
            stroke="#dc2626" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
        </div>
        <h1 className="adm-access-title">Admin access required</h1>
        <p className="adm-access-desc">
          Sign in with the account set as <code>ADMIN_EMAIL</code> in <code>.env.local</code>.
        </p>
        {user ? (
          <>
            <div className="adm-user-info-box">
              Signed in as <strong>{user.email}</strong>
              <span className="adm-role-pill">{user.role || 'no role'}</span>
            </div>
            <button onClick={handleRefreshRole} disabled={refreshingRole} className="adm-access-btn-primary">
              {refreshingRole ? 'Checking…' : 'Re-check admin access'}
            </button>
            {roleError && <p className="adm-role-error">{roleError}</p>}
          </>
        ) : (
          <Link href="/login" className="adm-access-btn-primary">Go to login</Link>
        )}
        <Link href="/" className="adm-access-btn-outline">Back to home</Link>
      </div>
    </div>
  )

  const hasSecret = getAdminSecret()

  return (
    <>
      <div className="adm-layout">

        {/* ── Mobile top bar ── */}
        <div className="adm-topnav">
          <button
            className="adm-hamburger"
            onClick={() => setSidebarOpen(v => !v)}
            aria-label="Toggle menu"
          >
            {sidebarOpen ? (
              // X icon
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            ) : (
              // Hamburger icon
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6"  x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            )}
          </button>
          <div className="adm-topnav-brand">JCE Bridal · Admin</div>
          <Link href="/" className="adm-topnav-back">← Site</Link>
        </div>

        {/* ── Backdrop ── */}
        {sidebarOpen && (
          <div
            className="adm-sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── Sidebar ── */}
        <aside className={`adm-sidebar${sidebarOpen ? ' adm-sidebar--open' : ''}`}>
          <div className="adm-sidebar-brand">
            <Link href="/admin" onClick={() => setSidebarOpen(false)}>
              <div className="adm-brand-name">JCE Bridal</div>
              <div className="adm-brand-sub">Admin panel</div>
            </Link>
          </div>

          <nav className="adm-nav">
            {NAV_LINKS.map(({ href, label, exact }) => {
              const active = exact ? pathname === href : pathname.startsWith(href)
              return (
                <Link
                  key={href}
                  href={href}
                  className={`adm-nav-link${active ? ' active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <span className="adm-nav-dot" />
                  {label}
                </Link>
              )
            })}
          </nav>

          <div className="adm-sidebar-footer">
            <Link href="/" className="adm-footer-btn">← Back to site</Link>
            <button
              className="adm-footer-btn"
              onClick={() => { sessionStorage.removeItem(ADMIN_SECRET_KEY); window.location.reload() }}
            >
              Clear session
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <main className="adm-main">
          {!hasSecret ? (
            <div className="adm-secret-gate">
              <h1 className="adm-secret-title">Enter admin secret</h1>
              <p className="adm-secret-hint">
                Set <code>ADMIN_SECRET</code> in your <code>.env.local</code> file.
              </p>
              <form onSubmit={handleSecretSubmit} className="adm-secret-form">
                <input
                  type="password"
                  value={secret}
                  onChange={e => setSecret(e.target.value)}
                  placeholder="Admin secret"
                  autoComplete="off"
                  className="adm-input"
                />
                {secretError && <p className="adm-error-msg">{secretError}</p>}
                <button type="submit" className="adm-btn">Continue</button>
              </form>
            </div>
          ) : children}
        </main>
      </div>
    </>
  )
}

