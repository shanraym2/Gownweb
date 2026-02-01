'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { loadUsers } from '../../utils/authClient'

export default function AdminUsersPage() {
  const [users, setUsers] = useState([])

  useEffect(() => {
    setUsers(loadUsers())
  }, [])

  return (
    <div className="admin-users">
      <h1>Users</h1>
      <p className="admin-placeholder">Registered users (from this browser&apos;s localStorage). Full user management would require a backend user store.</p>
      {users.length === 0 ? (
        <p>No users registered yet.</p>
      ) : (
        <div className="admin-list">
          {users.map((u) => (
            <div key={u.id} className="admin-list-item">
              <span>{u.name}</span>
              <span>{u.email}</span>
            </div>
          ))}
        </div>
      )}
      <Link href="/admin" className="btn btn-outline" style={{ marginTop: 16 }}>← Dashboard</Link>
    </div>
  )
}
