'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { getAdminSecret } from '../layout'
import { useRoleGuard } from '../../utils/useRoleGuard'



  // ... rest unchanged

// ── Constants ─────────────────────────────────────────────────────────────────

const SECTIONS = [
  { key: 'about',                label: 'About Section',        icon: '✦' },
  { key: 'collection-spotlight', label: 'Collection Spotlight', icon: '◈' },
  { key: 'contact',              label: 'Contact',              icon: '◎' },
  { key: 'footer',               label: 'Footer',               icon: '▣' },
  { key: 'theme-config',         label: 'Theme & Colours',      icon: '◉' },
]

const SECTION_FIELDS = {
  'about': [
    { key: 'eyebrow_label', label: 'Eyebrow Label',   type: 'text',     placeholder: 'ABOUT US' },
    { key: 'heading',       label: 'Heading',          type: 'text',     placeholder: 'Comfort and Quality Come First.' },
    { key: 'body_1',        label: 'Paragraph 1',      type: 'textarea', placeholder: 'First paragraph…' },
    { key: 'body_2',        label: 'Paragraph 2',      type: 'textarea', placeholder: 'Second paragraph…' },
    { key: 'image_url',     label: 'Image Path / URL', type: 'text',     placeholder: '/images/aboutus.png' },
  ],
  'collection-spotlight': [
    { key: 'eyebrow_label', label: 'Eyebrow Label', type: 'text', placeholder: 'THE COLLECTION' },
    { key: 'heading',       label: 'Heading',        type: 'text', placeholder: 'Handpicked Elegance' },
  ],
  'contact': [
    { key: 'heading',       label: 'Page Heading',    type: 'text',     placeholder: 'Get In Touch' },
    { key: 'subheading',    label: 'Subheading',      type: 'text',     placeholder: 'We would love to hear from you.' },
    { key: 'address',       label: 'Address',         type: 'textarea', placeholder: '123 Bridal Lane, Manila, Philippines' },
    { key: 'phone',         label: 'Phone',           type: 'text',     placeholder: '+63 912 345 6789' },
    { key: 'email',         label: 'Email',           type: 'text',     placeholder: 'hello@jcebridalboutique.com' },
    { key: 'hours',         label: 'Business Hours',  type: 'text',     placeholder: 'Mon–Sat: 10AM – 7PM' },
    { key: 'facebook',      label: 'Facebook URL',    type: 'text',     placeholder: 'https://facebook.com/…' },
    { key: 'instagram',     label: 'Instagram URL',   type: 'text',     placeholder: 'https://instagram.com/…' },
    { key: 'map_embed_url', label: 'Google Maps Embed URL', type: 'textarea', placeholder: 'https://www.google.com/maps/embed?pb=…' },
  ],
  'footer': [
    { key: 'brand_name',  label: 'Brand Name',     type: 'text', placeholder: 'JCE Bridal.' },
    { key: 'instagram',   label: 'Instagram URL',  type: 'text', placeholder: 'https://instagram.com/…' },
    { key: 'facebook',    label: 'Facebook URL',   type: 'text', placeholder: 'https://facebook.com/…' },
    { key: 'pinterest',   label: 'Pinterest URL',  type: 'text', placeholder: 'https://pinterest.com/…' },
    { key: 'copyright',   label: 'Copyright Text', type: 'text', placeholder: '© 2026 JCE Bridal Boutique. All rights reserved.' },
  ],
  'theme-config': [
    { key: 'colors.navBg',   label: 'Nav Background Colour', type: 'color', placeholder: '#1a1a2e' },
    { key: 'colors.primary', label: 'Primary / Gold Colour',  type: 'color', placeholder: '#c8a96e' },
    { key: 'fonts.body',     label: 'Body Font',              type: 'text',  placeholder: 'Jost, sans-serif' },
  ],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getNestedValue(obj, dotKey) {
  return dotKey.split('.').reduce((acc, k) => acc?.[k], obj) ?? ''
}

function setNestedValue(obj, dotKey, value) {
  const keys = dotKey.split('.')
  const clone = structuredClone(obj)
  let cur = clone
  for (let i = 0; i < keys.length - 1; i++) {
    if (!cur[keys[i]] || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {}
    cur = cur[keys[i]]
  }
  cur[keys[keys.length - 1]] = value
  return clone
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type = 'success', onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className={`adm-toast adm-toast--${type}`} role="status">
      {type === 'success'
        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      }
      {message}
    </div>
  )
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────

function ConfirmModal({ title, message, confirmLabel = 'Confirm', onConfirm, onClose }) {
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])
  return (
    <div className="adm-confirm-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="adm-confirm-box">
        <p className="adm-confirm-title">{title}</p>
        <p className="adm-confirm-msg">{message}</p>
        <div className="adm-confirm-actions">
          <button className="adm-btn-outline" onClick={onClose}>Cancel</button>
          <button className="adm-btn" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ── Slide Row ─────────────────────────────────────────────────────────────────

function SlideRow({ slide, onEdit, onDelete, onToggle }) {
  return (
    <div className={`cms-slide-row${!slide.is_active ? ' is-inactive' : ''}`}>
      <div className="cms-slide-thumb">
        <img
          src={slide.image_url}
          alt={slide.subtitle || ''}
          onError={e => { e.target.style.opacity = '0.2' }}
        />
      </div>
      <div className="cms-slide-info">
        <div className="cms-slide-subtitle">{slide.subtitle || <span className="adm-muted">No subtitle</span>}</div>
        <div className="cms-slide-heading">{slide.heading || <span className="adm-muted">No heading</span>}</div>
        <div className="cms-slide-body-preview">{slide.body?.slice(0, 80)}{slide.body?.length > 80 ? '…' : ''}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
          <span className="adm-tab-count">Order: {slide.sort_order}</span>
          {!slide.is_active && <span className="adm-archived-badge">Hidden</span>}
        </div>
      </div>
      <div className="adm-gown-actions">
        <button onClick={() => onEdit(slide)} className="adm-btn-sm">Edit</button>
        <button
          onClick={() => onToggle(slide)}
          className="adm-btn-sm"
          style={slide.is_active ? {} : { color: 'var(--adm-success)', borderColor: 'rgba(22,101,52,.35)' }}
        >
          {slide.is_active ? 'Hide' : 'Show'}
        </button>
        <button onClick={() => onDelete(slide)} className="adm-btn-danger">Delete</button>
      </div>
    </div>
  )
}

// ── Testimonial Row ───────────────────────────────────────────────────────────

function TestimonialRow({ t, onEdit, onDelete, onToggle }) {
  return (
    <div className={`cms-slide-row${!t.is_active ? ' is-inactive' : ''}`}>
      <div className="cms-slide-thumb" style={{ borderRadius: '50%', overflow: 'hidden' }}>
        {t.image_url
          ? <img src={t.image_url} alt={t.author_name} onError={e => { e.target.style.opacity = '0.2' }} />
          : <div style={{ width: '100%', height: '100%', background: 'var(--adm-accent-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: 'var(--adm-accent-text)', fontWeight: 700 }}>
              {t.author_name?.[0]?.toUpperCase() || '?'}
            </div>
        }
      </div>
      <div className="cms-slide-info">
        <div className="cms-slide-subtitle" style={{ fontStyle: 'italic', color: 'var(--adm-text-2)' }}>
          "{t.quote_text?.slice(0, 100)}{t.quote_text?.length > 100 ? '…' : ''}"
        </div>
        <div className="cms-slide-heading" style={{ fontSize: 13, marginTop: 4 }}>— {t.author_name}</div>
        {!t.is_active && <span className="adm-archived-badge" style={{ marginTop: 4, display: 'inline-block' }}>Hidden</span>}
      </div>
      <div className="adm-gown-actions">
        <button onClick={() => onEdit(t)} className="adm-btn-sm">Edit</button>
        <button
          onClick={() => onToggle(t)}
          className="adm-btn-sm"
          style={t.is_active ? {} : { color: 'var(--adm-success)', borderColor: 'rgba(22,101,52,.35)' }}
        >
          {t.is_active ? 'Hide' : 'Show'}
        </button>
        <button onClick={() => onDelete(t)} className="adm-btn-danger">Delete</button>
      </div>
    </div>
  )
}

// ── Slide / Testimonial Modal ─────────────────────────────────────────────────

function SlideModal({ slide, onSave, onClose, saving }) {
  const isNew = !slide?.id
  const [form, setForm] = useState({
    image_url:  slide?.image_url  || '',
    subtitle:   slide?.subtitle   || '',
    heading:    slide?.heading    || '',
    body:       slide?.body       || '',
    sort_order: slide?.sort_order ?? 0,
    is_active:  slide?.is_active  ?? true,
  })

  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  return (
    <div className="adm-confirm-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="adm-confirm-box" style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <p className="adm-confirm-title" style={{ margin: 0 }}>{isNew ? 'Add hero slide' : 'Edit hero slide'}</p>
          <button className="adm-modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { key: 'image_url',  label: 'Image Path / URL',  type: 'text',     placeholder: '/images/weds.jpg' },
            { key: 'subtitle',   label: 'Subtitle',           type: 'text',     placeholder: 'DESIGNER COLLECTION' },
            { key: 'heading',    label: 'Heading (use \\n for line break)', type: 'text', placeholder: 'Your New\nDream Look.' },
            { key: 'body',       label: 'Body text',          type: 'textarea', placeholder: 'Description…' },
            { key: 'sort_order', label: 'Sort order',         type: 'number',   placeholder: '0' },
          ].map(f => (
            <div key={f.key} className="adm-form-row">
              <label className="adm-label">{f.label}</label>
              {f.type === 'textarea'
                ? <textarea rows={3} className="adm-input" placeholder={f.placeholder} value={form[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
                : <input type={f.type} className="adm-input" placeholder={f.placeholder}
                    value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value }))} />
              }
            </div>
          ))}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--adm-text-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} />
            Visible to visitors
          </label>
          {form.image_url && (
            <div style={{ borderRadius: 8, overflow: 'hidden', height: 120, background: 'var(--adm-surface-alt)', border: '1px solid var(--adm-border)' }}>
              <img src={form.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
                onError={e => { e.target.style.opacity = '0.15' }} />
            </div>
          )}
        </div>
        <div className="adm-confirm-actions" style={{ marginTop: 22 }}>
          <button className="adm-btn-outline" onClick={onClose}>Cancel</button>
          <button className="adm-btn" disabled={saving} onClick={() => onSave(form)}>
            {saving ? 'Saving…' : isNew ? 'Add slide' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TestimonialModal({ item, onSave, onClose, saving }) {
  const isNew = !item?.id
  const [form, setForm] = useState({
    quote_text:  item?.quote_text  || '',
    author_name: item?.author_name || '',
    image_url:   item?.image_url   || '',
    sort_order:  item?.sort_order  ?? 0,
    is_active:   item?.is_active   ?? true,
  })

  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  return (
    <div className="adm-confirm-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="adm-confirm-box" style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <p className="adm-confirm-title" style={{ margin: 0 }}>{isNew ? 'Add testimonial' : 'Edit testimonial'}</p>
          <button className="adm-modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { key: 'quote_text',  label: 'Quote',              type: 'textarea', placeholder: 'Customer quote…' },
            { key: 'author_name', label: 'Author name',        type: 'text',     placeholder: 'Karina Ayacocho' },
            { key: 'image_url',   label: 'Photo URL / Path',   type: 'text',     placeholder: '/images/image2.png' },
            { key: 'sort_order',  label: 'Sort order',         type: 'number',   placeholder: '0' },
          ].map(f => (
            <div key={f.key} className="adm-form-row">
              <label className="adm-label">{f.label}</label>
              {f.type === 'textarea'
                ? <textarea rows={3} className="adm-input" placeholder={f.placeholder} value={form[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
                : <input type={f.type} className="adm-input" placeholder={f.placeholder}
                    value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value }))} />
              }
            </div>
          ))}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--adm-text-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} />
            Visible to visitors
          </label>
        </div>
        <div className="adm-confirm-actions" style={{ marginTop: 22 }}>
          <button className="adm-btn-outline" onClick={onClose}>Cancel</button>
          <button className="adm-btn" disabled={saving} onClick={() => onSave(form)}>
            {saving ? 'Saving…' : isNew ? 'Add testimonial' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminContentsPage() {
  const { ready } = useRoleGuard(['admin'], '/staff')
 
  // ── Tab state ──
  const [tab, setTab] = useState('hero')  // 'hero' | 'testimonials' | section key

  // ── Hero slides ──
  const [slides,      setSlides     ] = useState([])
  const [slidesLoad,  setSlidesLoad ] = useState(true)
  const [slideModal,  setSlideModal ] = useState(null)  // null | 'new' | slide object
  const [slideSaving, setSlideSaving] = useState(false)

  // ── Testimonials ──
  const [testims,      setTestims     ] = useState([])
  const [testimsLoad,  setTestimsLoad ] = useState(true)
  const [testimModal,  setTestimModal ] = useState(null)
  const [testimSaving, setTestimSaving] = useState(false)

  // ── Content blocks ──
  const [blocks,       setBlocks      ] = useState({})
  const [blockLoad,    setBlockLoad   ] = useState(false)
  const [blockSaving,  setBlockSaving ] = useState(false)
  const [editingBlock, setEditingBlock] = useState(null) // section key being edited

  // ── Shared ──
  const [toast,   setToast  ] = useState(null)
  const [confirm, setConfirm] = useState(null)

  function headers() {
    return { 'Content-Type': 'application/json', 'X-Admin-Secret': getAdminSecret() || '' }
  }

  function showToast(message, type = 'success') { setToast({ message, type }) }

  // ── Load hero slides ──────────────────────────────────────────────────────

  const loadSlides = useCallback(async () => {
    setSlidesLoad(true)
    try {
      const res  = await fetch('/api/admin/cms/hero', { headers: headers() })
      const data = await res.json()
      if (data.ok) setSlides(data.slides || [])
    } catch { showToast('Failed to load slides', 'error') }
    finally { setSlidesLoad(false) }
  }, [])

  // ── Load testimonials ─────────────────────────────────────────────────────

  const loadTestims = useCallback(async () => {
    setTestimsLoad(true)
    try {
      const res  = await fetch('/api/admin/cms/testimonials', { headers: headers() })
      const data = await res.json()
      if (data.ok) setTestims(data.testimonials || [])
    } catch { showToast('Failed to load testimonials', 'error') }
    finally { setTestimsLoad(false) }
  }, [])

  // ── Load content blocks ───────────────────────────────────────────────────

  const loadBlocks = useCallback(async () => {
    setBlockLoad(true)
    try {
      const res  = await fetch('/api/admin/cms/content', { headers: headers() })
      const data = await res.json()
      if (data.ok) setBlocks(data.blocks || {})
    } catch { showToast('Failed to load content blocks', 'error') }
    finally { setBlockLoad(false) }
  }, [])

  useEffect(() => {
    loadSlides()
    loadTestims()
    loadBlocks()
  }, [loadSlides, loadTestims, loadBlocks])

  // ── Hero slide actions ────────────────────────────────────────────────────

  const handleSaveSlide = async (form) => {
    setSlideSaving(true)
    const isNew = !slideModal?.id
    try {
      const res  = await fetch('/api/admin/cms/hero', {
        method:  isNew ? 'POST' : 'PUT',
        headers: headers(),
        body:    JSON.stringify(isNew ? form : { ...form, id: slideModal.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setSlideModal(null)
      showToast(isNew ? 'Slide added' : 'Slide updated')
      await loadSlides()
    } catch (e) { showToast(e.message, 'error') }
    finally { setSlideSaving(false) }
  }

  const handleToggleSlide = async (slide) => {
    try {
      const res  = await fetch('/api/admin/cms/hero', {
        method:  'PUT',
        headers: headers(),
        body:    JSON.stringify({ ...slide, is_active: !slide.is_active }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      showToast(slide.is_active ? 'Slide hidden' : 'Slide visible')
      setSlides(p => p.map(s => s.id === slide.id ? { ...s, is_active: !s.is_active } : s))
    } catch (e) { showToast(e.message, 'error') }
  }

  const handleDeleteSlide = (slide) => {
    setConfirm({
      title:        'Delete slide?',
      message:      `"${slide.subtitle || slide.heading}" will be permanently removed from the hero carousel.`,
      confirmLabel: 'Delete slide',
      onConfirm:    async () => {
        setConfirm(null)
        try {
          const res  = await fetch(`/api/admin/cms/hero?id=${slide.id}`, { method: 'DELETE', headers: headers() })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Failed to delete')
          setSlides(p => p.filter(s => s.id !== slide.id))
          showToast('Slide deleted')
        } catch (e) { showToast(e.message, 'error') }
      },
    })
  }

  // ── Testimonial actions ───────────────────────────────────────────────────

  const handleSaveTestim = async (form) => {
    setTestimSaving(true)
    const isNew = !testimModal?.id
    try {
      const res  = await fetch('/api/admin/cms/testimonials', {
        method:  isNew ? 'POST' : 'PUT',
        headers: headers(),
        body:    JSON.stringify(isNew ? form : { ...form, id: testimModal.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setTestimModal(null)
      showToast(isNew ? 'Testimonial added' : 'Testimonial updated')
      await loadTestims()
    } catch (e) { showToast(e.message, 'error') }
    finally { setTestimSaving(false) }
  }

  const handleToggleTestim = async (t) => {
    try {
      const res  = await fetch('/api/admin/cms/testimonials', {
        method:  'PUT',
        headers: headers(),
        body:    JSON.stringify({ ...t, is_active: !t.is_active }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      showToast(t.is_active ? 'Testimonial hidden' : 'Testimonial visible')
      setTestims(p => p.map(x => x.id === t.id ? { ...x, is_active: !x.is_active } : x))
    } catch (e) { showToast(e.message, 'error') }
  }

  const handleDeleteTestim = (t) => {
    setConfirm({
      title:        'Delete testimonial?',
      message:      `"${t.author_name}"'s testimonial will be permanently removed.`,
      confirmLabel: 'Delete',
      onConfirm:    async () => {
        setConfirm(null)
        try {
          const res  = await fetch(`/api/admin/cms/testimonials?id=${t.id}`, { method: 'DELETE', headers: headers() })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Failed to delete')
          setTestims(p => p.filter(x => x.id !== t.id))
          showToast('Testimonial deleted')
        } catch (e) { showToast(e.message, 'error') }
      },
    })
  }

  // ── Content block actions ─────────────────────────────────────────────────

  const handleFieldChange = (section, dotKey, value) => {
    setBlocks(p => ({
      ...p,
      [section]: setNestedValue(p[section] || {}, dotKey, value),
    }))
  }

  const handleSaveBlock = async (section) => {
    setBlockSaving(true)
    setEditingBlock(section)
    try {
      const res  = await fetch('/api/admin/cms/content', {
        method:  'PUT',
        headers: headers(),
        body:    JSON.stringify({ section, fields: blocks[section] || {} }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      showToast('Content saved')
    } catch (e) { showToast(e.message, 'error') }
    finally { setBlockSaving(false); setEditingBlock(null) }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const activeSlides  = slides.filter(s => s.is_active).length
  const activeTestims = testims.filter(t => t.is_active).length
 if (!ready) return null
  return (
    <>
      <style>{`
        /* CMS page styles — consistent with admin.css */
        .cms-page {
          max-width: 860px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* Section tabs — reuse adm-tabs pattern */
        .cms-section-tabs {
          display: flex;
          gap: 2px;
          border-bottom: 2px solid var(--adm-border);
          margin-bottom: 24px;
          flex-wrap: wrap;
        }

        .cms-section-tab {
          background: none;
          border: none;
          border-bottom: 3px solid transparent;
          padding: 11px 18px;
          font-size: 14px;
          font-weight: 500;
          color: var(--adm-text-3);
          cursor: pointer;
          margin-bottom: -2px;
          transition: color .15s, border-color .15s;
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 44px;
          white-space: nowrap;
        }

        .cms-section-tab.active {
          color: var(--adm-text);
          border-bottom-color: var(--adm-accent);
          font-weight: 700;
        }

        .cms-section-tab:hover:not(.active) { color: var(--adm-text-2); }

        .cms-section-tab-icon {
          font-size: 12px;
          color: var(--adm-accent);
          opacity: .8;
        }

        /* Slide / testimonial rows */
        .cms-slide-row {
          display: grid;
          grid-template-columns: 80px 1fr auto;
          gap: 18px;
          align-items: start;
          padding: 18px 20px;
          border: 1px solid var(--adm-border);
          border-radius: var(--adm-radius-lg);
          margin-bottom: 10px;
          background: var(--adm-surface);
          box-shadow: var(--adm-shadow-sm);
          transition: border-color .15s;
        }

        .cms-slide-row:hover { border-color: var(--adm-border-em); }

        .cms-slide-row.is-inactive {
          opacity: .6;
          background: var(--adm-surface-alt);
        }

        .cms-slide-thumb {
          width: 80px;
          height: 80px;
          border-radius: var(--adm-radius-md);
          overflow: hidden;
          background: var(--adm-surface-alt);
          border: 1px solid var(--adm-border);
          flex-shrink: 0;
        }

        .cms-slide-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: top;
        }

        .cms-slide-info { min-width: 0; display: flex; flex-direction: column; gap: 3px; }

        .cms-slide-subtitle {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: .1em;
          text-transform: uppercase;
          color: var(--adm-accent);
        }

        .cms-slide-heading {
          font-size: 15px;
          font-weight: 700;
          color: var(--adm-text);
          white-space: pre-line;
          line-height: 1.3;
        }

        .cms-slide-body-preview {
          font-size: 12px;
          color: var(--adm-text-3);
          line-height: 1.5;
          margin-top: 2px;
        }

        /* Content block form card */
        .cms-block-card {
          background: var(--adm-surface);
          border: 1px solid var(--adm-border);
          border-radius: var(--adm-radius-lg);
          padding: 24px 26px;
          box-shadow: var(--adm-shadow-sm);
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .cms-block-title {
          font-size: 17px;
          font-weight: 700;
          color: var(--adm-text);
          margin: 0 0 4px;
          letter-spacing: -.01em;
        }

        .cms-block-desc {
          font-size: 13px;
          color: var(--adm-text-3);
          line-height: 1.55;
          margin-bottom: 8px;
        }

        /* Stats bar reuse */
        .cms-stats-bar {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
        }

        .cms-stat-card {
          flex: 1;
          min-width: 120px;
          padding: 16px 20px;
          border: 1px solid var(--adm-border);
          border-radius: var(--adm-radius-lg);
          background: var(--adm-surface);
          box-shadow: var(--adm-shadow-sm);
        }

        .cms-stat-card .adm-stat-val { font-size: 24px; font-weight: 700; color: var(--adm-text); }
        .cms-stat-card .adm-stat-lbl { font-size: 12px; color: var(--adm-text-3); margin-top: 3px; font-weight: 500; }

        /* Colour input wrapper */
        .cms-color-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .cms-color-input {
          width: 44px;
          height: 44px;
          border-radius: var(--adm-radius-md);
          border: 1.5px solid var(--adm-border-em);
          cursor: pointer;
          padding: 2px;
          background: var(--adm-surface);
          flex-shrink: 0;
        }

        .cms-color-hex {
          flex: 1;
        }

        /* Add button row */
        .cms-add-row {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 4px;
        }

        /* Empty state */
        .cms-empty {
          text-align: center;
          padding: 40px 24px;
          color: var(--adm-text-3);
          font-size: 14px;
          border: 1.5px dashed var(--adm-border-em);
          border-radius: var(--adm-radius-lg);
          background: var(--adm-surface-alt);
        }

        @media (max-width: 600px) {
          .cms-slide-row {
            grid-template-columns: 60px 1fr;
          }
          .adm-gown-actions {
            grid-column: 1 / -1;
            flex-direction: row;
            flex-wrap: wrap;
          }
        }
      `}</style>

      {/* Modals */}
      {toast   && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
      {slideModal !== null && (
        <SlideModal
          slide={slideModal === 'new' ? null : slideModal}
          onSave={handleSaveSlide}
          onClose={() => setSlideModal(null)}
          saving={slideSaving}
        />
      )}
      {testimModal !== null && (
        <TestimonialModal
          item={testimModal === 'new' ? null : testimModal}
          onSave={handleSaveTestim}
          onClose={() => setTestimModal(null)}
          saving={testimSaving}
        />
      )}

      <div className="cms-page">

        {/* Header */}
        <div className="adm-topbar">
          <div>
            <h1 className="adm-page-title">Content Manager</h1>
            <p className="adm-page-meta">
              Manage homepage slides, testimonials, and static copy — no code needed.
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="cms-stats-bar">
          <div className="cms-stat-card">
            <div className="adm-stat-val">{slides.length}</div>
            <div className="adm-stat-lbl">Hero slides</div>
          </div>
          <div className="cms-stat-card">
            <div className="adm-stat-val adm-stat-val-green">{activeSlides}</div>
            <div className="adm-stat-lbl">Visible slides</div>
          </div>
          <div className="cms-stat-card">
            <div className="adm-stat-val">{testims.length}</div>
            <div className="adm-stat-lbl">Testimonials</div>
          </div>
          <div className="cms-stat-card">
            <div className="adm-stat-val adm-stat-val-green">{activeTestims}</div>
            <div className="adm-stat-lbl">Visible testimonials</div>
          </div>
        </div>

        {/* Section tabs */}
        <div className="cms-section-tabs">
          {[
            { key: 'hero',         label: 'Hero Slides',    icon: '◈' },
            { key: 'testimonials', label: 'Testimonials',   icon: '✦' },
            ...SECTIONS,
          ].map(s => (
            <button
              key={s.key}
              className={`cms-section-tab${tab === s.key ? ' active' : ''}`}
              onClick={() => setTab(s.key)}
            >
              <span className="cms-section-tab-icon">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>

        {/* ── Hero Slides ── */}
        {tab === 'hero' && (
          <div>
            <div className="cms-add-row">
              <button className="adm-btn" onClick={() => setSlideModal('new')}>
                + Add slide
              </button>
            </div>
            {slidesLoad ? (
              <p className="adm-muted">Loading slides…</p>
            ) : slides.length === 0 ? (
              <div className="cms-empty">
                No hero slides yet. Add one to replace the hardcoded defaults.
              </div>
            ) : (
              slides
                .slice()
                .sort((a, b) => a.sort_order - b.sort_order)
                .map(s => (
                  <SlideRow
                    key={s.id}
                    slide={s}
                    onEdit={setSlideModal}
                    onDelete={handleDeleteSlide}
                    onToggle={handleToggleSlide}
                  />
                ))
            )}
          </div>
        )}

        {/* ── Testimonials ── */}
        {tab === 'testimonials' && (
          <div>
            <div className="cms-add-row">
              <button className="adm-btn" onClick={() => setTestimModal('new')}>
                + Add testimonial
              </button>
            </div>
            {testimsLoad ? (
              <p className="adm-muted">Loading testimonials…</p>
            ) : testims.length === 0 ? (
              <div className="cms-empty">
                No testimonials yet. Add customer quotes that will appear on the homepage.
              </div>
            ) : (
              testims
                .slice()
                .sort((a, b) => a.sort_order - b.sort_order)
                .map(t => (
                  <TestimonialRow
                    key={t.id}
                    t={t}
                    onEdit={setTestimModal}
                    onDelete={handleDeleteTestim}
                    onToggle={handleToggleTestim}
                  />
                ))
            )}
          </div>
        )}

        {/* ── Content Blocks ── */}
        {SECTIONS.map(section => tab === section.key && (
          <div key={section.key}>
            {blockLoad ? (
              <p className="adm-muted">Loading…</p>
            ) : (
              <div className="cms-block-card">
                <div>
                  <p className="cms-block-title">{section.label}</p>
                  <p className="cms-block-desc">
                    {section.key === 'about'                && 'Controls the About section copy and image on the homepage.'}
                    {section.key === 'collection-spotlight' && 'Controls the heading above the featured gowns grid.'}
                    {section.key === 'contact'              && 'Controls the Contact page heading, address, phone, email, hours, social links, and Google Maps embed.'}
                    {section.key === 'footer'               && 'Controls the footer brand name, social links, and copyright line.'}
                    {section.key === 'theme-config'         && 'Controls global brand colours injected into the site header.'}
                  </p>
                </div>

                {(SECTION_FIELDS[section.key] || []).map(field => (
                  <div key={field.key} className="adm-form-row">
                    <label className="adm-label">{field.label}</label>

                    {field.type === 'textarea' && (
                      <textarea
                        rows={3}
                        className="adm-input"
                        placeholder={field.placeholder}
                        value={getNestedValue(blocks[section.key] || {}, field.key)}
                        onChange={e => handleFieldChange(section.key, field.key, e.target.value)}
                      />
                    )}

                    {field.type === 'color' && (
                      <div className="cms-color-row">
                        <input
                          type="color"
                          className="cms-color-input"
                          value={getNestedValue(blocks[section.key] || {}, field.key) || '#000000'}
                          onChange={e => handleFieldChange(section.key, field.key, e.target.value)}
                        />
                        <input
                          type="text"
                          className="adm-input cms-color-hex"
                          placeholder={field.placeholder}
                          value={getNestedValue(blocks[section.key] || {}, field.key)}
                          onChange={e => handleFieldChange(section.key, field.key, e.target.value)}
                        />
                      </div>
                    )}

                    {(field.type === 'text') && (
                      <input
                        type="text"
                        className="adm-input"
                        placeholder={field.placeholder}
                        value={getNestedValue(blocks[section.key] || {}, field.key)}
                        onChange={e => handleFieldChange(section.key, field.key, e.target.value)}
                      />
                    )}

                    {/* Image preview for image_url fields */}
                    {field.key === 'image_url' && getNestedValue(blocks[section.key] || {}, field.key) && (
                      <div style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', height: 100, width: 140, border: '1px solid var(--adm-border)' }}>
                        <img
                          src={getNestedValue(blocks[section.key] || {}, field.key)}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
                          onError={e => { e.target.style.opacity = '0.15' }}
                        />
                      </div>
                    )}
                  </div>
                ))}

                <div className="adm-form-actions">
                  <button
                    className="adm-btn"
                    disabled={blockSaving && editingBlock === section.key}
                    onClick={() => handleSaveBlock(section.key)}
                  >
                    {blockSaving && editingBlock === section.key ? 'Saving…' : `Save ${section.label}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        <Link href="/admin" className="adm-back-link">← Dashboard</Link>
      </div>
    </>
  )
}