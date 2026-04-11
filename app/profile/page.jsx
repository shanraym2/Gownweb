'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser, logoutUser, updateUser, resetUserPassword, loadUsers } from '../utils/authClient'
import { getPasswordRuleChecks, passwordMeetsRules } from '../utils/authValidation'

// ─── helpers ────────────────────────────────────────────────────────────────

const PROFILE_KEY = 'jce_profile_extra'

function loadProfileExtra() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') }
  catch { return {} }
}

function saveProfileExtra(data) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(data))
}

async function hashPassword(pw) {
  if (!window.crypto?.subtle) return String(pw || '')
  const data   = new TextEncoder().encode(String(pw || ''))
  const digest = await window.crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── Avatar ──────────────────────────────────────────────────────────────────

function Avatar({ name }) {
  const initials = (name || 'G')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="profile-avatar" aria-hidden="true">
      <span>{initials}</span>
      <div className="profile-avatar-ring" />
    </div>
  )
}

// ─── Editable field ──────────────────────────────────────────────────────────

function EditableField({ label, name, type = 'text', value, editing, onChange, placeholder, maxLength }) {
  return (
    <div className={`profile-field ${editing ? 'profile-field--editing' : ''}`}>
      <label className="profile-field-label">{label}</label>
      {editing ? (
        <input
          className="profile-field-input"
          type={type} name={name} value={value}
          onChange={onChange} placeholder={placeholder || label}
          maxLength={maxLength} autoComplete="off"
        />
      ) : (
        <p className="profile-field-value">
          {value || <span className="profile-field-empty">Not set</span>}
        </p>
      )}
    </div>
  )
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, icon }) {
  return (
    <div className="profile-stat">
      <span className="profile-stat-icon" aria-hidden="true">{icon}</span>
      <span className="profile-stat-value">{value}</span>
      <span className="profile-stat-label">{label}</span>
    </div>
  )
}

// ─── Change Password Modal ────────────────────────────────────────────────────

