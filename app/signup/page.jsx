'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser, setCurrentUserRole } from '../utils/authClient'
import { isRealName, getPasswordRuleChecks, passwordMeetsRules } from '../utils/authValidation'

const RESEND_COOLDOWN = 30

export default function SignupPage() {
  const router = useRouter()

  const [firstName,        setFirstName       ] = useState('')
  const [lastName,         setLastName        ] = useState('')
  const [email,            setEmail           ] = useState('')
  const [password,         setPassword        ] = useState('')
  const [confirmPassword,  setConfirmPassword ] = useState('')
  const [otp,              setOtp             ] = useState('')
  const [step,             setStep            ] = useState(1)
  const [isSubmitting,     setIsSubmitting    ] = useState(false)
  const [devMode,          setDevMode         ] = useState(false)
  const [showPassword,     setShowPassword    ] = useState(false)
  const [showConfirm,      setShowConfirm     ] = useState(false)
  const [resendCooldown,   setResendCooldown  ] = useState(0)
  const cooldownRef = useRef(null)

  const [errors, setErrors] = useState({
    firstName: '', lastName: '', email: '',
    password: '', confirmPassword: '', otp: '', general: '',
  })

  useEffect(() => {
    if (getCurrentUser()) router.replace('/')
  }, [router])

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

  const pwdChecks = getPasswordRuleChecks(password)

  const clearErrors = () => setErrors({
    firstName: '', lastName: '', email: '',
    password: '', confirmPassword: '', otp: '', general: '',
  })

  const validateFirstName       = v => !v ? 'Please enter your first name.' : !isRealName(v) ? 'Letters only. Hyphens and apostrophes are OK.' : ''
  const validateLastName        = v => !v ? 'Please enter your last name.'  : !isRealName(v) ? 'Letters only. Hyphens and apostrophes are OK.' : ''
  const validateEmail           = v => !v ? 'Please enter your email.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Enter a valid email address.' : ''
  const validatePassword        = v => !v ? 'Please create a password.' : !passwordMeetsRules(v) ? 'Password must meet all requirements below.' : ''
  const validateConfirmPassword = v => !v ? 'Please confirm your password.' : v !== password ? 'Passwords do not match.' : ''
  const validateOtp             = v => !v ? 'Please enter the 6-digit code.' : v.length !== 6 ? 'Code must be exactly 6 digits.' : ''

  const sendOtp = useCallback(async () => {
    setIsSubmitting(true)
    setErrors(p => ({ ...p, general: '' }))
    try {
      const res  = await fetch('/api/auth/send-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), purpose: 'signup' }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setErrors(p => ({ ...p, general: data.error || 'Failed to send code.' }))
        return false
      }
      setDevMode(!!data.devMode)
      setResendCooldown(RESEND_COOLDOWN)
      return true
    } catch {
      setErrors(p => ({ ...p, general: 'Failed to send code. Please try again.' }))
      return false
    } finally {
      setIsSubmitting(false)
    }
  }, [email])

  // ── Step 1: validate → check email → send OTP ────────────────────────────
  const handleSendOtp = async e => {
    e.preventDefault()
    const firstNameErr       = validateFirstName(firstName)
    const lastNameErr        = validateLastName(lastName)
    const emailErr           = validateEmail(email)
    const passwordErr        = validatePassword(password)
    const confirmPasswordErr = validateConfirmPassword(confirmPassword)

    if (firstNameErr || lastNameErr || emailErr || passwordErr || confirmPasswordErr) {
      setErrors(p => ({
        ...p,
        firstName: firstNameErr, lastName: lastNameErr,
        email: emailErr, password: passwordErr,
        confirmPassword: confirmPasswordErr,
      }))
      return
    }

    setIsSubmitting(true)
    try {
      // Check if email already exists in DB
      const checkRes  = await fetch('/api/auth/check-email?email=' + encodeURIComponent(email.trim()))
      const checkData = await checkRes.json()
      if (checkData.taken) {
        setErrors(p => ({
          ...p,
          general: 'An account with this email already exists. Please log in instead.',
        }))
        return
      }
    } catch {
      // If check fails, proceed — register API will catch duplicates anyway
    } finally {
      setIsSubmitting(false)
    }

    const sent = await sendOtp()
    if (sent) setStep(2)
  }

  // ── Step 2: verify OTP → register in DB ──────────────────────────────────
  const handleVerifyAndRegister = async e => {
    e.preventDefault()
    const otpErr = validateOtp(otp)
    if (otpErr) { setErrors(p => ({ ...p, otp: otpErr })); return }

    setIsSubmitting(true)
    try {
      // 1. Verify OTP
      const verifyRes  = await fetch('/api/auth/verify-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), otp: otp.trim(), purpose: 'signup' }),
      })
      const verifyData = await verifyRes.json()

      if (!verifyRes.ok || !verifyData.ok) {
        setErrors(p => ({ ...p, general: verifyData.error || 'Invalid or expired code.' }))
        if (verifyRes.status === 429) { setStep(1); setOtp('') }
        return
      }

      // 2. Register in DB
      const regRes  = await fetch('/api/auth/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          firstName: firstName.trim(),
          lastName:  lastName.trim(),
          email:     email.trim(),
          password,
        }),
      })
      const regData = await regRes.json()

      if (!regRes.ok || !regData.ok) {
        setErrors(p => ({ ...p, general: regData.error || 'Unable to create account.' }))
        return
      }

      // 3. Save user to localStorage so getCurrentUser() works
      const user = regData.user
      localStorage.setItem('jce_user', JSON.stringify({
        id:        user.id,
        name:      user.name,
        email:     user.email,
        role:      user.role,
        createdAt: user.createdAt || new Date().toISOString(),
      }))
      setCurrentUserRole(user.role)

      router.push('/')
    } catch {
      setErrors(p => ({ ...p, general: 'Something went wrong. Please try again.' }))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResendOtp = useCallback(async () => {
    if (resendCooldown > 0 || isSubmitting) return
    setOtp(''); clearErrors()
    await sendOtp()
  }, [resendCooldown, isSubmitting, sendOtp])

  const handleBack = () => {
    setStep(1); setOtp(''); clearErrors()
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
            <p>Save your favorite looks and make it easier to inquire about gowns, dresses, and suits for your special day.</p>
          </div>

          <div className="auth-card">
            {step === 1 ? (
              <form onSubmit={handleSendOtp}>
                <div className="profile-fields-row">
                  <div className="auth-field">
                    <label htmlFor="firstName">First name</label>
                    <input
                      id="firstName" type="text" autoComplete="given-name"
                      value={firstName}
                      onChange={e => { setFirstName(e.target.value); setErrors(p => ({ ...p, firstName: validateFirstName(e.target.value), general: '' })) }}
                      placeholder="Maria"
                    />
                    {errors.firstName && <p className="auth-error">{errors.firstName}</p>}
                  </div>
                  <div className="auth-field">
                    <label htmlFor="lastName">Last name</label>
                    <input
                      id="lastName" type="text" autoComplete="family-name"
                      value={lastName}
                      onChange={e => { setLastName(e.target.value); setErrors(p => ({ ...p, lastName: validateLastName(e.target.value), general: '' })) }}
                      placeholder="Santos"
                    />
                    {errors.lastName && <p className="auth-error">{errors.lastName}</p>}
                  </div>
                </div>

                <div className="auth-field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email" type="email" value={email}
                    onChange={e => { setEmail(e.target.value); setErrors(p => ({ ...p, email: validateEmail(e.target.value), general: '' })) }}
                    placeholder="you@example.com"
                  />
                  {errors.email && <p className="auth-error">{errors.email}</p>}
                </div>

                <div className="auth-field">
                  <label htmlFor="password">Password</label>
                  <div className="auth-password-row">
                    <input
                      id="password" type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password" value={password}
                      onChange={e => {
                        setPassword(e.target.value)
                        setErrors(p => ({
                          ...p,
                          password:        validatePassword(e.target.value),
                          confirmPassword: validateConfirmPassword(confirmPassword),
                          general: '',
                        }))
                      }}
                      placeholder="Create a password"
                    />
                    <button type="button" className="auth-show-password" onClick={() => setShowPassword(v => !v)}>
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <ul className="auth-password-rules" aria-live="polite">
                    <li className={pwdChecks.length ? 'auth-rule-met' : ''}>At least 8 characters</li>
                    <li className={pwdChecks.letter ? 'auth-rule-met' : ''}>At least one letter</li>
                    <li className={pwdChecks.number ? 'auth-rule-met' : ''}>At least one number</li>
                  </ul>
                  {errors.password && <p className="auth-error">{errors.password}</p>}
                </div>

                <div className="auth-field">
                  <label htmlFor="confirmPassword">Confirm password</label>
                  <div className="auth-password-row">
                    <input
                      id="confirmPassword" type={showConfirm ? 'text' : 'password'}
                      autoComplete="new-password" value={confirmPassword}
                      onChange={e => { setConfirmPassword(e.target.value); setErrors(p => ({ ...p, confirmPassword: validateConfirmPassword(e.target.value), general: '' })) }}
                      placeholder="Confirm your password"
                    />
                    <button type="button" className="auth-show-password" onClick={() => setShowConfirm(v => !v)}>
                      {showConfirm ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {errors.confirmPassword && <p className="auth-error">{errors.confirmPassword}</p>}
                </div>

                {errors.general && <p className="auth-error">{errors.general}</p>}

                <button type="submit" className="btn btn-primary auth-submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Sending…' : 'Register'}
                </button>
                <p className="auth-switch">Already have an account? <a href="/login">Log in</a></p>
              </form>
            ) : (
              <form onSubmit={handleVerifyAndRegister}>
                <p className="auth-otp-intro">
                  {devMode
                    ? <>Check the <strong>terminal</strong> where <code>npm run dev</code> is running for your 6-digit code.</>
                    : <>We sent a 6-digit code to <strong>{email}</strong>. Enter it below. Check your spam folder if you don't see it.</>
                  }
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
                  {isSubmitting ? 'Verifying…' : 'Verify & Create Account'}
                </button>

                <p className="auth-switch" style={{ marginTop: 12 }}>
                  Didn't receive a code?{' '}
                  {resendCooldown > 0
                    ? <span className="auth-resend-disabled">Resend in {resendCooldown}s</span>
                    : <button type="button" className="auth-link-btn" onClick={handleResendOtp} disabled={isSubmitting}>Resend code</button>
                  }
                </p>
                <button type="button" className="auth-back-link" onClick={handleBack} disabled={isSubmitting}>
                  ← Back to form
                </button>
                <p className="auth-switch">Already have an account? <a href="/login">Log in</a></p>
              </form>
            )}
          </div>
        </div>
      </section>
      <Footer />
    </main>
  )
}