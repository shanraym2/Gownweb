'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { loginUser, getCurrentUser, setCurrentUserRole } from '../utils/authClient'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [devMode, setDevMode] = useState(false)

  useEffect(() => {
    const user = getCurrentUser()
    if (user) router.replace('/')
  }, [router])

  const handleSendOtp = async (e) => {
    e.preventDefault()
    setError('')
    if (!email || !password) {
      setError('Please enter your email and password.')
      return
    }
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), purpose: 'login' }),
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

  const handleVerifyAndLogin = async (e) => {
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
      const result = loginUser({ email: email.trim(), password })
      if (!result.ok) {
        setError(result.error || 'Invalid email or password.')
        return
      }
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
            <span className="subtitle">Welcome Back</span>
            <h1>Log in to your account</h1>
            <p>
              Access your saved favorites and make it easier to inquire about your chosen looks.
            </p>
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
                  />
                </div>
                <div className="auth-field">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                  />
                </div>
                {error && <p className="auth-error">{error}</p>}
                <button
                  type="submit"
                  className="btn btn-primary auth-submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Sending...' : 'Login'}
                </button>
                <p className="auth-switch">
                  New to JCE Bridal? <a href="/signup">Create an account</a>
                </p>
              </form>
            ) : (
              <form onSubmit={handleVerifyAndLogin}>
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
                <button
                  type="submit"
                  className="btn btn-primary auth-submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Verifying...' : 'Verify & Log In'}
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
                  New to JCE Bridal? <a href="/signup">Create an account</a>
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
