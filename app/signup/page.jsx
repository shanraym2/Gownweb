'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import {
  registerUser,
  getCurrentUser,
  loadUsers,
  setCurrentUserRole,
} from '../utils/authClient'
import { isRealName, getPasswordRuleChecks, passwordMeetsRules } from '../utils/authValidation'

const RESEND_COOLDOWN = 30 // seconds

export default function SignupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [devMode, setDevMode] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  // Resend countdown
  const [resendCooldown, setResendCooldown] = useState(0)
  const cooldownRef = useRef(null)

  const [errors, setErrors] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    otp: '',
    general: '',
  })

  useEffect(() => {
    const user = getCurrentUser()
    if (user) router.replace('/')
  }, [router])

  // Tick the resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return
    cooldownRef.current = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) {
          clearInterval(cooldownRef.current)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(cooldownRef.current)
  }, [resendCooldown])

  const pwdChecks = getPasswordRuleChecks(password)

  const validateName = (value) => {
    if (!value) return 'Please enter your name.'
    if (!isRealName(value))
      return "Use your real name: letters only, spaces between words. Hyphens and apostrophes are OK (e.g. O'Brien). No numbers or symbols."
    return ''
  }

  const validateEmail = (value) => {
    if (!value) return 'Please enter your email.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address.'
    return ''
  }

  const validatePassword = (value) => {
    if (!value) return 'Please create a password.'
    if (!passwordMeetsRules(value)) return 'Password must meet all requirements below.'
    return ''
  }

  const validateConfirmPassword = (value) => {
    if (!value) return 'Please confirm your password.'
    if (value !== password) return 'Passwords do not match.'
    return ''
  }

  const validateOtp = (value) => {
    if (!value) return 'Please enter the 6-digit code.'
    if (value.length !== 6) return 'Code must be exactly 6 digits.'
    return ''
  }

  const sendOtp = useCallback(async () => {
    setIsSubmitting(true)
    setErrors((prev) => ({ ...prev, general: '' }))

    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), purpose: 'signup' }),
      })

      const data = await res.json()

      if (!res.ok || !data.ok) {
        setErrors((prev) => ({
          ...prev,
          general: data.error || 'Failed to send code.',
        }))
        return false
      }

      setDevMode(!!data.devMode)
      setResendCooldown(RESEND_COOLDOWN)
      return true
    } catch {
      setErrors((prev) => ({
        ...prev,
        general: 'Failed to send code. Please try again.',
      }))
      return false
    } finally {
      setIsSubmitting(false)
    }
  }, [email])

  const handleSendOtp = async (e) => {
    e.preventDefault()
    setErrors((prev) => ({ ...prev, general: '' }))

    const nameError = validateName(name)
    const emailError = validateEmail(email)
    const passwordError = validatePassword(password)
    const confirmPasswordError = validateConfirmPassword(confirmPassword)

    if (nameError || emailError || passwordError || confirmPasswordError) {
      setErrors((prev) => ({
        ...prev,
        name: nameError,
        email: emailError,
        password: passwordError,
        confirmPassword: confirmPasswordError,
      }))
      return
    }

    const users = loadUsers()
    const emailTaken = users.some(
      (u) => u.email.toLowerCase() === email.trim().toLowerCase()
    )

    if (emailTaken) {
      setErrors((prev) => ({
        ...prev,
        general: 'An account with this email already exists. Please log in instead.',
      }))
      return
    }

    const sent = await sendOtp()
    if (sent) setStep(2)
  }

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || isSubmitting) return
    setOtp('')
    setErrors({ name: '', email: '', password: '', confirmPassword: '', otp: '', general: '' })
    await sendOtp()
  }

  const handleVerifyAndRegister = async (e) => {
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
        body: JSON.stringify({ email: email.trim(), otp: otp.trim(), purpose: 'signup' }),
      })

      const verifyData = await verifyRes.json()

      if (!verifyRes.ok || !verifyData.ok) {
        setErrors((prev) => ({
          ...prev,
          general: verifyData.error || 'Invalid or expired code.',
        }))
        // Locked out — go back to step 1
        if (verifyRes.status === 429) {
          setStep(1)
          setOtp('')
        }
        return
      }

      const result = await registerUser({
        name: name.trim(),
        email: email.trim(),
        password,
      })

      if (!result.ok) {
        setErrors((prev) => ({
          ...prev,
          general: result.error || 'Unable to create account.',
        }))
        return
      }

      const roleRes = await fetch(`/api/auth/role?email=${encodeURIComponent(email.trim())}`)
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
    setErrors({ name: '', email: '', password: '', confirmPassword: '', otp: '', general: '' })
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
                    autoComplete="name"
                    value={name}
                    onChange={(e) => {
                      const value = e.target.value
                      setName(value)
                      setErrors((prev) => ({ ...prev, name: validateName(value), general: '' }))
                    }}
                    placeholder="e.g. Maria Santos"
                  />
                  <p className="auth-field-hint">
                    Letters only. Spaces, hyphens, and apostrophes are allowed (e.g. Ana-Maria,
                    O&apos;Brien). No numbers or symbols.
                  </p>
                  {errors.name && <p className="auth-error">{errors.name}</p>}
                </div>

                <div className="auth-field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      const value = e.target.value
                      setEmail(value)
                      setErrors((prev) => ({ ...prev, email: validateEmail(value), general: '' }))
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
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => {
                        const value = e.target.value
                        setPassword(value)
                        setErrors((prev) => ({
                          ...prev,
                          password: validatePassword(value),
                          confirmPassword: validateConfirmPassword(confirmPassword),
                          general: '',
                        }))
                      }}
                      placeholder="Create a password"
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
                    <li className={pwdChecks.length ? 'auth-rule-met' : ''}>
                      At least 8 characters
                    </li>
                    <li className={pwdChecks.letter ? 'auth-rule-met' : ''}>
                      At least one letter
                    </li>
                    <li className={pwdChecks.number ? 'auth-rule-met' : ''}>
                      At least one number
                    </li>
                  </ul>
                  {errors.password && <p className="auth-error">{errors.password}</p>}
                </div>

                <div className="auth-field">
                  <label htmlFor="confirmPassword">Confirm password</label>
                  <div className="auth-password-row">
                    <input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => {
                        const value = e.target.value
                        setConfirmPassword(value)
                        setErrors((prev) => ({
                          ...prev,
                          confirmPassword: validateConfirmPassword(value),
                          general: '',
                        }))
                      }}
                      placeholder="Confirm your password"
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
                  {errors.confirmPassword && (
                    <p className="auth-error">{errors.confirmPassword}</p>
                  )}
                </div>

                {errors.general && <p className="auth-error">{errors.general}</p>}

                <button
                  type="submit"
                  className="btn btn-primary auth-submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Sending…' : 'Register'}
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
                      Check the <strong>terminal</strong> where{' '}
                      <code>npm run dev</code> is running for your 6-digit code.
                    </>
                  ) : (
                    <>
                      We sent a 6-digit code to <strong>{email}</strong>. Enter it
                      below. Check your spam folder if you don&apos;t see it.
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
                    autoComplete="one-time-code"
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
                  {isSubmitting ? 'Verifying…' : 'Verify & Create Account'}
                </button>

                {/* Resend code */}
                <p className="auth-switch" style={{ marginTop: 12 }}>
                  Didn&apos;t receive a code?{' '}
                  {resendCooldown > 0 ? (
                    <span className="auth-resend-disabled">
                      Resend in {resendCooldown}s
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="auth-link-btn"
                      onClick={handleResendOtp}
                      disabled={isSubmitting}
                    >
                      Resend code
                    </button>
                  )}
                </p>

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