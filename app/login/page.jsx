'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser, setCurrentUserRole } from '../utils/authClient'

export default function LoginPage() {
  const router = useRouter()

  const [email,        setEmail       ] = useState('')
  const [password,     setPassword    ] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const [content, setContent] = useState({
    login_heading:    'Welcome back',
    login_subheading: 'Sign in to your account',
    register_heading: 'Create an account',
    tc_label:         'Terms & Conditions',
    tc_url:           '/terms',
  })

  const [errors, setErrors] = useState({ email: '', password: '', general: '' })

  const redirectByRole = useCallback((role) => {
    if (role === 'admin') { router.replace('/admin'); return }
    if (role === 'staff') { router.replace('/staff'); return }
    router.replace('/')
  }, [router])

  // Auto-redirect if already logged in
  useEffect(() => {
    const user = getCurrentUser()
    if (!user) return
    setIsSubmitting(true)
    redirectByRole(user.role)
  }, [redirectByRole])

  // CMS content
  useEffect(() => {
    fetch('/api/cms/content?section=login')
      .then(r => r.json())
      .then(d => { if (d.ok && d.fields) setContent(d.fields) })
      .catch(() => {})
  }, [])

  const clearErrors = () => setErrors({ email: '', password: '', general: '' })

  const validateEmail = v =>
    !v ? 'Please enter your email.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Enter a valid email address.' : ''

  const validatePassword = v =>
    !v ? 'Please enter your password.'
      : v.length < 8 ? 'Password must be at least 8 characters.' : ''

  const handleLogin = async e => {
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
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), password }),
      })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        setErrors(p => ({ ...p, general: data.error || 'Invalid email or password.' }))
        return
      }

      // Save user to localStorage and redirect
      const user = data.user
      localStorage.setItem('jce_current_user', JSON.stringify({
        id:        user.id,
        firstName: user.firstName,
        lastName:  user.lastName,
        name:      user.name || `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
        email:     user.email,
        role:      user.role,
        createdAt: user.createdAt,
      }))
      setCurrentUserRole(user.role)
      redirectByRole(user.role)

    } catch {
      setErrors(p => ({ ...p, general: 'Something went wrong. Please try again.' }))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <Header solid />
      <section className="login-header-spacer" />
      <section className="auth-section">
        <div className="container auth-layout">
          <div className="auth-copy">
            <span className="subtitle">{content.login_heading}</span>
            <h1>{content.login_subheading}</h1>
            <p>Access your saved favorites and make it easier to inquire about your chosen looks.</p>
          </div>

          <div className="auth-card">
            <form onSubmit={handleLogin}>
              <div className="auth-field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  autoComplete="email"
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
                    type="button"
                    className="auth-show-password"
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

              <button
                type="submit"
                className="btn btn-primary auth-submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Signing in…' : 'Log In'}
              </button>

              <p className="auth-switch">
                New to JCE Bridal? <a href="/signup">{content.register_heading}</a>
              </p>
            </form>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  )
}