function ChangePasswordModal({ email, onClose }) {
  const [step, setStep]                       = useState(1)
  const [otp, setOtp]                         = useState('')
  const [newPassword, setNewPassword]         = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPwd, setShowPwd]                 = useState(false)
  const [showConfirm, setShowConfirm]         = useState(false)
  const [error, setError]                     = useState('')
  const [submitting, setSubmitting]           = useState(false)
  const [devMode, setDevMode]                 = useState(false)

  const pwdChecks = useMemo(() => getPasswordRuleChecks(newPassword), [newPassword])
  const canSubmit = useMemo(
    () => passwordMeetsRules(newPassword) && newPassword === confirmPassword,
    [newPassword, confirmPassword]
  )

  const handleSendOtp = async () => {
    setError(''); setSubmitting(true)
    try {
      const res  = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose: 'reset-password' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) { setError(data.error || 'Failed to send code.'); return }
      setDevMode(!!data.devMode)
      setStep(2)
    } catch { setError('Network error. Please try again.') }
    finally { setSubmitting(false) }
  }

  const handleVerifyOtp = async (e) => {
    e.preventDefault(); setError('')
    if (!otp || otp.length !== 6) { setError('Enter the 6-digit code.'); return }
    setSubmitting(true)
    try {
      const res  = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: otp.trim(), purpose: 'reset-password' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) { setError(data.error || 'Invalid or expired code.'); return }
      setStep(3)
    } catch { setError('Verification failed. Try again.') }
    finally { setSubmitting(false) }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault(); setError('')
    if (!canSubmit) return
    try {
      const users      = loadUsers()
      const storedUser = users.find(u => u.email?.toLowerCase() === email?.toLowerCase())
      if (storedUser?.passwordHash) {
        const newHash = await hashPassword(newPassword)
        if (newHash === storedUser.passwordHash) {
          setError('New password must be different from your current password.')
          return
        }
      }
    } catch {}

    setSubmitting(true)
    try {
      const result = await resetUserPassword({ email, password: newPassword })
      if (!result.ok) { setError(result.error || 'Unable to update password.'); return }
      onClose(true)
    } finally { setSubmitting(false) }
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Change password">
      <div className="modal-box">
        <button className="modal-close" onClick={() => onClose(false)} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <span className="modal-label">ACCOUNT SECURITY</span>
        <h2 className="modal-title">Change password</h2>

        <div className="modal-steps" aria-hidden="true">
          {[1,2,3].map(n => (
            <div key={n} className={`modal-step-dot ${step >= n ? 'modal-step-dot--done' : ''}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="modal-body">
            <p className="modal-desc">
              We'll send a verification code to <strong>{email}</strong> to confirm it's you.
            </p>
            {error && <p className="modal-error">{error}</p>}
            <button className="btn btn-primary modal-btn" onClick={handleSendOtp} disabled={submitting}>
              {submitting ? 'Sending…' : 'Send verification code'}
            </button>
          </div>
        )}

        {step === 2 && (
          <form className="modal-body" onSubmit={handleVerifyOtp}>
            <p className="modal-desc">
              {devMode
                ? <>Check the <strong>terminal</strong> running <code>npm run dev</code> for your code.</>
                : <>Enter the 6-digit code sent to <strong>{email}</strong>.</>}
            </p>
            <div className="modal-field">
              <label className="modal-field-label">Verification code</label>
              <input
                className="modal-field-input modal-otp-input"
                type="text" inputMode="numeric" maxLength={6}
                value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="000000" autoFocus
              />
            </div>
            {error && <p className="modal-error">{error}</p>}
            <button type="submit" className="btn btn-primary modal-btn" disabled={submitting}>
              {submitting ? 'Verifying…' : 'Verify code'}
            </button>
            <button type="button" className="modal-back" onClick={() => { setStep(1); setOtp(''); setError('') }}>
              ← Back
            </button>
          </form>
        )}

        {step === 3 && (
          <form className="modal-body" onSubmit={handleResetPassword}>
            <div className="modal-field">
              <label className="modal-field-label">New password</label>
              <div className="modal-pwd-row">
                <input
                  className="modal-field-input"
                  type={showPwd ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setError('') }}
                  placeholder="Create a new password"
                  autoComplete="new-password" autoFocus
                />
                <button type="button" className="modal-show-pwd" onClick={() => setShowPwd(v => !v)}>
                  {showPwd ? 'Hide' : 'Show'}
                </button>
              </div>
              <ul className="modal-pwd-rules" aria-live="polite">
                <li className={pwdChecks.length ? 'rule-met' : ''}>At least 8 characters</li>
                <li className={pwdChecks.letter ? 'rule-met' : ''}>At least one letter</li>
                <li className={pwdChecks.number ? 'rule-met' : ''}>At least one number</li>
              </ul>
            </div>

            <div className="modal-field">
              <label className="modal-field-label">Confirm new password</label>
              <div className="modal-pwd-row">
                <input
                  className="modal-field-input"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError('') }}
                  placeholder="Confirm your new password"
                  autoComplete="new-password"
                />
                <button type="button" className="modal-show-pwd" onClick={() => setShowConfirm(v => !v)}>
                  {showConfirm ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {error && <p className="modal-error">{error}</p>}
            <button type="submit" className="btn btn-primary modal-btn" disabled={submitting || !canSubmit}>
              {submitting ? 'Saving…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter()

  const [user,          setUser         ] = useState(null)
  const [editing,       setEditing      ] = useState(false)
  const [saving,        setSaving       ] = useState(false)
  const [toast,         setToast        ] = useState(null)
  const [orders,        setOrders       ] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [showPwdModal,  setShowPwdModal ] = useState(false)
  const [form, setForm] = useState({
    name: '', email: '', phone: '',
    address: '', city: '', province: '', zip: '',
  })

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2800)
  }

  useEffect(() => {
    const existing = getCurrentUser()
    if (!existing) { router.replace('/login'); return }
    setUser(existing)

    const extra = loadProfileExtra()
    setForm({
      name:     existing.name  || '',
      email:    existing.email || '',
      phone:    extra.phone    || '',
      address:  extra.address  || '',
      city:     extra.city     || '',
      province: extra.province || '',
      zip:      extra.zip      || '',
    })

    fetch('/api/my-orders', {
      headers: { 'X-Customer-Email': existing.email }
    })
      .then(r => r.json())
      .then(data => { if (data.ok) setOrders((data.orders || []).slice(0, 3)) })
      .catch(() => {})
      .finally(() => setOrdersLoading(false))

  }, [router])

  const handleChange = (e) => {
    const { name, value } = e.target
    const val = name === 'phone' || name === 'zip' ? value.replace(/\D/g, '') : value
    setForm(prev => ({ ...prev, [name]: val }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      updateUser({ name: form.name, email: form.email })
      saveProfileExtra({
        phone: form.phone, address: form.address,
        city: form.city, province: form.province, zip: form.zip,
      })
      setUser(prev => ({ ...prev, name: form.name, email: form.email }))
      await new Promise(r => setTimeout(r, 500))
      setEditing(false)
      showToast('Profile updated')
    } finally { setSaving(false) }
  }

  const handleCancel = () => {
    const existing = getCurrentUser()
    const extra    = loadProfileExtra()
    setForm({
      name:     existing?.name  || '',
      email:    existing?.email || '',
      phone:    extra.phone     || '',
      address:  extra.address   || '',
      city:     extra.city      || '',
      province: extra.province  || '',
      zip:      extra.zip       || '',
    })
    setEditing(false)
  }

  const handleLogout = () => { logoutUser(); router.push('/') }

  const handlePwdModalClose = (success) => {
    setShowPwdModal(false)
    if (success) showToast('Password updated successfully')
  }

  const profileComplete = [
    form.name, form.email, form.phone,
    form.address, form.city, form.province, form.zip,
  ].filter(Boolean).length
  const completionPct = Math.round((profileComplete / 7) * 100)

  if (!user) return (
    <main className="auth-page">
      <Header />
      <section className="gowns-header-spacer" />
      <section className="profile-loading">
        <div className="profile-loading-dot" />
        <div className="profile-loading-dot" />
        <div className="profile-loading-dot" />
      </section>
      <Footer />
    </main>
  )

  return (
    <main className="auth-page profile-page">
      <Header solid />
      <section className="gowns-header-spacer" />

      {/* ── Hero ── */}
      <section className="profile-hero">
        <div className="profile-hero-inner">
          <Avatar name={user.name} />
          <div className="profile-hero-text">
            <span className="profile-label">YOUR ACCOUNT</span>
            <h1 className="profile-name">{user.name || 'Guest'}</h1>
            <span className="profile-member-since">
              Member since {user.createdAt
                ? new Date(user.createdAt).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
                : new Date().getFullYear()}
            </span>
          </div>
          <div className="profile-actions-top">
            {!editing ? (
              <button className="btn btn-outline profile-edit-btn" onClick={() => setEditing(true)}>
                Edit profile
              </button>
            ) : (
              <div className="profile-edit-controls">
                <button className="btn btn-outline" onClick={handleCancel} disabled={saving}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            )}
          </div>
        </div>

        {toast && (
          <div className={`profile-toast profile-toast--${toast.type}`} role="status">
            {toast.type === 'success' ? '✓' : '!'} {toast.msg}
          </div>
        )}
      </section>

      {/* ── Stats ── */}
      <section className="profile-stats-row">
        <div className="profile-stats-inner">
          <StatCard label="Orders"  value={ordersLoading ? '…' : orders.length} icon="🛍" />
          <StatCard label="Profile" value={`${completionPct}%`}                 icon="◈" />
        </div>
      </section>

      {/* ── Main ── */}
      <section className="profile-section">
        <div className="profile-grid">

          {/* ── Info card ── */}
          <div className="profile-card">
            <div className="profile-card-header">
              <h2 className="profile-card-title">Personal information</h2>
              <p className="profile-card-sub">
                {editing
                  ? 'Changes here auto-fill your checkout form.'
                  : 'Pre-fills your checkout. Click "Edit profile" to update.'}
              </p>
            </div>

            <div className="profile-fields">
              <div className="profile-fields-row">
                <EditableField label="Full name" name="name"  value={form.name}  editing={editing} onChange={handleChange} />
                <EditableField label="Email"     name="email" type="email" value={form.email} editing={editing} onChange={handleChange} />
              </div>
              <EditableField label="Phone number" name="phone" type="tel" value={form.phone} editing={editing} onChange={handleChange} maxLength={11} placeholder="09XXXXXXXXX" />
            </div>

            <div className="profile-divider" />

            <div className="profile-card-header">
              <h2 className="profile-card-title">Delivery address</h2>
            </div>
            <div className="profile-fields">
              <EditableField label="Street / Barangay" name="address"  value={form.address}  editing={editing} onChange={handleChange} />
              <div className="profile-fields-row">
                <EditableField label="City"     name="city"     value={form.city}     editing={editing} onChange={handleChange} />
                <EditableField label="Province" name="province" value={form.province} editing={editing} onChange={handleChange} />
              </div>
              <EditableField label="ZIP / Postal" name="zip" value={form.zip} editing={editing} onChange={handleChange} maxLength={6} />
            </div>

            <div className="profile-completion">
              <div className="profile-completion-label">
                <span>Profile completeness</span>
                <span>{completionPct}%</span>
              </div>
              <div className="profile-completion-track">
                <div className="profile-completion-fill" style={{ width: `${completionPct}%` }} />
              </div>
            </div>
          </div>

          {/* ── Sidebar ── */}
          <div className="profile-sidebar">

            <div className="profile-card profile-card--sm">
              <h2 className="profile-card-title">Security</h2>
              <p className="profile-card-sub" style={{ marginBottom: '1rem' }}>
                Keep your account safe with a strong password.
              </p>
              <button className="btn btn-outline profile-security-btn" onClick={() => setShowPwdModal(true)}>
                Change password
              </button>
            </div>

            <div className="profile-card profile-card--sm">
              <h2 className="profile-card-title">Quick links</h2>
              <div className="profile-links">
                {[
                  { href: '/my-orders', label: 'My orders'        },
                  { href: '/gowns',     label: 'Browse collection' },
                  { href: '/cart',      label: 'View cart'         },
                ].map(({ href, label }) => (
                  <Link key={href} href={href} className="profile-link">
                    <span>{label}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </Link>
                ))}
              </div>
            </div>

            <div className="profile-card profile-card--sm">
              <h2 className="profile-card-title">Recent orders</h2>
              {ordersLoading ? (
                <p className="profile-empty-orders">Loading…</p>
              ) : orders.length === 0 ? (
                <p className="profile-empty-orders">
                  No orders yet.{' '}
                  <Link href="/gowns" className="profile-link-inline">Shop now →</Link>
                </p>
              ) : (
                <ul className="profile-orders-list">
                  {orders.map((o, i) => (
                    <li key={i} className="profile-order-item">
                      <span className="profile-order-date">
                        {new Date(o.createdAt).toLocaleDateString('en-PH', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </span>
                      <span className="profile-order-total">
                        ₱{Number(o.total ?? o.subtotal ?? 0).toLocaleString('en-PH')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/my-orders" className="profile-see-all">See all orders →</Link>
            </div>

            <div className="profile-card profile-card--sm">
              <h2 className="profile-card-title">Account</h2>
              <button className="btn btn-outline profile-logout-btn" onClick={handleLogout}>
                Sign out
              </button>
            </div>

          </div>
        </div>
      </section>

      {showPwdModal && (
        <ChangePasswordModal email={user.email} onClose={handlePwdModalClose} />
      )}

      <Footer />
    </main>
  )
}