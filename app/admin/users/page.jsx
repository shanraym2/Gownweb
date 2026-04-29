'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { getAdminSecret } from '../layout'
import { getCurrentUser } from '../../utils/authClient'
import { useRoleGuard } from '../../utils/useRoleGuard'
import { isRealName, getPasswordRuleChecks, passwordMeetsRules } from '../../utils/authValidation'

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

// ── View user info modal (read-only) ──────────────────────────────────────────
//
// Shown when admin/staff clicks any non-self user row.
// Displays: full name, email, phone, address. Nothing is editable.

function ViewUserModal({ user, onClose }) {
  const fullName = user.name
    || `${user.firstName || ''} ${user.lastName || ''}`.trim()
    || '—'

  // Resolve address: may be a plain string or a structured object from user_addresses
  const address = (() => {
    const a = user.defaultAddress || user.address
    if (!a) return null
    if (typeof a === 'string') return a
    const parts = [
      a.recipientName || a.recipient_name,
      a.line1,
      a.line2,
      a.city,
      a.province,
      a.postalCode || a.postal_code,
      a.country !== 'PH' ? a.country : null,
    ].filter(Boolean)
    return parts.length ? parts.join(', ') : null
  })()

  const Row = ({ label, value }) => (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '110px 1fr',
      gap: '6px 12px',
      padding: '9px 0',
      borderBottom: '1px solid var(--color-border-tertiary)',
      alignItems: 'start',
    }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 500, paddingTop: 1 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: value ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>
        {value || '—'}
      </span>
    </div>
  )

  return (
    <Modal title="User Information" onClose={onClose}>
      <div className="modal-body" style={{ padding: '0 20px 4px' }}>
        {/* Avatar + name header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 0 14px' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'var(--color-text-primary)',
            color: 'var(--color-background-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 700, flexShrink: 0,
          }}>
            {(user.firstName || user.name || user.email || '?')[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {fullName}
            </div>
            <div style={{ fontSize: 11, marginTop: 3 }}>
              <span className={`adm-user-badge adm-user-badge-${user.role || 'customer'}`}>
                {user.role || 'customer'}
              </span>
            </div>
          </div>
        </div>

        <Row label="Email"   value={user.email} />
        <Row label="Phone"   value={user.phone} />
        <Row label="Address" value={address} />
        <Row label="Joined"  value={fmtDate(user.createdAt)} />
        <Row label="Status"  value={user.isActive ? 'Active' : 'Archived'} />

        <p style={{
          fontSize: 11, color: 'var(--color-text-tertiary)',
          margin: '14px 0 6px', lineHeight: 1.5,
        }}>
          User information can only be changed by the account owner.
        </p>
      </div>

      <div className="modal-footer">
        <button className="modal-btn modal-btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}

// ── Edit own profile modal ────────────────────────────────────────────────────
//
// Only the logged-in admin/staff can edit their own account.
// Fields: first name, last name, email, password. Role is always read-only.

function EditSelfModal({ user, secret, onSave, onClose }) {
  const [firstName, setFirstName] = useState(user?.firstName || user?.name?.split(' ')[0] || '')
  const [lastName,  setLastName ] = useState(user?.lastName  || user?.name?.split(' ').slice(1).join(' ') || '')
  const [email,     setEmail    ] = useState(user?.email || '')
  const [password,  setPassword ] = useState('')
  const [confirm,   setConfirm  ] = useState('')
  const [error,     setError    ] = useState('')
  const [saving,    setSaving   ] = useState(false)

  const pwdRules = getPasswordRuleChecks(password)

  async function handleSubmit() {
    setError('')
    if (!isRealName(firstName)) return setError('First name: letters only, spaces, hyphens, and apostrophes.')
    if (!isRealName(lastName))  return setError('Last name: letters only, spaces, hyphens, and apostrophes.')
    if (!email.trim())          return setError('Email is required.')

    if (password) {
      if (!passwordMeetsRules(password)) return setError('Password must be at least 8 characters and include letters and numbers.')
      if (password !== confirm)          return setError('Passwords do not match.')
    }

    setSaving(true)
    try {
      const res  = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
        body: JSON.stringify({
          id: user.id,
          firstName,
          lastName,
          email,
          ...(password ? { password } : {}),
        }),
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
    <Modal title="Edit My Profile" onClose={onClose}>
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

        <label className="modal-label">Role
          <input
            className="modal-input"
            value={`${(user.role || 'customer').charAt(0).toUpperCase() + (user.role || 'customer').slice(1)} (cannot change own role)`}
            readOnly
            style={{ opacity: 0.55, cursor: 'not-allowed' }}
          />
        </label>

        <label className="modal-label">
          New password{' '}
          <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>(leave blank to keep)</span>
          <input
            className="modal-input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>

        {password && (
          <>
            <div style={{ display: 'flex', gap: 10, margin: '-4px 0 6px', flexWrap: 'wrap' }}>
              {[
                { ok: pwdRules.length, label: '8+ chars' },
                { ok: pwdRules.letter, label: 'Letter'   },
                { ok: pwdRules.number, label: 'Number'   },
              ].map(({ ok, label }) => (
                <span key={label} style={{
                  fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 10,
                  background: ok ? '#dcfce7' : '#fee2e2',
                  color:      ok ? '#166534' : '#991b1b',
                }}>
                  {ok ? '✓' : '✗'} {label}
                </span>
              ))}
            </div>

            <label className="modal-label">Confirm password
              <input
                className="modal-input"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
              />
            </label>

            {confirm && password !== confirm && (
              <p style={{ fontSize: 11, color: '#991b1b', margin: '-4px 0 4px' }}>Passwords do not match.</p>
            )}
          </>
        )}
      </div>

      <div className="modal-footer">
        <button className="modal-btn modal-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="modal-btn modal-btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Modal>
  )
}

// ── Add user modal (admin only) ───────────────────────────────────────────────
//
// No password field — server generates a temporary random password.

function AddUserModal({ secret, editorRole, onSave, onClose }) {
  const assignableRoles = editorRole === 'admin'
    ? ['customer', 'staff', 'admin']
    : ['customer']

  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName ] = useState('')
  const [email,     setEmail    ] = useState('')
  const [role,      setRole     ] = useState('customer')
  const [error,     setError    ] = useState('')
  const [saving,    setSaving   ] = useState(false)

  async function handleSubmit() {
    setError('')
    if (!isRealName(firstName)) return setError('First name: letters only, spaces, hyphens, and apostrophes.')
    if (!isRealName(lastName))  return setError('Last name: letters only, spaces, hyphens, and apostrophes.')
    if (!email.trim())          return setError('Email is required.')

    setSaving(true)
    try {
      const res  = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          role: assignableRoles.includes(role) ? role : 'customer',
        }),
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
    <Modal title="Add User" onClose={onClose}>
      <div className="modal-body">
        {error && <div className="modal-error">{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="modal-label">First name
            <input className="modal-input" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Maria" />
          </label>
          <label className="modal-label">Last name
            <input className="modal-input" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Santos" />
          </label>
        </div>

        <label className="modal-label">Email
          <input className="modal-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" />
        </label>

        {editorRole === 'admin' ? (
          <label className="modal-label">Role
            <select className="modal-input modal-select" value={role} onChange={e => setRole(e.target.value)}>
              {assignableRoles.map(r => (
                <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="modal-label">Role
            <input className="modal-input" value="Customer" readOnly style={{ opacity: 0.55, cursor: 'not-allowed' }} />
          </label>
        )}

        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '8px 0 0', lineHeight: 1.5 }}>
          A temporary password will be generated. The user can change it after logging in.
        </p>
      </div>

      <div className="modal-footer">
        <button className="modal-btn modal-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="modal-btn modal-btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Creating…' : 'Create user'}
        </button>
      </div>
    </Modal>
  )
}

// ── Change role modal (admin only, staff users only) ──────────────────────────

function ChangeRoleModal({ user, secret, onSave, onClose }) {
  const [role,   setRole  ] = useState(user.role || 'staff')
  const [error,  setError ] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    setError('')
    setSaving(true)
    try {
      const res  = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
        body: JSON.stringify({ id: user.id, role }),
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
    <Modal title="Change Role" onClose={onClose}>
      <div className="modal-body">
        {error && <div className="modal-error">{error}</div>}
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
          Changing role for <strong>{user.name || user.email}</strong>.
        </p>
        <label className="modal-label">Role
          <select className="modal-input modal-select" value={role} onChange={e => setRole(e.target.value)}>
            {['staff', 'admin'].map(r => (
              <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
            ))}
          </select>
        </label>
        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '8px 0 0', lineHeight: 1.5 }}>
          Only Staff accounts can have their role changed. Customer roles are fixed.
        </p>
      </div>
      <div className="modal-footer">
        <button className="modal-btn modal-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="modal-btn modal-btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving…' : 'Change role'}
        </button>
      </div>
    </Modal>
  )
}

// ── Archive confirm modal ─────────────────────────────────────────────────────

function ArchiveModal({ user, secret, onConfirm, onClose }) {
  const isArchiving = user.isActive
  const [loading, setLoading] = useState(false)
  const [error,   setError  ] = useState('')

  async function handleArchive() {
    setLoading(true)
    try {
      const res  = await fetch(`/api/admin/users?id=${user.id}`, {
        method:  'DELETE',
        headers: { 'X-Admin-Secret': secret },
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error || 'Failed.'); return }
      onConfirm(user.id, !isArchiving)
      onClose()
    } catch {
      setError('Could not connect.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title={isArchiving ? 'Archive User' : 'Restore User'} onClose={onClose}>
      <div className="modal-body">
        {error && <div className="modal-error">{error}</div>}
        <p className="modal-confirm-text">
          {isArchiving ? (
            <>
              Archive <strong>{user.name || user.email}</strong>?{' '}
              Their account and order history will be preserved but they won't be able to log in.
              You can restore them later.
            </>
          ) : (
            <>
              Restore <strong>{user.name || user.email}</strong>?{' '}
              Their account will be reactivated and they'll be able to log in again.
            </>
          )}
        </p>
      </div>
      <div className="modal-footer">
        <button className="modal-btn modal-btn-ghost" onClick={onClose}>Cancel</button>
        <button
          className={`modal-btn ${isArchiving ? 'modal-btn-danger' : 'modal-btn-primary'}`}
          onClick={handleArchive}
          disabled={loading}
        >
          {loading
            ? (isArchiving ? 'Archiving…' : 'Restoring…')
            : (isArchiving ? 'Archive user' : 'Restore user')}
        </button>
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const { user: authUser, ready } = useRoleGuard(['admin', 'staff'], '/')

  const isAdmin    = authUser?.role === 'admin'
  const editorRole = authUser?.role

  const [users,        setUsers       ] = useState([])
  const [loading,      setLoading     ] = useState(true)
  const [error,        setError       ] = useState('')
  const [search,       setSearch      ] = useState('')
  const [roleFilter,   setRoleFilter  ] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')
  const [copied,       setCopied      ] = useState(null)
  const [addOpen,      setAddOpen     ] = useState(false)
  const [editSelf,     setEditSelf    ] = useState(false)
  const [viewUser,     setViewUser    ] = useState(null)  // read-only info modal
  const [roleUser,     setRoleUser    ] = useState(null)  // change role modal
  const [archiveUser,  setArchiveUser ] = useState(null)

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

  const handleCreated  = user => setUsers(p => [user, ...p])
  const handleEdited   = user => setUsers(p => p.map(u => u.id === user.id ? user : u))
  const handleArchived = (id, newActiveState) =>
    setUsers(p => p.map(u => u.id === id ? { ...u, isActive: newActiveState } : u))

  const filtered = users.filter(u => {
    const matchRole   = roleFilter === 'all' || u.role === roleFilter
    const matchStatus = statusFilter === 'all'
      ? true
      : statusFilter === 'active' ? u.isActive : !u.isActive
    const q = search.trim().toLowerCase()
    const matchSearch = !q ||
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.firstName?.toLowerCase().includes(q) ||
      u.lastName?.toLowerCase().includes(q)
    return matchRole && matchStatus && matchSearch
  })

  const counts = { all: users.length, customer: 0, staff: 0, admin: 0 }
  for (const u of users) counts[u.role] = (counts[u.role] || 0) + 1
  const archivedCount = users.filter(u => !u.isActive).length

  const selfRecord = users.find(u => u.id === current?.id) || null

  if (!ready) return null

  return (
    <>
      <style>{`
        .adm-users-filters{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;}
        .adm-role-pill{background:none;border:1px solid var(--color-border-tertiary);border-radius:20px;padding:5px 14px;font-size:12px;cursor:pointer;transition:all .15s;color:var(--color-text-secondary);}
        .adm-role-pill.active{background:var(--color-text-primary);color:var(--color-background-primary);border-color:var(--color-text-primary);}
        .adm-status-filters{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}
        .adm-status-pill{background:none;border:1px solid var(--color-border-tertiary);border-radius:6px;padding:4px 12px;font-size:11px;cursor:pointer;transition:all .15s;color:var(--color-text-secondary);}
        .adm-status-pill.active{background:var(--color-text-secondary);color:var(--color-background-primary);border-color:var(--color-text-secondary);}
        .adm-status-pill.archived.active{background:#b45309;border-color:#b45309;}
        .adm-user-status{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:4px;}
        .adm-user-status.active{background:#639922;}
        .adm-user-status.inactive{background:#9ca3af;}
        .adm-user-badge-staff{background:#e2d9f3;color:#4a2c82;}
        .adm-archived-banner{background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;padding:6px 12px;font-size:11px;color:#92400e;margin-bottom:12px;}
        .adm-my-profile-bar{display:flex;align-items:center;justify-content:space-between;background:var(--color-background-secondary,#f9fafb);border:1px solid var(--color-border-tertiary);border-radius:8px;padding:10px 14px;margin-bottom:18px;gap:12px;flex-wrap:wrap;}
        .adm-my-profile-info{display:flex;flex-direction:column;gap:2px;}
        .adm-my-profile-name{font-size:13px;font-weight:600;color:var(--color-text-primary);}
        .adm-my-profile-meta{font-size:11px;color:var(--color-text-tertiary);}
        .adm-user-row{cursor:default;transition:background .12s;}
        .adm-user-row.clickable{cursor:pointer;}
        .adm-user-row.clickable:hover{background:var(--color-background-secondary,#f9fafb);}
        .adm-user-details{display:flex;gap:12px;flex-wrap:wrap;margin-top:4px;}
        .adm-user-detail-chip{font-size:11px;color:var(--color-text-tertiary);display:flex;align-items:center;gap:4px;}
      `}</style>

      <div className="adm-users-page">
        <div className="adm-topbar">
          <h1 className="adm-page-title">Users</h1>
          <span className="adm-page-meta">
            {users.length} registered{archivedCount > 0 ? ` · ${archivedCount} archived` : ''}
          </span>
        </div>

        {/* My Profile quick-edit bar */}
        {selfRecord && (
          <div className="adm-my-profile-bar">
            <div className="adm-my-profile-info">
              <span className="adm-my-profile-name">
                {selfRecord.name || `${selfRecord.firstName || ''} ${selfRecord.lastName || ''}`.trim() || current?.email}
                <span style={{ marginLeft: 6, fontSize: '.68rem', color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
                  (you)
                </span>
              </span>
              <span className="adm-my-profile-meta">{selfRecord.email} · {selfRecord.role}</span>
            </div>
            <button className="adm-btn adm-btn-secondary" onClick={() => setEditSelf(true)}>
              Edit my profile
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div className="adm-toolbar">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="adm-search"
          />
          {isAdmin && (
            <button className="adm-btn adm-btn-primary" onClick={() => setAddOpen(true)}>
              + Add user
            </button>
          )}
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

        {/* Status filter */}
        <div className="adm-status-filters">
          {[
            { key: 'active',   label: 'Active' },
            { key: 'archived', label: `Archived (${archivedCount})` },
            { key: 'all',      label: 'All' },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`adm-status-pill ${key}${statusFilter === key ? ' active' : ''}`}
              onClick={() => setStatusFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {statusFilter === 'archived' && (
          <div className="adm-archived-banner">
            Archived users cannot log in but their data and order history is preserved.
          </div>
        )}

        {error && <p className="adm-error-msg">{error}</p>}

        {loading ? (
          <p className="adm-muted">Loading users…</p>
        ) : filtered.length === 0 ? (
          <p className="adm-muted">{users.length === 0 ? 'No users yet.' : 'No results.'}</p>
        ) : (
          <div className="adm-user-list">
            {filtered.map(u => {
              const isSelf        = current?.id === u.id
              const canChangeRole = isAdmin && !isSelf && u.role === 'staff'
              const canArchive    = isAdmin && !isSelf

              const fullName = u.name
                || `${u.firstName || ''} ${u.lastName || ''}`.trim()
                || '—'

              // Compact address for the row (city/province only)
              const addressChip = (() => {
                const a = u.defaultAddress || u.address
                if (!a) return null
                if (typeof a === 'string') return a.length > 40 ? a.slice(0, 40) + '…' : a
                return [a.city, a.province].filter(Boolean).join(', ') || null
              })()

              return (
                <div
                  key={u.id}
                  className={`adm-user-row${!isSelf ? ' clickable' : ''}`}
                  style={!u.isActive ? { opacity: 0.6 } : undefined}
                  onClick={() => { if (!isSelf) setViewUser(u) }}
                  title={!isSelf ? 'View user details' : undefined}
                >
                  <div className="adm-user-avatar">
                    {(u.firstName || u.name || u.email || '?')[0].toUpperCase()}
                  </div>

                  <div className="adm-user-info">
                    <div className="adm-user-name">
                      {fullName}
                      {isSelf && (
                        <span style={{ marginLeft: 6, fontSize: '.68rem', color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
                          (you)
                        </span>
                      )}
                      {!u.isActive && (
                        <span style={{ marginLeft: 6, fontSize: '.68rem', color: '#b45309', fontWeight: 500 }}>
                          archived
                        </span>
                      )}
                    </div>

                    {/* Inline chips: email · phone · address */}
                    <div className="adm-user-details">
                      <span className="adm-user-detail-chip">
                        <span style={{ opacity: 0.45 }}>✉</span>
                        {u.email}
                        <button
                          onClick={e => { e.stopPropagation(); copyEmail(u.email) }}
                          className={`adm-copy-btn${copied === u.email ? ' is-copied' : ''}`}
                        >
                          {copied === u.email ? 'Copied' : 'Copy'}
                        </button>
                      </span>
                      {u.phone && (
                        <span className="adm-user-detail-chip">
                          <span style={{ opacity: 0.45 }}>☏</span>
                          {u.phone}
                        </span>
                      )}
                      {addressChip && (
                        <span className="adm-user-detail-chip">
                          <span style={{ opacity: 0.45 }}>⌖</span>
                          {addressChip}
                        </span>
                      )}
                    </div>

                    {/* Row action buttons — stop propagation so they don't open the view modal */}
                    <div className="adm-row-actions" onClick={e => e.stopPropagation()}>
                      {canChangeRole && u.isActive && (
                        <button className="adm-row-btn" onClick={() => setRoleUser(u)}>
                          Change role
                        </button>
                      )}
                      {canArchive && (
                        <button
                          className={`adm-row-btn${u.isActive ? ' adm-row-btn-danger' : ''}`}
                          onClick={() => setArchiveUser(u)}
                        >
                          {u.isActive ? 'Archive' : 'Restore'}
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
                      <span className="adm-user-joined">{u.isActive ? 'Active' : 'Archived'}</span>
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

      {/* Read-only user info modal — any non-self user */}
      {viewUser && (
        <ViewUserModal
          user={viewUser}
          onClose={() => setViewUser(null)}
        />
      )}

      {/* Edit own profile — admin & staff */}
      {editSelf && selfRecord && (
        <EditSelfModal
          user={selfRecord}
          secret={secret}
          onSave={handleEdited}
          onClose={() => setEditSelf(false)}
        />
      )}

      {/* Add user — admin only */}
      {isAdmin && addOpen && (
        <AddUserModal
          secret={secret}
          editorRole={editorRole}
          onSave={handleCreated}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* Change role — admin only, staff accounts only */}
      {isAdmin && roleUser && (
        <ChangeRoleModal
          user={roleUser}
          secret={secret}
          onSave={handleEdited}
          onClose={() => setRoleUser(null)}
        />
      )}

      {/* Archive / restore — admin only */}
      {isAdmin && archiveUser && (
        <ArchiveModal
          user={archiveUser}
          secret={secret}
          onConfirm={handleArchived}
          onClose={() => setArchiveUser(null)}
        />
      )}
    </>
  )
}