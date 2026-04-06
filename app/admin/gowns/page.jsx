'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { getAdminSecret } from '../layout'

const emptyGown = {
  name: '', price: '₱', image: '/images/', alt: '',
  type: 'Gowns', color: '', silhouette: '', description: '',
}
const TYPES = ['Gowns', 'Dresses', 'Suit']

export default function AdminGownsPage() {
  const [gowns,     setGowns    ] = useState([])
  const [loading,   setLoading  ] = useState(true)
  const [error,     setError    ] = useState('')
  const [form,      setForm     ] = useState(emptyGown)
  const [editingId, setEditingId] = useState(null)
  const [saving,    setSaving   ] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleteId,  setDeleteId ] = useState(null)
  const [imgError,  setImgError ] = useState(false)
  const formRef = useRef(null)

  function headers() {
    return { 'Content-Type': 'application/json', 'X-Admin-Secret': getAdminSecret() || '' }
  }

  async function loadGowns() {
    setLoading(true); setError('')
    try {
      const res  = await fetch('/api/admin/gowns', { headers: headers() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setGowns(data.gowns || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadGowns() }, [])

  const handleChange = e => {
    const { name, value } = e.target
    setForm(p => ({ ...p, [name]: value }))
    setFormError('')
    if (name === 'image') setImgError(false)
  }

  const handlePriceChange = e => {
    const raw = e.target.value.replace(/[^\d]/g, '')
    setForm(p => ({ ...p, price: '₱' + (raw ? Number(raw).toLocaleString('en-PH') : '') }))
    setFormError('')
  }

  const handleEdit = gown => {
    const raw = String(gown.price || '').replace(/[^\d]/g, '')
    setForm({
      name: gown.name || '', price: '₱' + (raw ? Number(raw).toLocaleString('en-PH') : ''),
      image: gown.image || '/images/', alt: gown.alt || '', type: gown.type || 'Gowns',
      color: gown.color || '', silhouette: gown.silhouette || '', description: gown.description || '',
    })
    setEditingId(gown.id); setFormError(''); setImgError(false)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const handleCancelEdit = () => {
    setForm(emptyGown); setEditingId(null); setFormError(''); setImgError(false)
  }

  const handleSubmit = async e => {
    e.preventDefault(); setFormError('')
    if (!form.name.trim())                         { setFormError('Name is required.');  return }
    if (!form.price.trim() || form.price === '₱') { setFormError('Price is required.'); return }
    if (!form.image.trim())                        { setFormError('Image path is required.'); return }
    setSaving(true)
    try {
      const method = editingId != null ? 'PUT' : 'POST'
      const body   = editingId != null ? { ...form, id: editingId } : form
      const res    = await fetch('/api/admin/gowns', { method, headers: headers(), body: JSON.stringify(body) })
      const data   = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      if (editingId != null) {
        setGowns(p => p.map(g => Number(g.id) === Number(editingId) ? data.gown : g))
        handleCancelEdit()
      } else {
        setGowns(p => [...p, data.gown])
        setForm(emptyGown)
      }
    } catch (e) { setFormError(e.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async id => {
    if (deleteId !== id) { setDeleteId(id); return }
    try {
      const res  = await fetch(`/api/admin/gowns?id=${id}`, { method: 'DELETE', headers: headers() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      setGowns(p => p.filter(g => Number(g.id) !== Number(id)))
      if (editingId === id) handleCancelEdit()
    } catch (e) { setError(e.message) }
    finally { setDeleteId(null) }
  }

  const showPreview = form.image && form.image !== '/images/' && !imgError

  return (
    <div className="adm-gowns-page" ref={formRef}>
      <div className="adm-topbar">
        <h1 className="adm-page-title">Gowns</h1>
        <span className="adm-page-meta">{gowns.length} listed</span>
      </div>

      <div className="adm-gown-form-card">
        <h2 className="adm-gown-form-title">{editingId ? 'Edit gown' : 'Add new gown'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="adm-gown-form-grid">
            <div className="adm-form-row">
              <label className="adm-label">Name</label>
              <input name="name" value={form.name} onChange={handleChange}
                placeholder="e.g. The Isabella" className="adm-input" />
            </div>
            <div className="adm-form-row">
              <label className="adm-label">Price</label>
              <input name="price" type="text" inputMode="numeric"
                value={form.price} onChange={handlePriceChange}
                onKeyDown={e => { if (form.price === '₱' && (e.key === 'Backspace' || e.key === 'Delete')) e.preventDefault() }}
                placeholder="₱65,000" className="adm-input" />
            </div>
            <div className="adm-form-row">
              <label className="adm-label">Type</label>
              <select name="type" value={form.type} onChange={handleChange} className="adm-input">
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="adm-form-row">
              <label className="adm-label">Color</label>
              <input name="color" value={form.color} onChange={handleChange}
                placeholder="e.g. Ivory" className="adm-input" />
            </div>
            <div className="adm-form-row">
              <label className="adm-label">Silhouette</label>
              <input name="silhouette" value={form.silhouette} onChange={handleChange}
                placeholder="e.g. A-line" className="adm-input" />
            </div>
            <div className="adm-form-row">
              <label className="adm-label">Alt text</label>
              <input name="alt" value={form.alt} onChange={handleChange}
                placeholder="Short image description" className="adm-input" />
            </div>
          </div>

          <div className="adm-form-row" style={{ marginBottom: 14 }}>
            <label className="adm-label">Image path or URL</label>
            <div className="adm-image-row">
              <input name="image" value={form.image} onChange={handleChange}
                placeholder="/images/photo.png" className="adm-input" />
              {showPreview && (
                <img src={form.image} alt="" className="adm-image-preview"
                  onError={() => setImgError(true)} />
              )}
            </div>
            <span className="adm-field-hint">
              Put images in <code>public/images/</code> · use <code>/images/filename.png</code>
            </span>
          </div>

          <div className="adm-form-row" style={{ marginBottom: 18 }}>
            <label className="adm-label">Description</label>
            <textarea name="description" value={form.description} onChange={handleChange}
              rows={3} placeholder="Product description…" className="adm-input" />
          </div>

          {formError && <p className="adm-error-msg" style={{ marginBottom: 12 }}>{formError}</p>}

          <div className="adm-form-actions">
            <button type="submit" disabled={saving} className="adm-btn">
              {saving ? 'Saving…' : editingId ? 'Update gown' : 'Add gown'}
            </button>
            {editingId && (
              <button type="button" onClick={handleCancelEdit} className="adm-btn-outline">
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {error && <p className="adm-error-msg">{error}</p>}

      {loading ? (
        <p className="adm-muted">Loading gowns…</p>
      ) : gowns.length === 0 ? (
        <p className="adm-muted">No gowns yet. Add one above.</p>
      ) : (
        <div className="adm-gown-list">
          {gowns.map(g => (
            <div key={g.id} className={`adm-gown-row${editingId === g.id ? ' is-editing' : ''}`}>
              <div className="adm-gown-thumb">
                <img src={g.image} alt={g.alt || g.name}
                  onError={e => { e.target.style.display = 'none' }} />
              </div>
              <div className="adm-gown-info">
                <div className="adm-gown-name">{g.name}</div>
                <div className="adm-gown-meta">
                  {g.price}{g.type ? ` · ${g.type}` : ''}{g.silhouette ? ` · ${g.silhouette}` : ''}{g.color ? ` · ${g.color}` : ''}
                </div>
              </div>
              <div className="adm-gown-actions">
                <button onClick={() => handleEdit(g)} className="adm-btn-sm">Edit</button>
                <Link href={`/gowns/${g.id}`} target="_blank" rel="noopener noreferrer" className="adm-btn-sm">View</Link>
                <button onClick={() => handleDelete(g.id)} className={`adm-btn-danger${deleteId === g.id ? ' armed' : ''}`}>
                  {deleteId === g.id ? 'Confirm' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Link href="/admin" className="adm-back-link">← Dashboard</Link>
    </div>
  )
}