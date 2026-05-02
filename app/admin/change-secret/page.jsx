'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { getAdminSecret } from '../adminSecret'

export default function ChangeSecretPage() {
  const [currentSecret, setCurrentSecret] = useState('')

  // Read from localStorage after mount (client-only)
  useEffect(() => {
    setCurrentSecret(getAdminSecret() || '')
  }, [])

  const [stage,      setStage     ] = useState('password')
  const [adminEmail, setAdminEmail] = useState('')
  const [password,   setPassword  ] = useState('')
  const [otp,        setOtp       ] = useState('')
  const [newSecret,  setNewSecret ] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [error,      setError     ] = useState('')
  const [loading,    setLoading   ] = useState(false)
  const [devMode,    setDevMode   ] = useState(false)

  // ── Step 1: verify password → send OTP ───────────────────────────────────
  async function handleSendOtp(e) {
    e.preventDefault()
    setError('')
    if (!adminEmail.trim()) return setError('Enter your admin email.')
    if (!password)          return setError('Enter your password.')

    setLoading(true)
    try {
      const res  = await fetch('/api/admin/change-secret', {
        method:  'POST',
        headers: {
          'Content-Type':   'application/json',
          'X-Admin-Secret': currentSecret,
        },
        body: JSON.stringify({ step: 'send_otp', adminEmail, password }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error || 'Failed.'); return }
      setDevMode(data.devMode)
      setStage('otp')
    } catch {
      setError('Could not connect. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: verify OTP + new secret → change ─────────────────────────────
  async function handleChange(e) {
    e.preventDefault()
    setError('')
    if (!otp.trim())       return setError('Enter the 6-digit code.')
    if (!newSecret.trim()) return setError('Enter a new secret.')

    setLoading(true)
    try {
      const res  = await fetch('/api/admin/change-secret', {
        method:  'POST',
        headers: {
          'Content-Type':   'application/json',
          'X-Admin-Secret': currentSecret,
        },
        body: JSON.stringify({ step: 'change', adminEmail, password, otp, newSecret }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error || 'Failed.'); return }
      setStage('done')
    } catch {
      setError('Could not connect. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Stage: password ───────────────────────────────────────────────────────
  if (stage === 'password') return (
    <div className="adm-page" style={{ maxWidth: 480 }}>
      <div className="adm-topbar">
        <h1 className="adm-page-title">Change admin secret</h1>
      </div>

      <div className="adm-card">
        <p style={{ fontSize: 14, color: 'var(--adm-text-2)', margin: '0 0 20px', lineHeight: 1.6 }}>
          Enter your admin email and account password to receive a one-time verification code.
        </p>

        {error && <div className="adm-error-msg" style={{ marginBottom: 16 }}>{error}</div>}

        <form onSubmit={handleSendOtp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="adm-form-row">
            <label className="adm-label">Admin email</label>
            <input
              className="adm-input"
              type="email"
              value={adminEmail}
              onChange={e => { setAdminEmail(e.target.value); setError('') }}
              placeholder="admin@example.com"
              autoFocus
            />
          </div>
          <div className="adm-form-row">
            <label className="adm-label">Current password</label>
            <input
                className="adm-input"
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                placeholder="••••••••"
                autoComplete="off"
                />
          </div>
          <div className="adm-form-actions">
            <button type="submit" className="adm-btn" disabled={loading}>
              {loading ? 'Sending code…' : 'Send verification code'}
            </button>
            <Link href="/admin" className="adm-back-link">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  )

  // ── Stage: otp + new secret ───────────────────────────────────────────────
  if (stage === 'otp') return (
    <div className="adm-page" style={{ maxWidth: 480 }}>
      <div className="adm-topbar">
        <h1 className="adm-page-title">Verify and set new secret</h1>
      </div>

      <div className="adm-card">
        {devMode ? (
          <div className="adm-error-msg" style={{
            background: 'var(--adm-warn-bg)', color: 'var(--adm-warn)',
            borderColor: 'var(--adm-warn)', marginBottom: 20,
          }}>
            <strong>Dev mode:</strong> OTP printed to your terminal (no Gmail credentials configured).
          </div>
        ) : (
          <p style={{ fontSize: 14, color: 'var(--adm-text-2)', margin: '0 0 20px', lineHeight: 1.6 }}>
            A 6-digit code was sent to <strong>{adminEmail}</strong>. It expires in 10 minutes.
          </p>
        )}

        {error && <div className="adm-error-msg" style={{ marginBottom: 16 }}>{error}</div>}

        <form onSubmit={handleChange} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="adm-form-row">
                <label className="adm-label">Verification code</label>
                <input
                className="adm-input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={e => { setOtp(e.target.value.replace(/\D/g, '')); setError('') }}
                placeholder="123456"
                autoComplete="off"
                style={{ letterSpacing: '0.2em', fontWeight: 700 }}
                />
            </div>

            <div className="adm-form-row">
                <label className="adm-label">New admin secret</label>
                <div style={{ display: 'flex', gap: 8 }}>
                <input
                    className="adm-input"
                    type={showSecret ? 'text' : 'password'}
                    value={newSecret}
                    onChange={e => { setNewSecret(e.target.value); setError('') }}
                    placeholder="min. 16 characters, no spaces"
                    style={{ flex: 1 }}
                    autoComplete="new-password"
                />
                <button
                    type="button"
                    className="adm-btn-sm"
                    onClick={() => setShowSecret(v => !v)}
                >
                    {showSecret ? 'Hide' : 'Show'}
                </button>
                </div>
                {newSecret && (
                <span className="adm-field-hint" style={{
                    color: newSecret.trim().length >= 16 && !/\s/.test(newSecret)
                    ? 'var(--adm-success)' : 'var(--adm-danger)',
                }}>
                    {newSecret.trim().length < 16
                    ? `${16 - newSecret.trim().length} more character${16 - newSecret.trim().length !== 1 ? 's' : ''} needed`
                    : /\s/.test(newSecret)
                        ? 'No spaces allowed'
                        : '✓ Looks good'}
                </span>
                )}
            </div>

            <p className="adm-field-hint">
                The new secret will be written to <code>.env.local</code>. You must{' '}
                <strong>restart the server</strong> for it to take effect, then clear
                your stored secret and re-enter the new one.
            </p>

            <div className="adm-form-actions">
                <button type="submit" className="adm-btn" disabled={loading}>
                {loading ? 'Changing…' : 'Change secret'}
                </button>
                <button
                type="button"
                className="adm-btn-outline"
                onClick={() => { setStage('password'); setError('') }}
                >
                Back
                </button>
            </div>
            </form>
      </div>
    </div>
  )

  // ── Stage: done ───────────────────────────────────────────────────────────
  return (
    <div className="adm-page" style={{ maxWidth: 480 }}>
      <div className="adm-topbar">
        <h1 className="adm-page-title">Secret updated</h1>
      </div>

      <div className="adm-card">
        <div style={{
          fontSize: 14, padding: '14px 16px', borderRadius: 8, lineHeight: 1.7,
          background: 'var(--adm-success-bg)', color: 'var(--adm-success)',
          border: '1px solid rgba(22,101,52,0.25)', marginBottom: 20,
        }}>
          ✓ <strong>Admin secret updated</strong> in <code>.env.local</code>.
        </div>

        <ol style={{ fontSize: 14, color: 'var(--adm-text-2)', paddingLeft: 20, margin: '0 0 24px', lineHeight: 2.2 }}>
          <li>Restart the dev server (<code>Ctrl+C</code> then <code>npm run dev</code>).</li>
          <li>Click <strong>Clear secret</strong> in the sidebar.</li>
          <li>Enter your new secret when prompted.</li>
        </ol>

        <Link href="/admin" className="adm-btn" style={{ display: 'inline-flex', textDecoration: 'none' }}>
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}