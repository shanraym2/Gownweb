'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { loginUser, getCurrentUser } from '../utils/authClient'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const user = getCurrentUser()
    if (user) {
      router.replace('/')
    }
  }, [router])

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')

    if (!email || !password) {
      setError('Please enter your email and password.')
      return
    }

    setIsSubmitting(true)
    const result = loginUser({ email, password })
    setIsSubmitting(false)

    if (!result.ok) {
      setError(result.error || 'Unable to log in.')
      return
    }

    router.push('/')
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
            <p>Access your saved favorites and make it easier to inquire about your chosen looks.</p>
          </div>

          <div className="auth-card">
            <form onSubmit={handleSubmit}>
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

              <button type="submit" className="btn btn-primary auth-submit" disabled={isSubmitting}>
                {isSubmitting ? 'Logging in...' : 'Log In'}
              </button>

              <p className="auth-switch">
                New to JCE Bridal? <a href="/signup">Create an account</a>
              </p>
            </form>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}

