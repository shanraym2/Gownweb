'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import {
  getCurrentUser,
  setCurrentUserRole,
} from '../utils/authClient'

export default function SignupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [devMode, setDevMode] = useState(false)

  useEffect(() => {
    const user = getCurrentUser()
    if (user) router.replace('/')
  }, [router])

  const validateForm = () => {
    if (!name || !email || !password || !confirmPassword) {
      setError('Please fill in all fields.')
      return false
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return false
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return false
    }
    return true
  }

  const handleSendOtp = async (e) => {
    e.preventDefault()
    setError('')
    if (!validateForm()) return
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), purpose: 'signup' }),
      })
      const data = await res.json()
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

  const handleVerifyAndRegister = async (e) => {
    e.preventDefault()
    setError('')
    if (!otp || otp.length !== 6) {
      setError('Please enter the 6-digit code from your email.')
      return
    }
    setIsSubmitting(true)
    try {
      const verifyRes = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), otp: otp.trim() }),
      })
      const verifyData = await verifyRes.json()
      if (!verifyRes.ok || !verifyData.ok) {
        setError(verifyData.error || 'Invalid or expired OTP.')
        return
      }

      // Register user in database
      const registerRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      })
      const registerData = await registerRes.json()
      if (!registerRes.ok || !registerData.ok) {
        setError(registerData.error || 'Unable to create account.')
        return
      }

      // Set current user session
      const session = {
        id: registerData.user.id,
        name: registerData.user.name,
        email: registerData.user.email,
        role: registerData.user.role || 'customer',
      }
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('jce_current_user', JSON.stringify(session))
      }

      // Get admin role if applicable
      const roleRes = await fetch(
        `/api/auth/role?email=${encodeURIComponent(email.trim())}`
      )
      const roleData = await roleRes.json()
      if (roleData.ok && roleData.role) setCurrentUserRole(roleData.role)

      router.push('/')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBack = () => {
    setStep(1)
    setOtp('')
    setError('')
  }

  return (
    <main className="auth-page">
      <Header />
      <section className="gowns-header-spacer" />
      <section className="auth-section">
        <div className="container auth-layout">
          <div className="auth-copy">
            <span className="subtitle">Create Account</span>
            <h1>Join JCE Bridal</h1>
            <p>
              Save your favorite looks and make it easier to inquire about gowns, dresses, and
              suits for your special day.
            </p>
          </div>
          <div className="auth-card">
            {step === 1 ? (
              <form onSubmit={handleSendOtp}>
                <div className="auth-field">
                  <label htmlFor="name">Name</label>
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                  />
                </div>
                <div className="auth-field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="auth-field">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                  />
                </div>
                <div className="auth-field">
                  <label htmlFor="confirmPassword">Confirm password</label>
                  <input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                  />
                </div>
                {error && <p className="auth-error">{error}</p>}
                <button
                  type="submit"
                  className="btn btn-primary auth-submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Sending...' : 'Register'}
                </button>
                <p className="auth-switch">
                  Already have an account? <a href="/login">Log in</a>
                </p>
              </form>
            ) : (
              <form onSubmit={handleVerifyAndRegister}>
                <p className="auth-otp-intro">
                  {devMode ? (
                    <>
                      Check the <strong>terminal</strong> where <code>npm run dev</code> is
                      running for your 6-digit code.
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
                <button
                  type="submit"
                  className="btn btn-primary auth-submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Verifying...' : 'Verify & Create Account'}
                </button>
                <button
                  type="button"
                  className="auth-back-link"
                  onClick={handleBack}
                  disabled={isSubmitting}
                >
                  ← Back to form
                </button>
                <p className="auth-switch">
                  Already have an account? <a href="/login">Log in</a>
                </p>
              </form>
            )}
          </div>
        </div>
      </section>
      <Footer />
    </main>
  )
}
