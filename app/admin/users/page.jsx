'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { loadUsers, saveUsers } from '../../utils/authClient'

function fmtDate(ts) {
  if (!ts) return '—'
  try { return new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '—' }
}

async function hashPassword(pw) {
  if (!window.crypto?.subtle) return String(pw || '')
  const data = new TextEncoder().encode(String(pw || ''))
  const digest = await window.crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const ROLES = ['admin', 'staff', 'customer']

// ─── Modal ──────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box">
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Add / Edit User Modal ───────────────────────────────────────────────────
function UserModal({ user, currentAdminId, onSave, onClose }) {
  const isEdit = !!user
  const [name,     setName    ] = useState(user?.name  || '')
  const [email,    setEmail   ] = useState(user?.email || '')
  const [role,     setRole    ] = useState(user?.role  || 'customer')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm ] = useState('')
  const [error,    setError   ] = useState('')

  async function handleSubmit() {
    setError('')
    if (!name.trim())  return setError('Name is required.')
    if (!email.trim()) return setError('Email is required.')
    if (!isEdit && !password) return setError('Password is required for new users.')
    if (password && password !== confirm) return setError('Passwords do not match.')

    const all = loadUsers()

    // Check for duplicate email (excluding the user being edited)
    const duplicate = all.find(u => u.email.toLowerCase() === email.toLowerCase() && u.id !== user?.id)
    if (duplicate) return setError('An account with this email already exists.')

    if (isEdit) {
      const next = { ...all.find(u => u.id === user.id), name: name.trim(), email: email.trim(), role }
      if (password) next.passwordHash = await hashPassword(password)
      const updated = all.map(u => u.id !== user.id ? u : next)
      saveUsers(updated)
      onSave(updated)
    } else {
      const newUser = {
        id:           crypto.randomUUID(),
        name:         name.trim(),
        email:        email.trim().toLowerCase(),
        role,
        passwordHash: await hashPassword(password),
        createdAt:    new Date().toISOString(),
      }
      const updated = [...all, newUser]
      saveUsers(updated)
      onSave(updated)
    }
    onClose()
  }

  return (
    <Modal title={isEdit ? 'Edit User' : 'Add User'} onClose={onClose}>
      <div className="modal-body">
        {error && <div className="modal-error">{error}</div>}

        <label className="modal-label">Name
          <input className="modal-input" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
        </label>

        <label className="modal-label">Email
          <input className="modal-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" />
        </label>

        <label className="modal-label">Role
          <select className="modal-input modal-select" value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>

        <label className="modal-label">{isEdit ? 'New Password (leave blank to keep)' : 'Password'}
          <input className="modal-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
        </label>

        {(password || !isEdit) && (
          <label className="modal-label">Confirm Password
            <input className="modal-input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" />
          </label>
        )}
      </div>
      <div className="modal-footer">
        <button className="modal-btn modal-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="modal-btn modal-btn-primary" onClick={handleSubmit}>
          {isEdit ? 'Save Changes' : 'Create User'}
        </button>
      </div>
    </Modal>
  )
}

// ─── Change Own Password Modal ───────────────────────────────────────────────
function ChangePasswordModal({ adminId, onClose }) {
  const [current,  setCurrent ] = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm ] = useState('')
  const [error,    setError   ] = useState('')
  const [success,  setSuccess ] = useState(false)

  async function handleSubmit() {
    setError('')
    if (!current)  return setError('Enter your current password.')
    if (!password) return setError('Enter a new password.')
    if (password === current) return setError('New password must differ from current.')
    if (password !== confirm) return setError('Passwords do not match.')

    const all = loadUsers()
    const me  = all.find(u => u.id === adminId)
    if (!me)   return setError('Admin account not found.')

    const currentHash = await hashPassword(current)
    if (me.passwordHash && me.passwordHash !== currentHash)
      return setError('Current password is incorrect.')

    const newHash = await hashPassword(password)
    const updated = all.map(u => u.id === adminId ? { ...u, passwordHash: newHash } : u)
    saveUsers(updated)
    setSuccess(true)
    setTimeout(onClose, 1400)
  }

  return (
    <Modal title="Change My Password" onClose={onClose}>
      <div className="modal-body">
        {success
          ? <div className="modal-success">Password updated! ✓</div>
          : <>
              {error && <div className="modal-error">{error}</div>}
              <label className="modal-label">Current Password
                <input className="modal-input" type="password" value={current} onChange={e => setCurrent(e.target.value)} placeholder="••••••••" />
              </label>
              <label className="modal-label">New Password
                <input className="modal-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
              </label>
              <label className="modal-label">Confirm New Password
                <input className="modal-input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" />
              </label>
            </>
        }
      </div>
      {!success && (
        <div className="modal-footer">
          <button className="modal-btn modal-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="modal-btn modal-btn-primary" onClick={handleSubmit}>Update Password</button>
        </div>
      )}
    </Modal>
  )
}

