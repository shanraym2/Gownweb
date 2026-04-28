'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser, setCurrentUserRole } from '../utils/authClient'

const RESEND_COOLDOWN = 30

export default function LoginPage() {
  const router = useRouter()

  const [email,         setEmail        ] = useState('')
  const [password,      setPassword     ] = useState('')
  const [otp,           setOtp          ] = useState('')
  const [step,          setStep         ] = useState(1)   // 1=credentials, 2=otp
  const [isSubmitting,  setIsSubmitting ] = useState(false)
  const [devMode,       setDevMode      ] = useState(false)
  const [showPassword,  setShowPassword ] = useState(false)
  const [resendCooldown,setResendCooldown] = useState(0)
  const cooldownRef = useRef(null)

  const [errors, setErrors] = useState({
    email: '', password: '', otp: '', general: '',
  })

  // Redirect if already logged in — send to the right dashboard
  useEffect(() => {
    const user = getCurrentUser()
    if (!user) return
    redirectByRole(user.role)
  }, [])

  // Countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    cooldownRef.current = setInterval(() => {
      setResendCooldown(s => {
        if (s <= 1) { clearInterval(cooldownRef.current); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(cooldownRef.current)
  }, [resendCooldown])

  // ── Role-based redirect helper ───────────────────────────────────────────
  function redirectByRole(role) {
    if (role === 'admin')  { router.replace('/admin'); return }
    if (role === 'staff')  { router.replace('/staff'); return }
    router.replace('/')
  }

  const clearErrors = () => setErrors({ email: '', password: '', otp: '', general: '' })

  const validateEmail    = v => !v ? 'Please enter your email.'    : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Enter a valid email address.' : ''
  const validatePassword = v => !v ? 'Please enter your password.' : v.length < 6 ? 'Password must be at least 6 characters.' : ''
  const validateOtp      = v => !v ? 'Please enter the 6-digit code.' : v.length !== 6 ? 'Code must be exactly 6 digits.' : ''

  // ── Step 1: verify credentials then check device trust ──────────────────
  const handleSendOtp = async e => {
    e.preventDefault()
    clearErrors()

    const emailErr = validateEmail(email)
    const passErr  = validatePassword(password)
    if (emailErr || passErr) {
      setErrors(p => ({ ...p, email: emailErr, password: passErr }))
      return
    }

    setIsSubmitting(true)
    try {
      // 1. Verify credentials against DB
      const loginRes  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), password }),
      })
      const loginData = await loginRes.json()

      if (!loginRes.ok || !loginData.ok) {
        setErrors(p => ({ ...p, general: loginData.error || 'Invalid email or password.' }))
        return
      }

      // 2. Check if this device is already trusted (skip OTP)
      const trustRes  = await fetch('/api/auth/check-trust', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim() }),
      })
      const trustData = await trustRes.json()

      if (trustData.trusted) {
        finishLogin(loginData.user)
        return
      }

      // 3. Send OTP
      const otpRes  = await fetch('/api/auth/send-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), purpose: 'login' }),
      })
      const otpData = await otpRes.json()

      if (!otpRes.ok || !otpData.ok) {
        setErrors(p => ({ ...p, general: otpData.error || 'Failed to send code.' }))
        return
      }

      setDevMode(!!otpData.devMode)
      setResendCooldown(RESEND_COOLDOWN)
      setStep(2)
    } catch {
      setErrors(p => ({ ...p, general: 'Something went wrong. Please try again.' }))
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Step 2: verify OTP ───────────────────────────────────────────────────
  const handleVerifyOtp = async e => {
    e.preventDefault()
    clearErrors()

    const otpErr = validateOtp(otp)
    if (otpErr) { setErrors(p => ({ ...p, otp: otpErr })); return }

    setIsSubmitting(true)
    try {
      const res  = await fetch('/api/auth/verify-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), otp: otp.trim(), purpose: 'login' }),
      })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        setErrors(p => ({ ...p, general: data.error || 'Invalid or expired code.' }))
        if (res.status === 429) { setStep(1); setOtp('') }
        return
      }

      // OTP verified — fetch the user record
      const loginRes  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), password }),
      })
      const loginData = await loginRes.json()

      if (!loginRes.ok || !loginData.ok) {
        setErrors(p => ({ ...p, general: 'Login failed after verification. Please try again.' }))
        return
      }

      finishLogin(loginData.user)
    } catch {
      setErrors(p => ({ ...p, general: 'Something went wrong. Please try again.' }))
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Shared: save user and redirect by role ───────────────────────────────
  function finishLogin(user) {
    localStorage.setItem('jce_current_user', JSON.stringify({
      id:        user.id,
      name:      user.name,
      email:     user.email,
      role:      user.role,
      createdAt: user.createdAt,
    }))
    setCurrentUserRole(user.role)
    redirectByRole(user.role)
  }

  const handleResendOtp = useCallback(async () => {
    if (resendCooldown > 0 || isSubmitting) return
    setOtp(''); clearErrors()
    setIsSubmitting(true)
    try {
      const res  = await fetch('/api/auth/send-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), purpose: 'login' }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setErrors(p => ({ ...p, general: data.error || 'Failed to send code.' }))
        return
      }
      setDevMode(!!data.devMode)
      setResendCooldown(RESEND_COOLDOWN)
    } catch {
      setErrors(p => ({ ...p, general: 'Failed to resend code.' }))
    } finally {
      setIsSubmitting(false)
    }
  }, [email, resendCooldown, isSubmitting])

  const handleBack = () => { setStep(1); setOtp(''); clearErrors() }

  return (
    <main className="auth-page">
      <Header solid/>
      <section className="login-header-spacer" />
      <section className="auth-section">
        <div className="container auth-layout">
          <div className="auth-copy">
            <span className="subtitle">Welcome Back</span>
            <h1>Log in to your account</h1>
            <p>Access your saved favorites and make it easier to inquire about your chosen looks.</p>
          </div>

          <div className="auth-card">
            {step === 1 ? (
              <form onSubmit={handleSendOtp}>
                <div className="auth-field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email" type="email" value={email}
                    onChange={e => {
                      setEmail(e.target.value)
                      setErrors(p => ({ ...p, email: validateEmail(e.target.value), general: '' }))
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
                      onChange={e => {
                        setPassword(e.target.value)
                        setErrors(p => ({ ...p, password: validatePassword(e.target.value), general: '' }))
                      }}
                      placeholder="Your password"
                    />
                    <button
                      type="button" className="auth-show-password"
                      onClick={() => setShowPassword(v => !v)}
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

                <button type="submit" className="btn btn-primary auth-submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Checking…' : 'Log In'}
                </button>

                <p className="auth-switch">
                  New to JCE Bridal? <a href="/signup">Create an account</a>
                </p>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp}>
                <p className="auth-otp-intro">
                  {devMode ? (
                    <>Check the <strong>terminal</strong> where <code>npm run dev</code> is running for your 6-digit code.</>
                  ) : (
                    <>We sent a 6-digit code to <strong>{email}</strong>. Enter it below. Check your spam folder if you don't see it.</>
                  )}
                </p>

                <p className="auth-trust-note" style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>
                  After verifying, this device will be trusted for 7 days.
                </p>

                <div className="auth-field">
                  <label htmlFor="otp">Verification code</label>
                  <input
                    id="otp" type="text" inputMode="numeric" maxLength={6}
                    value={otp} autoComplete="one-time-code"
                    onChange={e => {
                      const v = e.target.value.replace(/\D/g, '')
                      setOtp(v)
                      setErrors(p => ({ ...p, otp: validateOtp(v), general: '' }))
                    }}
                    placeholder="000000" className="auth-otp-input"
                  />
                </div>

                {errors.otp     && <p className="auth-error">{errors.otp}</p>}
                {errors.general && <p className="auth-error">{errors.general}</p>}

                <button type="submit" className="btn btn-primary auth-submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Verifying…' : 'Verify & Log In'}
                </button>

                <p className="auth-switch" style={{ marginTop: 12 }}>
                  Didn't receive a code?{' '}
                  {resendCooldown > 0 ? (
                    <span className="auth-resend-disabled">Resend in {resendCooldown}s</span>
                  ) : (
                    <button type="button" className="auth-link-btn" onClick={handleResendOtp} disabled={isSubmitting}>
                      Resend code
                    </button>
                  )}
                </p>

                <button type="button" className="auth-back-link" onClick={handleBack} disabled={isSubmitting}>
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