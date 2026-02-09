'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const ADMIN_SECRET_KEY = 'jce_admin_secret'

const emptyGown = {
  name: '',
  price: '₱',
  image: '/images/',
  alt: '',
  type: 'Gowns',
  color: '',
  silhouette: '',
  description: '',
}

export default function AdminGownsPage() {
  const [gowns, setGowns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyGown)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  function getSecret() {
    if (typeof window === 'undefined') return ''
    return sessionStorage.getItem(ADMIN_SECRET_KEY) || ''
  }

  function headers() {
    return { 'Content-Type': 'application/json', 'X-Admin-Secret': getSecret() }
  }

  async function loadGowns() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/gowns', { headers: headers() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load gowns')
      setGowns(data.gowns || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadGowns()
  }, [])

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    setFormError('')
  }

  const handlePriceChange = (e) => {
    const raw = e.target.value.replace(/[^\d]/g, '')
    const formatted = raw ? Number(raw).toLocaleString('en-PH') : ''
    setForm((prev) => ({ ...prev, price: '₱' + formatted }))
    setFormError('')
  }

  const handleEdit = (gown) => {
    const raw = String(gown.price || '').replace(/[^\d]/g, '')
    const formatted = raw ? Number(raw).toLocaleString('en-PH') : ''
    setForm({
      name: gown.name || '',
      price: '₱' + formatted,
      image: gown.image || '/images/',
      alt: gown.alt || '',
      type: gown.type || 'Gowns',
      color: gown.color || '',
      silhouette: gown.silhouette || '',
      description: gown.description || '',
    })
    setEditingId(gown.id)
    setFormError('')
  }

  const handleCancelEdit = () => {
    setForm(emptyGown)
    setEditingId(null)
    setFormError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError('')
    if (!form.name?.trim() || !form.price?.trim() || !form.image?.trim()) {
      setFormError('Name, price, and image are required.')
      return
    }
    setSaving(true)
    try {
      if (editingId != null) {
        const res = await fetch('/api/admin/gowns', {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({ ...form, id: editingId }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to update')
        setGowns((prev) => prev.map((g) => (Number(g.id) === Number(editingId) ? data.gown : g)))
        handleCancelEdit()
      } else {
        const res = await fetch('/api/admin/gowns', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(form),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to add')
        setGowns((prev) => [...prev, data.gown])
        setForm(emptyGown)
      }
    } catch (e) {
      setFormError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this gown?')) return
    try {
      const res = await fetch(`/api/admin/gowns?id=${id}`, {
        method: 'DELETE',
        headers: headers(),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      setGowns((prev) => prev.filter((g) => Number(g.id) !== Number(id)))
      if (editingId === id) handleCancelEdit()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="admin-gowns">
      <h1>Gowns</h1>
      <p className="admin-placeholder">Add, edit, or remove gowns. Image can be a path (e.g. /images/photo.png) or a full URL. Put new images in <code>public/images/</code> and use <code>/images/filename.png</code>.</p>

      <div className="admin-gown-form">
        <h2>{editingId ? 'Edit gown' : 'Add gown'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="admin-form-row">
            <label>Name</label>
            <input name="name" value={form.name} onChange={handleChange} placeholder="e.g. The Isabella" required />
          </div>
          <div className="admin-form-row">
            <label>Price</label>
            <input
              name="price"
              type="text"
              inputMode="numeric"
              value={form.price}
              onChange={handlePriceChange}
              onKeyDown={(e) => {
                if (form.price === '₱' && (e.key === 'Backspace' || e.key === 'Delete')) e.preventDefault()
              }}
              placeholder="₱65,000"
              required
            />
          </div>
          <div className="admin-form-row">
            <label>Image (URL or path)</label>
            <input name="image" value={form.image} onChange={handleChange} placeholder="/images/image1.png" required />
            {form.image && (
              <div className="admin-image-preview">
                <img src={form.image} alt="" onError={(e) => (e.target.style.display = 'none')} />
              </div>
            )}
          </div>
          <div className="admin-form-row">
            <label>Alt text (for accessibility)</label>
            <input name="alt" value={form.alt} onChange={handleChange} placeholder="Short description of image" />
          </div>
          <div className="admin-form-row">
            <label>Type</label>
            <select name="type" value={form.type} onChange={handleChange}>
              <option value="Gowns">Gowns</option>
              <option value="Dresses">Dresses</option>
              <option value="Suit">Suit</option>
            </select>
          </div>
          <div className="admin-form-row">
            <label>Color</label>
            <input name="color" value={form.color} onChange={handleChange} placeholder="e.g. Ivory" />
          </div>
          <div className="admin-form-row">
            <label>Silhouette</label>
            <input name="silhouette" value={form.silhouette} onChange={handleChange} placeholder="e.g. A-line" />
          </div>
          <div className="admin-form-row">
            <label>Description</label>
            <textarea name="description" value={form.description} onChange={handleChange} rows={3} placeholder="Product description" />
          </div>
          {formError && <p className="auth-error">{formError}</p>}
          <div className="admin-form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Update gown' : 'Add gown'}
            </button>
            {editingId && (
              <button type="button" className="btn btn-outline" onClick={handleCancelEdit}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {error && <p className="auth-error">{error}</p>}
      {loading ? (
        <p>Loading gowns…</p>
      ) : (
        <div className="admin-list admin-gowns-list">
          {gowns.map((g) => (
            <div key={g.id} className="admin-list-item admin-gown-row">
              <div className="admin-gown-thumb">
                <img src={g.image} alt="" />
              </div>
              <div className="admin-gown-info">
                <strong>{g.name}</strong>
                <span>{g.price}</span>
                <span>{g.type}</span>
              </div>
              <div className="admin-gown-actions">
                <button type="button" className="btn btn-outline" onClick={() => handleEdit(g)}>
                  Edit
                </button>
                <button type="button" className="btn btn-outline" style={{ color: '#b00020' }} onClick={() => handleDelete(g.id)}>
                  Delete
                </button>
                <Link href={`/gowns/${g.id}`} className="btn btn-outline" target="_blank" rel="noopener noreferrer">
                  View
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <Link href="/admin" className="btn btn-outline" style={{ marginTop: 16 }}>← Dashboard</Link>
    </div>
  )
}
