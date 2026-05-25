'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser, logoutUser, updateUser, resetUserPassword, loadUsers } from '../utils/authClient'
import { getPasswordRuleChecks, passwordMeetsRules } from '../utils/authValidation'
import '../profile.css'

// ─── helpers ────────────────────────────────────────────────────────────────

const PROFILE_KEY = 'jce_profile_extra'

function loadProfileExtra() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') }
  catch { return {} }
}

function saveProfileExtra(data) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(data))
}

async function hashPassword(pw) {
  if (!window.crypto?.subtle) return String(pw || '')
  const data   = new TextEncoder().encode(String(pw || ''))
  const digest = await window.crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── Avatar ──────────────────────────────────────────────────────────────────

function Avatar({ name }) {
  const initials = (name || 'G')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="profile-avatar" aria-hidden="true">
      <span>{initials}</span>
      <div className="profile-avatar-ring" />
    </div>
  )
}

// ─── Editable field ──────────────────────────────────────────────────────────

function EditableField({ label, name, type = 'text', value, editing, onChange, placeholder, maxLength }) {
  return (
    <div className={`profile-field ${editing ? 'profile-field--editing' : ''}`}>
      <label className="profile-field-label">{label}</label>
      {editing ? (
        <input
          className="profile-field-input"
          type={type} name={name} value={value}
          onChange={onChange} placeholder={placeholder || label}
          maxLength={maxLength} autoComplete="off"
        />
      ) : (
        <p className="profile-field-value">
          {value || <span className="profile-field-empty">Not set</span>}
        </p>
      )}
    </div>
  )
}

// ─── Measurements Card ────────────────────────────────────────────────────────

