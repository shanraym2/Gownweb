'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import {
  getCurrentUser,
  resetUserPassword,
} from '../utils/authClient'
import { getPasswordRuleChecks, passwordMeetsRules } from '../utils/authValidation'

export default function ForgotPasswordPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState(1) // 1=email, 2=otp, 3=new password
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [devMode, setDevMode] = useState(false)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  useEffect(() => {
    const u = getCurrentUser()
    if (u) router.replace('/')
  }, [router])

  const pwdChecks = useMemo(() => getPasswordRuleChecks(newPassword), [newPassword])
  const canSubmitNewPassword = useMemo(
    () =>
      passwordMeetsRules(newPassword) &&
      String(newPassword || '') === String(confirmPassword || ''),
    [newPassword, confirmPassword]
  )

  const handleSendOtp = async (e) => {
    e.preventDefault()
    setError('')
    if (!email) {
      setError('Please enter your email.')
      return
    }
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), purpose: 'reset-password' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(data.error || 'Failed to send OTP.')
        return
      }
      setDevMode(!!data.devMode)
      setStep(2)
    } catch {
      setError('Failed to send OTP. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleVerifyOtp = async (e) => {
    e.preventDefault()
    setError('')
    if (!otp || otp.length !== 6) {
      setError('Please enter the 6-digit code from your email.')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), otp: otp.trim(), purpose: 'reset-password' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(data.error || 'Invalid or expired OTP.')
        return
      }
      setStep(3)
    } catch {
      setError('OTP verification failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    setError('')

    if (!passwordMeetsRules(newPassword)) {
      setError('Password must meet all requirements below.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setIsSubmitting(true)
    try {
      // Optional: avoid resetting to the same password (only if password check is supported).
      // Since the reset page doesn't know the old password, we skip old-password checks.
      const result = await resetUserPassword({ email: email.trim(), password: newPassword })
      if (!result.ok) {
        setError(result.error || 'Unable to reset password.')
        return
      }
      router.push('/')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBackToEmail = () => {
    setStep(1)
    setOtp('')
    setNewPassword('')
    setConfirmPassword('')
    setError('')
  }

  return (
    <main className="auth-page">
      <Header />
      <section className="gowns-header-spacer" />
      <section className="auth-section">
        <div className="container auth-layout">
          <div className="auth-copy">
            <span className="subtitle">Reset Password</span>
            <h1>Forgot your password?</h1>
            <p>Enter your email, verify the code, then set a new password.</p>
          </div>

          <div className="auth-card">
            {step === 1 ? (
              <form onSubmit={handleSendOtp}>
                <div className="auth-field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
                {error && <p className="auth-error">{error}</p>}
                <button type="submit" className="btn btn-primary auth-submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Sending...' : 'Send code'}
                </button>
                <p className="auth-switch">
                  Remembered? <a href="/login">Log in</a>
                </p>
              </form>
            ) : null}

            {step === 2 ? (
              <form onSubmit={handleVerifyOtp}>
                <p className="auth-otp-intro">
                  {devMode ? (
                    <>
                      Check the <strong>terminal</strong> where <code>npm run dev</code> is running
                      for your 6-digit code.
                    </>
                  ) : (
                    <>
                      We sent a 6-digit code to <strong>{email}</strong>. Enter it below.
                    </>
                  )}
                </p>
                <div className="auth-field">
                  <label htmlFor="otp">Verification code</label>
                  <input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="auth-otp-input"
                  />
                </div>
                {error && <p className="auth-error">{error}</p>}
                <button type="submit" className="btn btn-primary auth-submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Verifying...' : 'Verify code'}
                </button>
                <button type="button" className="auth-back-link" onClick={handleBackToEmail} disabled={isSubmitting}>
                  ← Back
                </button>
              </form>
            ) : null}

            {step === 3 ? (
              <form onSubmit={handleResetPassword}>
                <div className="auth-field">
                  <label htmlFor="newPassword">New password</label>
                  <div className="auth-password-row">
                    <input
                      id="newPassword"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Create a new password"
                    />
                    <button
                      type="button"
                      className="auth-show-password"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <ul className="auth-password-rules" aria-live="polite">
                    <li className={pwdChecks.length ? 'auth-rule-met' : ''}>At least 8 characters</li>
                    <li className={pwdChecks.letter ? 'auth-rule-met' : ''}>At least one letter</li>
                    <li className={pwdChecks.number ? 'auth-rule-met' : ''}>At least one number</li>
                  </ul>
                </div>

                <div className="auth-field">
                  <label htmlFor="confirmPassword">Confirm new password</label>
                  <div className="auth-password-row">
                    <input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm your new password"
                    />
                    <button
                      type="button"
                      className="auth-show-password"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                {error && <p className="auth-error">{error}</p>}
                <button type="submit" className="btn btn-primary auth-submit" disabled={isSubmitting || !canSubmitNewPassword}>
                  {isSubmitting ? 'Saving...' : 'Reset password'}
                </button>
                <p className="auth-switch">
                  Need to sign in again? <a href="/login">Log in</a>
                </p>
              </form>
            ) : null}
          </div>
        </div>
      </section>
      <Footer />
    </main>
  )
}

