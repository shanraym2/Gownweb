'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import {
  loginUser,
  getCurrentUser,
  setCurrentUserRole,
  verifyLoginCredentials,
  loadUsers,
} from '../utils/authClient'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [devMode, setDevMode] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const [errors, setErrors] = useState({
    email: '',
    password: '',
    otp: '',
    general: '',
  })

  useEffect(() => {
    const user = getCurrentUser()
    if (user) router.replace('/')
  }, [router])

  const validateEmail = (value) => {
    if (!value) return 'Please enter your email.'
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!regex.test(value)) return 'Enter a valid email address.'
    return ''
  }

  const validatePassword = (value) => {
    if (!value) return 'Please enter your password.'
    if (value.length < 6) return 'Password must be at least 6 characters.'
    return ''
  }

  const validateOtp = (value) => {
    if (!value) return 'Please enter the 6-digit code from your email.'
    if (value.length !== 6) return 'OTP must be 6 digits.'
    return ''
  }

  const handleSendOtp = async (e) => {
    e.preventDefault()
    setErrors((prev) => ({ ...prev, general: '' }))

    const emailError = validateEmail(email)
    const passwordError = validatePassword(password)

    if (emailError || passwordError) {
      setErrors((prev) => ({
        ...prev,
        email: emailError,
        password: passwordError,
      }))
      return
    }

    const check = await verifyLoginCredentials({ email: email.trim(), password })

    if (!check.ok) {
      const users = loadUsers()
      const exists = users.some(
        (u) => String(u.email || '').trim().toLowerCase() === email.trim().toLowerCase()
      )

      setErrors((prev) => ({
        ...prev,
        general: exists
          ? 'Incorrect password.'
          : check.error || 'No account found with this email. Please sign up first.',
      }))
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
        setErrors((prev) => ({
          ...prev,
          general: data.error || 'Failed to send OTP.',
        }))
        return
      }

      setDevMode(!!data.devMode)
      setStep(2)
    } catch {
      setErrors((prev) => ({
        ...prev,
        general: 'Failed to send OTP. Please try again.',
      }))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleVerifyAndLogin = async (e) => {
    e.preventDefault()
    setErrors((prev) => ({ ...prev, general: '' }))

    const otpError = validateOtp(otp)

    if (otpError) {
      setErrors((prev) => ({ ...prev, otp: otpError }))
      return
    }

    setIsSubmitting(true)

    try {
      const verifyRes = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), otp: otp.trim(), purpose: 'login' }),
      })

      const verifyData = await verifyRes.json()

      if (!verifyRes.ok || !verifyData.ok) {
        setErrors((prev) => ({
          ...prev,
          general: verifyData.error || 'Invalid or expired OTP.',
        }))
        return
      }

      const result = await loginUser({ email: email.trim(), password })

      if (!result.ok) {
        setErrors((prev) => ({
          ...prev,
          general: result.error || 'Invalid email or password.',
        }))
        return
      }

      const roleRes = await fetch(
        `/api/auth/role?email=${encodeURIComponent(email.trim())}`
      )
      const roleData = await roleRes.json()

      if (roleData.ok && roleData.role) setCurrentUserRole(roleData.role)

      router.push('/')
    } catch {
      setErrors((prev) => ({
        ...prev,
        general: 'Something went wrong. Please try again.',
      }))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBack = () => {
    setStep(1)
    setOtp('')
    setErrors({ email: '', password: '', otp: '', general: '' })
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
                    onChange={(e) => {
                      const value = e.target.value
                      setEmail(value)
                      setErrors((prev) => ({
                        ...prev,
                        email: validateEmail(value),
                        general: '',
                      }))
                    }}
                    placeholder="you@example.com"
                  />
                  {errors.email && <p className="auth-error">{errors.email}</p>}
                </div>
                <div className="auth-field">
                  <label htmlFor="password">Password</label>
                  <div className="auth-password-row">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => {
                        const value = e.target.value
                        setPassword(value)
                        setErrors((prev) => ({
                          ...prev,
                          password: validatePassword(value),
                          general: '',
                        }))
                      }}
                      placeholder="Your password"
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
                  {errors.password && <p className="auth-error">{errors.password}</p>}
                </div>
                {errors.general && <p className="auth-error">{errors.general}</p>}
                <p className="auth-switch" style={{ marginTop: 10 }}>
                  Forgot your password? <a href="/forgot-password">Reset it</a>
                </p>
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
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '')
                      setOtp(value)
                      setErrors((prev) => ({
                        ...prev,
                        otp: validateOtp(value),
                        general: '',
                      }))
                    }}
                    placeholder="000000"
                    className="auth-otp-input"
                  />
                </div>
                {errors.otp && <p className="auth-error">{errors.otp}</p>}
                {errors.general && <p className="auth-error">{errors.general}</p>}
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