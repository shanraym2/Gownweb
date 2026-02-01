'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { resetAllUsers } from '../utils/authClient'

export default function AdminDashboardPage() {
  const router = useRouter()

  const handleResetUsers = () => {
    if (typeof window === 'undefined') return
    if (!window.confirm('This will delete all registered accounts and log everyone out on this browser. Continue?')) return
    resetAllUsers()
    router.push('/')
    window.location.reload()
  }

  return (
    <div className="admin-dashboard">
      <h1>Admin Dashboard</h1>
      <p className="admin-dashboard-intro">Manage your JCE Bridal store.</p>
      <div className="admin-dashboard-cards">
        <Link href="/admin/gowns" className="admin-card">
          <h2>Gowns</h2>
          <p>Add, edit, and remove gowns.</p>
        </Link>
        <Link href="/admin/orders" className="admin-card">
          <h2>Orders</h2>
          <p>View all orders.</p>
        </Link>
        <Link href="/admin/users" className="admin-card">
          <h2>Users</h2>
          <p>Manage users.</p>
        </Link>
      </div>
      <div className="admin-reset-section">
        <h2>Reset data</h2>
        <p>Clear all registered accounts on this browser. You will be logged out and need to sign up again.</p>
        <button type="button" onClick={handleResetUsers} className="btn btn-outline admin-reset-btn">
          Reset all registered users
        </button>
      </div>
    </div>
  )
}
