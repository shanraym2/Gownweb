'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { getCurrentUser, setCurrentUserRole, logoutUser } from '../utils/authClient'

const ADMIN_SECRET_KEY = 'jce_admin_secret'

export function getAdminSecret() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ADMIN_SECRET_KEY)
}
export function setAdminSecret(secret) {
  if (typeof window === 'undefined') return
  localStorage.setItem(ADMIN_SECRET_KEY, secret)
}
export function clearAdminSecret() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(ADMIN_SECRET_KEY)
}

// ── Nav links per role ────────────────────────────────────────────────────────
// Admin-only routes: dashboard, users, contents
// Staff routes: catalogue, orders, sales, customers (no users/contents/dashboard mgmt)

const ADMIN_NAV_LINKS = [
  { href: '/admin',           label: 'Dashboard', exact: true },
  { href: '/admin/gowns',     label: 'Catalogue'              },
  { href: '/admin/orders',    label: 'Orders'                 },
  { href: '/admin/dashboard', label: 'Sales'                  },
  { href: '/admin/users',     label: 'Users'                  },
  { href: '/admin/contents',  label: 'Content'                },
]

const STAFF_NAV_LINKS = [
  { href: '/staff',           label: 'Dashboard', exact: true },
  { href: '/admin/gowns',     label: 'Catalogue'              },
  { href: '/admin/orders',    label: 'Orders'                 },
  { href: '/admin/dashboard', label: 'Sales'                  },
  { href: '/admin/users',     label: 'Customers'              },
]

// Routes that are restricted to admins only
const ADMIN_ONLY_ROUTES = ['/admin/contents', '/admin/users']

// ── Theme hook ────────────────────────────────────────────────────────────────

function useAdminTheme() {
  const [theme, setTheme] = useState('system')

  useEffect(() => {
    const stored = localStorage.getItem('jce_admin_theme') || 'system'
    setTheme(stored)
    applyTheme(stored)
  }, [])

  function applyTheme(t) {
    const root = document.documentElement
    if (t === 'light')       root.setAttribute('data-adm-theme', 'light')
    else if (t === 'dark')   root.setAttribute('data-adm-theme', 'dark')
    else                     root.removeAttribute('data-adm-theme')
  }

  function toggle() {
    setTheme(prev => {
      const next = prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light'
      localStorage.setItem('jce_admin_theme', next)
      applyTheme(next)
      return next
    })
  }

  return { theme, toggle }
}

// ── Secret gate ───────────────────────────────────────────────────────────────

function SecretGate({ onSuccess }) {
  const [secret,     setSecret    ] = useState('')
  const [error,      setError     ] = useState('')
  const [validating, setValidating] = useState(false)

  useEffect(() => {
    const stored = getAdminSecret()
    if (stored) validateSecret(stored, false)
  }, [])

  async function validateSecret(value, store = true) {
    const trimmed = value.trim()
    if (!trimmed) { setError('Enter the admin secret.'); return }
    setValidating(true); setError('')
    try {
      const res = await fetch('/api/admin/ping', {
        headers: { 'X-Admin-Secret': trimmed },
      })
      if (res.status === 401) {
        clearAdminSecret()
        setError('Incorrect secret. Check ADMIN_SECRET in your .env.local.')
        return
      }
      if (store) setAdminSecret(trimmed)
      onSuccess()
    } catch {
      if (store) setAdminSecret(trimmed)
      onSuccess()
    } finally {
      setValidating(false)
    }
  }

  return (
    <div className="adm-secret-gate">
      <h1 className="adm-secret-title">Enter admin secret</h1>
      <p className="adm-secret-hint">
        Set <code>ADMIN_SECRET</code> in your <code>.env.local</code> file,
        then enter the same value here. It will be remembered until you clear it.
      </p>
      <form
        onSubmit={e => { e.preventDefault(); validateSecret(secret) }}
        className="adm-secret-form"
      >
        <input
          type="password"
          value={secret}
          onChange={e => { setSecret(e.target.value); setError('') }}
          placeholder="Admin secret"
          autoComplete="off"
          autoFocus
          className="adm-input"
        />
        {error && <p className="adm-error-msg">{error}</p>}
        <button type="submit" disabled={validating} className="adm-btn">
          {validating ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}

// ── Theme icons ───────────────────────────────────────────────────────────────

function ThemeToggle({ theme, onToggle }) {
  const icons = {
    light:  { svg: <SunIcon />,    label: 'Light mode'   },
    dark:   { svg: <MoonIcon />,   label: 'Dark mode'    },
    system: { svg: <SystemIcon />, label: 'System theme' },
  }
  const { svg, label } = icons[theme] || icons.system
  return (
    <button
      className="adm-theme-toggle"
      onClick={onToggle}
      aria-label={`Current: ${label}. Click to switch.`}
      title={label}
    >
      {svg}
      <span>{label}</span>
    </button>
  )
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1"  x2="12" y2="3"/>   <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22"  y1="4.22"  x2="5.64"  y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1"  y1="12" x2="3"  y2="12"/>  <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36"/>
      <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"/>
    </svg>
  )
}
function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}
function SystemIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <line x1="8"  y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  )
}

