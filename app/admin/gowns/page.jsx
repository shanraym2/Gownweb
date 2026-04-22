'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { getAdminSecret } from '../layout'
import { useRoleGuard } from '../../utils/useRoleGuard'
 
const emptyGown = {
  name: '', price: '₱', image: '/images/', alt: '',
  type: 'Gowns', color: '', silhouette: '',
  fabric: '', neckline: '', description: '',
}
const TYPES = ['Gowns', 'Dresses', 'Suit']

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

// ── Confirm modal ─────────────────────────────────────────────────────────────

function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onClose }) {
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
          <button className={danger ? 'adm-btn-danger armed' : 'adm-btn'} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ── Inventory editor ──────────────────────────────────────────────────────────

function InventoryEditor({ inventory, onChange }) {
  const [newSize,  setNewSize ] = useState('')
  const [newStock, setNewStock] = useState('')

  const handleAdd = () => {
    const size  = newSize.trim().toUpperCase()
    const stock = Math.max(0, parseInt(newStock) || 0)
    if (!size || inventory.some(i => i.size === size)) return
    onChange([...inventory, { size, stock }])
    setNewSize(''); setNewStock('')
  }

  return (
    <div className="inv-editor">
      <p className="adm-label" style={{ marginBottom: 10 }}>Inventory (sizes &amp; stock)</p>
      {inventory.length > 0 && (
        <div className="inv-table">
          <div className="inv-row inv-header">
            <span>Size</span><span>Stock qty</span><span>Reserved</span><span />
          </div>
          {inventory.map(inv => (
            <div key={inv.size} className="inv-row">
              <span className="inv-size">{inv.size}</span>
              <input type="number" min="0" value={inv.stock} className="inv-stock-input"
                onChange={e => onChange(inventory.map(i =>
                  i.size === inv.size ? { ...i, stock: Math.max(0, parseInt(e.target.value) || 0) } : i
                ))} />
              <span className="inv-reserved">{inv.reserved ?? 0} reserved</span>
              <button type="button" className="inv-remove"
                onClick={() => onChange(inventory.filter(i => i.size !== inv.size))}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="inv-add-row">
        <input type="text" placeholder="Size (e.g. S, M, XL, 42)"
          value={newSize} onChange={e => setNewSize(e.target.value)}
          className="inv-size-input"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }} />
        <input type="number" min="0" placeholder="Qty"
          value={newStock} onChange={e => setNewStock(e.target.value)}
          className="inv-qty-input"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }} />
        <button type="button" className="adm-btn-sm" onClick={handleAdd}>Add size</button>
      </div>
      <p className="adm-field-hint">Press Enter or click Add size to add a row.</p>
    </div>
  )
}

// ── Gown row ──────────────────────────────────────────────────────────────────
function GownRow({ g, editingId, onEdit, onArchive, onPermanentDelete, archived = false, isAdmin = false }) {
  const inv      = g.inventory || []
  const totalQty = inv.reduce((s, i) => s + (i.stock || 0), 0)

  return (
    <div className={`adm-gown-row${String(editingId) === String(g.id) ? ' is-editing' : ''}${archived ? ' is-archived' : ''}`}>
      <div className="adm-gown-thumb">
        <img src={g.image} alt={g.alt || g.name} onError={e => { e.target.style.display = 'none' }} />
      </div>
      <div className="adm-gown-info">
        <div className="adm-gown-name">
          {g.name}
          {archived && <span className="adm-archived-badge">Archived</span>}
        </div>
        <div className="adm-gown-meta">
          {g.price}
          {g.silhouette ? ` · ${g.silhouette}` : ''}
          {g.color      ? ` · ${g.color}`      : ''}
        </div>
        <div className="inv-summary">
          {inv.length > 0 ? (
            <>
              <span className="inv-chip">{totalQty} units · {inv.length} size{inv.length !== 1 ? 's' : ''}</span>
              {inv.map(i => {
                const avail = i.stock - (i.reserved || 0)
                const cls   = avail <= 0 ? 'out' : avail <= 2 ? 'low' : ''
                return (
                  <span key={i.size} className={`inv-chip ${cls}`}>
                    {i.size}: {avail <= 0 ? 'sold out' : `${avail} left`}
                  </span>
                )
              })}
            </>
          ) : (
            <span className="inv-chip">No inventory set</span>
          )}
        </div>
      </div>
      <div className="adm-gown-actions">
        {!archived && <button onClick={() => onEdit(g)} className="adm-btn-sm">Edit</button>}
        <Link href={`/gowns/${g.id}`} target="_blank" rel="noopener noreferrer" className="adm-btn-sm">View</Link>
        {archived ? (
          <>
            <button onClick={() => onArchive(g.id, false)} className="adm-btn-sm adm-btn-restore">Restore</button>
            <button onClick={() => onPermanentDelete(g)} className="adm-btn-danger">Delete permanently</button>
          </>
        ) : (
          <button onClick={() => onArchive(g.id, true)} className="adm-btn-danger">Archive</button>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminGownsPage() {
  const { user: authUser, ready } = useRoleGuard(['admin', 'staff'], '/')
  
  const isAdmin = authUser?.role === 'admin'

  const [gowns,      setGowns     ] = useState([])
  const [archived,   setArchived  ] = useState([])
  const [arcCount,   setArcCount  ] = useState(0)   // separate count loaded eagerly
  const [loading,    setLoading   ] = useState(true)
  const [arcLoading, setArcLoading] = useState(false)
  const [error,      setError     ] = useState('')
  const [form,       setForm      ] = useState(emptyGown)
  const [inventory,  setInventory ] = useState([])
  const [editingId,  setEditingId ] = useState(null)
  const [saving,     setSaving    ] = useState(false)
  const [formError,  setFormError ] = useState('')
  const [imgError,   setImgError  ] = useState(false)
  const [tab,        setTab       ] = useState('active')
  const [toast,      setToast     ] = useState(null)   // { message, type }
  const [confirm,    setConfirm   ] = useState(null)   // { title, message, confirmLabel, danger, onConfirm }
  const formRef = useRef(null)

  function headers() {
    return { 'Content-Type': 'application/json', 'X-Admin-Secret': getAdminSecret() || '' }
  }

  function showToast(message, type = 'success') {
    setToast({ message, type })
  }

  function askConfirm(opts) {
    setConfirm(opts)
  }

  // Load active gowns + archived count on mount
  const loadActive = useCallback(async () => {
    setLoading(true)
    setArcLoading(true)   // ← ADD THIS
    setError('')
    try {
      const [activeRes, arcRes] = await Promise.all([
        fetch('/api/admin/gowns',              { headers: headers() }),
        fetch('/api/admin/gowns?tab=archived', { headers: headers() }),
      ])
      const activeData = await activeRes.json()
      const arcData    = await arcRes.json()
      if (!activeRes.ok) throw new Error(activeData.error || 'Failed to load')
      setGowns(activeData.gowns || [])
      if (arcData.ok) {
        setArchived(arcData.gowns || [])
        setArcCount((arcData.gowns || []).length)
      }
    } catch (e) { setError(e.message) }
    finally {
      setLoading(false)
      setArcLoading(false)   // ← ADD THIS
    }
  }, [])


  useEffect(() => { loadActive() }, [loadActive])

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
      name:        gown.name        || '',
      price:       '₱' + (raw ? Number(raw).toLocaleString('en-PH') : ''),
      image:       gown.image       || '/images/',
      alt:         gown.alt         || '',
      type:        gown.type        || 'Gowns',
      color:       gown.color       || '',
      silhouette:  gown.silhouette  || '',
      fabric:      gown.fabric      || '',
      neckline:    gown.neckline    || '',
      description: gown.description || '',
    })
    setInventory(gown.inventory || [])
    setEditingId(gown.id); setFormError(''); setImgError(false); setTab('active')
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const handleCancelEdit = () => {
    setForm(emptyGown); setInventory([]); setEditingId(null); setFormError(''); setImgError(false)
  }

  const handleSubmit = async e => {
    e.preventDefault(); setFormError('')
    if (!form.name.trim())                         { setFormError('Name is required.');       return }
    if (!form.price.trim() || form.price === '₱') { setFormError('Price is required.');      return }
    if (!form.image.trim())                        { setFormError('Image path is required.'); return }

    const isEdit = editingId != null
    const label  = isEdit ? `Save changes to "${form.name}"?` : `Add "${form.name}" to the collection?`

    askConfirm({
      title:        isEdit ? 'Save changes?' : 'Add new gown?',
      message:      label,
      confirmLabel: isEdit ? 'Save changes' : 'Add gown',
      danger:       false,
      onConfirm:    () => doSubmit(isEdit),
    })
  }

  const doSubmit = async isEdit => {
    setConfirm(null)
    setSaving(true)
    try {
      const method  = isEdit ? 'PUT' : 'POST'
      const payload = isEdit ? { ...form, id: editingId, inventory } : { ...form, inventory }
      const res     = await fetch('/api/admin/gowns', { method, headers: headers(), body: JSON.stringify(payload) })
      const data    = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')

      if (isEdit) {
        setGowns(p => p.map(g => String(g.id) === String(editingId) ? data.gown : g))
        showToast(`"${data.gown.name}" updated successfully`)
        handleCancelEdit()
      } else {
        setGowns(p => [...p, data.gown])
        setForm(emptyGown); setInventory([])
        showToast(`"${data.gown.name}" added to collection`)
      }
    } catch (e) {
      setFormError(e.message)
      showToast(e.message, 'error')
    } finally { setSaving(false) }
  }

  const handleArchive = (id, archive) => {
    const gown = archive
      ? gowns.find(g => String(g.id) === String(id))
      : archived.find(g => String(g.id) === String(id))

    const name = gown?.name || 'this gown'

    if (archive) {
      askConfirm({
        title:        'Archive gown?',
        message:      `"${name}" will be hidden from customers but preserved in order history.`,
        confirmLabel: 'Archive',
        danger:       true,
        onConfirm:    () => doArchive(id, true, name),
      })
    } else {
      askConfirm({
        title:        'Restore gown?',
        message:      `"${name}" will be visible to customers again.`,
        confirmLabel: 'Restore',
        danger:       false,
        onConfirm:    () => doArchive(id, false, name),
      })
    }
  }

  const doArchive = async (id, archive, name) => {
    setConfirm(null)
    try {
      let res, data
      if (archive) {
        res  = await fetch(`/api/admin/gowns?id=${id}`, { method: 'DELETE', headers: headers() })
        data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to archive')
        const gown = gowns.find(g => String(g.id) === String(id))
        setGowns(p => p.filter(g => String(g.id) !== String(id)))
        if (gown) { setArchived(p => [{ ...gown, isActive: false }, ...p]); setArcCount(c => c + 1) }
        if (editingId === id) handleCancelEdit()
        showToast(`"${name}" archived`)
      } else {
        res  = await fetch('/api/admin/gowns', {
          method: 'PUT', headers: headers(),
          body: JSON.stringify({ id, restore: true }),
        })
        data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to restore')
        const gown = archived.find(g => String(g.id) === String(id))
        setArchived(p => p.filter(g => String(g.id) !== String(id)))
        setArcCount(c => Math.max(0, c - 1))
        if (gown) setGowns(p => [{ ...gown, isActive: true }, ...p])
        showToast(`"${name}" restored`)
      }
    } catch (e) { setError(e.message); showToast(e.message, 'error') }
  }

  const handlePermanentDelete = gown => {
    askConfirm({
      title:        'Delete permanently?',
      message:      `This will permanently delete "${gown.name}" and all its images and inventory. This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      danger:       true,
      onConfirm:    () => doPermanentDelete(gown.id, gown.name),
    })
  }

  const doPermanentDelete = async (id, name) => {
    setConfirm(null)
    try {
      const res  = await fetch(`/api/admin/gowns?id=${id}&permanent`, { method: 'DELETE', headers: headers() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      setArchived(p => p.filter(g => String(g.id) !== String(id)))
      setArcCount(c => Math.max(0, c - 1))
      showToast(`"${name}" permanently deleted`)
    } catch (e) { setError(e.message); showToast(e.message, 'error') }
  }

  const showPreview = form.image && form.image !== '/images/' && !imgError
  const allInv      = gowns.flatMap(g => g.inventory || [])
  const totalUnits  = allInv.reduce((s, i) => s + Math.max(0, i.stock - (i.reserved || 0)), 0)
  const lowCount    = allInv.filter(i => { const a = i.stock-(i.reserved||0); return a > 0 && a <= 2 }).length
  const outCount    = allInv.filter(i => (i.stock-(i.reserved||0)) <= 0).length
  if (!ready) return null

  return (
    <>
      <style>{`
        /* Toast */
        .adm-toast{position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;align-items:center;gap:8px;padding:11px 18px;border-radius:var(--border-radius-lg);font-size:13px;font-weight:500;box-shadow:0 4px 24px rgba(0,0,0,.12);animation:toastIn .25s ease;}
        @keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .adm-toast--success{background:#1a3a1a;color:#9ee09e;border:1px solid #2d5a2d;}
        .adm-toast--error{background:#3a1a1a;color:#e09e9e;border:1px solid #5a2d2d;}

        /* Confirm modal */
        .adm-confirm-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:24px;}
        .adm-confirm-box{background:var(--color-background-primary);border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-lg);padding:24px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.15);}
        .adm-confirm-title{font-size:15px;font-weight:500;margin-bottom:8px;color:var(--color-text-primary);}
        .adm-confirm-msg{font-size:13px;color:var(--color-text-secondary);line-height:1.6;margin-bottom:20px;}
        .adm-confirm-actions{display:flex;gap:10px;justify-content:flex-end;}

        /* Inventory */
        .inv-editor{margin-top:8px;}
        .inv-table{border:1px solid var(--color-border-tertiary);border-radius:8px;overflow:hidden;margin-bottom:10px;}
        .inv-row{display:grid;grid-template-columns:80px 1fr 130px 36px;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--color-border-tertiary);}
        .inv-row:last-child{border-bottom:none;}
        .inv-header{background:var(--color-background-secondary);font-size:11px;font-weight:500;color:var(--color-text-secondary);}
        .inv-size{font-weight:500;font-size:13px;}
        .inv-stock-input{width:72px;padding:5px 8px;border:1px solid var(--color-border-secondary);border-radius:6px;font-size:13px;background:var(--color-background-primary);color:var(--color-text-primary);}
        .inv-reserved{font-size:11px;color:var(--color-text-tertiary);}
        .inv-remove{background:none;border:none;font-size:18px;color:var(--color-text-tertiary);cursor:pointer;line-height:1;padding:0 4px;}
        .inv-remove:hover{color:var(--color-text-danger);}
        .inv-add-row{display:flex;gap:8px;align-items:center;margin-bottom:4px;}
        .inv-size-input{flex:1;padding:7px 10px;border:1px solid var(--color-border-secondary);border-radius:6px;font-size:13px;background:var(--color-background-primary);color:var(--color-text-primary);}
        .inv-qty-input{width:72px;padding:7px 10px;border:1px solid var(--color-border-secondary);border-radius:6px;font-size:13px;background:var(--color-background-primary);color:var(--color-text-primary);}
        .inv-summary{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;}
        .inv-chip{font-size:11px;background:var(--color-background-secondary);border:1px solid var(--color-border-tertiary);border-radius:20px;padding:2px 8px;color:var(--color-text-secondary);}
        .inv-chip.low{color:var(--color-text-warning);border-color:var(--color-border-warning);}
        .inv-chip.out{color:var(--color-text-danger);border-color:var(--color-border-danger);}

        /* Tabs */
        .adm-tabs{display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid var(--color-border-tertiary);}
        .adm-tab{background:none;border:none;border-bottom:2px solid transparent;padding:10px 18px;font-size:13px;font-weight:500;color:var(--color-text-secondary);cursor:pointer;margin-bottom:-1px;transition:color .15s,border-color .15s;display:flex;align-items:center;gap:8px;}
        .adm-tab.active{color:var(--color-text-primary);border-bottom-color:var(--color-text-primary);}
        .adm-tab:hover:not(.active){color:var(--color-text-primary);}
        .adm-tab-count{font-size:11px;background:var(--color-background-secondary);border:1px solid var(--color-border-tertiary);border-radius:10px;padding:1px 7px;}

        .adm-archived-badge{font-size:10px;background:var(--color-background-warning);color:var(--color-text-warning);border-radius:4px;padding:1px 6px;margin-left:8px;font-weight:400;}
        .adm-btn-restore{background:var(--color-background-success)!important;color:var(--color-text-success)!important;border:1px solid var(--color-border-success)!important;}

        .adm-gown-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;margin-bottom:16px;}
        .adm-gown-row{display:grid;grid-template-columns:72px 1fr auto;gap:16px;align-items:start;padding:16px;border:1px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);margin-bottom:10px;background:var(--color-background-primary);}
        .adm-gown-row.is-editing{border-color:var(--color-border-primary);background:var(--color-background-info);}
        .adm-gown-row.is-archived{opacity:.75;}
        .adm-gown-thumb{width:72px;height:88px;border-radius:var(--border-radius-md);overflow:hidden;background:var(--color-background-secondary);flex-shrink:0;}
        .adm-gown-thumb img{width:100%;height:100%;object-fit:cover;object-position:top;}
        .adm-gown-info{min-width:0;}
        .adm-gown-name{font-weight:500;font-size:14px;margin-bottom:3px;display:flex;align-items:center;flex-wrap:wrap;gap:4px;}
        .adm-gown-meta{font-size:12px;color:var(--color-text-secondary);margin-bottom:4px;}
        .adm-gown-actions{display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0;}
        .adm-gown-actions .adm-btn-sm,.adm-gown-actions .adm-btn-danger{width:100%;text-align:center;}

        .adm-stats-bar{display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap;}
        .adm-stat-card{flex:1;min-width:120px;padding:14px 18px;border:1px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);background:var(--color-background-primary);}
        .adm-stat-val{font-size:22px;font-weight:500;color:var(--color-text-primary);}
        .adm-stat-lbl{font-size:11px;color:var(--color-text-secondary);margin-top:2px;}
        .adm-stat-card.warning{border-color:var(--color-border-warning);background:var(--color-background-warning);}
        .adm-stat-card.danger{border-color:var(--color-border-danger);background:var(--color-background-danger);}
        .adm-archive-note{font-size:12px;color:var(--color-text-secondary);margin-bottom:16px;padding:10px 14px;background:var(--color-background-secondary);border-radius:var(--border-radius-md);border:1px solid var(--color-border-tertiary);}

        @media(max-width:600px){
          .adm-gown-form-grid{grid-template-columns:1fr;}
          .adm-gown-row{grid-template-columns:60px 1fr;}
          .adm-gown-actions{flex-direction:row;grid-column:1/-1;}
        }
      `}</style>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}

      <div className="adm-gowns-page" ref={formRef}>
        <div className="adm-topbar">
          <h1 className="adm-page-title">Gowns</h1>
          <span className="adm-page-meta">{gowns.length} active · {arcCount} archived</span>
        </div>

        {/* Stats */}
        {!loading && (
          <div className="adm-stats-bar">
            <div className="adm-stat-card">
              <div className="adm-stat-val">{gowns.length}</div>
              <div className="adm-stat-lbl">Active gowns</div>
            </div>
            <div className="adm-stat-card">
              <div className="adm-stat-val">{totalUnits}</div>
              <div className="adm-stat-lbl">Units available</div>
            </div>
            {lowCount > 0 && (
              <div className="adm-stat-card warning">
                <div className="adm-stat-val">{lowCount}</div>
                <div className="adm-stat-lbl">Low stock sizes</div>
              </div>
            )}
            {outCount > 0 && (
              <div className="adm-stat-card danger">
                <div className="adm-stat-val">{outCount}</div>
                <div className="adm-stat-lbl">Sold out sizes</div>
              </div>
            )}
          </div>
        )}

        {/* Form */}
        <div className="adm-gown-form-card">
          <h2 className="adm-gown-form-title">{editingId ? 'Edit gown' : 'Add new gown'}</h2>
          <form onSubmit={handleSubmit}>
            <div className="adm-gown-form-grid">
              <div className="adm-form-row">
                <label className="adm-label">Name</label>
                <input name="name" value={form.name} onChange={handleChange} placeholder="e.g. The Isabella" className="adm-input" />
              </div>
              <div className="adm-form-row">
                <label className="adm-label">Price</label>
                <input name="price" type="text" inputMode="numeric" value={form.price} onChange={handlePriceChange}
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
                <input name="color" value={form.color} onChange={handleChange} placeholder="e.g. Ivory" className="adm-input" />
              </div>
              <div className="adm-form-row">
                <label className="adm-label">Silhouette</label>
                <input name="silhouette" value={form.silhouette} onChange={handleChange} placeholder="e.g. A-line" className="adm-input" />
              </div>
              <div className="adm-form-row">
                <label className="adm-label">Fabric</label>
                <input name="fabric" value={form.fabric} onChange={handleChange} placeholder="e.g. Satin" className="adm-input" />
              </div>
              <div className="adm-form-row">
                <label className="adm-label">Neckline</label>
                <input name="neckline" value={form.neckline} onChange={handleChange} placeholder="e.g. V-neck" className="adm-input" />
              </div>
              <div className="adm-form-row">
                <label className="adm-label">Alt text</label>
                <input name="alt" value={form.alt} onChange={handleChange} placeholder="Short image description" className="adm-input" />
              </div>
            </div>

            <div className="adm-form-row" style={{ marginBottom: 14 }}>
              <label className="adm-label">Image path or URL</label>
              <div className="adm-image-row">
                <input name="image" value={form.image} onChange={handleChange} placeholder="/images/photo.png" className="adm-input" />
                {showPreview && <img src={form.image} alt="" className="adm-image-preview" onError={() => setImgError(true)} />}
              </div>
              <span className="adm-field-hint">Put images in <code>public/images/</code> · use <code>/images/filename.png</code></span>
            </div>

            <div className="adm-form-row" style={{ marginBottom: 18 }}>
              <label className="adm-label">Description</label>
              <textarea name="description" value={form.description} onChange={handleChange}
                rows={3} placeholder="Product description…" className="adm-input" />
            </div>

            <div className="adm-form-row" style={{ marginBottom: 18 }}>
              <InventoryEditor inventory={inventory} onChange={setInventory} />
            </div>

            {formError && <p className="adm-error-msg" style={{ marginBottom: 12 }}>{formError}</p>}

            <div className="adm-form-actions">
              <button type="submit" disabled={saving} className="adm-btn">
                {saving ? 'Saving…' : editingId ? 'Update gown' : 'Add gown'}
              </button>
              {editingId && (
                <button type="button" onClick={handleCancelEdit} className="adm-btn-outline">Cancel</button>
              )}
            </div>
          </form>
        </div>

        {error && <p className="adm-error-msg">{error}</p>}

        {/* Tabs */}
        <div className="adm-tabs">
          <button className={`adm-tab${tab === 'active' ? ' active' : ''}`} onClick={() => setTab('active')}>
            Active <span className="adm-tab-count">{gowns.length}</span>
          </button>
          <button className={`adm-tab${tab === 'archived' ? ' active' : ''}`} onClick={() => setTab('archived')}>
            Archived <span className="adm-tab-count">{arcCount}</span>
          </button>
        </div>

        {tab === 'active' ? (
          loading
            ? <p className="adm-muted">Loading gowns…</p>
            : gowns.length === 0
              ? <p className="adm-muted">No active gowns. Add one above.</p>
              : gowns.map(g => (
                  <GownRow key={g.id} g={g} editingId={editingId} isAdmin={isAdmin}
                    onEdit={handleEdit} onArchive={handleArchive} onPermanentDelete={handlePermanentDelete} />
                ))
        ) : (
          arcLoading
            ? <p className="adm-muted">Loading archived gowns…</p>
            : archived.length === 0
              ? <p className="adm-muted">No archived gowns.</p>
              : <>
                  <p className="adm-archive-note">
                    Archived gowns are hidden from customers but preserved in order history.
                    Restore to make them visible again, or permanently delete to remove them entirely.
                  </p>
                  {archived.map(g => (
                    <GownRow key={g.id} g={g} editingId={editingId} archived isAdmin={isAdmin}
                      onEdit={handleEdit} onArchive={handleArchive} onPermanentDelete={handlePermanentDelete} />
                  ))}
                </>
        )}

        <Link href="/admin" className="adm-back-link">← Dashboard</Link>
      </div>
    </>
  )
}