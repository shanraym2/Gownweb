'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { getAdminSecret } from '../layout'
import { getCurrentUser } from '../../utils/authClient'
import { useRoleGuard } from '../../utils/useRoleGuard'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleDateString('en-PH', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch { return '—' }
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────

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

// ── Add / Edit user modal ─────────────────────────────────────────────────────
//
// editorRole — 'admin' | 'staff'   (who is doing the editing)
// isSelf     — true when the editor is editing their own account
//
// Permission matrix:
//   Admin editing others : can change name, email, role (any), password
//   Admin editing self   : can change name, email, password — NOT role (safety)
//   Staff editing customer: can change name, email, password — NOT role
//   Staff editing self   : can change name, email, password — NOT role
//   Staff adding new     : always creates as 'customer', no role selector

function UserModal({ user, secret, onSave, onClose, editorRole, isSelf }) {
  const isEdit = !!user

  // Roles this editor is allowed to assign
  const assignableRoles = editorRole === 'admin'
    ? ['customer', 'staff', 'admin']
    : ['customer']

  // Admin can change role — but not their own (to prevent accidental self-demotion)
  const canChangeRole = editorRole === 'admin' && !isSelf

  const [firstName, setFirstName] = useState(user?.firstName || user?.name?.split(' ')[0] || '')
  const [lastName,  setLastName ] = useState(user?.lastName  || user?.name?.split(' ').slice(1).join(' ') || '')
  const [email,     setEmail    ] = useState(user?.email || '')
  const [role,      setRole     ] = useState(user?.role  || 'customer')
  const [password,  setPassword ] = useState('')
  const [confirm,   setConfirm  ] = useState('')
  const [error,     setError    ] = useState('')
  const [saving,    setSaving   ] = useState(false)

  async function handleSubmit() {
    setError('')
    if (!firstName.trim() || !lastName.trim()) return setError('First and last name are required.')
    if (!email.trim())    return setError('Email is required.')
    if (!isEdit && !password) return setError('Password is required for new users.')
    if (password && password !== confirm) return setError('Passwords do not match.')
    if (password && password.length < 8)  return setError('Password must be at least 8 characters.')

    setSaving(true)
    try {
      const method = isEdit ? 'PUT' : 'POST'

      const payload = isEdit
        ? {
            id: user.id,
            firstName,
            lastName,
            email,
            // Only send role if this editor is allowed to change it
            ...(canChangeRole ? { role } : {}),
            ...(password ? { password } : {}),
          }
        : {
            firstName,
            lastName,
            email,
            password,
            // Staff always creates customers; admin uses the selector value
            role: assignableRoles.includes(role) ? role : 'customer',
          }

      const res  = await fetch('/api/admin/users', {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error || 'Failed to save.'); return }
      onSave(data.user)
      onClose()
    } catch {
      setError('Could not connect. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={isEdit ? (isSelf ? 'Edit My Profile' : 'Edit User') : 'Add User'} onClose={onClose}>
      <div className="modal-body">
        {error && <div className="modal-error">{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="modal-label">First name
            <input
              className="modal-input"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder="Maria"
            />
          </label>
          <label className="modal-label">Last name
            <input
              className="modal-input"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              placeholder="Santos"
            />
          </label>
        </div>

        <label className="modal-label">Email
          <input
            className="modal-input"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="user@example.com"
          />
        </label>

        {/* Role — editable dropdown for admin editing others */}
        {canChangeRole && (
          <label className="modal-label">Role
            <select
              className="modal-input modal-select"
              value={role}
              onChange={e => setRole(e.target.value)}
            >
              {assignableRoles.map(r => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Role — read-only hint when staff is creating a customer */}
        {!canChangeRole && !isEdit && (
          <label className="modal-label">Role
            <input
              className="modal-input"
              value="Customer"
              readOnly
              style={{ opacity: 0.55, cursor: 'not-allowed' }}
            />
          </label>
        )}

        {/* Role — read-only hint when admin edits self */}
        {isEdit && isSelf && (
          <label className="modal-label">Role
            <input
              className="modal-input"
              value={`${user.role.charAt(0).toUpperCase() + user.role.slice(1)} (cannot change own role)`}
              readOnly
              style={{ opacity: 0.55, cursor: 'not-allowed' }}
            />
          </label>
        )}

        <label className="modal-label">
          {isEdit ? 'New password (leave blank to keep)' : 'Password'}
          <input
            className="modal-input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>
        {(password || !isEdit) && (
          <label className="modal-label">Confirm password
            <input
              className="modal-input"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••"
            />
          </label>
        )}
      </div>

      <div className="modal-footer">
        <button className="modal-btn modal-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="modal-btn modal-btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
        </button>
      </div>
    </Modal>
  )
}

// ── Delete confirm modal ──────────────────────────────────────────────────────

function DeleteModal({ user, secret, onConfirm, onClose }) {
  const [deleting, setDeleting] = useState(false)
  const [error,    setError   ] = useState('')

  async function handleDelete() {
    setDeleting(true)
    try {
      const res  = await fetch(`/api/admin/users?id=${user.id}&permanent`, {
        method:  'DELETE',
        headers: { 'X-Admin-Secret': secret },
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error || 'Failed.'); return }
      onConfirm(user.id)
      onClose()
    } catch {
      setError('Could not connect.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal title="Delete User" onClose={onClose}>
      <div className="modal-body">
        {error && <div className="modal-error">{error}</div>}
        <p className="modal-confirm-text">
          Permanently delete <strong>{user.name || user.email}</strong>?
          This will also remove their order history links. This cannot be undone.
        </p>
      </div>
      <div className="modal-footer">
        <button className="modal-btn modal-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="modal-btn modal-btn-danger" onClick={handleDelete} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete permanently'}
        </button>
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const { user: authUser, ready } = useRoleGuard(['admin', 'staff'], '/')
  

  const isAdmin    = authUser?.role === 'admin'
  const isStaff    = authUser?.role === 'staff'
  const editorRole = authUser?.role   // passed into UserModal

  const [users,      setUsers     ] = useState([])
  const [loading,    setLoading   ] = useState(true)
  const [error,      setError     ] = useState('')
  const [search,     setSearch    ] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [copied,     setCopied    ] = useState(null)
  const [addOpen,    setAddOpen   ] = useState(false)
  const [editUser,   setEditUser  ] = useState(null)
  const [deleteUser, setDeleteUser] = useState(null)

  const secret  = getAdminSecret() || ''
  const current = typeof window !== 'undefined' ? getCurrentUser() : null

  const loadUsers = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res  = await fetch('/api/admin/users', { headers: { 'X-Admin-Secret': secret } })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Failed to load')
      setUsers(data.users || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [secret])

  useEffect(() => { loadUsers() }, [loadUsers])

  const copyEmail = async email => {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(email)
      setTimeout(() => setCopied(null), 1800)
    } catch {}
  }

  const handleCreated = user => setUsers(p => [user, ...p])
  const handleEdited  = user => setUsers(p => p.map(u => u.id === user.id ? user : u))
  const handleDeleted = id   => setUsers(p => p.filter(u => u.id !== id))

  // ── Filter + search ──────────────────────────────────────────────────────
  const filtered = users.filter(u => {
    const matchRole   = roleFilter === 'all' || u.role === roleFilter
    const matchSearch = !search.trim() ||
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase())
    return matchRole && matchSearch
  })

  // Count all three roles for the filter pills
  const counts = { all: users.length, customer: 0, staff: 0, admin: 0 }
  for (const u of users) counts[u.role] = (counts[u.role] || 0) + 1
  if (!ready) return null
  return (
    <>
      <style>{`
        .adm-users-filters{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;}
        .adm-role-pill{background:none;border:1px solid var(--color-border-tertiary);border-radius:20px;padding:5px 14px;font-size:12px;cursor:pointer;transition:all .15s;color:var(--color-text-secondary);}
        .adm-role-pill.active{background:var(--color-text-primary);color:var(--color-background-primary);border-color:var(--color-text-primary);}
        .adm-user-status{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:4px;}
        .adm-user-status.active{background:#639922;}
        .adm-user-status.inactive{background:#E24B4A;}
        .adm-user-badge-staff{background:#e2d9f3;color:#4a2c82;}
      `}</style>

      <div className="adm-users-page">
        <div className="adm-topbar">
          <h1 className="adm-page-title">Users</h1>
          <span className="adm-page-meta">{users.length} registered</span>
        </div>

        {/* Toolbar */}
        <div className="adm-toolbar">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="adm-search"
          />
          {/* Admin can add any user; staff can add customers */}
          <button className="adm-btn adm-btn-primary" onClick={() => setAddOpen(true)}>
            + {isStaff ? 'Add customer' : 'Add user'}
          </button>
        </div>

        {/* Role filter pills */}
        <div className="adm-users-filters">
          {['all', 'customer', 'staff', 'admin'].map(r => (
            <button
              key={r}
              className={`adm-role-pill${roleFilter === r ? ' active' : ''}`}
              onClick={() => setRoleFilter(r)}
            >
              {r.charAt(0).toUpperCase() + r.slice(1)} ({counts[r] || 0})
            </button>
          ))}
        </div>

        {error && <p className="adm-error-msg">{error}</p>}

        {loading ? (
          <p className="adm-muted">Loading users…</p>
        ) : filtered.length === 0 ? (
          <p className="adm-muted">{users.length === 0 ? 'No users yet.' : 'No results.'}</p>
        ) : (
          <div className="adm-user-list">
            {filtered.map(u => {
              const isSelf = current?.id === u.id

              // Who can edit this row?
              // Admin  : everyone
              // Staff  : only themselves OR customers
              const staffCanEdit = isStaff && (isSelf || u.role === 'customer')
              const canEdit      = isAdmin || staffCanEdit

              // Only admin can delete — and never themselves
              const canDelete = isAdmin && !isSelf

              return (
                <div key={u.id} className="adm-user-row">
                  <div className="adm-user-avatar">
                    {(u.firstName || u.name || u.email || '?')[0].toUpperCase()}
                  </div>

                  <div className="adm-user-info">
                    <div className="adm-user-name">
                      {u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—'}
                      {isSelf && (
                        <span style={{ marginLeft: 6, fontSize: '.68rem', color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
                          (you)
                        </span>
                      )}
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

                    {u.phone && (
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{u.phone}</div>
                    )}

                    <div className="adm-row-actions">
                      {canEdit && (
                        <button className="adm-row-btn" onClick={() => setEditUser(u)}>
                          {isSelf ? 'Edit my profile' : 'Edit'}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          className="adm-row-btn adm-row-btn-danger"
                          onClick={() => setDeleteUser(u)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="adm-user-aside">
                    <span className={`adm-user-badge adm-user-badge-${u.role || 'customer'}`}>
                      {u.role || 'customer'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                      <span className={`adm-user-status ${u.isActive ? 'active' : 'inactive'}`} />
                      <span className="adm-user-joined">{u.isActive ? 'Active' : 'Inactive'}</span>
                    </div>
                    <span className="adm-user-joined">{fmtDate(u.createdAt)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <Link href="/admin" className="adm-back-link">← Dashboard</Link>
      </div>

      {/* Add modal — admin sees full role selector, staff locked to customer */}
      {addOpen && (
        <UserModal
          secret={secret}
          onSave={handleCreated}
          onClose={() => setAddOpen(false)}
          editorRole={editorRole}
          isSelf={false}
        />
      )}

      {/* Edit modal — permissions determined by editorRole + isSelf */}
      {editUser && (
        <UserModal
          user={editUser}
          secret={secret}
          onSave={handleEdited}
          onClose={() => setEditUser(null)}
          editorRole={editorRole}
          isSelf={current?.id === editUser.id}
        />
      )}

      {/* Delete modal — admin only */}
      {isAdmin && deleteUser && (
        <DeleteModal
          user={deleteUser}
          secret={secret}
          onConfirm={handleDeleted}
          onClose={() => setDeleteUser(null)}
        />
      )}
    </>
  )
}