'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser, logoutUser } from '../utils/authClient'

export default function ProfilePage() {
  const router = useRouter()
  const [user, setUser] = useState(null)

  useEffect(() => {
    const existing = getCurrentUser()
    if (!existing) {
      router.replace('/login')
    } else {
      setUser(existing)
    }
  }, [router])

  const handleLogout = () => {
    logoutUser()
    setUser(null)
    router.push('/')
  }

  if (!user) {
    return (
      <main className="auth-page">
        <Header />
        <section className="gowns-header-spacer" />
        <section className="auth-section">
          <div className="container">
            <p>Loading your profile...</p>
          </div>
        </section>
        <Footer />
      </main>
    )
  }

  return (
    <main className="auth-page">
      <Header />
      <section className="gowns-header-spacer" />

      <section className="auth-section">
        <div className="container auth-layout">
          <div className="auth-copy">
            <span className="subtitle">Your Profile</span>
            <h1>Welcome back, {user.name || 'Guest'}</h1>
            <p>Review the details connected to your JCE Bridal account.</p>
          </div>

          <div className="auth-card">
            <div className="auth-field">
              <label>Name</label>
              <p>{user.name}</p>
            </div>
            <div className="auth-field">
              <label>Email</label>
              <p>{user.email}</p>
            </div>

            <button type="button" className="btn btn-outline auth-submit" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}