// ── Main layout ───────────────────────────────────────────────────────────────

export default function AdminLayout({ children }) {
  const pathname = usePathname()
  const router   = useRouter()
  const { theme, toggle } = useAdminTheme()

  const [user,           setUser          ] = useState(null)
  const [checking,       setChecking      ] = useState(true)
  const [secretOk,       setSecretOk      ] = useState(false)
  const [sidebarOpen,    setSidebarOpen   ] = useState(false)
  const [refreshingRole, setRefreshingRole] = useState(false)
  const [roleError,      setRoleError     ] = useState('')

  useEffect(() => {
    setUser(getCurrentUser())
    if (getAdminSecret()) setSecretOk(true)
    setChecking(false)
  }, [])

  useEffect(() => { setSidebarOpen(false) }, [pathname])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = sidebarOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [sidebarOpen])

  // Block staff from admin-only routes
  useEffect(() => {
    if (!user) return
    if (user.role === 'staff' && ADMIN_ONLY_ROUTES.some(r => pathname.startsWith(r))) {
      router.replace('/staff')
    }
  }, [user, pathname])

  const handleRefreshRole = async () => {
    const u = getCurrentUser()
    if (!u?.email) { setRoleError('You are not logged in.'); return }
    setRefreshingRole(true); setRoleError('')
    try {
      const res  = await fetch(`/api/auth/role?email=${encodeURIComponent(u.email)}`)
      const data = await res.json()
      if (data.ok && data.role) {
        setCurrentUserRole(data.role)
        if (['admin', 'staff'].includes(data.role)) { window.location.reload(); return }
        setRoleError(
          data.adminEmailConfigured === false
            ? `ADMIN_EMAIL not set. Add ADMIN_EMAIL=${u.email} to .env.local and restart.`
            : `Role is "${data.role}". Make sure ADMIN_EMAIL or STAFF_EMAILS includes ${u.email} in .env.local, then restart.`
        )
      } else {
        setRoleError('Could not fetch role. Is the server running?')
      }
    } catch {
      setRoleError('Request failed.')
    } finally {
      setRefreshingRole(false)
    }
  }

  const handleLogout = () => {
    const role = user?.role
    logoutUser()
    clearAdminSecret()
    setSecretOk(false)
    setUser(null)
    setSidebarOpen(false)
    // Redirect to the appropriate panel login, not the homepage
    router.replace(role === 'staff' ? '/staff' : '/admin')
  }

  if (checking) return (
    <div className="adm-loading-screen">
      <span className="adm-loading-text">Loading…</span>
    </div>
  )

  if (!user || !['admin', 'staff'].includes(user.role)) return (
    <div className="adm-access-screen">
      <div className="adm-access-card">
        <div className="adm-access-icon">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#dc2626" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
        </div>
        <h1 className="adm-access-title">Access required</h1>
        <p className="adm-access-desc">Sign in with an account that has admin or staff access.</p>
        {user ? (
          <>
            <div className="adm-user-info-box">
              Signed in as <strong>{user.email}</strong>
              <span className="adm-role-pill">{user.role || 'no role'}</span>
            </div>
            <button onClick={handleRefreshRole} disabled={refreshingRole} className="adm-access-btn-primary">
              {refreshingRole ? 'Checking…' : 'Re-check access'}
            </button>
            {roleError && <p className="adm-role-error">{roleError}</p>}
          </>
        ) : (
          <Link href="/login" className="adm-access-btn-primary">Go to login</Link>
        )}
      </div>
    </div>
  )

  const isAdmin  = user.role === 'admin'
  const navLinks = isAdmin ? ADMIN_NAV_LINKS : STAFF_NAV_LINKS
  const homeHref = isAdmin ? '/admin' : '/staff'

  return (
    <div className="adm-layout">

      <style>{`
        /* 1 ── Dark default */
        :root {
          --c-bg:#0f0f11; --c-surface:#18181c; --c-surface2:#1e1e23;
          --c-border:#2a2a32; --c-border2:#333340; --c-text:#e8e6e3;
          --c-muted:#7c7a85; --c-subtle:#4a4856;
          --c-gold:#c8a96e; --c-gold-dim:rgba(200,169,110,.15); --c-gold-border:rgba(200,169,110,.25);
          --c-blue:#4a7fd4; --c-blue-dim:rgba(74,127,212,.12); --c-blue-border:rgba(74,127,212,.25);
          --c-green:#4caf82; --c-green-dim:rgba(76,175,130,.12);
          --c-red:#c45c5c; --c-red-dim:rgba(196,92,92,.12); --c-red-border:rgba(196,92,92,.25);
          --c-warn:#d4943a; --c-warn-dim:rgba(212,148,58,.12);
          --radius:8px; --radius-lg:12px; --radius-xl:16px; --sidebar-w:480px;
        }

        /* 2 ── OS light preference — only when no manual override is set */
        @media (prefers-color-scheme: light) {
          :root:not([data-adm-theme="dark"]) {
            --c-bg:#f5f4f0; --c-surface:#ffffff; --c-surface2:#f0eeea;
            --c-border:rgba(0,0,0,.10); --c-border2:rgba(0,0,0,.18);
            --c-text:#111111; --c-muted:#555555; --c-subtle:#999999;
            --c-gold:#9a6f2e; --c-gold-dim:rgba(154,111,46,.10); --c-gold-border:rgba(154,111,46,.25);
            --c-blue:#2d62b8; --c-blue-dim:rgba(45,98,184,.08); --c-blue-border:rgba(45,98,184,.22);
            --c-green:#1e7a4e; --c-green-dim:rgba(30,122,78,.09);
            --c-red:#b33030; --c-red-dim:rgba(179,48,48,.08); --c-red-border:rgba(179,48,48,.22);
            --c-warn:#9a5a10; --c-warn-dim:rgba(154,90,16,.09);
          }
        }

        /* 3 ── Manual toggle: highest specificity, always wins */
        [data-adm-theme="light"] {
          --c-bg:#f5f4f0; --c-surface:#ffffff; --c-surface2:#f0eeea;
          --c-border:rgba(0,0,0,.10); --c-border2:rgba(0,0,0,.18);
          --c-text:#111111; --c-muted:#555555; --c-subtle:#999999;
          --c-gold:#9a6f2e; --c-gold-dim:rgba(154,111,46,.10); --c-gold-border:rgba(154,111,46,.25);
          --c-blue:#2d62b8; --c-blue-dim:rgba(45,98,184,.08); --c-blue-border:rgba(45,98,184,.22);
          --c-green:#1e7a4e; --c-green-dim:rgba(30,122,78,.09);
          --c-red:#b33030; --c-red-dim:rgba(179,48,48,.08); --c-red-border:rgba(179,48,48,.22);
          --c-warn:#9a5a10; --c-warn-dim:rgba(154,90,16,.09);
        }
        [data-adm-theme="dark"] {
          --c-bg:#0f0f11; --c-surface:#18181c; --c-surface2:#1e1e23;
          --c-border:#2a2a32; --c-border2:#333340; --c-text:#e8e6e3;
          --c-muted:#7c7a85; --c-subtle:#4a4856;
          --c-gold:#c8a96e; --c-gold-dim:rgba(200,169,110,.15); --c-gold-border:rgba(200,169,110,.25);
          --c-blue:#4a7fd4; --c-blue-dim:rgba(74,127,212,.12); --c-blue-border:rgba(74,127,212,.25);
          --c-green:#4caf82; --c-green-dim:rgba(76,175,130,.12);
          --c-red:#c45c5c; --c-red-dim:rgba(196,92,92,.12); --c-red-border:rgba(196,92,92,.25);
          --c-warn:#d4943a; --c-warn-dim:rgba(212,148,58,.12);
        }
      `}</style>

      {/* Mobile top bar */}
      <div className="adm-topnav">
        <button
          className="adm-hamburger"
          onClick={() => setSidebarOpen(v => !v)}
          aria-label="Toggle menu"
        >
          {sidebarOpen ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6"  x2="6"  y2="18"/>
              <line x1="6"  y1="6"  x2="18" y2="18"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3"  y1="6"  x2="21" y2="6"/>
              <line x1="3"  y1="12" x2="21" y2="12"/>
              <line x1="3"  y1="18" x2="21" y2="18"/>
            </svg>
          )}
        </button>
        <div className="adm-topnav-brand">JCE Bridal · {isAdmin ? 'Admin' : 'Staff'}</div>
        <button className="adm-topnav-back" onClick={handleLogout}>Logout</button>
      </div>

      {sidebarOpen && (
        <div className="adm-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`adm-sidebar${sidebarOpen ? ' adm-sidebar--open' : ''}`}>
        <div className="adm-sidebar-brand">
          <Link href={homeHref} onClick={() => setSidebarOpen(false)}>
            <div className="adm-brand-name">JCE Bridal</div>
            <div className="adm-brand-sub">{isAdmin ? 'Admin panel' : 'Staff panel'}</div>
          </Link>
        </div>

        <nav className="adm-nav">
          {navLinks.map(({ href, label, exact }) => {
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
          <ThemeToggle theme={theme} onToggle={toggle} />
          <div className="adm-footer-divider" />
          <button
            className="adm-footer-btn"
            onClick={() => { clearAdminSecret(); setSecretOk(false) }}
          >
            Clear secret
          </button>
          <button
            className="adm-footer-btn adm-footer-btn--logout"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="adm-main">
        {!secretOk
          ? <SecretGate onSuccess={() => setSecretOk(true)} />
          : children
        }
      </main>
    </div>
  )
}