function MeasurementsCard({ userId }) {
  const [meas,         setMeas        ] = useState(null)
  const [sizes,        setSizes       ] = useState([])
  const [supplierName, setSupplierName] = useState('')
  const [loading,      setLoading     ] = useState(true)
  const [editing,      setEditing     ] = useState(false)
  const [saving,       setSaving      ] = useState(false)
  const [deleting,     setDeleting    ] = useState(false)
  const [msg,          setMsg         ] = useState(null)
  const [form, setForm] = useState({ bust: '', waist: '', hips: '', height: '', weight: '' })
  const [unit, setUnit] = useState(() =>
  typeof window !== 'undefined' ? (localStorage.getItem('fr_unit') || 'cm') : 'cm'
  )
  const toggleUnit = () => setUnit(u => {
    const n = u === 'cm' ? 'in' : 'cm'
    localStorage.setItem('fr_unit', n)
    return n
  })
  const CM_PER_INCH = 2.54
  const cmToIn = cm => cm != null ? Math.round((cm / CM_PER_INCH) * 10) / 10 : null
  const inToCm = inches => inches != null ? Math.round(inches * CM_PER_INCH * 10) / 10 : null
  const dispVal = (cm) => cm == null ? '—' : unit === 'in' ? `${cmToIn(cm)} in` : `${cm} cm`

  useEffect(() => {
    if (!userId) { setLoading(false); return }
    Promise.all([
      fetch('/api/measurements', { headers: { 'x-user-id': userId } }).then(r => r.json()),
      fetch('/api/size-chart').then(r => r.json()),
    ])
      .then(([mData, cData]) => {
        if (mData.ok && mData.measurements) {
          setMeas(mData.measurements)
          setForm({
            bust:   String(mData.measurements.bust_cm  ?? ''),
            waist:  String(mData.measurements.waist_cm ?? ''),
            hips:   String(mData.measurements.hips_cm  ?? ''),
            height: String(mData.measurements.height_cm ?? ''),
            weight: String(mData.measurements.weight_kg ?? ''),
          })
        }
        if (cData.ok) { setSizes(cData.sizes); setSupplierName(cData.supplierName || '') }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [userId])

  const recommendation = useMemo(() => {
    if (!meas || !sizes.length) return null
    const bust = meas.bust_cm, waist = meas.waist_cm, hips = meas.hips_cm
    let best = null, bestScore = Infinity
    for (const sz of sizes) {
      let score = 0, hits = 0
      if (bust  && sz.bust_min  != null) { score += Math.abs(bust  - (sz.bust_min  + sz.bust_max)  / 2); hits++ }
      if (waist && sz.waist_min != null) { score += Math.abs(waist - (sz.waist_min + sz.waist_max) / 2); hits++ }
      if (hips  && sz.hip_min   != null) { score += Math.abs(hips  - (sz.hip_min   + sz.hip_max)   / 2); hits++ }
      if (hits === 0) continue
      score /= hits
      if (score < bestScore) { bestScore = score; best = sz }
    }
    if (!best) return null
    const idx  = sizes.findIndex(s => s.label === best.label)
    const conf = Math.min(Math.round(100 - bestScore * 3), 95)
    return {
      size:     best,
      score:    bestScore,
      conf,
      adjacent: sizes.slice(Math.max(0, idx - 1), Math.min(sizes.length, idx + 2)),
    }
  }, [meas, sizes])

  const handleSave = async () => {
    setSaving(true); setMsg(null)
    const toStoredCm = (key, val) => {
      if (!val) return null
      const n = Number(val)
      if (!Number.isFinite(n)) return null
      // weight is always kg, height/bust/waist/hips convert if unit is 'in'
      return (unit === 'in' && key !== 'weight') ? Math.round(n * CM_PER_INCH * 10) / 10 : n
    }
    try {
      const body = {
        bust_cm:   toStoredCm('bust',   form.bust),
        waist_cm:  toStoredCm('waist',  form.waist),
        hips_cm:   toStoredCm('hips',   form.hips),
        height_cm: toStoredCm('height', form.height),
        weight_kg: toStoredCm('weight', form.weight),
        source:    'manual',
      }
      if (!body.bust_cm && !body.waist_cm && !body.hips_cm) {
        setMsg({ text: 'Enter at least one of bust, waist, or hips.', type: 'error' }); setSaving(false); return
      }
      const res  = await fetch('/api/measurements', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (data.ok) {
        setMeas(data.measurements); setEditing(false)
        setMsg({ text: '✓ Measurements saved', type: 'success' })
        setTimeout(() => setMsg(null), 3000)
      } else {
        setMsg({ text: data.error || 'Save failed.', type: 'error' })
      }
    } catch {
      setMsg({ text: 'Network error. Try again.', type: 'error' })
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm('Remove your saved measurements?')) return
    setDeleting(true)
    try {
      await fetch('/api/measurements', { method: 'DELETE', headers: { 'x-user-id': userId } })
      setMeas(null); setForm({ bust: '', waist: '', hips: '', height: '', weight: '' })
      setMsg({ text: 'Measurements cleared.', type: 'success' })
      setTimeout(() => setMsg(null), 3000)
    } catch {
      setMsg({ text: 'Could not clear. Try again.', type: 'error' })
    } finally { setDeleting(false) }
  }

  const confColor = recommendation
    ? (recommendation.conf >= 75 ? '#1D9E75' : recommendation.conf >= 55 ? '#EF9F27' : '#E24B4A')
    : '#999'

  if (loading) return (
    <div className="profile-card profile-card--sm profile-meas-card">
      <h2 className="profile-card-title">My measurements</h2>
      <p className="profile-card-sub">Loading…</p>
    </div>
  )

  return (
    <div className="profile-card profile-meas-card">
      <div className="profile-card-header">
        <div>
          <h2 className="profile-card-title">My measurements</h2>
          <p className="profile-card-sub">
            Used by FitMatcher to recommend your size on every gown page.
          </p>
        </div>
        {!editing && meas && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-outline profile-meas-edit-btn" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              className="profile-meas-delete-btn"
              onClick={handleDelete}
              disabled={deleting}
              title="Clear measurements"
              aria-label="Delete measurements"
            >
              {deleting ? '…' : '✕'}
            </button>
          </div>
        )}
      </div>

      {msg && (
        <div className={`profile-meas-msg profile-meas-msg--${msg.type}`}>
          {msg.text}
        </div>
      )}

      {/* ── No data: CTA ── */}
      {!meas && !editing && (
        <div className="profile-meas-empty">
          <p className="profile-meas-empty-text">
            No measurements saved yet. Use the size recommender to get personalised size suggestions on any gown.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/fitting-room" className="btn btn-primary profile-meas-cta-btn">
              Use camera / enter measurements →
            </Link>
            <button className="btn btn-outline" onClick={() => setEditing(true)}>
              Enter manually
            </button>
          </div>
        </div>
      )}

      {/* ── Has data: display ── */}
      {meas && !editing && (
        <>
          <div className="profile-meas-grid">
            {[
             { label: 'Bust',   val: meas.bust_cm,   isKg: false },
             { label: 'Waist',  val: meas.waist_cm,  isKg: false },
             { label: 'Hips',   val: meas.hips_cm,   isKg: false },
             { label: 'Height', val: meas.height_cm, isKg: false },
             { label: 'Weight', val: meas.weight_kg, isKg: true  },
            ].filter(f => f.val != null).map(f => (
              <div key={f.label} className="profile-meas-item">
                <div className="profile-meas-label">{f.label}</div>
                <div className="profile-meas-val">
                  {f.isKg ? `${f.val} kg` : dispVal(f.val)}
                </div>
              </div>
            ))}
            <div className="profile-meas-item profile-meas-item--source">
              <div className="profile-meas-label">Source</div>
              <div className="profile-meas-val profile-meas-val--src">{meas.source || 'manual'}</div>
            </div>
          </div>

          {recommendation && (
            <div className="profile-meas-rec">
              <div className="profile-meas-rec-row">
                <div>
                  <div className="profile-meas-rec-label">
                    Your typical size · {supplierName || 'Standard'} chart
                  </div>
                  <div className="profile-meas-rec-size">{recommendation.size.label}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="profile-meas-rec-label">Match</div>
                  <div className="profile-meas-rec-conf" style={{ color: confColor }}>
                    {recommendation.conf}%
                  </div>
                </div>
              </div>
              <div className="profile-meas-conf-track">
                <div className="profile-meas-conf-fill" style={{ width: `${recommendation.conf}%`, background: confColor }}/>
              </div>
              <div className="profile-meas-pills">
                {recommendation.adjacent.map(sz => (
                  <span
                    key={sz.label}
                    className={`profile-meas-pill${sz.label === recommendation.size.label ? ' profile-meas-pill--match' : ''}`}
                  >
                    {sz.label}
                  </span>
                ))}
              </div>
              {recommendation.score > 5 && (
                <p className="profile-meas-border-note">
                  You're near a size boundary. Consider sizing up — alteration services are available.
                </p>
              )}
            </div>
          )}

          <div className="profile-meas-footer">
            <Link href="/fitting-room" className="profile-link-inline">
              Retake with camera →
            </Link>
            <span className="profile-meas-footer-sep">·</span>
            <span className="profile-meas-date">
              Updated {new Date(meas.measured_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </>
      )}

      {/* ── Edit form ── */}
      {editing && (
        <div className="profile-meas-form">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <p className="profile-meas-form-note" style={{ margin:0 }}>
              Enter in {unit === 'in' ? 'inches' : 'centimetres'}. At least one of bust, waist, or hips is required.
            </p>
            <button
              onClick={toggleUnit}
              style={{ fontSize:'11px', padding:'2px 8px', borderRadius:'10px', cursor:'pointer',
                border:'0.5px solid #e0ddd8', background:'#f5f3ef', color:'#888', flexShrink:0 }}
              aria-label={`Switch to ${unit === 'cm' ? 'inches' : 'centimetres'}`}
            >
              {unit === 'cm' ? 'cm' : 'in'}
            </button>
          </div>
          <div className="profile-meas-form-grid">
            {[
              { label: 'Bust / chest', key: 'bust',   placeholder: unit==='in'?'e.g. 34.5':'e.g. 88',  unit: unit },
              { label: 'Waist',        key: 'waist',  placeholder: unit==='in'?'e.g. 27.5':'e.g. 70',  unit: unit },
              { label: 'Hips',         key: 'hips',   placeholder: unit==='in'?'e.g. 37.5':'e.g. 95',  unit: unit },
              { label: 'Height',       key: 'height', placeholder: unit==='in'?'e.g. 64':'e.g. 162',   unit: unit, optional: true },
              { label: 'Weight',       key: 'weight', placeholder: 'e.g. 58',  unit: 'kg', optional: true },
            ].map(f => (
              <div key={f.key} className="profile-field">
                <label className="profile-field-label">
                  {f.label}
                  {f.optional && <span className="profile-meas-opt"> (optional)</span>}
                </label>
                <div className="profile-meas-input-wrap">
                  <input
                    className="profile-field-input"
                    type="number"
                    value={form[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    min={f.min} max={f.max}
                  />
                  <span className="profile-meas-unit-label">{f.unit}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="profile-edit-controls" style={{ marginTop: 4 }}>
            <button className="btn btn-outline" onClick={() => { setEditing(false); setMsg(null) }} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save measurements'}
            </button>
          </div>
          <p className="profile-meas-tip">
            Or use the{' '}
            <Link href="/fitting-room" className="profile-link-inline">
              camera-based recommender
            </Link>
            {' '}for automatic measurement estimation.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Change Password Modal ────────────────────────────────────────────────────

function ChangePasswordModal({ email, onClose }) {
  const [step, setStep]                       = useState(1)
  const [otp, setOtp]                         = useState('')
  const [newPassword, setNewPassword]         = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPwd, setShowPwd]                 = useState(false)
  const [showConfirm, setShowConfirm]         = useState(false)
  const [error, setError]                     = useState('')
  const [submitting, setSubmitting]           = useState(false)
  const [devMode, setDevMode]                 = useState(false)

  const pwdChecks = useMemo(() => getPasswordRuleChecks(newPassword), [newPassword])
  const canSubmit = useMemo(
    () => passwordMeetsRules(newPassword) && newPassword === confirmPassword,
    [newPassword, confirmPassword]
  )

  const handleSendOtp = async () => {
    setError(''); setSubmitting(true)
    try {
      const res  = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose: 'password_reset' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) { setError(data.error || 'Failed to send code.'); return }
      setDevMode(!!data.devMode)
      setStep(2)
    } catch { setError('Network error. Please try again.') }
    finally { setSubmitting(false) }
  }

  const handleVerifyOtp = async (e) => {
    e.preventDefault(); setError('')
    if (!otp || otp.length !== 6) { setError('Enter the 6-digit code.'); return }
    setSubmitting(true)
    try {
      const res  = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: otp.trim(), purpose: 'password_reset' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) { setError(data.error || 'Invalid or expired code.'); return }
      setStep(3)
    } catch { setError('Verification failed. Try again.') }
    finally { setSubmitting(false) }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault(); setError('')
    if (!canSubmit) return
    try {
      const users      = loadUsers()
      const storedUser = users.find(u => u.email?.toLowerCase() === email?.toLowerCase())
      if (storedUser?.passwordHash) {
        const newHash = await hashPassword(newPassword)
        if (newHash === storedUser.passwordHash) {
          setError('New password must be different from your current password.')
          return
        }
      }
    } catch {}

    setSubmitting(true)
    try {
      const result = await resetUserPassword({ email, password: newPassword })
      if (!result.ok) { setError(result.error || 'Unable to update password.'); return }
      onClose(true)
    } finally { setSubmitting(false) }
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Change password">
      <div className="modal-box">
        <button className="modal-close" onClick={() => onClose(false)} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <span className="modal-label">ACCOUNT SECURITY</span>
        <h2 className="modal-title">Change password</h2>

        <div className="modal-steps" aria-hidden="true">
          {[1,2,3].map(n => (
            <div key={n} className={`modal-step-dot ${step >= n ? 'modal-step-dot--done' : ''}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="modal-body">
            <p className="modal-desc">
              We'll send a verification code to <strong>{email}</strong> to confirm it's you.
            </p>
            {error && <p className="modal-error">{error}</p>}
            <button className="btn btn-primary modal-btn" onClick={handleSendOtp} disabled={submitting}>
              {submitting ? 'Sending…' : 'Send verification code'}
            </button>
          </div>
        )}

        {step === 2 && (
          <form className="modal-body" onSubmit={handleVerifyOtp}>
            <p className="modal-desc">
              {devMode
                ? <>Check the <strong>terminal</strong> running <code>npm run dev</code> for your code.</>
                : <>Enter the 6-digit code sent to <strong>{email}</strong>.</>}
            </p>
            <div className="modal-field">
              <label className="modal-field-label">Verification code</label>
              <input
                className="modal-field-input modal-otp-input"
                type="text" inputMode="numeric" maxLength={6}
                value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="000000" autoFocus
              />
            </div>
            {error && <p className="modal-error">{error}</p>}
            <button type="submit" className="btn btn-primary modal-btn" disabled={submitting}>
              {submitting ? 'Verifying…' : 'Verify code'}
            </button>
            <button type="button" className="modal-back" onClick={() => { setStep(1); setOtp(''); setError('') }}>
              ← Back
            </button>
          </form>
        )}

        {step === 3 && (
          <form className="modal-body" onSubmit={handleResetPassword}>
            <div className="modal-field">
              <label className="modal-field-label">New password</label>
              <div className="modal-pwd-row">
                <input
                  className="modal-field-input"
                  type={showPwd ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setError('') }}
                  placeholder="Create a new password"
                  autoComplete="new-password" autoFocus
                />
                <button type="button" className="modal-show-pwd" onClick={() => setShowPwd(v => !v)}>
                  {showPwd ? 'Hide' : 'Show'}
                </button>
              </div>
              <ul className="modal-pwd-rules" aria-live="polite">
                <li className={pwdChecks.length ? 'rule-met' : ''}>At least 8 characters</li>
                <li className={pwdChecks.letter ? 'rule-met' : ''}>At least one letter</li>
                <li className={pwdChecks.number ? 'rule-met' : ''}>At least one number</li>
              </ul>
            </div>

            <div className="modal-field">
              <label className="modal-field-label">Confirm new password</label>
              <div className="modal-pwd-row">
                <input
                  className="modal-field-input"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError('') }}
                  placeholder="Confirm your new password"
                  autoComplete="new-password"
                />
                <button type="button" className="modal-show-pwd" onClick={() => setShowConfirm(v => !v)}>
                  {showConfirm ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {error && <p className="modal-error">{error}</p>}
            <button type="submit" className="btn btn-primary modal-btn" disabled={submitting || !canSubmit}>
              {submitting ? 'Saving…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter()

  const [user,          setUser         ] = useState(null)
  const [editing,       setEditing      ] = useState(false)
  const [saving,        setSaving       ] = useState(false)
  const [toast,         setToast        ] = useState(null)
  const [orders,        setOrders       ] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [showPwdModal,  setShowPwdModal ] = useState(false)
  const [form, setForm] = useState({
    name: '', email: '', phone: '',
    address: '', city: '', province: '', zip: '',
  })

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2800)
  }

  const [content, setContent] = useState({
    heading:    'My Profile',
    save_label: 'Save changes',
    help_text:  'Update your name, email address, or password below.',
  })

  useEffect(() => {
    fetch('/api/cms/content?section=profile')
      .then(r => r.json())
      .then(d => { if (d.ok && d.fields) setContent(d.fields) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const existing = getCurrentUser()
    if (!existing) { router.replace('/login'); return }
    setUser(existing)

    const extra = loadProfileExtra()
    setForm({
      name:     existing.name  || '',
      email:    existing.email || '',
      phone:    extra.phone    || '',
      address:  extra.address  || '',
      city:     extra.city     || '',
      province: extra.province || '',
      zip:      extra.zip      || '',
    })

    fetch('/api/my-orders', {
      headers: { 'X-Customer-Email': existing.email }
    })
      .then(r => r.json())
      .then(data => { if (data.ok) setOrders((data.orders || []).slice(0, 3)) })
      .catch(() => {})
      .finally(() => setOrdersLoading(false))

  }, [router])

  const handleChange = (e) => {
    const { name, value } = e.target
    const val = name === 'phone' || name === 'zip' ? value.replace(/\D/g, '') : value
    setForm(prev => ({ ...prev, [name]: val }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      updateUser({ name: form.name, email: form.email })
      saveProfileExtra({
        phone:    form.phone,
        address:  form.address,
        city:     form.city,
        province: form.province,
        zip:      form.zip,
      })
      setUser(prev => ({ ...prev, name: form.name, email: form.email }))
      await new Promise(r => setTimeout(r, 500))
      setEditing(false)
      showToast('Profile updated')

      // Re-fetch orders with updated email
      fetch('/api/my-orders', { headers: { 'X-Customer-Email': form.email } })
        .then(r => r.json())
        .then(data => { if (data.ok) setOrders((data.orders || []).slice(0, 3)) })
        .catch(() => {})
    } finally { setSaving(false) }
  }

  const handleCancel = () => {
    const existing = getCurrentUser()
    const extra    = loadProfileExtra()
    setForm({
      name:     existing?.name  || '',
      email:    existing?.email || '',
      phone:    extra.phone     || '',
      address:  extra.address   || '',
      city:     extra.city      || '',
      province: extra.province  || '',
      zip:      extra.zip       || '',
    })
    setEditing(false)
  }

  const handleLogout = () => { logoutUser(); router.push('/') }

  const handlePwdModalClose = (success) => {
    setShowPwdModal(false)
    if (success) showToast('Password updated successfully')
  }

  const profileComplete = [
    form.name, form.email, form.phone,
    form.address, form.city, form.province, form.zip,
  ].filter(Boolean).length
  const completionPct = Math.round((profileComplete / 7) * 100)

  if (!user) return (
    <main className="auth-page">
      <Header />
      <section className="gowns-header-spacer" />
      <section className="profile-loading">
        <div className="profile-loading-dot" />
        <div className="profile-loading-dot" />
        <div className="profile-loading-dot" />
      </section>
      <Footer />
    </main>
  )

  return (
    <main className="auth-page profile-page">
      <Header solid />
      <section className="gowns-header-spacer" />

      {/* ── Hero ── */}
      <section className="profile-hero">
        <div className="profile-hero-inner">
          <Avatar name={user.name} />
          <div className="profile-hero-text">
            <span className="profile-label">{content.heading}</span>
            <h1 className="profile-name">{user.name || 'Guest'}</h1>
            <span className="profile-member-since">
              Member since {user.createdAt
                ? new Date(user.createdAt).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
                : new Date().getFullYear()}
            </span>
          </div>
          <div className="profile-actions-top">
            {!editing ? (
              <button className="btn btn-outline profile-edit-btn" onClick={() => setEditing(true)}>
                Edit profile
              </button>
            ) : (
              <div className="profile-edit-controls">
                <button className="btn btn-outline" onClick={handleCancel} disabled={saving}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : content.save_label}
                </button>
              </div>
            )}
          </div>
        </div>

        {toast && (
          <div className={`profile-toast profile-toast--${toast.type}`} role="status">
            {toast.type === 'success' ? '✓' : '!'} {toast.msg}
          </div>
        )}
      </section>

      {/* ── Main ── */}
      <section className="profile-section">
        <div className="profile-grid">

          {/* ── Left column: info + measurements ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* ── Info card ── */}
            <div className="profile-card">
              <div className="profile-card-header">
                <h2 className="profile-card-title">Personal information</h2>
                <p className="profile-card-sub">
                  {editing ? content.help_text : 'Pre-fills your checkout. Click "Edit profile" to update.'}
                </p>
              </div>

              <div className="profile-fields">
                <div className="profile-fields-row">
                  <EditableField label="Full name" name="name"  value={form.name}  editing={editing} onChange={handleChange} />
                  <EditableField label="Email"     name="email" type="email" value={form.email} editing={editing} onChange={handleChange} />
                </div>
                <EditableField label="Phone number" name="phone" type="tel" value={form.phone} editing={editing} onChange={handleChange} maxLength={11} placeholder="09XXXXXXXXX" />
              </div>

              <div className="profile-divider" />

              <div className="profile-card-header">
                <h2 className="profile-card-title">Delivery address</h2>
              </div>
              <div className="profile-fields">
                <EditableField label="Street / Barangay" name="address"  value={form.address}  editing={editing} onChange={handleChange} />
                <div className="profile-fields-row">
                  <EditableField label="City"     name="city"     value={form.city}     editing={editing} onChange={handleChange} />
                  <EditableField label="Province" name="province" value={form.province} editing={editing} onChange={handleChange} />
                </div>
                <EditableField label="ZIP / Postal" name="zip" value={form.zip} editing={editing} onChange={handleChange} maxLength={6} />
              </div>
            </div>

            {/* ── Measurements card ── */}
            <MeasurementsCard userId={user?.id} />

          </div>

          {/* ── Sidebar ── */}
          <div className="profile-sidebar">

            {/* ── Security card with profile completion inline ── */}
            <div className="profile-card profile-card--sm">
              <h2 className="profile-card-title">Security</h2>
              <p className="profile-card-sub" style={{ marginBottom: '1rem' }}>
                Keep your account safe with a strong password.
              </p>
              <button className="btn btn-outline profile-security-btn" onClick={() => setShowPwdModal(true)}>
                Change password
              </button>

              {/* ── Profile completion (compact, relocated here) ── */}
              <div className="profile-completion profile-completion--compact">
                <div className="profile-completion-label">
                  <span>Profile</span>
                  <span>{completionPct}%</span>
                </div>
                <div className="profile-completion-track">
                  <div className="profile-completion-fill" style={{ width: `${completionPct}%` }} />
                </div>
              </div>
            </div>

            <div className="profile-card profile-card--sm">
              <h2 className="profile-card-title">Quick links</h2>
              <div className="profile-links">
                {[
                  { href: '/my-orders',       label: 'My orders'         },
                  { href: '/favorites',        label: 'Saved gowns'       },
                  { href: '/fitting-room',     label: 'Size recommender'  },
                  { href: '/fitting-room',     label: 'Virtual try-on'    },
                  { href: '/gowns',            label: 'Browse collection' },
                  { href: '/cart',             label: 'View cart'         },
                ].map(({ href, label }) => (
                  <Link key={label} href={href} className="profile-link">
                    <span>{label}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </Link>
                ))}
              </div>
            </div>

            <div className="profile-card profile-card--sm">
              <h2 className="profile-card-title">Recent orders</h2>
              {ordersLoading ? (
                <p className="profile-empty-orders">Loading…</p>
              ) : orders.length === 0 ? (
                <p className="profile-empty-orders">
                  No orders yet.{' '}
                  <Link href="/gowns" className="profile-link-inline">Shop now →</Link>
                </p>
              ) : (
                <ul className="profile-orders-list">
                  {orders.map((o, i) => (
                    <li key={i} className="profile-order-item">
                      <span className="profile-order-date">
                        {new Date(o.placed_at).toLocaleDateString('en-PH', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </span>
                      <span className="profile-order-total">
                        ₱{Number(o.total ?? o.subtotal ?? 0).toLocaleString('en-PH')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/my-orders" className="profile-see-all">See all orders →</Link>
            </div>

            <div className="profile-card profile-card--sm">
              <h2 className="profile-card-title">Account</h2>
              <button className="btn btn-outline profile-logout-btn" onClick={handleLogout}>
                Sign out
              </button>
            </div>

          </div>
        </div>
      </section>

      {showPwdModal && (
        <ChangePasswordModal email={user.email} onClose={handlePwdModalClose} />
      )}

      <Footer />

     
    </main>
  )
}