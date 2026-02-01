'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
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

export default function AdminLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState(null)
  const [secret, setSecret] = useState('')
  const [secretError, setSecretError] = useState('')
  const [checking, setChecking] = useState(true)
  const [refreshingRole, setRefreshingRole] = useState(false)
  const [roleError, setRoleError] = useState('')

  useEffect(() => {
    const u = getCurrentUser()
    setUser(u)
    setChecking(false)
  }, [router])

  const handleSecretSubmit = (e) => {
    e.preventDefault()
    setSecretError('')
    if (!secret.trim()) {
      setSecretError('Enter admin secret.')
      return
    }
    setAdminSecret(secret.trim())
    setSecret('')
    window.location.reload()
  }

  const handleLogoutAdmin = () => {
    sessionStorage.removeItem(ADMIN_SECRET_KEY)
  }

  const handleRefreshRole = async () => {
    const u = getCurrentUser()
    if (!u?.email) {
      setRoleError('You are not logged in. Go to Login first.')
      return
    }
    setRefreshingRole(true)
    setRoleError('')
    try {
      const res = await fetch(`/api/auth/role?email=${encodeURIComponent(u.email)}`)
      const data = await res.json()
      if (data.ok && data.role) {
        setCurrentUserRole(data.role)
        if (data.role === 'admin') {
          window.location.reload()
          return
        }
        if (data.adminEmailConfigured === false) {
          setRoleError('ADMIN_EMAIL is not set on the server. Put .env.local in the project root (same folder as package.json) with a line: ADMIN_EMAIL=' + u.email + ' then save and restart the dev server (stop it and run npm run dev again).')
        } else {
          setRoleError('ADMIN_EMAIL is set but your email does not match. In .env.local use exactly: ADMIN_EMAIL=' + u.email + ' with no extra spaces or quotes, then restart the dev server.')
        }
      } else {
        setRoleError('Could not fetch role. Restart the dev server after setting ADMIN_EMAIL.')
      }
    } catch {
      setRoleError('Request failed. Is the dev server running?')
    } finally {
      setRefreshingRole(false)
    }
  }

  if (checking) {
    return (
      <div className="admin-loading">
        <p>Loading...</p>
      </div>
    )
  }

  if (!user || user.role !== 'admin') {
    return (
      <div className="admin-loading">
        <div className="admin-access-denied">
          <h1>Admin access required</h1>
          <p>
            You need to log in with the account set as <strong>ADMIN_EMAIL</strong> in .env.local
            to view the admin panel.
          </p>
          {user ? (
            <>
              <p>You are logged in as <strong>{user.email}</strong> (role: {user.role || 'none'}).</p>
              <p>If this is your admin email, click below to re-check — the server will update your role and reload.</p>
              <button
                type="button"
                onClick={handleRefreshRole}
                disabled={refreshingRole}
                className="btn btn-primary"
                style={{ marginTop: 16 }}
              >
                {refreshingRole ? 'Checking…' : 'Re-check admin access'}
              </button>
              {roleError && <p className="auth-error" style={{ marginTop: 12 }}>{roleError}</p>}
            </>
          ) : (
            <p>Log in at the main site first — the &quot;Admin&quot; link will appear in the header after you sign in.</p>
          )}
          <a href="/login" className="btn btn-primary" style={{ marginTop: 16 }}>Go to Login</a>
          <a href="/" className="btn btn-outline" style={{ marginTop: 12, display: 'block' }}>Back to home</a>
        </div>
      </div>
    )
  }

  const hasSecret = typeof window !== 'undefined' && getAdminSecret()

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <Link href="/admin" className="admin-logo">JCE Admin</Link>
        </div>
        <nav className="admin-nav">
          <Link href="/admin" className={pathname === '/admin' ? 'active' : ''}>Dashboard</Link>
          <Link href="/admin/gowns" className={pathname === '/admin/gowns' ? 'active' : ''}>Gowns</Link>
          <Link href="/admin/orders" className={pathname === '/admin/orders' ? 'active' : ''}>Orders</Link>
          <Link href="/admin/users" className={pathname === '/admin/users' ? 'active' : ''}>Users</Link>
        </nav>
        <div className="admin-sidebar-footer">
          <Link href="/" className="admin-back">← Back to site</Link>
          <a href="/" onClick={handleLogoutAdmin} className="admin-back">Clear admin session</a>
        </div>
      </aside>
      <main className="admin-main">
        {!hasSecret ? (
          <div className="admin-secret-gate">
            <h1>Admin access</h1>
            <p>Enter the admin secret to continue.</p>
            <form onSubmit={handleSecretSubmit} className="admin-secret-form">
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Admin secret"
                autoComplete="off"
                className="admin-secret-input"
              />
              {secretError && <p className="auth-error">{secretError}</p>}
              <button type="submit" className="btn btn-primary">Continue</button>
            </form>
            <p className="admin-secret-hint">Set ADMIN_SECRET in .env.local. The &quot;Admin&quot; link in the header only appears when you&apos;re logged in with the email set as ADMIN_EMAIL.</p>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  )
}