// ─── Delete Confirm Modal ────────────────────────────────────────────────────
function DeleteModal({ user, onConfirm, onClose }) {
  return (
    <Modal title="Delete User" onClose={onClose}>
      <div className="modal-body">
        <p className="modal-confirm-text">
          Delete <strong>{user.name || user.email}</strong>? This cannot be undone.
        </p>
      </div>
      <div className="modal-footer">
        <button className="modal-btn modal-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="modal-btn modal-btn-danger" onClick={onConfirm}>Delete</button>
      </div>
    </Modal>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function AdminUsersPage() {
  const [users,    setUsers   ] = useState([])
  const [search,   setSearch  ] = useState('')
  const [copied,   setCopied  ] = useState(null)

  // Modal states
  const [addOpen,   setAddOpen  ] = useState(false)
  const [editUser,  setEditUser ] = useState(null)   // user object | null
  const [deleteUser,setDeleteUser] = useState(null)  // user object | null
  const [pwOpen,    setPwOpen   ] = useState(false)

  // Identify the currently logged-in admin from session/localStorage.
  // Adjust the key to match what your authClient stores.
  const [adminId] = useState(() => {
    try { return JSON.parse(localStorage.getItem('jce_current_user') || '{}').id ?? null }
    catch { return null }
  })

  useEffect(() => { setUsers(loadUsers()) }, [])

  // ── Fix: if admin's record has no role set, treat it as admin ──
  // This is a one-time migration — run on mount.
  useEffect(() => {
    const all = loadUsers()
    let changed = false
    const fixed = all.map(u => {
      // If this is the logged-in admin and role is missing/wrong
      if (u.id === adminId && (!u.role || u.role === 'customer')) {
        changed = true
        return { ...u, role: 'admin' }
      }
      return u
    })
    if (changed) { saveUsers(fixed); setUsers(fixed) }
  }, [adminId])

  const copyEmail = async email => {
    try { await navigator.clipboard.writeText(email); setCopied(email); setTimeout(() => setCopied(null), 1800) }
    catch {}
  }

  function handleDelete() {
    const updated = loadUsers().filter(u => u.id !== deleteUser.id)
    saveUsers(updated)
    setUsers(updated)
    setDeleteUser(null)
  }

  const filtered = search.trim()
    ? users.filter(u =>
        u.email?.toLowerCase().includes(search.toLowerCase()) ||
        u.name?.toLowerCase().includes(search.toLowerCase()))
    : users

  return (
    <>


      <div className="adm-users-page">
        {/* ── Top ── */}
        <div className="adm-topbar">
          <h1 className="adm-page-title">Users</h1>
          <span className="adm-page-meta">{users.length} registered</span>
        </div>

        <p className="adm-users-desc">
          Accounts stored in this browser's localStorage. Full user management requires a backend.
        </p>

        {/* ── Toolbar ── */}
        <div className="adm-toolbar">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="adm-search"
          />
          {adminId && (
            <button className="adm-btn adm-btn-outline" onClick={() => setPwOpen(true)}>
              🔑 My Password
            </button>
          )}
          <button className="adm-btn adm-btn-primary" onClick={() => setAddOpen(true)}>
            + Add User
          </button>
        </div>

        {/* ── List ── */}
        {filtered.length === 0 ? (
          <p className="adm-muted">{users.length === 0 ? 'No users registered yet.' : 'No results.'}</p>
        ) : (
          <div className="adm-user-list">
            {filtered.map(u => (
              <div key={u.id} className="adm-user-row">
                <div className="adm-user-avatar">
                  {(u.name || u.email || '?')[0].toUpperCase()}
                </div>

                <div className="adm-user-info">
                  <div className="adm-user-name">
                    {u.name || '—'}
                    {u.id === adminId && <span style={{marginLeft:6,fontSize:'.68rem',color:'#888',fontWeight:400}}>(you)</span>}
                  </div>
                  <div className="adm-user-email-row">
                    <span className="adm-user-email">{u.email}</span>
                    <button
                      onClick={() => copyEmail(u.email)}
                      className={`adm-copy-btn${copied === u.email ? ' is-copied' : ''}`}
                    >
                      {copied === u.email ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="adm-row-actions">
                    <button className="adm-row-btn" onClick={() => setEditUser(u)}>Edit</button>
                    {u.id !== adminId && (
                      <button className="adm-row-btn adm-row-btn-danger" onClick={() => setDeleteUser(u)}>Delete</button>
                    )}
                  </div>
                </div>

                <div className="adm-user-aside">
                  <span className={`adm-user-badge adm-user-badge-${u.role || 'customer'}`}>
                    {u.role || 'customer'}
                  </span>
                  <span className="adm-user-joined">{fmtDate(u.createdAt || u.joinedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <Link href="/admin" className="adm-back-link">← Dashboard</Link>
      </div>

      {/* ── Modals ── */}
      {addOpen    && <UserModal currentAdminId={adminId} onSave={setUsers} onClose={() => setAddOpen(false)} />}
      {editUser   && <UserModal user={editUser} currentAdminId={adminId} onSave={setUsers} onClose={() => setEditUser(null)} />}
      {deleteUser && <DeleteModal user={deleteUser} onConfirm={handleDelete} onClose={() => setDeleteUser(null)} />}
      {pwOpen     && <ChangePasswordModal adminId={adminId} onClose={() => setPwOpen(false)} />}
    </>
  )
}