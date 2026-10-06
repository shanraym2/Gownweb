'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRoleGuard } from '../../utils/useRoleGuard'
import { adminFetch }   from '../adminFetch'
import { PRESET_SIZES_BY_SEGMENT, SEGMENTS } from '@/app/constants/sizeConstants'
import { drawGownWarped, getProfile } from '@/lib/fitting-room/gownWarp'
import { drawGownGL, ensureProfile, makeWidthFn, sampleSkirt } from '@/lib/fitting-room/glGownRenderer'
import { resolveCal, seamsFor, bodiceExtent, NECKLINES, SLEEVES, ADV_FIELDS, GEO_GROUPS, CURVE_MIN, CURVE_MAX, CURVE_OVERRIDES } from '@/lib/fitting-room/calibration'
import { matteGown } from '@/lib/fitting-room/matte'
import { createPortal } from 'react-dom'

/* ─────────────────────────────────────────────
   Constants & helpers
───────────────────────────────────────────── */
const emptyGown = {
  name:'', price:'₱', image:'/images/', alt:'',
  tryonImage:'', tryonImageBack:'', tryonCalibration:null,
  type:'Gowns', segment:'women',
  color:'', silhouette:'', fabric:'', neckline:'', description:'',
}
const TYPES = ['Gowns','Dresses','Suit']
const SORT_OPTIONS = [
  { value:'name-asc',  label:'Name A→Z' },
  { value:'name-desc', label:'Name Z→A' },
  { value:'price-asc', label:'Price Low→High' },
  { value:'price-desc',label:'Price High→Low' },
  { value:'stock-asc', label:'Stock Low→High' },
  { value:'stock-desc',label:'Stock High→Low' },
]

function numericPrice(p) {
  return parseInt(String(p||'').replace(/[^\d]/g,'')) || 0
}
function totalAvail(g) {
  return (g.inventory||[]).reduce((s,i)=>s+Math.max(0,(i.stock||0)-(i.reserved||0)),0)
}
function headers() { return {'Content-Type':'application/json'} }

/* ─────────────────────────────────────────────
   SizePicker
───────────────────────────────────────────── */
function SizePicker({ inventory, onAdd, error, onClearErr, presets }) {
  const taken     = new Set((inventory||[]).map(i => i.size))
  const available = presets.filter(s => !taken.has(s))
  const [custom, setCustom]         = useState('')
  const [showCustom, setShowCustom] = useState(false)

  function validateCustom(val) {
    const v = val.trim().toUpperCase()
    if (!v)               return 'Enter a size label.'
    if (v.length > 8)     return 'Max 8 characters.'
    if (/\s/.test(v))     return 'No spaces allowed.'
    if (taken.has(v))     return `"${v}" already added.`
    if (presets.includes(v)) return `Use the "${v}" button above.`
    return null
  }

  const handleCustomAdd = () => {
    const err = validateCustom(custom)
    if (err) { onClearErr(); return }
    onAdd(custom.trim().toUpperCase())
    setCustom('')
    setShowCustom(false)
  }

  const allPresetTaken = available.length === 0

  return (
    <div className="sp-root">
      {!allPresetTaken && (
        <div className="sp-grid">
          {presets.map(size => {
            const isTaken = taken.has(size)
            return (
              <button
                key={size}
                type="button"
                className={`sp-btn${isTaken ? ' sp-btn--taken' : ''}`}
                disabled={isTaken}
                title={isTaken ? `${size} already added` : `Add ${size}`}
                onClick={() => { onClearErr(); onAdd(size) }}
              >
                {size}
                {isTaken && <span className="sp-check" aria-hidden="true">✓</span>}
              </button>
            )
          })}
          <button
            type="button"
            className={`sp-btn sp-btn--custom${showCustom ? ' sp-btn--custom-active' : ''}`}
            onClick={() => { setShowCustom(v => !v); onClearErr() }}
            title="Add a size not in the list"
          >
            + Custom
          </button>
        </div>
      )}

      {(showCustom || allPresetTaken) && (
        <div className="sp-custom-row">
          <input
            type="text"
            maxLength={8}
            value={custom}
            onChange={e => { setCustom(e.target.value); onClearErr() }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCustomAdd() } }}
            placeholder="e.g. 0, 2, 28, 34…"
            className="sp-custom-input"
            autoFocus={showCustom}
          />
          <button type="button" className="btn-sm" onClick={handleCustomAdd} disabled={!custom.trim()}>
            Add
          </button>
          {!allPresetTaken && (
            <button type="button" className="btn-xs" onClick={() => { setShowCustom(false); setCustom(''); onClearErr() }}>
              ✕
            </button>
          )}
        </div>
      )}

      {error && <p className="field-error" style={{margin:'4px 0 0'}}>{error}</p>}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Image uploader
───────────────────────────────────────────── */
function ImageUploader({ label, hint, value, onChange, onError, error, badge }) {
  const inputRef    = useRef(null)
  const [dragging,  setDragging ] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')

  const upload = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setUploadErr('Please select an image file.')
      return
    }
    setUploading(true)
    setUploadErr('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res  = await adminFetch('/api/admin/upload-tryon-image', {
        method: 'POST',
        body:   formData,
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Upload failed')
      onChange(data.url)
    } catch (e) {
      setUploadErr(e.message)
    } finally {
      setUploading(false)
    }
  }, [onChange])

  const onDrop = useCallback(e => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files?.[0]; if (f) upload(f)
  }, [upload])

  const onPick = useCallback(e => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) upload(f)
  }, [upload])

  const hasImage = value && value !== '/images/'
  const err = uploadErr || (error ? 'Image failed to load' : '')

  return (
    <div className="iup-slot">
      <div className="iup-label-row">
        <span className="iup-label">{label}</span>
        {badge}
      </div>
      <div
        className={`iup-dropzone${dragging ? ' dragging' : ''}${hasImage ? ' has-image' : ''}`}
        onDragEnter={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
      >
        <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPick} />
        {hasImage ? (
          <div className="iup-preview-wrap">
            <img src={value} alt={label} className="iup-preview" onError={onError} />
            <div className="iup-preview-overlay"><span>{uploading ? 'Uploading…' : 'Replace'}</span></div>
          </div>
        ) : (
          <div className="iup-empty">
            {uploading ? (
              <><span className="iup-spin" /><span className="iup-empty-text">Uploading…</span></>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <rect x="3" y="3" width="18" height="18" rx="3"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span className="iup-empty-text">Drop or click</span>
              </>
            )}
          </div>
        )}
      </div>
      <input
        className="iup-path-input"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder="/images/filename.png"
        spellCheck={false}
      />
      {err && <p className="iup-error">{err}</p>}
      {hint && <p className="iup-hint">{hint}</p>}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Background Remover
───────────────────────────────────────────── */
async function toSafeUrl(src) {
  if (src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('/')) {
    return src
  }
  const res = await adminFetch(`/api/admin/proxy-img?url=${encodeURIComponent(src)}`)
  if (!res.ok) throw new Error('Could not load image for processing.')
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

function removeBg(imgSrc, tolerance = 32) {
  return new Promise(async (resolve, reject) => {
    let objectUrl = null
    try {
      const safeSrc = await toSafeUrl(imgSrc)
      if (safeSrc !== imgSrc) objectUrl = safeSrc

      const img = new Image()
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)

        let data
        try {
          data = ctx.getImageData(0, 0, w, h)
        } catch (e) {
          reject(new Error('Canvas is tainted — image could not be processed.'))
          return
        }

        const d = data.data
        const seeds = []
        const pts = [
          [0,0],[w-1,0],[0,h-1],[w-1,h-1],
          [Math.floor(w/2),0],[Math.floor(w/2),h-1],
          [0,Math.floor(h/2)],[w-1,Math.floor(h/2)]
        ]
        pts.forEach(([x,y]) => {
          const i = (y * w + x) * 4
          seeds.push({ r: d[i], g: d[i+1], b: d[i+2] })
        })

        function isBg(x, y) {
          const i = (y * w + x) * 4
          return d[i+3] < 10 || seeds.some(s =>
            Math.abs(d[i] - s.r) + Math.abs(d[i+1] - s.g) + Math.abs(d[i+2] - s.b) < tolerance * 3
          )
        }

        const visited = new Uint8Array(w * h)
        const queue  = new Uint32Array(w * h)
        let head = 0, tail = 0

        function enq(x, y) {
          if (x < 0 || y < 0 || x >= w || y >= h) return
          const idx = y * w + x
          if (visited[idx]) return
          visited[idx] = 1
          if (isBg(x, y)) queue[tail++] = idx
        }

        for (let x = 0; x < w; x++) { enq(x, 0); enq(x, h-1) }
        for (let y = 0; y < h; y++) { enq(0, y); enq(w-1, y) }

        while (head < tail) {
          const idx = queue[head++]
          const x = idx % w, y = (idx - x) / w
          d[idx * 4 + 3] = 0
          enq(x-1, y); enq(x+1, y); enq(x, y-1); enq(x, y+1)
        }

        ctx.putImageData(data, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = () => reject(new Error('Could not load image.'))
      img.src = safeSrc
    } catch (e) {
      reject(e)
    } finally {
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 5000)
    }
  })
}

// Crop a try-on PNG to its visible pixels (+1%) and upload it. Saved calibration stays valid:
// waist / seams are stored as fractions of the gown, not of the image.
async function tightCropUpload(srcUrl) {
  const safe = await toSafeUrl(srcUrl)
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not load image.')); im.src = safe })
    const w = img.naturalWidth, h = img.naturalHeight
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0)
    const d = cx.getImageData(0, 0, w, h).data
    let x0 = w, y0 = h, x1 = -1, y1 = -1
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] >= 16) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y
    }
    if (x1 < 0) throw new Error('No visible gown pixels found. Remove the background first.')
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.01) + 1
    const sx = Math.max(0, x0 - pad), sy = Math.max(0, y0 - pad)
    const ex = Math.min(w, x1 + 1 + pad), ey = Math.min(h, y1 + 1 + pad)
    const out = document.createElement('canvas'); out.width = ex - sx; out.height = ey - sy
    out.getContext('2d').drawImage(c, sx, sy, out.width, out.height, 0, 0, out.width, out.height)
    const blob = await new Promise(r => out.toBlob(r, 'image/png'))
    const fd = new FormData()
    fd.append('file', new File([blob], `tryon-${Date.now()}.png`, { type: 'image/png' }))
    const res  = await adminFetch('/api/admin/upload-tryon-image', { method: 'POST', body: fd })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'Upload failed')
    return data.url
  } finally { if (safe !== srcUrl && safe.startsWith('blob:')) URL.revokeObjectURL(safe) }
}

function BgRemover({ src, onDone, onClose }) {
  const canvasRef=useRef(null)
  const [tol,setTol]=useState(32); const [processing,setProcessing]=useState(false)
  const [result,setResult]=useState(null); const [error,setError]=useState(''); const [saving,setSaving]=useState(false)
  const run=useCallback(async(t)=>{
    setProcessing(true);setError('');setResult(null)
    try{
      const png=await removeBg(src,t); setResult(png)
      if(canvasRef.current){ const img=new Image(); img.onload=()=>{ const c=canvasRef.current; if(!c)return; const scale=Math.min(340/img.width,320/img.height,1); c.width=img.width*scale; c.height=img.height*scale; const ctx=c.getContext('2d'),sz=12; for(let y=0;y<c.height;y+=sz)for(let x=0;x<c.width;x+=sz){ctx.fillStyle=(Math.floor(x/sz)+Math.floor(y/sz))%2===0?'#ccc':'#fff';ctx.fillRect(x,y,sz,sz)} ctx.drawImage(img,0,0,c.width,c.height) }; img.src=png }
    }catch(e){setError(e.message)}
    finally{setProcessing(false)}
  },[src])
  useEffect(()=>{run(tol)},[src]) // eslint-disable-line
  const handleSave=async()=>{
    if(!result)return; setSaving(true)
    try{
      const res=await adminFetch('/api/admin/upload-tryon-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:result})})
      const data=await res.json(); if(!data.ok)throw new Error(data.error||'Upload failed')
      onDone(data.url)
    }catch(e){setError(e.message)}
    finally{setSaving(false)}
  }
  return(
    <div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
      <div className="modal-box" style={{maxWidth:460}}>
        <div className="modal-header"><span className="modal-title">Background Remover</span><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <p className="modal-hint">Edge flood-fill removes the background. Use plain studio photos for best results.</p>
          <div className="bgr-preview-area">{processing&&<div className="bgr-spin-wrap"><span className="spin"/><span>Processing…</span></div>}<canvas ref={canvasRef} className="bgr-canvas" style={{display:processing?'none':'block'}}/></div>
          {error&&<p className="field-error">{error}</p>}
          <div className="bgr-tolerance-row">
            <span className="field-label" style={{flexShrink:0}}>Tolerance</span>
            <input type="range" min="8" max="80" step="4" value={tol} onChange={e=>setTol(+e.target.value)} className="range-input"/>
            <span className="tol-val">{tol}</span>
            <button className="btn-sm" onClick={()=>run(tol)} disabled={processing}>{processing?'Running…':'Re-run'}</button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={!result||saving||processing}>{saving?'Saving…':'Use as try-on image'}</button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   AutoMatteModal — ML cut-out (BiRefNet + person removal), runs in the browser
───────────────────────────────────────────── */
function AutoMatteModal({ displayImage, onDone, onClose }) {
  const [srcUrl,     setSrcUrl    ] = useState(null)
  const [removeSkin, setRemoveSkin] = useState(true)
  const [busy,       setBusy      ] = useState(false)
  const [status,     setStatus    ] = useState('')
  const [result,     setResult    ] = useState(null)
  const [error,      setError     ] = useState('')
  const [saving,     setSaving    ] = useState(false)
  const [dark,       setDark      ] = useState(false)
  const inputRef = useRef(null)
  const fileRef  = useRef(null)
  const urlsRef  = useRef([])

  useEffect(() => {
    const fn = e => { if (e.key === 'Escape' && !busy && !saving) onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [busy, saving, onClose])
  useEffect(() => () => urlsRef.current.forEach(u => URL.revokeObjectURL(u)), [])

  const run = useCallback(async (file, skin) => {
    setBusy(true); setError(''); setResult(null); setStatus('Starting…')
    try {
      const r = await matteGown(file, { removeSkin: skin, format: 'webp', onStatus: setStatus })
      if (r.url) urlsRef.current.push(r.url)
      setResult(r)
    } catch (e) {
      console.error('[AutoMatte]', e)
      setError(e?.message || 'Cut-out failed. See the browser console.')
    } finally { setBusy(false); setStatus('') }
  }, [])

  const pickFile = useCallback(file => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return }
    const u = URL.createObjectURL(file); urlsRef.current.push(u)
    fileRef.current = file; setSrcUrl(u)
    run(file, removeSkin)
  }, [run, removeSkin])

  const useDisplay = async () => {
    setError('')
    try {
      const safe = await toSafeUrl(displayImage)
      const res  = await fetch(safe)
      if (!res.ok) throw new Error('Could not read the display image.')
      const blob = await res.blob()
      if (safe !== displayImage && safe.startsWith('blob:')) URL.revokeObjectURL(safe)
      pickFile(new File([blob], 'display-image', { type: blob.type || 'image/jpeg' }))
    } catch (e) { setError(e.message) }
  }

  const upload = async blob => {
    const fd = new FormData()
    fd.append('file', new File([blob], `tryon-${Date.now()}.${blob.type === 'image/webp' ? 'webp' : 'png'}`, { type: blob.type }))
    const res  = await adminFetch('/api/admin/upload-tryon-image', { method: 'POST', body: fd })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'Upload failed')
    return data.url
  }

  const save = async () => {
    if (!result?.blob) return
    setSaving(true); setError('')
    try {
      let url
      try { url = await upload(result.blob) }
      catch (e) {
        if (result.blob.type === 'image/png') throw e
        const png = await new Promise(r => result.canvas.toBlob(r, 'image/png'))   // route may not accept WebP
        url = await upload(png)
      }
      onDone(url)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const checker = 'repeating-conic-gradient(#d9d6d0 0% 25%, #f4f2ee 0% 50%) 50% / 20px 20px'
  const hasDisplay = displayImage && displayImage !== '/images/'

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy && !saving) onClose() }}>
      <div className="modal-box modal-box--wide">
        <div className="modal-header">
          <span className="modal-title">Auto cut-out</span>
          <button className="modal-close" onClick={onClose} disabled={busy || saving}>×</button>
        </div>
        <div className="modal-body">
          <p className="modal-hint">
            Cuts the gown out on this computer (nothing is sent anywhere until you save). The first run downloads the model (~200 MB, then cached); Chrome or Edge on desktop is fastest.
          </p>

          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
            <input ref={inputRef} type="file" accept="image/*" style={{display:'none'}}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; pickFile(f) }} />
            <button type="button" className="btn-sm" disabled={busy || saving} onClick={() => inputRef.current?.click()}>Choose photo…</button>
            {hasDisplay && <button type="button" className="btn-sm" disabled={busy || saving} onClick={useDisplay}>Use display image</button>}
            <label style={{display:'flex',gap:6,alignItems:'center',fontSize:12,color:'var(--c-muted)'}}>
              <input type="checkbox" checked={removeSkin} disabled={busy || saving} onChange={e => setRemoveSkin(e.target.checked)} />
              Remove model (face, hair, skin)
            </label>
            {fileRef.current && !busy && (
              <button type="button" className="btn-xs" disabled={saving} onClick={() => run(fileRef.current, removeSkin)}>Run again</button>
            )}
          </div>

          {busy && <p role="status" aria-live="polite" className="modal-hint" style={{color:'var(--c-gold)'}}>{status || 'Working…'}</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          {result && !result.ok && result.warnings.map((w, i) => <p key={i} className="field-error">{w}</p>)}
          {result?.ok && result.warnings.length > 0 && (
            <div className="archive-note" role="status">{result.warnings.map((w, i) => <div key={i}>• {w}</div>)}</div>
          )}

          {(srcUrl || result?.ok) && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div>
                <p className="field-label" style={{marginBottom:4}}>Original</p>
                {srcUrl && <img src={srcUrl} alt="Original" style={{width:'100%',maxHeight:360,objectFit:'contain',background:'var(--c-surface2)',borderRadius:8}} />}
              </div>
              <div>
                <p className="field-label" style={{marginBottom:4,display:'flex',justifyContent:'space-between'}}>
                  <span>Cut-out{result?.ok ? ` · ${result.width}×${result.height} · ${(result.blob.size/1024).toFixed(0)} KB` : ''}</span>
                  <button type="button" className="btn-xs" onClick={() => setDark(d => !d)}>{dark ? 'Checkerboard' : 'Dark'}</button>
                </p>
                <div style={{background: dark ? '#0d0a07' : checker, borderRadius:8, minHeight:120}}>
                  {result?.ok && <img src={result.url} alt="Cut-out preview" style={{width:'100%',maxHeight:360,objectFit:'contain',display:'block'}} />}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={busy || saving}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={!result?.ok || busy || saving}>{saving ? 'Saving…' : 'Use as try-on image'}</button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   SeamPreview — draggable sleeve-seam lines over the cut-out image
───────────────────────────────────────────── */
function SeamPreview({ src, cal, rc, onSeam, onGeo, onWaistRow }) {
  const [img, setImg] = useState(null)
  const boxRef  = useRef(null)
  const dragRef = useRef(null)

  useEffect(() => {
    if (!src) { setImg(null); return }
    let cancelled = false, objectUrl = null
    toSafeUrl(src)
      .then(safe => {
        if (cancelled) return
        if (safe !== src) objectUrl = safe
        const im = new Image()
        im.onload  = () => { if (!cancelled) setImg(im) }
        im.onerror = () => { if (!cancelled) setImg(null) }
        im.src = safe
      })
      .catch(() => { if (!cancelled) setImg(null) })
    return () => { cancelled = true; if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000) }
  }, [src])

  const prof = useMemo(() => {
    if (!img) return null
    try { const p = getProfile(img); if (p) ensureProfile(p); return p } catch { return null }
  }, [img])

  if (!img) return null
  if (!prof) return <p className="ce-row-hint">Seam lines need a try-on image with a transparent background. Use Auto cut-out first.</p>

  const clampN = (v, a, b) => Math.min(Math.max(v, a), b)
  const wf  = clampN(cal.waistRow ?? prof.waistFrac, 0.02, 0.9)
  const ex  = bodiceExtent(prof.glL, prof.glR, wf)
  if (!ex) return null
  const e   = rc.enh
  const xL  = ex.lo + e.seamL * ex.W
  const xR  = ex.hi - e.seamR * ex.W
  const bad = !seamsFor(prof.glL, prof.glR, wf, e)
  const pct = x => `${(x / prof.iw) * 100}%`
  const yWaist = ((prof.srcTop + wf * prof.srcH) / prof.ih) * 100

  const geo = rc.enh.geo
  const yAt = f => ((prof.srcTop + f * prof.srcH) / prof.ih) * 100
  const move = ev => {
    const side = dragRef.current; if (!side || !boxRef.current) return
    const r = boxRef.current.getBoundingClientRect()
    if (side === 'top' || side === 'waist' || side === 'hem') {
      const f = (((ev.clientY - r.top) / r.height) * prof.ih - prof.srcTop) / prof.srcH
      if (side === 'top')   onGeo?.('imgTop', clampN(f, 0, Math.min(0.6, geo.imgHem - 0.25)))
      if (side === 'hem')   onGeo?.('imgHem', clampN(f, Math.max(0.7, geo.imgTop + 0.25), 1))
      if (side === 'waist') onWaistRow?.(clampN(f, Math.max(0.02, geo.imgTop + 0.05), Math.min(0.9, geo.imgHem - 0.1)))
      return
    }
    const x = ((ev.clientX - r.left) / r.width) * prof.iw
    onSeam(side, side === 'L' ? clampN((x - ex.lo) / ex.W, 0, 0.4) : clampN((ex.hi - x) / ex.W, 0, 0.4))
  }
  const hline = (kind, y, color, label, dashed) => (
    <div key={kind} role="slider" aria-label={label}
      onPointerDown={ev => { dragRef.current = kind; ev.currentTarget.setPointerCapture(ev.pointerId) }}
      onPointerMove={move}
      onPointerUp={() => { dragRef.current = null }}
      onPointerCancel={() => { dragRef.current = null }}
      style={{ position:'absolute', left:0, right:0, top:`${y}%`, height:16, marginTop:-8, cursor:'ns-resize', touchAction:'none' }}>
      <div style={{ position:'absolute', left:0, right:0, top:7, borderTop:`2px ${dashed ? 'dashed' : 'solid'} ${color}` }}/>
      <span style={{ position:'absolute', left:4, top:-4, fontSize:9, color, background:'rgba(0,0,0,.55)', padding:'0 4px', borderRadius:3 }}>{label}</span>
    </div>
  )
  const line = (side, x) => (
    <div key={side}
      role="slider" aria-label={side === 'L' ? 'Left sleeve seam' : 'Right sleeve seam'}
      aria-valuenow={Number((side === 'L' ? e.seamL : e.seamR).toFixed(2))} aria-valuemin={0} aria-valuemax={0.4}
      onPointerDown={ev => { dragRef.current = side; ev.currentTarget.setPointerCapture(ev.pointerId) }}
      onPointerMove={move}
      onPointerUp={() => { dragRef.current = null }}
      onPointerCancel={() => { dragRef.current = null }}
      style={{ position:'absolute', top:0, bottom:0, left:pct(x), width:16, marginLeft:-8, cursor:'ew-resize', touchAction:'none' }}>
      <div style={{ position:'absolute', top:0, bottom:0, left:7, width:2, background: bad ? '#e24b4a' : '#c9a96e' }}/>
    </div>
  )

  return (
    <div>
      <p className="ce-row-label" style={{marginBottom:4}}>Sleeve seams: drag the gold lines to where the bodice ends and the sleeves begin</p>
      <div ref={boxRef} style={{ position:'relative', background:'repeating-conic-gradient(#d9d6d0 0% 25%, #f4f2ee 0% 50%) 50% / 16px 16px', borderRadius:8, overflow:'hidden', userSelect:'none' }}>
        <img src={img.src} alt="Try-on image with sleeve seam lines" draggable={false} style={{ width:'100%', display:'block' }}/>
        <div style={{ position:'absolute', left:0, right:0, top:0, height:`${yAt(geo.imgTop)}%`, background:'rgba(0,0,0,.45)', pointerEvents:'none' }} aria-hidden="true"/>
        <div style={{ position:'absolute', left:0, right:0, bottom:0, height:`${100 - yAt(geo.imgHem)}%`, background:'rgba(0,0,0,.45)', pointerEvents:'none' }} aria-hidden="true"/>
        {hline('top',   yAt(geo.imgTop), '#c9a96e', 'Garment top', false)}
        {hline('waist', yWaist,          '#4a7fd4', 'Skirt start', true)}
        {hline('hem',   yAt(geo.imgHem), '#7ab8f5', 'Hem',         false)}
        {line('L', xL)}
        {line('R', xR)}
      </div>
      {bad && <p className="field-error">The seams are too close together. Move them apart.</p>}
    </div>
  )
}
/* ─────────────────────────────────────────────
   CalibrationEditor  v2
   Skeleton-anchored interactive canvas editor.
   Props:
     calibration  object|null   — current cal values
     onChange     fn(obj|null)  — called with new cal or null to reset
     tryonImage   string        — URL of front try-on PNG; used as dress overlay
───────────────────────────────────────────── */
const DEFAULT_CAL = {
  necklineY:   0.18,
  shoulderPad: 1.25,
  skirtFlare:  1.10,
  hemY:        null,
  offsetX:     0,      // px, dress horizontal shift
  offsetY:     0,      // px, dress vertical shift
  scaleX:      1.0,    // horizontal stretch multiplier
  scaleY:      1.0,    // vertical stretch multiplier
}
// Synthetic body in normalised coords (0..1) for canvas W=220 H=400
const B_AVG = {
  head: [0.50, 0.055],
  ls:   [0.30, 0.175], rs:  [0.70, 0.175],
  lh:   [0.36, 0.445], rh:  [0.64, 0.445],
  lk:   [0.38, 0.660], rk:  [0.62, 0.660],
  la:   [0.39, 0.875], ra:  [0.61, 0.875],
  le:   [0.19, 0.315], re:  [0.81, 0.315],
  lw:   [0.15, 0.435], rw:  [0.85, 0.435],
}

function makeBody({ sh, hh, shY, hipY, kneeY, ankleY, headY }) {
  const torso = hipY - shY
  const elY = shY + torso * 0.52, wrY = shY + torso * 0.96
  const L = (half, y) => [0.5 - half, y], R = (half, y) => [0.5 + half, y]
  return {
    head: [0.5, headY],
    ls: L(sh, shY),            rs: R(sh, shY),
    lh: L(hh, hipY),           rh: R(hh, hipY),
    lk: L(hh * 0.857, kneeY),  rk: R(hh * 0.857, kneeY),
    la: L(hh * 0.786, ankleY), ra: R(hh * 0.786, ankleY),
    le: L(sh * 1.55, elY),     re: R(sh * 1.55, elY),
    lw: L(sh * 1.75, wrY),     rw: R(sh * 1.75, wrY),
  }
}
const BODY_D = { sh: .20, hh: .14, shY: .175, hipY: .445, kneeY: .66, ankleY: .875, headY: .055 }
const BODIES = {
  average: B_AVG,
  narrow:  makeBody({ ...BODY_D, sh: .17, hh: .12 }),
  broad:   makeBody({ ...BODY_D, sh: .23 }),
  widehip: makeBody({ ...BODY_D, sh: .19, hh: .18 }),
  tall:    makeBody({ ...BODY_D, shY: .14, hipY: .43, ankleY: .90, headY: .035 }),
  petite:  makeBody({ ...BODY_D, sh: .19, hh: .13, shY: .215, hipY: .46, kneeY: .665, ankleY: .86, headY: .09 }),
}
const BODY_OPTIONS = [
  { id: 'average', label: 'Average' }, { id: 'narrow', label: 'Narrow' }, { id: 'broad', label: 'Broad shoulders' },
  { id: 'widehip', label: 'Wide hip' }, { id: 'tall', label: 'Tall' }, { id: 'petite', label: 'Petite' },
]
// The draw helpers read `B` at call time; the editor sets it from the selected preview body.
let B = B_AVG
const setBody = k => { B = BODIES[k] || B_AVG }
const CE_ACTIVE = { background: 'rgba(200,169,110,.18)', color: '#c9a96e', borderColor: 'rgba(200,169,110,.45)' }

const bpx = (key, W, H) => ({ x: B[key][0] * W, y: B[key][1] * H })

function calLayout(cal, W, H) {
  const c      = { ...DEFAULT_CAL, ...(cal || {}) }
  const smX    = (B.ls[0] + B.rs[0]) / 2 * W
  const smY    = B.ls[1] * H
  const hmY    = B.lh[1] * H
  const torsoH = hmY - smY
  const swPx   = (B.rs[0] - B.ls[0]) * W

  const topY   = smY - torsoH * c.necklineY
  const topW   = swPx * c.shoulderPad
  const botBase = Math.max(swPx * 1.2, topW)
  const botW   = botBase * c.skirtFlare

  let bottomY
  if (c.hemY != null) {
    const fullH = smY + torsoH * 4.8 - topY
    bottomY     = topY + fullH * c.hemY
  } else {
    const ankleY = (B.la[1] + B.ra[1]) / 2 * H
    bottomY      = ankleY + torsoH * 0.10
  }

  return { topY, bottomY, cx: smX, topW, botW, torsoH, smY, hmY, swPx,
           waistY: smY + torsoH * (cal?.enh?.geo?.waistAt ?? 0.65), enh: !!cal?.enh, curve: !!cal?.enh?.curve?.on }
}

function calHandles(lay) {
  const { topY, bottomY, cx, topW, botW, smY } = lay
  return {
    ...(lay.enh ? { waist: { x: cx + topW/2 + 14, y: lay.waistY, axis:'y', color:'#4a7fd4', label:'Skirt start' } } : {}),
    neckline:  { x: cx,          y: topY,    axis:'y', color:'#c9a96e', label:'Neckline' },
    shoulderL: { x: cx - topW/2, y: smY,     axis:'x', color:'#c9a96e', label:'Shoulder' },
    shoulderR: { x: cx + topW/2, y: smY,     axis:'x', color:'#c9a96e', label:'Shoulder' },
    hem:       { x: cx,          y: bottomY, axis:'y', color:'#7ab8f5', label:'Hem'      },
    ...(lay.curve ? {} : {
      flareL:  { x: cx - botW/2, y: bottomY, axis:'x', color:'#7ab8f5', label:'Flare'    },
      flareR:  { x: cx + botW/2, y: bottomY, axis:'x', color:'#7ab8f5', label:'Flare'    },
    }),
  }
}

function drawCalSkeleton(ctx, W, H, alpha) {
  ctx.save()
  ctx.globalAlpha   = alpha
  ctx.strokeStyle   = 'rgba(200,169,110,0.6)'
  ctx.lineWidth     = 1.5
  ctx.setLineDash([])
  const seg = (...keys) => {
    const [a, b] = keys.map(k => bpx(k, W, H))
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
  }
  seg('ls','rs'); seg('ls','lh'); seg('rs','rh'); seg('lh','rh')
  seg('lh','lk'); seg('lk','la'); seg('rh','rk'); seg('rk','ra')
  seg('ls','le'); seg('le','lw'); seg('rs','re'); seg('re','rw')
  const h = bpx('head', W, H)
  ctx.beginPath(); ctx.arc(h.x, h.y, W * 0.053, 0, Math.PI*2); ctx.stroke()
  ctx.fillStyle = 'rgba(200,169,110,0.75)'
  for (const k of ['ls','rs','lh','rh','lk','rk','la','ra']) {
    const p = bpx(k, W, H)
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI*2); ctx.fill()
  }
  ctx.restore()
}

function drawCalDressImage(ctx, img, lay, W) {
  const { topY, bottomY, cx, topW, botW } = lay
  const h = bottomY - topY
  if (h <= 0) return
  const oc  = document.createElement('canvas')
  oc.width  = W * 2; oc.height = bottomY + 20
  const otx = oc.getContext('2d')
  otx.beginPath()
  otx.moveTo(cx - topW/2, topY); otx.lineTo(cx + topW/2, topY)
  otx.lineTo(cx + botW/2, bottomY); otx.lineTo(cx - botW/2, bottomY)
  otx.closePath(); otx.clip()
  otx.drawImage(img, cx - botW/2, topY, botW, h)
  ctx.save(); ctx.globalAlpha = 0.93; ctx.drawImage(oc, 0, 0); ctx.restore()
}

function drawCalDressTrapezoid(ctx, lay) {
  const { topY, bottomY, cx, topW, botW } = lay
  const grad = ctx.createLinearGradient(0, topY, 0, bottomY)
  grad.addColorStop(0, 'rgba(200,169,110,0.50)')
  grad.addColorStop(1, 'rgba(200,169,110,0.12)')
  ctx.save()
  ctx.fillStyle   = grad
  ctx.strokeStyle = 'rgba(200,169,110,0.65)'
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(cx - topW/2, topY); ctx.lineTo(cx + topW/2, topY)
  ctx.lineTo(cx + botW/2, bottomY); ctx.lineTo(cx - botW/2, bottomY)
  ctx.closePath(); ctx.fill(); ctx.stroke()
  ctx.restore()
}

// Extended draw with offset + scale overrides
function drawCalDressImageEx(ctx, img, lay, W, ox, oy, sx, sy) {
  const { topY, bottomY, cx, topW, botW } = lay
  const h = (bottomY - topY) * sy
  if (h <= 0) return
  const adjTopW  = topW  * sx
  const adjBotW  = botW  * sx
  const adjTopY  = topY  + oy
  const adjBotY  = adjTopY + h
  const adjCx    = cx + ox
  const oc  = document.createElement('canvas')
  oc.width  = W * 2; oc.height = adjBotY + 20
  const otx = oc.getContext('2d')
  otx.beginPath()
  otx.moveTo(adjCx - adjTopW/2, adjTopY); otx.lineTo(adjCx + adjTopW/2, adjTopY)
  otx.lineTo(adjCx + adjBotW/2, adjBotY); otx.lineTo(adjCx - adjBotW/2, adjBotY)
  otx.closePath(); otx.clip()
  otx.drawImage(img, adjCx - adjBotW/2, adjTopY, adjBotW, h)
  ctx.save(); ctx.globalAlpha = 0.93; ctx.drawImage(oc, 0, 0); ctx.restore()
}

function drawCalDressTrapezoidEx(ctx, lay, ox, oy, sx, sy) {
  const { topY, bottomY, cx, topW, botW } = lay
  const adjTopW  = topW  * sx
  const adjBotW  = botW  * sx
  const adjTopY  = topY  + oy
  const adjBotY  = topY  + (bottomY - topY) * sy + oy
  const adjCx    = cx + ox
  const grad = ctx.createLinearGradient(0, adjTopY, 0, adjBotY)
  grad.addColorStop(0, 'rgba(200,169,110,0.50)')
  grad.addColorStop(1, 'rgba(200,169,110,0.12)')
  ctx.save()
  ctx.fillStyle   = grad
  ctx.strokeStyle = 'rgba(200,169,110,0.65)'
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(adjCx - adjTopW/2, adjTopY); ctx.lineTo(adjCx + adjTopW/2, adjTopY)
  ctx.lineTo(adjCx + adjBotW/2, adjBotY); ctx.lineTo(adjCx - adjBotW/2, adjBotY)
  ctx.closePath(); ctx.fill(); ctx.stroke()
  ctx.restore()
}

function drawCalGuides(ctx, lay, W) {
  ctx.save()
  ctx.setLineDash([3,5])
  ctx.lineWidth = 0.75
  const lines = [
    { y: lay.smY,     color: 'rgba(200,169,110,0.28)' },
    { y: lay.hmY,     color: 'rgba(200,169,110,0.18)' },
    { y: lay.topY,    color: 'rgba(200,169,110,0.15)' },
    { y: lay.bottomY, color: 'rgba(122,184,245,0.22)' },
  ]
  for (const { y, color } of lines) {
    ctx.strokeStyle = color
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.restore()
}

function drawCalHandles(ctx, hmap, active, hover) {
  for (const [key, h] of Object.entries(hmap)) {
    const isActive = key === active
    const isHover  = key === hover
    const r        = isActive ? 7 : isHover ? 6 : 5
    ctx.save()
    if (isActive || isHover) {
      ctx.beginPath(); ctx.arc(h.x, h.y, r + 5, 0, Math.PI*2)
      ctx.fillStyle = h.color + '25'; ctx.fill()
    }
    ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI*2)
    ctx.fillStyle   = isActive ? h.color : '#100a04'
    ctx.strokeStyle = h.color
    ctx.lineWidth   = isActive ? 2.5 : 1.8
    ctx.fill(); ctx.stroke()
    if (isActive) {
      ctx.font = '600 9px system-ui'; ctx.textAlign = 'center'
      ctx.fillStyle = h.color
      ctx.fillText(h.label, h.x, h.y - r - 5)
    }
    ctx.restore()
  }
}
/* ── Skirt curves: geometry, drawing, insert ── */
function curveGeom(lay, c) {
  const top = lay.topY + (c.offsetY || 0)
  return { cx: lay.cx + (c.offsetX || 0), sw: lay.swPx, hipY: lay.hmY + (c.offsetY || 0), bottomY: top + (lay.bottomY - lay.topY) * (c.scaleY ?? 1) }
}
const curvePt = (g, p) => ({ x: g.cx + p.x * g.sw, y: g.hipY + p.y * (g.bottomY - g.hipY) })
function curveInsert(pts, t) {
  if (pts.length >= CURVE_MAX) return pts
  return [...pts, { y: t, x: makeWidthFn(pts.map(p => [p.y, p.x]))(t) }].sort((a, b) => a.y - b.y)   // sits on the existing curve
}
function drawCalCurves(ctx, cv, g, active, hover, sel) {
  const span = g.bottomY - g.hipY
  for (const side of ['L', 'R']) {
    const pts = side === 'L' ? cv.L : cv.R
    const fn = makeWidthFn(pts.map(p => [p.y, p.x]))
    ctx.save()
    ctx.strokeStyle = '#5fd0b0'; ctx.lineWidth = 1.6; ctx.setLineDash([])
    ctx.beginPath()
    for (let i = 0; i <= 48; i++) {
      const t = i / 48, px = g.cx + fn(t) * g.sw, py = g.hipY + t * span
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py)
    }
    ctx.stroke()
    pts.forEach((p, i) => {
      const key = `c${side}:${i}`, q = curvePt(g, p)
      const on = key === active, hv = key === hover, sl = key === sel
      const r = on ? 6.5 : (hv || sl) ? 5.5 : 4.5
      ctx.beginPath()
      if (i === 0 || i === pts.length - 1) ctx.rect(q.x - r, q.y - r, r * 2, r * 2)   // squares = Y locked (hip / hem)
      else ctx.arc(q.x, q.y, r, 0, Math.PI * 2)
      ctx.fillStyle = (on || sl) ? '#5fd0b0' : '#100a04'
      ctx.strokeStyle = '#5fd0b0'; ctx.lineWidth = (on || sl) ? 2.5 : 1.8
      ctx.fill(); ctx.stroke()
    })
    ctx.restore()
  }
}

function CalibrationEditor({ calibration, onChange, tryonImage, gown, savedCalibration }) {
  const [open,        setOpen      ] = useState(false)
  const [dressImg,    setDressImg  ] = useState(null)
  const [active,      setActive    ] = useState(null)
  const [hover,       setHover     ] = useState(null)
  const [dragOrigin,  setDragOrigin] = useState(null)
  const [calSnapshot, setCalSnap   ] = useState(null)
  const [expanded,    setExpanded  ] = useState(false)   // full-screen view
  const [showRef,     setShowRef   ] = useState(false)   // display picture beside the canvas
  const [skelTop,     setSkelTop   ] = useState(false)   // draw the skeleton over the dress
  const [selPt,       setSelPt     ] = useState(null)    // selected curve point, e.g. 'cL:2'
  const insTime = useRef(0)

  // View state: zoom + pan of the canvas viewport
  const [zoom,    setZoom   ] = useState(1)
  const [panX,    setPanX   ] = useState(0)
  const [panY,    setPanY   ] = useState(0)
  const [panning, setPanning] = useState(false)
  const panOrigin = useRef(null)

  const canvasRef = useRef(null)
  const dragging  = useRef(false)
  const CW = 220, CH = 400
  const EDPR = () => (typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1)

  // Full screen renders into #ce-fs-root (outside the sidebar, which has a transform)
  const fsTarget = expanded && typeof document !== 'undefined' ? document.getElementById('ce-fs-root') : null
  const fs = !!fsTarget
  const RS = () => Math.min(3, EDPR() * (fs ? 2 : 1))   // canvas pixels per logical pixel

  useEffect(() => {
    if (!fs) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = e => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [fs])

  const cal = { ...DEFAULT_CAL, ...(calibration || {}) }
    const isEnh   = cal.mode === 'enhanced'
  const [showSaved, setShowSaved] = useState(false)
  const [bodyKey,   setBodyKey  ] = useState('average')
  setBody(bodyKey)                               // preview body for the draw helpers
  const savedCal = { ...DEFAULT_CAL, ...(savedCalibration || {}) }
  const viewCal  = showSaved && savedCalibration ? savedCal : cal
  const rc       = resolveCal(viewCal, gown)     // geometry only, never saved
  const setMode = m => onChange({ ...cal, mode: m })
  const setEnh  = (k, v) => onChange({ ...cal, enhanced: { ...(cal.enhanced || {}), [k]: v } })
    const setCurve = patch => onChange({ ...cal, enhanced: { ...(cal.enhanced || {}), ...patch } })
  const toggleCurve = on => {
    const c = rc.enh.curve
    if (!on || (c.L && c.R)) return setCurve({ curveOn: on })
    const s = sampleSkirt(4) || [0, 1/3, 2/3, 1].map((y, i) => ({ y, l: -[.45, .5, .6, .75][i], r: [.45, .5, .6, .75][i] }))
    setCurve({
      curveOn: true, curveLink: true,
      curveL: s.map(p => ({ y: p.y, x: -(p.r - p.l) / 2 })),
      curveR: s.map(p => ({ y: p.y, x:  (p.r - p.l) / 2 })),
    })
  }
  const insertAt = (side, t) => {
    const c = rc.enh.curve
    insTime.current = Date.now()
    if (c.link) setCurve({ curveL: curveInsert(c.L, t), curveR: curveInsert(c.R, t) })
    else if (side === 'L') setCurve({ curveL: curveInsert(c.L, t) })
    else setCurve({ curveR: curveInsert(c.R, t) })
  }
  const addPointAuto = () => {
    const c = rc.enh.curve
    const mid = pts => { let bi = 0, bg = -1; for (let i = 0; i < pts.length - 1; i++) { const d = pts[i + 1].y - pts[i].y; if (d > bg) { bg = d; bi = i } } return (pts[bi].y + pts[bi + 1].y) / 2 }
    setCurve({ curveL: curveInsert(c.L, mid(c.L)), curveR: curveInsert(c.R, mid(c.R)) })
  }
  const removePoint = key => {
    const side = key[1], i = +key.slice(3), c = rc.enh.curve
    const drop = pts => (pts.length <= CURVE_MIN || i <= 0 || i >= pts.length - 1) ? pts : pts.filter((_, j) => j !== i)
    if (c.link) setCurve({ curveL: drop(c.L), curveR: drop(c.R) })
    else if (side === 'L') setCurve({ curveL: drop(c.L) })
    else setCurve({ curveR: drop(c.R) })
    setSelPt(null)
  }
  const setLink = v => setCurve(v ? { curveLink: true, curveR: rc.enh.curve.L.map(p => ({ y: p.y, x: -p.x })) } : { curveLink: false })
  const resetCurves = () => onChange({ ...cal, enhanced: Object.fromEntries(Object.entries(cal.enhanced || {}).filter(([k]) => !['curveOn', 'curveL', 'curveR', 'curveLink'].includes(k))) })

  useEffect(() => {                                   // Delete key removes the selected point
    if (!open) return
    const fn = e => {
      if (e.key !== 'Delete' || !selPt || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return
      removePoint(selPt)
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  })

  // Load dress image
  useEffect(() => {
    if (!tryonImage) { setDressImg(null); return }
    let cancelled = false, objectUrl = null
    toSafeUrl(tryonImage)
      .then(safeUrl => {
        if (cancelled) return
        if (safeUrl !== tryonImage) objectUrl = safeUrl
        const img = new Image()
        img.onload  = () => { if (!cancelled) setDressImg(img) }
        img.onerror = () => { if (!cancelled) setDressImg(null) }
        img.src = safeUrl
      })
      .catch(() => { if (!cancelled) setDressImg(null) })
    return () => { cancelled = true; if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000) }
  }, [tryonImage])

  // Redraw canvas
  useEffect(() => {
    if (!open) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
        const cal = viewCal      // shadows the outer `cal` inside this effect: offsets and scale follow the viewed calibration
    ctx.setTransform(RS(), 0, 0, RS(), 0, 0)
    ctx.clearRect(0, 0, CW, CH)

    ctx.fillStyle = '#0c0804'
    ctx.fillRect(0, 0, CW, CH)
    ctx.strokeStyle = 'rgba(255,255,255,0.025)'
    ctx.lineWidth = 1
    for (let y = 0; y < CH; y += 20) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke()
    }
    for (let x = 0; x < CW; x += 20) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke()
    }

    // Apply zoom + pan transform
    ctx.save()
    ctx.translate(panX, panY)
    ctx.scale(zoom, zoom)

    // Apply dress offset from cal
    const dox = cal.offsetX || 0
    const doy = cal.offsetY || 0

        const lay  = calLayout(rc, CW, CH)
    const hmap = calHandles(lay)

    drawCalGuides(ctx, lay, CW)
    if (!skelTop) drawCalSkeleton(ctx, CW, CH, dressImg ? 0.5 : 0.85)

    // Draw dress with offset + scale overrides applied
    if (dressImg) {
      const sy2  = cal.scaleY ?? 1
      const top2 = lay.topY + doy
      const L = {
        topY: top2, bottomY: top2 + (lay.bottomY - lay.topY) * sy2,
        sm: { x: lay.cx, y: lay.smY }, hm: { x: lay.cx, y: lay.hmY },
        sw: lay.swPx, hw: (B.rh[0] - B.lh[0]) * CW, torsoH: lay.torsoH,
        cal: rc, dx: dox, dy: doy, scaleX: cal.scaleX ?? 1, noCloth: true,
      }
      const warped = drawGownGL(ctx, dressImg, L, 0.93, { w: CW, h: CH })
                  || drawGownWarped(ctx, dressImg, L, 0.93, { w: CW, h: CH })
      if (!warped) drawCalDressImageEx(ctx, dressImg, lay, CW, dox, doy, cal.scaleX ?? 1, cal.scaleY ?? 1)
    } else {
      drawCalDressTrapezoidEx(ctx, lay, dox, doy, cal.scaleX ?? 1, cal.scaleY ?? 1)
    }

    if (skelTop) drawCalSkeleton(ctx, CW, CH, 0.9)
          if (rc.enh?.curve?.on) drawCalCurves(ctx, rc.enh.curve, curveGeom(lay, cal), active, hover, selPt)
    drawCalHandles(ctx, hmap, active, hover)

    ctx.restore()

    // Footer hint (outside transform)
    ctx.fillStyle = 'rgba(12,8,4,0.75)'
    ctx.fillRect(0, CH - 18, CW, 18)
    ctx.font = '9px system-ui'; ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(200,169,110,0.4)'
    ctx.fillText(`drag handles · scroll=zoom · drag bg=pan  [${Math.round(zoom*100)}%]`, CW/2, CH - 6)
    }, [open, cal, viewCal, bodyKey, dressImg, active, hover, zoom, panX, panY, fs, skelTop, selPt])

  // Pointer helpers — account for zoom+pan
  function canvasXY(e) {
    const c = canvasRef.current; if (!c) return {x:0,y:0}
    const r  = c.getBoundingClientRect()
    const sx = CW / r.width, sy = CH / r.height
    const cx = e.touches ? e.touches[0].clientX : e.clientX
    const cy = e.touches ? e.touches[0].clientY : e.clientY
    const rawX = (cx - r.left) * sx
    const rawY = (cy - r.top)  * sy
    // Invert zoom+pan
    return { x: (rawX - panX) / zoom, y: (rawY - panY) / zoom }
  }

  function rawCanvasXY(e) {
    const c = canvasRef.current; if (!c) return {x:0,y:0}
    const r = c.getBoundingClientRect()
    const sx = CW / r.width, sy = CH / r.height
    const cx = e.touches ? e.touches[0].clientX : e.clientX
    const cy = e.touches ? e.touches[0].clientY : e.clientY
    return { x: (cx - r.left) * sx, y: (cy - r.top) * sy }
  }

  function hitTest(x, y) {
    const lay  = calLayout(rc, CW, CH)
    const hmap = calHandles(lay)
    const cv = rc.enh?.curve
    if (cv?.on) {
      const g = curveGeom(lay, cal)
      for (const side of ['L', 'R']) {
        const pts = side === 'L' ? cv.L : cv.R
        for (let i = 0; i < pts.length; i++) {
          const q = curvePt(g, pts[i])
          if (Math.hypot(x - q.x, y - q.y) < 11 / zoom) return `c${side}:${i}`
        }
      }
    }
    for (const [key, h] of Object.entries(hmap)) {
      if (Math.hypot(x - h.x, y - h.y) < 11 / zoom) return key
    }
    return null
  }

    // nearest point on a curve line (for click-to-add)
  function curveNear(x, y) {
    const c = rc.enh?.curve
    if (!c?.on) return null
    const g = curveGeom(calLayout(rc, CW, CH), cal)
    let best = null, bd = 8 / zoom
    for (const side of ['L', 'R']) {
      const pts = side === 'L' ? c.L : c.R
      if (pts.length >= CURVE_MAX) continue
      const fn = makeWidthFn(pts.map(p => [p.y, p.x]))
      for (let i = 1; i < 40; i++) {
        const t = i / 40
        const d = Math.hypot(x - (g.cx + fn(t) * g.sw), y - (g.hipY + t * (g.bottomY - g.hipY)))
        if (d < bd) { bd = d; best = { side, t } }
      }
    }
    return best
  }
  const onDbl = e => {
    if (showSaved || Date.now() - insTime.current < 500) return
    const { x, y } = canvasXY(e)
    const hit = hitTest(x, y)
    if (hit && hit.startsWith('c')) removePoint(hit)
  }
  const onWheel = useCallback(e => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.12 : -0.12
    setZoom(z => Math.max(0.4, Math.min(3.0, z + delta)))
  }, [])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !open) return
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  }, [open, onWheel, fs])

  // Keyboard pan (arrow keys)
  useEffect(() => {
    if (!open) return
    const fn = e => {
      const step = 10
      if (e.key === 'ArrowLeft')  setPanX(p => p + step)
      if (e.key === 'ArrowRight') setPanX(p => p - step)
      if (e.key === 'ArrowUp')    setPanY(p => p + step)
      if (e.key === 'ArrowDown')  setPanY(p => p - step)
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [open])

  const onDown = useCallback(e => {
        if (showSaved) return
    e.preventDefault()
    const { x, y } = canvasXY(e)
    const hit = hitTest(x, y)
    if (hit) {
      dragging.current = true
            setActive(hit)
      setSelPt(hit.startsWith('c') ? hit : null)
      setDragOrigin({ x, y })
      setCalSnap({ ...cal })
    } else {
      const cn = curveNear(x, y)
      if (cn) { insertAt(cn.side, cn.t); return }
      setSelPt(null)
      // Start panning background
      setPanning(true)
      panOrigin.current = rawCanvasXY(e)
    }
    }, [cal, zoom, panX, panY, showSaved])

  const onMove = useCallback(e => {
    e.preventDefault()
    const { x, y } = canvasXY(e)

    if (panning && panOrigin.current) {
      const raw = rawCanvasXY(e)
      const dx = raw.x - panOrigin.current.x
      const dy = raw.y - panOrigin.current.y
      setPanX(p => p + dx)
      setPanY(p => p + dy)
      panOrigin.current = raw
      return
    }

    if (!dragging.current) {
      const hit = hitTest(x, y)
      setHover(hit)
      const canvas = canvasRef.current
            if (canvas) {
        canvas.style.cursor = hit
          ? (hit.startsWith('c') ? 'move' : hit === 'neckline' || hit === 'hem' || hit === 'waist' ? 'ns-resize' : 'ew-resize')
          : 'grab'
      }
      return
    }
    const dx   = x - dragOrigin.x
    const dy   = y - dragOrigin.y
    const snap = calSnapshot
        if (active && (active.startsWith('cL:') || active.startsWith('cR:'))) {
      const side = active[1], idx = +active.slice(3)
      const cv = resolveCal(snap, gown).enh.curve
      const g1 = curveGeom(calLayout(resolveCal(snap, gown), CW, CH), snap)
      const pts = side === 'L' ? cv.L : cv.R
      const nx = (x - g1.cx) / g1.sw
      let ny = (y - g1.hipY) / (g1.bottomY - g1.hipY)
      if (idx === 0) ny = 0
      else if (idx === pts.length - 1) ny = 1
      else ny = Math.max(pts[idx - 1].y + 0.03, Math.min(pts[idx + 1].y - 0.03, ny))
      const px = side === 'L' ? Math.max(-2.5, Math.min(-0.05, nx)) : Math.max(0.05, Math.min(2.5, nx))
      const upd = (arr, i, ax, ay) => arr.map((p, j) => j === i ? { y: ay, x: ax } : p)
      let L = cv.L, R = cv.R
      if (side === 'L') { L = upd(L, idx, px, ny); if (cv.link && R.length === L.length) R = upd(R, idx, -px, ny) }
      else              { R = upd(R, idx, px, ny); if (cv.link && L.length === R.length) L = upd(L, idx, -px, ny) }
      onChange({ ...snap, enhanced: { ...(snap.enhanced || {}), curveL: L, curveR: R } })
      return
    }
        const lay0 = calLayout(resolveCal(snap, gown), CW, CH)
    let next   = { ...snap }

    switch (active) {
      case 'neckline': {
        const newTop = lay0.topY + dy
        next.necklineY = Math.max(0.02, Math.min(0.55, (lay0.smY - newTop) / lay0.torsoH))
        break
      }
      case 'shoulderL': {
        const newHalfW = lay0.topW / 2 - dx
        next.shoulderPad = Math.max(0.60, Math.min(2.80, (newHalfW * 2) / lay0.swPx))
        break
      }
      case 'shoulderR': {
        const newHalfW = lay0.topW / 2 + dx
        next.shoulderPad = Math.max(0.60, Math.min(2.80, (newHalfW * 2) / lay0.swPx))
        break
      }
      case 'waist': {
        const nw = lay0.waistY + dy
        next = { ...snap, enhanced: { ...(snap.enhanced || {}), waistAt: Math.max(0.4, Math.min(0.9, (nw - lay0.smY) / lay0.torsoH)) } }
        break
      }
      case 'hem': {
        const newBot = lay0.bottomY + dy
        const fullH  = lay0.smY + lay0.torsoH * 4.8 - lay0.topY
        next.hemY = Math.max(0.35, Math.min(1.30, (newBot - lay0.topY) / fullH))
        break
      }
      case 'flareL': {
        const baseBotW = Math.max(lay0.swPx * 1.2, lay0.topW)
        const newHalfW = lay0.botW / 2 - dx
        next.skirtFlare = Math.max(0.70, Math.min(2.20, (newHalfW * 2) / baseBotW))
        break
      }
      case 'flareR': {
        const baseBotW = Math.max(lay0.swPx * 1.2, lay0.topW)
        const newHalfW = lay0.botW / 2 + dx
        next.skirtFlare = Math.max(0.70, Math.min(2.20, (newHalfW * 2) / baseBotW))
        break
      }
    }
    if (isEnh && (active === 'neckline' || active === 'shoulderL' || active === 'shoulderR')) {
      // route the drag into the enhanced values and leave the simple ones as saved
      const patch = active === 'neckline' ? { topAt: -next.necklineY } : { shoulderEase: next.shoulderPad }
      next = { ...snap, enhanced: { ...(snap.enhanced || {}), ...patch } }
    }
    onChange(next)
  }, [active, dragOrigin, calSnapshot, onChange, panning, zoom, isEnh, gown, cal])

  const onUp = useCallback(() => {
    dragging.current = false
    setActive(null)
    setDragOrigin(null)
    setCalSnap(null)
    setPanning(false)
    panOrigin.current = null
  }, [])

  const resetView = () => { setZoom(1); setPanX(0); setPanY(0) }

  const hasCustom = !!calibration
  const hasImg    = !!tryonImage

  // Full screen: same editor, rendered into #ce-fs-root under a top bar
  const hasDisplay = !!gown?.image && gown.image !== '/images/'
  const wrapFs = node => fsTarget ? createPortal(
    <div className="ce-fs" role="dialog" aria-modal="true" aria-label="Try-on calibration, full screen">
      <div className="ce-fs-bar">
        <span className="ce-fs-title">Try-on calibration{gown?.name ? ` · ${gown.name}` : ''}</span>
        <div className="ce-fs-btns">
          {hasDisplay && (
            <button type="button" className="ce-ghost" aria-pressed={showRef}
              style={showRef ? CE_ACTIVE : undefined} onClick={() => setShowRef(v => !v)}>
              {showRef ? 'Hide display picture' : 'Show display picture'}
            </button>
          )}
          <button type="button" className="ce-ghost" onClick={() => setExpanded(false)}>✕ Close (Esc)</button>
        </div>
      </div>
      <div className="ce-fs-body">
        {showRef && hasDisplay && (
          <div className="ce-fs-ref">
            <img src={gown.image} alt={`Display photo of ${gown.name || 'gown'}`} />
          </div>
        )}
        {node}
      </div>
    </div>,
    fsTarget
  ) : node

  return (
    <div className="ce-root">
      <button type="button" className="ce-toggle" onClick={() => setOpen(v => !v)}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
        </svg>
        Try-On Calibration
        {hasCustom && <span className="ce-pill">Custom</span>}
        {hasImg    && <span className="ce-pill ce-pill--blue">Live dress</span>}
        <span className="ce-chev">{open ? '▲' : '▼'}</span>
      </button>

      {open && wrapFs(
        <div className="ce-panel">
          <div className="ce-layout">

            {/* Canvas col */}
            <div className="ce-canvas-col">
              {/* View controls */}
              <div className="ce-view-bar">
                <button type="button" className="ce-vbtn" onClick={() => setZoom(z => Math.min(3, z + 0.2))} title="Zoom in">＋</button>
                <span className="ce-zoom-label">{Math.round(zoom * 100)}%</span>
                <button type="button" className="ce-vbtn" onClick={() => setZoom(z => Math.max(0.4, z - 0.2))} title="Zoom out">－</button>
                <button type="button" className="ce-vbtn ce-vbtn--sm" onClick={resetView} title="Reset view">⊹</button>
                <button type="button" className="ce-vbtn ce-vbtn--sm" onClick={() => setPanX(p => p + 20)} title="Pan left">◂</button>
                <button type="button" className="ce-vbtn ce-vbtn--sm" onClick={() => setPanX(p => p - 20)} title="Pan right">▸</button>
                <button type="button" className="ce-vbtn ce-vbtn--sm" onClick={() => setPanY(p => p + 20)} title="Pan up">▴</button>
                <button type="button" className="ce-vbtn ce-vbtn--sm" onClick={() => setPanY(p => p - 20)} title="Pan down">▾</button>
                {!fs && (
                  <button type="button" className="ce-vbtn ce-vbtn--sm" style={{ marginLeft: 'auto' }}
                    onClick={() => setExpanded(true)} title="Open the calibration full screen">⤢ Expand</button>
                )}
              </div>

              <canvas
                ref={canvasRef}
                width={Math.round(CW * RS())} height={Math.round(CH * RS())}
                className="ce-canvas"
                onMouseDown={onDown}
                onMouseMove={onMove}
                onMouseUp={onUp}
                onMouseLeave={onUp}
                onDoubleClick={onDbl}
                onTouchStart={onDown}
                onTouchMove={onMove}
                onTouchEnd={onUp}
              />
              {!hasImg && (
                <p className="ce-no-img">Upload a try-on image above to preview the real dress here</p>
              )}
              <div className="ce-legend">
                <span className="ce-dot" style={{background:'#c9a96e'}}/>Bodice
                <span className="ce-dot" style={{background:'#7ab8f5',marginLeft:8}}/>Hem / Flare
                <span className="ce-dot" style={{background:'rgba(200,169,110,0.4)',marginLeft:8}}/>Body
              </div>
            </div>

            {/* Sliders col */}
            <div className="ce-sliders">
              <p className="ce-desc">
                Drag handles on the canvas for quick alignment, or use sliders for precision.
                Scroll to zoom · drag background to pan · arrow keys to nudge view.
              </p>
                            <p className="ce-group-label">Preview body</p>
              <div className="ce-btns">
                {BODY_OPTIONS.map(o => (
                  <button key={o.id} type="button" className="ce-ghost" aria-pressed={bodyKey === o.id}
                    style={bodyKey === o.id ? CE_ACTIVE : undefined} onClick={() => setBodyKey(o.id)}>
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="ce-row-hint">Check that the fit holds across body types. Preview only; nothing here is saved.</p>
              <div className="ce-btns">
                <button type="button" className="ce-ghost" aria-pressed={showSaved} disabled={!savedCalibration}
                  style={showSaved ? CE_ACTIVE : undefined} onClick={() => setShowSaved(v => !v)}>
                  {!savedCalibration ? 'No saved calibration to compare' : showSaved ? 'Showing saved (editing paused)' : 'Compare with saved'}
                </button>
              </div>
                            <label style={{display:'flex',alignItems:'center',gap:7,fontSize:11,color:'var(--c-muted)',cursor:'pointer'}}>
                <input type="checkbox" checked={skelTop} onChange={e => setSkelTop(e.target.checked)} style={{accentColor:'#c9a96e'}}/>
                Show skeleton over dress
              </label>
              <p className="ce-group-label">Mode</p>
              <div className="ce-btns">
                {['simple', 'enhanced'].map(m => {
                  const on = (isEnh ? 'enhanced' : 'simple') === m
                  return (
                    <button key={m} type="button" className="ce-ghost" aria-pressed={on} onClick={() => setMode(m)}
                      style={on ? { background:'rgba(200,169,110,.18)', color:'#c9a96e', borderColor:'rgba(200,169,110,.45)' } : undefined}>
                      {m === 'simple' ? 'Simple' : 'Enhanced'}
                    </button>
                  )
                })}
              </div>
              {isEnh && (
                <>
                  <p className="ce-desc">Pick the neckline and sleeves for starting values, then fine-tune. Switching back to Simple keeps these values.</p>
                  <div className="form-grid-2">
                    <select aria-label="Neckline" className="field-input" value={rc.enh.neckline} onChange={e => setEnh('neckline', e.target.value)}>
                      {NECKLINES.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                    </select>
                    <select aria-label="Sleeves" className="field-input" value={rc.enh.sleeves} onChange={e => setEnh('sleeves', e.target.value)}>
                      {SLEEVES.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                    </select>
                  </div>
                  {[
                    { key:'topAt',        label:'Top edge',     min:-0.4, max:0.4, step:0.01, v:-rc.necklineY,  hint:'Where the top edge sits against the shoulders. Higher = toward the neck.' },
                    { key:'shoulderEase', label:'Top width',    min:0.8,  max:2.0, step:0.01, v:rc.shoulderPad, hint:'Width of the top edge relative to the shoulder span.' },
                    { key:'seamL',        label:'Left sleeve',  min:0,    max:0.4, step:0.01, v:rc.enh.seamL,   hint:'How much of the left side is sleeve.' },
                    { key:'seamR',        label:'Right sleeve', min:0,    max:0.4, step:0.01, v:rc.enh.seamR,   hint:'How much of the right side is sleeve.' },
                  ].map(s => (
                    <div key={s.key} className="ce-row">
                      <div className="ce-row-head">
                        <span className="ce-row-label">{s.label}</span>
                        <span className="ce-row-val">{Number(s.v).toFixed(2)}</span>
                      </div>
                      <input type="range" min={s.min} max={s.max} step={s.step} value={s.v}
                        onChange={e => setEnh(s.key, parseFloat(e.target.value))} className="ce-range"/>
                      <p className="ce-row-hint">{s.hint}</p>
                    </div>
                  ))}
                  {tryonImage && (
                    <SeamPreview src={tryonImage} cal={cal} rc={rc}
                      onSeam={(side, v) => setEnh(side === 'L' ? 'seamL' : 'seamR', v)}
                      onGeo={setEnh}
                      onWaistRow={v => onChange({ ...cal, waistRow: v })} />
                  )}
                                    {GEO_GROUPS.map(g => (
                    <div key={g.id} style={{display:'flex',flexDirection:'column',gap:13}}>
                      <p className="ce-group-label" style={{marginTop:6}}>{g.title}</p>
                      {g.fields.map(f => {
                        const byCurve = rc.enh.curve.on && CURVE_OVERRIDES.includes(f.k)
                        return (
                          <div key={f.k} className="ce-row" style={byCurve ? { opacity: .4 } : undefined}>
                            <div className="ce-row-head">
                              <span className="ce-row-label">{f.label}</span>
                              <span className="ce-row-val">{Number(rc.enh.geo[f.k]).toFixed(2)}</span>
                            </div>
                            <input type="range" min={f.min} max={f.max} step={f.step} value={rc.enh.geo[f.k]} disabled={byCurve}
                              onChange={e => setEnh(f.k, parseFloat(e.target.value))} className="ce-range"/>
                            <p className="ce-row-hint">{byCurve ? 'Controlled by the skirt curves.' : f.hint}</p>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                                    <p className="ce-group-label" style={{marginTop:6}}>Skirt curves</p>
                  <label style={{display:'flex',alignItems:'center',gap:7,fontSize:11,color:'var(--c-muted)',cursor:'pointer'}}>
                    <input type="checkbox" checked={rc.enh.curve.on} disabled={showSaved}
                      onChange={e => toggleCurve(e.target.checked)} style={{accentColor:'#c9a96e'}}/>
                    Use custom skirt curves
                  </label>
                  {rc.enh.curve.on ? (
                    <>
                      <p className="ce-row-hint">Drag the teal points. Squares (hip / hem) move sideways only. Click a curve to add a point, double-click a point or press Delete to remove it. Hip, hem and skirt width sliders are replaced by the curves.</p>
                      <label style={{display:'flex',alignItems:'center',gap:7,fontSize:11,color:'var(--c-muted)',cursor:'pointer'}}>
                        <input type="checkbox" checked={rc.enh.curve.link} onChange={e => setLink(e.target.checked)} style={{accentColor:'#c9a96e'}}/>
                        Link both sides (mirror)
                      </label>
                      <div className="ce-btns">
                        <button type="button" className="ce-ghost" onClick={addPointAuto}
                          disabled={rc.enh.curve.L.length >= CURVE_MAX || rc.enh.curve.R.length >= CURVE_MAX}>Add point</button>
                        <button type="button" className="ce-ghost" onClick={resetCurves}>Reset curves</button>
                      </div>
                      <p className="ce-row-hint">{rc.enh.curve.L.length} left · {rc.enh.curve.R.length} right (min {CURVE_MIN}, max {CURVE_MAX})</p>
                    </>
                  ) : (
                    <p className="ce-row-hint">Off: the skirt uses the hip / skirt / hem width sliders. Turning it on starts from the current shape, and turning it off keeps your points.</p>
                  )}
                  <p className="ce-group-label" style={{marginTop:6}}>Advanced</p>
                  {ADV_FIELDS.map(f => (
                    <div key={f.k} className="ce-row">
                      <div className="ce-row-head">
                        <span className="ce-row-label">{f.label}</span>
                        <span className="ce-row-val">{Number(rc.enh.adv[f.k]).toFixed(2)}</span>
                      </div>
                      <input type="range" min={f.min} max={f.max} step={f.step} value={rc.enh.adv[f.k]}
                        onChange={e => setEnh(f.k, parseFloat(e.target.value))} className="ce-range"/>
                      <p className="ce-row-hint">{f.hint}</p>
                    </div>
                  ))}
                  <button type="button" className="ce-ghost"
                    onClick={() => onChange({ ...cal, enhanced: Object.fromEntries(Object.entries(cal.enhanced || {}).filter(([k]) => !ADV_FIELDS.some(f => f.k === k))) })}>
                    Reset advanced
                  </button>
                  <button type="button" className="ce-ghost"
                    onClick={() => onChange({ ...cal, enhanced: { neckline: rc.enh.neckline, sleeves: rc.enh.sleeves } })}>
                    Reset to tag defaults
                  </button>
                </>
              )}
              <p className="ce-group-label">Shape</p>
              {[
                { key:'necklineY',   label:'Neckline offset', min:0.02, max:0.55, step:0.01,
                  hint:'How far above the shoulder the dress top starts.' },
                { key:'shoulderPad', label:'Shoulder width',  min:0.60, max:2.80, step:0.05,
                  hint:'Bodice width relative to detected shoulder span.' },
                { key:'skirtFlare',  label:'Skirt flare',     min:0.70, max:2.20, step:0.05,
                  hint:'How wide the hem is compared to the bodice.' },
                { key:'hemY',        label:'Hem length',       min:0.35, max:1.30, step:0.01,
                  hint:'Override hem position. Drag the blue ↕ handle or use slider.', isHem:true },
              ].map(s => {
                                if (isEnh && (s.key === 'necklineY' || s.key === 'shoulderPad' || s.key === 'skirtFlare')) return null
                const raw = cal[s.key]
                const val = s.isHem ? (raw ?? 1.0) : raw
                const display = raw == null && s.isHem ? 'auto' : Number(val).toFixed(2)
                return (
                  <div key={s.key} className="ce-row">
                    <div className="ce-row-head">
                      <span className="ce-row-label">{s.label}</span>
                      <span className="ce-row-val">{display}</span>
                    </div>
                    <input type="range" min={s.min} max={s.max} step={s.step}
                      value={val}
                      onChange={e => onChange({ ...cal, [s.key]: parseFloat(e.target.value) })}
                      className="ce-range"
                    />
                    <p className="ce-row-hint">{s.hint}</p>
                  </div>
                )
              })}

              <p className="ce-group-label" style={{marginTop:6}}>Position &amp; Scale</p>
              {[
                { key:'offsetX', label:'Shift left / right', min:-80, max:80,  step:1,   hint:'Move dress horizontally over the body.',    unit:'px' },
                { key:'offsetY', label:'Shift up / down',    min:-80, max:80,  step:1,   hint:'Move dress vertically over the body.',      unit:'px' },
                { key:'scaleX',  label:'Horizontal stretch', min:0.5, max:2.0, step:0.02, hint:'Stretch or compress the dress width.',      unit:'×' },
                { key:'scaleY',  label:'Vertical stretch',   min:0.5, max:2.0, step:0.02, hint:'Stretch or compress the dress height.',     unit:'×' },
              ].map(s => {
                const val = cal[s.key] ?? (s.key.startsWith('scale') ? 1.0 : 0)
                const display = s.unit === 'px' ? `${val > 0 ? '+' : ''}${val}px` : `${Number(val).toFixed(2)}×`
                return (
                  <div key={s.key} className="ce-row">
                    <div className="ce-row-head">
                      <span className="ce-row-label">{s.label}</span>
                      <span className="ce-row-val">{display}</span>
                    </div>
                    <input type="range" min={s.min} max={s.max} step={s.step}
                      value={val}
                      onChange={e => onChange({ ...cal, [s.key]: parseFloat(e.target.value) })}
                      className="ce-range"
                    />
                    <p className="ce-row-hint">{s.hint}</p>
                  </div>
                )
              })}

              <p className="ce-group-label" style={{marginTop:6}}>Body fit (warp)</p>
              {[
                { key:'waistRow',  label:'Waist position', min:0.02, max:0.90, step:0.01, def:0.30, auto:true,
                  hint:'Where the bodice pinches, as a fraction of the dress image height. Auto finds the narrowest point; set it by hand for A-line gowns.' },
                { key:'waistEase', label:'Waist ease', min:0.80, max:1.40, step:0.01, def:1.05,
                  hint:'Bodice width at the waist. Raise it if the bodice looks too tight.' },
                { key:'hipEase',   label:'Hip ease',   min:0.80, max:1.40, step:0.01, def:1.10,
                  hint:'Dress width at the hips. Raise it if the dress looks too tight.' },
              ].map(s => {
                const raw = calibration?.[s.key]
                const val = raw ?? s.def
                return (
                  <div key={s.key} className="ce-row">
                    <div className="ce-row-head">
                      <span className="ce-row-label">{s.label}</span>
                      <span className="ce-row-val">{raw == null && s.auto ? 'auto' : Number(val).toFixed(2)}</span>
                    </div>
                    <input type="range" min={s.min} max={s.max} step={s.step} value={val}
                      onChange={e => onChange({ ...cal, [s.key]: parseFloat(e.target.value) })}
                      className="ce-range"/>
                    <p className="ce-row-hint">{s.hint}</p>
                  </div>
                )
              })}
              {cal.waistRow != null && (
                <button type="button" className="ce-ghost" onClick={() => onChange({ ...cal, waistRow: null })}>Auto waist</button>
              )}

              <div className="ce-btns">
                <button type="button" className="ce-ghost" onClick={() => onChange(null)}>
                  Reset defaults
                </button>
                {cal.hemY != null && (
                  <button type="button" className="ce-ghost" onClick={() => onChange({ ...cal, hemY: null })}>
                    Auto hem
                  </button>
                )}
                <button type="button" className="ce-ghost" onClick={() => onChange({ ...cal, offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 })}>
                  Reset position
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Toast
───────────────────────────────────────────── */
function Toast({ message, type='success', onDone }) {
  useEffect(()=>{ const t=setTimeout(onDone,2800); return()=>clearTimeout(t) },[onDone])
  return(
    <div className={`toast toast--${type}`} role="status">
      {type==='success'
        ?<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        :<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      }
      {message}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Confirm Modal
───────────────────────────────────────────── */
function ConfirmModal({ title, message, detail, confirmLabel='Confirm', danger=false, onConfirm, onClose }) {
  useEffect(()=>{ const fn=e=>{if(e.key==='Escape')onClose()}; window.addEventListener('keydown',fn); return()=>window.removeEventListener('keydown',fn) },[onClose])
  return(
    <div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
      <div className="modal-box" style={{maxWidth:400}}>
        <div className="modal-header"><span className="modal-title">{title}</span><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <p className="modal-msg">{message}</p>
          {detail&&<div className="confirm-detail">{detail}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className={danger?'btn-danger':'btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Product Detail Modal (View)
───────────────────────────────────────────── */
function ProductDetailModal({ gown, onClose, onEdit }) {
  useEffect(()=>{ const fn=e=>{if(e.key==='Escape')onClose()}; window.addEventListener('keydown',fn); return()=>window.removeEventListener('keydown',fn) },[onClose])
  const inv=gown.inventory||[]
  const totalAvailable=inv.reduce((s,i)=>s+Math.max(0,(i.stock||0)-(i.reserved||0)),0)
  return(
    <div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
      <div className="modal-box modal-box--wide">
        <div className="modal-header">
          <span className="modal-title">{gown.name}</span>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button className="btn-sm" onClick={()=>{onClose();onEdit(gown)}}>Edit</button>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="modal-body">
          <div className="detail-layout">
            <div className="detail-images">
              {gown.image&&gown.image!=='/images/'&&<img src={gown.image} alt={gown.alt||gown.name} className="detail-main-img"/>}
              <div className="detail-thumb-row">
                {gown.tryonImage&&<div className="detail-thumb-wrap"><img src={gown.tryonImage} alt="Front try-on" className="detail-thumb"/><span className="detail-thumb-label">Front</span></div>}
                {gown.tryonImageBack&&<div className="detail-thumb-wrap"><img src={gown.tryonImageBack} alt="Back try-on" className="detail-thumb"/><span className="detail-thumb-label">Back</span></div>}
              </div>
            </div>
            <div className="detail-info">
              <div className="detail-price">{gown.price}</div>
              <div className="detail-badges">
                {gown.type&&<span className="badge badge--neutral">{gown.type}</span>}
                {gown.segment&&gown.segment!=='women'&&<span className="badge badge--blue">{gown.segment}</span>}
                {gown.silhouette&&<span className="badge badge--neutral">{gown.silhouette}</span>}
                {gown.color&&<span className="badge badge--neutral">{gown.color}</span>}
              </div>
              <div className="detail-attrs">
                {gown.fabric&&<div className="detail-attr"><span className="detail-attr-key">Fabric</span><span>{gown.fabric}</span></div>}
                {gown.neckline&&<div className="detail-attr"><span className="detail-attr-key">Neckline</span><span>{gown.neckline}</span></div>}
                {gown.alt&&<div className="detail-attr"><span className="detail-attr-key">Alt text</span><span>{gown.alt}</span></div>}
              </div>
              {gown.description&&<p className="detail-desc">{gown.description}</p>}
              {inv.length>0&&(
                <div className="detail-inventory">
                  <p className="detail-section-label">Inventory — {totalAvailable} units available</p>
                  <div className="detail-inv-grid">
                    {inv.map(i=>{const avail=Math.max(0,(i.stock||0)-(i.reserved||0)); return(
                      <div key={i.size} className={`detail-inv-chip${avail<=0?' out':avail<=2?' low':''}`}>
                        <span className="detail-inv-size">{i.size}</span>
                        <span className="detail-inv-qty">{avail<=0?'Sold out':`${avail} left`}</span>
                        {(i.reserved||0)>0&&<span className="detail-inv-res">{i.reserved} reserved</span>}
                      </div>
                    )})}
                  </div>
                </div>
              )}
              <div className="detail-links">
                <Link href={`/gowns/${gown.id}`} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm">Open product page ↗</Link>
                {gown.tryonImage
                  ? <Link href={`/fitting-room?gown=${gown.id}`} target="_blank" rel="noopener noreferrer" className="btn-info btn-sm">Virtual try-on ↗</Link>
                  : <span className="btn-sm btn-sm--disabled" title="No try-on image set">Virtual try-on ↗</span>
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Stock Dropdown
───────────────────────────────────────────── */
function StockDropdown({ gown, onSave }) {
  const [open, setOpen]           = useState(false)
  const [inventory, setInventory] = useState([])
  const [saving, setSaving]       = useState(false)
  const [err, setErr]             = useState('')
  const wrapRef = useRef(null)

  const segmentPresets = PRESET_SIZES_BY_SEGMENT[gown.segment ?? 'women'] ?? PRESET_SIZES_BY_SEGMENT.women

  useEffect(() => {
    if (open) setInventory(JSON.parse(JSON.stringify(gown.inventory || [])))
  }, [open, gown])

  useEffect(() => {
    if (!open) return
    const fn = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

  useEffect(() => {
    if (!open) return
    const fn = e => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [open])

  const handleAdd = (size) => {
    if (inventory.some(i => i.size === size)) { setErr(`Size "${size}" already exists`); return }
    setInventory(p => [...p, { size, stock: 1 }])
    setErr('')
  }

  const handleSave = async () => {
    setSaving(true); setErr('')
    try {
      await onSave(gown.id, inventory)
      setOpen(false)
    } catch(e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stock-dropdown-wrap" ref={wrapRef}>
      <button className="btn-sm btn-stock" onClick={() => setOpen(v => !v)} title="Manage stock">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
        Stock
        <span style={{fontSize:9,opacity:.55,marginLeft:1}}>{open?'▲':'▼'}</span>
      </button>

      {open && (
        <div className="stock-dropdown-panel">
          <div className="stock-dropdown-header">
            <span className="stock-dropdown-title">{gown.name}</span>
            <button className="modal-close" style={{fontSize:16,lineHeight:1}} onClick={() => setOpen(false)}>×</button>
          </div>

          {inventory.length > 0 && (
            <div className="stock-table">
              <div className="stock-header">
                <span>Size</span><span>Stock</span><span>Res.</span><span>Avail</span><span/>
              </div>
              {inventory.map(inv => {
                const avail = Math.max(0, (inv.stock || 0) - (inv.reserved || 0))
                return (
                  <div key={inv.size} className="stock-row">
                    <span className="stock-size">{inv.size}</span>
                    <input type="number" min="0" value={inv.stock} className="stock-input"
                      onChange={e => setInventory(p => p.map(i =>
                        i.size === inv.size ? { ...i, stock: Math.max(0, parseInt(e.target.value) || 0) } : i
                      ))}
                    />
                    <span className="stock-res">{inv.reserved || 0}</span>
                    <span className={`stock-avail${avail <= 0 ? ' out' : avail <= 2 ? ' low' : ''}`}>
                      {avail <= 0 ? 'Out' : avail}
                    </span>
                    <button className="stock-remove" onClick={() => setInventory(p => p.filter(i => i.size !== inv.size))}>×</button>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{marginTop: inventory.length ? 10 : 0}}>
            <p className="sp-section-label">Add size</p>
            <SizePicker inventory={inventory} onAdd={handleAdd} error={err} onClearErr={() => setErr('')} presets={segmentPresets}/>
          </div>

          {inventory.length === 0 && !err && (
            <p className="field-hint" style={{margin:'6px 0 0'}}>No sizes yet. Select one above.</p>
          )}

          <div className="stock-dropdown-footer">
            <button className="btn-ghost" style={{padding:'6px 12px',fontSize:12}} onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" style={{padding:'6px 14px',fontSize:12}} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Form Sidebar / Drawer
───────────────────────────────────────────── */
function GownFormSidebar({ open, editingGown, onClose, onSaved, showToast }) {
  const [form,setForm]                           = useState(emptyGown)
  const [inventory,setInventory]                 = useState([])
  const [saving,setSaving]                       = useState(false)
  const [formError,setFormError]                 = useState('')
  const [imgError,setImgError]                   = useState(false)
  const [tryonImgError,setTryonImgError]         = useState(false)
  const [tryonBackImgError,setTryonBackImgError] = useState(false)
  const [bgRemoverSrc,setBgRemoverSrc]           = useState(null)
  const [bgRemoverTarget,setBgRemoverTarget]     = useState('front')
    const [matteTarget,setMatteTarget]             = useState(null)   // 'front' | 'back' | null
  const [confirm,setConfirm]                     = useState(null)
  const isEdit = !!editingGown

  const segmentPresets = PRESET_SIZES_BY_SEGMENT[form.segment] ?? PRESET_SIZES_BY_SEGMENT.women

  useEffect(()=>{
    if(editingGown){
      const raw=String(editingGown.price||'').replace(/[^\d]/g,'')
      setForm({
        name:             editingGown.name||'',
        price:            '₱'+(raw?Number(raw).toLocaleString('en-PH'):''),
        image:            editingGown.image||'/images/',
        alt:              editingGown.alt||'',
        tryonImage:       editingGown.tryonImage||'',
        tryonImageBack:   editingGown.tryonImageBack||'',
        tryonCalibration: editingGown.tryonCalibration||null,
        type:             editingGown.type||'Gowns',
        segment:          editingGown.segment||'women',
        color:            editingGown.color||'',
        silhouette:       editingGown.silhouette||'',
        fabric:           editingGown.fabric||'',
        neckline:         editingGown.neckline||'',
        description:      editingGown.description||'',
      })
      setInventory(editingGown.inventory||[])
    } else {
      setForm(emptyGown); setInventory([])
    }
    setFormError(''); setImgError(false); setTryonImgError(false); setTryonBackImgError(false)
  },[editingGown, open])

  const handleChange=e=>{
    const{name,value}=e.target; setForm(p=>({...p,[name]:value})); setFormError('')
    if(name==='image')setImgError(false)
    if(name==='tryonImage')setTryonImgError(false)
    if(name==='tryonImageBack')setTryonBackImgError(false)
  }
  const handlePriceChange=e=>{
    const raw=e.target.value.replace(/[^\d]/g,'')
    setForm(p=>({...p,price:'₱'+(raw?Number(raw).toLocaleString('en-PH'):'')})); setFormError('')
  }

  const handleSubmit=e=>{
    e.preventDefault(); setFormError('')
    if(!form.name.trim()){setFormError('Name is required.');return}
    if(!form.price.trim()||form.price==='₱'||numericPrice(form.price)===0){setFormError('Price is required.');return}
    if(!form.image.trim()){setFormError('Image path is required.');return}
    const segmentLabel = SEGMENTS.find(s=>s.id===form.segment)?.label || form.segment
    const detail=isEdit?(
      <div>
        <div className="confirm-row"><span>Name</span><span>{form.name}</span></div>
        <div className="confirm-row"><span>Price</span><span>{form.price}</span></div>
        <div className="confirm-row"><span>Type</span><span>{form.type}</span></div>
        <div className="confirm-row"><span>Segment</span><span>{segmentLabel}</span></div>
        {form.color&&<div className="confirm-row"><span>Color</span><span>{form.color}</span></div>}
        {form.silhouette&&<div className="confirm-row"><span>Silhouette</span><span>{form.silhouette}</span></div>}
        {inventory.length>0&&<div className="confirm-row"><span>Sizes</span><span>{inventory.map(i=>i.size).join(', ')}</span></div>}
      </div>
    ):null
    setConfirm({
      title:isEdit?'Save changes?':'Add new gown?',
      message:isEdit?`Review the changes to "${form.name}" below:`:`Add "${form.name}" to the collection?`,
      detail,
      confirmLabel:isEdit?'Save changes':'Add gown',
      danger:false,
      onConfirm:()=>doSubmit(),
    })
  }

  const doSubmit=async()=>{
    setConfirm(null); setSaving(true)
    try{
      const method=isEdit?'PUT':'POST'
      const payload=isEdit?{...form,id:editingGown.id,inventory}:{...form,inventory}
      const res=await adminFetch('/api/admin/gowns',{method,headers:headers(),body:JSON.stringify(payload)})
      const data=await res.json()
      if(!res.ok)throw new Error(data.error||'Failed to save')
      onSaved(data.gown, isEdit)
      showToast(isEdit?`"${data.gown.name}" updated`:`"${data.gown.name}" added`)
      if(!isEdit){setForm(emptyGown);setInventory([])}
    }catch(e){setFormError(e.message);showToast(e.message,'error')}
    finally{setSaving(false)}
  }

  return(
    <>
      {bgRemoverSrc&&(
        <BgRemover
          src={bgRemoverSrc}
          onDone={path=>{
            if(bgRemoverTarget==='back'){setForm(p=>({...p,tryonImageBack:path}));setTryonBackImgError(false)}
            else{setForm(p=>({...p,tryonImage:path}));setTryonImgError(false)}
            setBgRemoverSrc(null); showToast('Background removed')
          }}
          onClose={()=>setBgRemoverSrc(null)}
        />
      )}
      {confirm&&<ConfirmModal {...confirm} onClose={()=>setConfirm(null)}/>}

            {matteTarget&&(
        <AutoMatteModal
          displayImage={form.image}
          onDone={path=>{
            if(matteTarget==='back'){setForm(p=>({...p,tryonImageBack:path}));setTryonBackImgError(false)}
            else{setForm(p=>({...p,tryonImage:path}));setTryonImgError(false)}
            setMatteTarget(null); showToast('Cut-out saved as try-on image')
          }}
          onClose={()=>setMatteTarget(null)}
        />
      )}

      <div id="ce-fs-root"/>
      <aside className={`sidebar${open?' sidebar--open':''}`}>
        <div className="sidebar-header">
          <div>
            <p className="sidebar-title">{isEdit?'Edit Gown':'Add New Gown'}</p>
            {isEdit&&<p className="sidebar-subtitle">{editingGown?.name}</p>}
          </div>
          <button className="modal-close" onClick={onClose} style={{fontSize:22,lineHeight:1}}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="sidebar-body">
          <div className="form-section">
            <p className="form-section-label">Basic Info</p>
            <div className="form-grid-2">
              <div className="form-field">
                <label className="field-label">Name <span className="req">*</span></label>
                <input name="name" value={form.name} onChange={handleChange} placeholder="e.g. The Isabella" className="field-input"/>
              </div>
              <div className="form-field">
                <label className="field-label">Price <span className="req">*</span></label>
                <input name="price" type="text" inputMode="numeric" value={form.price} onChange={handlePriceChange}
                  onKeyDown={e=>{if(form.price==='₱'&&(e.key==='Backspace'||e.key==='Delete'))e.preventDefault()}}
                  placeholder="₱65,000" className="field-input"/>
              </div>
              <div className="form-field">
                <label className="field-label">Type</label>
                <select name="type" value={form.type} onChange={handleChange} className="field-input">
                  {TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="field-label">Segment</label>
                <select name="segment" value={form.segment} onChange={handleChange} className="field-input">
                  {SEGMENTS.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="field-label">Color</label>
                <input name="color" value={form.color} onChange={handleChange} placeholder="e.g. Ivory" className="field-input"/>
              </div>
              <div className="form-field">
                <label className="field-label">Silhouette</label>
                <input name="silhouette" value={form.silhouette} onChange={handleChange} placeholder="e.g. A-line" className="field-input"/>
              </div>
              <div className="form-field">
                <label className="field-label">Fabric</label>
                <input name="fabric" value={form.fabric} onChange={handleChange} placeholder="e.g. Satin" className="field-input"/>
              </div>
              <div className="form-field">
                <label className="field-label">Neckline</label>
                <input name="neckline" value={form.neckline} onChange={handleChange} placeholder="e.g. V-neck" className="field-input"/>
              </div>
              <div className="form-field">
                <label className="field-label">Alt text</label>
                <input name="alt" value={form.alt} onChange={handleChange} placeholder="Short image description" className="field-input"/>
              </div>
            </div>
            <div className="form-field" style={{marginTop:10}}>
              <label className="field-label">Description</label>
              <textarea name="description" value={form.description} onChange={handleChange} rows={3} placeholder="Product description…" className="field-input"/>
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-label">Images</p>
            <div className="form-images-grid">
              <ImageUploader
                label="Display image"
                badge={<span className="badge badge--neutral">Catalog</span>}
                hint="Shown in catalog & product pages. Not used for try-on."
                value={form.image}
                onChange={v=>{setForm(p=>({...p,image:v}));setImgError(false)}}
                onError={()=>setImgError(true)}
                error={imgError}
              />
              <div>
                <ImageUploader
                  label="Try-on — front"
                  badge={<span className="badge badge--gold">Front</span>}
                  hint="Transparent PNG, front view. Upload separately from display image."
                  value={form.tryonImage}
                  onChange={v=>{setForm(p=>({...p,tryonImage:v}));setTryonImgError(false)}}
                  onError={()=>setTryonImgError(true)}
                  error={tryonImgError}
                />
                <button type="button" className="btn-ghost btn-xs" style={{marginTop:5,width:'100%'}}
                  disabled={!form.tryonImage}
                  onClick={()=>{ setBgRemoverTarget('front'); setBgRemoverSrc(form.tryonImage) }}>
                  ✂ Remove background…
                </button>
                <button type="button" className="btn-ghost btn-xs" style={{marginTop:5,width:'100%'}}
                  onClick={()=>setMatteTarget('front')}>
                  ✨ Auto cut-out…
                </button>
                <button type="button" className="btn-ghost btn-xs" style={{marginTop:5,width:'100%'}}
                  disabled={!form.tryonImage}
                  onClick={async()=>{ try{ const u=await tightCropUpload(form.tryonImage); setForm(p=>({...p,tryonImage:u})); setTryonImgError(false); showToast('Tight-cropped') }catch(e){ showToast(e.message,'error') } }}>
                  ⛶ Tight crop
                </button>
              </div>
              <div>
                <ImageUploader
                  label="Try-on — back"
                  badge={<span className="badge badge--blue">Back</span>}
                  hint="Back view, transparent PNG."
                  value={form.tryonImageBack||''}
                  onChange={v=>{setForm(p=>({...p,tryonImageBack:v}));setTryonBackImgError(false)}}
                  onError={()=>setTryonBackImgError(true)}
                  error={tryonBackImgError}
                />
                <button type="button" className="btn-ghost btn-xs" style={{marginTop:5,width:'100%'}}
                  disabled={!form.tryonImageBack}
                  onClick={()=>{ setBgRemoverTarget('back'); setBgRemoverSrc(form.tryonImageBack) }}>
                  ✂ Remove background…
                </button>
                <button type="button" className="btn-ghost btn-xs" style={{marginTop:5,width:'100%'}}
                  onClick={()=>setMatteTarget('back')}>
                  ✨ Auto cut-out…
                </button>
                <button type="button" className="btn-ghost btn-xs" style={{marginTop:5,width:'100%'}}
                  disabled={!form.tryonImageBack}
                  onClick={async()=>{ try{ const u=await tightCropUpload(form.tryonImageBack); setForm(p=>({...p,tryonImageBack:u})); setTryonBackImgError(false); showToast('Tight-cropped') }catch(e){ showToast(e.message,'error') } }}>
                  ⛶ Tight crop
                </button>
              </div>
            </div>
            {/* CalibrationEditor v2 — receives tryonImage for live dress preview */}
            <CalibrationEditor
              calibration={form.tryonCalibration}
              onChange={cal=>setForm(p=>({...p,tryonCalibration:cal}))}
                            tryonImage={form.tryonImage}
                            gown={form}
              savedCalibration={editingGown?.tryonCalibration||null}
            />
          </div>

          <div className="form-section">
            <p className="form-section-label">Inventory</p>
            <InlineInventoryEditor inventory={inventory} onChange={setInventory} segmentPresets={segmentPresets}/>
          </div>

          {formError&&<p className="field-error" style={{margin:'0 0 12px'}}>{formError}</p>}

          <div className="sidebar-footer">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving?'Saving…':isEdit?'Update gown':'Add gown'}</button>
          </div>
        </form>
      </aside>
    </>
  )
}

/* ─────────────────────────────────────────────
   Inline Inventory Editor
───────────────────────────────────────────── */
function InlineInventoryEditor({ inventory, onChange, segmentPresets }) {
  const [err, setErr] = useState('')

  const handleAdd = (size) => {
    if (inventory.some(i => i.size === size)) { setErr(`Size "${size}" already added.`); return }
    onChange([...inventory, { size, stock: 1 }])
    setErr('')
  }

  return (
    <div className="inv-editor">
      {inventory.length > 0 && (
        <div className="stock-table" style={{marginBottom:12}}>
          <div className="stock-header">
            <span>Size</span><span>Stock</span><span>Reserved</span><span>Avail</span><span/>
          </div>
          {inventory.map(inv => {
            const avail = Math.max(0, (inv.stock||0) - (inv.reserved||0))
            return (
              <div key={inv.size} className="stock-row">
                <span className="stock-size">{inv.size}</span>
                <input type="number" min="0" value={inv.stock} className="stock-input"
                  onChange={e => onChange(inventory.map(i =>
                    i.size === inv.size ? { ...i, stock: Math.max(0, parseInt(e.target.value)||0) } : i
                  ))}
                />
                <span className="stock-res">{inv.reserved||0}</span>
                <span className={`stock-avail${avail<=0?' out':avail<=2?' low':''}`}>
                  {avail<=0 ? 'Out' : avail}
                </span>
                <button type="button" className="stock-remove"
                  onClick={() => onChange(inventory.filter(i => i.size !== inv.size))}>×</button>
              </div>
            )
          })}
        </div>
      )}
      <p className="sp-section-label" style={{marginBottom:6}}>
        {inventory.length === 0 ? 'Select sizes to add' : 'Add another size'}
      </p>
      <SizePicker inventory={inventory} onAdd={handleAdd} error={err} onClearErr={() => setErr('')} presets={segmentPresets}/>
      {inventory.length === 0 && (
        <p className="field-hint" style={{marginTop:8}}>Add at least one size and set its stock quantity above.</p>
      )}
    </div>
  )
}
/* ─────────────────────────────────────────────
   Try-on image status (transparent corners = fast GL path in the fitting room)
───────────────────────────────────────────── */
const alphaCache = new Map()          // url -> 'ok' | 'opaque' | 'error'
const alphaQueue = []
let alphaActive = 0

async function runAlphaCheck(url) {
  let obj = null
  try {
    const safe = await toSafeUrl(url)
    if (safe !== url) obj = safe
    const img = await new Promise((res, rej) => {
      const im = new Image()
      im.onload = () => res(im); im.onerror = rej; im.src = safe
    })
    return getProfile(img) ? 'ok' : 'opaque'     // same test the renderer uses
  } catch { return 'error' }
  finally { if (obj) URL.revokeObjectURL(obj) }
}
function pumpAlpha() {
  while (alphaActive < 2 && alphaQueue.length) {
    const { url, resolve } = alphaQueue.shift()
    alphaActive++
    runAlphaCheck(url)
      .then(r => { alphaCache.set(url, r); resolve(r) })
      .finally(() => { alphaActive--; pumpAlpha() })
  }
}
function checkAlpha(url) {
  if (alphaCache.has(url)) return Promise.resolve(alphaCache.get(url))
  return new Promise(resolve => { alphaQueue.push({ url, resolve }); pumpAlpha() })
}
function useTryonStatus(url) {
  const ref = useRef(null)
  const [st, setSt] = useState(url ? (alphaCache.get(url) || null) : null)
  useEffect(() => {
    if (!url) { setSt(null); return }
    if (alphaCache.has(url)) { setSt(alphaCache.get(url)); return }
    let cancelled = false
    const go = () => checkAlpha(url).then(r => { if (!cancelled) setSt(r) })
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { go(); return () => { cancelled = true } }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go() } })
    io.observe(el)
    return () => { cancelled = true; io.disconnect() }
  }, [url])
  return [ref, st]
}
/* ─────────────────────────────────────────────
   Gown Card
───────────────────────────────────────────── */
function GownCard({ g, onEdit, onView, onSaveStock, onArchive, onPermanentDelete, archived=false }) {
  const inv=g.inventory||[]
  const avail=inv.reduce((s,i)=>s+Math.max(0,(i.stock||0)-(i.reserved||0)),0)
  const outSizes=inv.filter(i=>(i.stock-(i.reserved||0))<=0)
  const lowSizes=inv.filter(i=>{const a=i.stock-(i.reserved||0);return a>0&&a<=2})
  const segmentLabel = SEGMENTS.find(s=>s.id===g.segment)?.label
    const [tryRef, tryStatus] = useTryonStatus(archived ? '' : g.tryonImage)
  return(
    <div className={`gown-card${archived?' gown-card--archived':''}`}>
            <div className="gown-card-img" ref={tryRef}>
        <img src={g.image} alt={g.alt||g.name} onError={e=>{e.target.style.display='none'}}/>
        {g.tryonImage&&<div className="vto-badge">VTO</div>}
        {g.tryonImageBack&&<div className="vto-badge vto-badge--back">↩</div>}
      </div>
      <div className="gown-card-body">
        <div className="gown-card-name">
          {g.name}
          {archived&&<span className="badge badge--warning">Archived</span>}
                    {tryStatus==='opaque'&&<span className="badge badge--warning" title="This try-on image has no transparent background, so the fitting room draws it the slow, low-quality way. Open the gown and use Auto cut-out.">Needs cut-out</span>}
          {g.tryonCalibration&&<span className="badge badge--neutral">⚙ Cal</span>}
          {segmentLabel&&segmentLabel!=='Women'&&<span className="badge badge--blue">{segmentLabel}</span>}
        </div>
        <div className="gown-card-meta">{g.price}{g.silhouette?` · ${g.silhouette}`:''}{g.color?` · ${g.color}`:''}{g.type?` · ${g.type}`:''}</div>
        <div className="gown-card-stock">
          {inv.length===0
            ?<span className="stock-chip stock-chip--none">No inventory</span>
            :<>
              <span className="stock-chip">{avail} avail · {inv.length} size{inv.length!==1?'s':''}</span>
              {outSizes.length>0&&<span className="stock-chip stock-chip--out">{outSizes.length} sold out</span>}
              {lowSizes.length>0&&<span className="stock-chip stock-chip--low">{lowSizes.length} low stock</span>}
            </>
          }
        </div>
      </div>
      <div className="gown-card-actions">
        {!archived&&(
          <>
            <button className="btn-sm" onClick={()=>onEdit(g)} title="Edit gown">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
            <StockDropdown gown={g} onSave={onSaveStock}/>
          </>
        )}
        <button className="btn-sm btn-view" onClick={()=>onView(g)} title="View details">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          View
        </button>
        {archived?(
          <>
            <button className="btn-sm btn-restore" onClick={()=>onArchive(g.id,false)}>Restore</button>
            <button className="btn-sm btn-danger" onClick={()=>onPermanentDelete(g)}>Delete</button>
          </>
        ):(
          <button className="btn-sm btn-danger" onClick={()=>onArchive(g.id,true)}>Archive</button>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Main Page
───────────────────────────────────────────── */
export default function AdminGownsPage() {
  const {user:authUser,ready}=useRoleGuard(['admin','staff'],'/')

  const [gowns,setGowns]=useState([]); const [archived,setArchived]=useState([]); const [arcCount,setArcCount]=useState(0)
  const [loading,setLoading]=useState(true); const [error,setError]=useState('')
  const [tab,setTab]=useState('active')
  const [search,setSearch]=useState(''); const [sort,setSort]=useState('name-asc')
  const [toast,setToast]=useState(null); const [confirm,setConfirm]=useState(null)
  const [sidebarOpen,setSidebarOpen]=useState(false); const [editingGown,setEditingGown]=useState(null)
  const [viewingGown,setViewingGown]=useState(null)

  function showToast(m,t='success'){setToast({message:m,type:t})}
  function askConfirm(opts){setConfirm(opts)}

  const loadActive=useCallback(async()=>{
    setLoading(true); setError('')
    try{
      const [aRes,rRes]=await Promise.all([
        adminFetch('/api/admin/gowns',{headers:headers()}),
        adminFetch('/api/admin/gowns?tab=archived',{headers:headers()})
      ])
      const aData=await aRes.json(), rData=await rRes.json()
      if(!aRes.ok)throw new Error(aData.error||'Failed to load')
      setGowns(aData.gowns||[])
      if(rData.ok){setArchived(rData.gowns||[]);setArcCount((rData.gowns||[]).length)}
    }catch(e){setError(e.message)}
    finally{setLoading(false)}
  },[])

  useEffect(()=>{loadActive()},[loadActive])

  const filteredActive = useMemo(()=>{
    let list=[...gowns]
    if(search.trim()){const q=search.toLowerCase(); list=list.filter(g=>[g.name,g.color,g.silhouette,g.fabric,g.neckline,g.type,g.segment].some(v=>(v||'').toLowerCase().includes(q)))}
    list.sort((a,b)=>{
      if(sort==='name-asc')return a.name.localeCompare(b.name)
      if(sort==='name-desc')return b.name.localeCompare(a.name)
      if(sort==='price-asc')return numericPrice(a.price)-numericPrice(b.price)
      if(sort==='price-desc')return numericPrice(b.price)-numericPrice(a.price)
      if(sort==='stock-asc')return totalAvail(a)-totalAvail(b)
      if(sort==='stock-desc')return totalAvail(b)-totalAvail(a)
      return 0
    })
    return list
  },[gowns,search,sort])

  const filteredArchived = useMemo(()=>{
    if(!search.trim())return archived
    const q=search.toLowerCase()
    return archived.filter(g=>[g.name,g.color,g.silhouette,g.segment].some(v=>(v||'').toLowerCase().includes(q)))
  },[archived,search])

  const openAdd=()=>{ setEditingGown(null); setSidebarOpen(true) }
  const openEdit=g=>{ setEditingGown(g); setSidebarOpen(true) }
  const closeSidebar=()=>{ setSidebarOpen(false); setTimeout(()=>setEditingGown(null),300) }

  const handleSaved=(gown,isEdit)=>{
    if(isEdit){ setGowns(p=>p.map(g=>String(g.id)===String(gown.id)?gown:g)) }
    else      { setGowns(p=>[...p,gown]) }
    closeSidebar()
  }

  const handleSaveStock=async(id,inventory)=>{
    const res=await adminFetch('/api/admin/gowns',{method:'PUT',headers:headers(),body:JSON.stringify({id,inventory})})
    const data=await res.json(); if(!res.ok)throw new Error(data.error||'Failed')
    setGowns(p=>p.map(g=>String(g.id)===String(id)?{...g,inventory}:g))
    showToast('Inventory updated')
  }

  const handleArchive=(id,archive)=>{
    const gown=archive?gowns.find(g=>String(g.id)===String(id)):archived.find(g=>String(g.id)===String(id))
    const name=gown?.name||'this gown'
    if(archive){askConfirm({title:'Archive gown?',message:`"${name}" will be hidden from customers.`,confirmLabel:'Archive',danger:true,onConfirm:()=>doArchive(id,true,name)})}
    else{askConfirm({title:'Restore gown?',message:`"${name}" will be visible to customers again.`,confirmLabel:'Restore',danger:false,onConfirm:()=>doArchive(id,false,name)})}
  }
  const doArchive=async(id,archive,name)=>{
    setConfirm(null)
    try{
      if(archive){
        const res=await adminFetch(`/api/admin/gowns?id=${id}`,{method:'DELETE',headers:headers()}); const data=await res.json(); if(!res.ok)throw new Error(data.error||'Failed')
        const gown=gowns.find(g=>String(g.id)===String(id))
        setGowns(p=>p.filter(g=>String(g.id)!==String(id))); if(gown){setArchived(p=>[{...gown,isActive:false},...p]);setArcCount(c=>c+1)}
        showToast(`"${name}" archived`)
      }else{
       const res = await adminFetch('/api/admin/gowns', {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({ id, restore: true }),
        });
 const data=await res.json(); if(!res.ok)throw new Error(data.error||'Failed')
        const gown=archived.find(g=>String(g.id)===String(id))
        setArchived(p=>p.filter(g=>String(g.id)!==String(id))); setArcCount(c=>Math.max(0,c-1))
        if(gown)setGowns(p=>[{...gown,isActive:true},...p]); showToast(`"${name}" restored`)
      }
    }catch(e){setError(e.message);showToast(e.message,'error')}
  }
  const handlePermanentDelete=gown=>{
    askConfirm({title:'Delete permanently?',message:`This will permanently delete "${gown.name}" and all its data. This cannot be undone.`,confirmLabel:'Delete permanently',danger:true,onConfirm:()=>doPermanentDelete(gown.id,gown.name)})
  }
  const doPermanentDelete=async(id,name)=>{
    setConfirm(null)
    try{
    const res=await adminFetch(`/api/admin/gowns?id=${id}&permanent`,{method:'DELETE',headers:headers()}); const data=await res.json(); if(!res.ok)throw new Error(data.error||'Failed')
      setArchived(p=>p.filter(g=>String(g.id)!==String(id))); setArcCount(c=>Math.max(0,c-1))
      showToast(`"${name}" permanently deleted`)
    }catch(e){setError(e.message);showToast(e.message,'error')}
  }

  const allInv=gowns.flatMap(g=>g.inventory||[])
  const totalUnits=allInv.reduce((s,i)=>s+Math.max(0,(i.stock||0)-(i.reserved||0)),0)
  const lowCount=allInv.filter(i=>{const a=(i.stock||0)-(i.reserved||0);return a>0&&a<=2}).length
  const outCount=allInv.filter(i=>((i.stock||0)-(i.reserved||0))<=0).length

  if(!ready)return null

  const displayList=tab==='active'?filteredActive:filteredArchived

  return(
    <>
      <style>{`
        /* ── SizePicker ── */
        .sp-root{display:flex;flex-direction:column;gap:8px;}
        .sp-section-label{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--c-subtle);}
        .sp-grid{display:flex;flex-wrap:wrap;gap:5px;}
        .sp-btn{padding:5px 11px;border-radius:6px;font-size:12px;font-weight:500;border:1px solid var(--c-border);background:var(--c-surface2);color:var(--c-text);cursor:pointer;transition:all .13s;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;user-select:none;}
        .sp-btn:not(:disabled):hover{border-color:var(--c-gold);background:var(--c-gold-dim);color:var(--c-gold);}
        .sp-btn--taken{opacity:.38;cursor:not-allowed;background:var(--c-surface);}
        .sp-btn--custom{border-style:dashed;color:var(--c-muted);}
        .sp-btn--custom:not(:disabled):hover{border-color:var(--c-blue);background:var(--c-blue-dim);color:var(--c-blue);}
        .sp-btn--custom-active{border-color:var(--c-blue);background:var(--c-blue-dim);color:var(--c-blue);}
        .sp-check{font-size:9px;color:var(--c-green);}
        .sp-custom-row{display:flex;gap:7px;align-items:center;}
        .sp-custom-input{flex:1;padding:7px 10px;border:1px solid var(--c-border);border-radius:var(--radius);font-size:13px;background:var(--c-surface2);color:var(--c-text);min-width:0;}
        .sp-custom-input:focus{outline:none;border-color:var(--c-gold);}
        .sp-custom-input::placeholder{color:var(--c-subtle);}

        /* ── Toast ── */
        .toast{position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:var(--radius-lg);font-size:13px;font-weight:500;box-shadow:0 4px 24px rgba(0,0,0,.3);animation:toastIn .22s ease;}
        @keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        .toast--success{background:#0d2010;color:#7dd87d;border:1px solid #1d4a1d;}
        .toast--error{background:#200d0d;color:#d47d7d;border:1px solid #4a1d1d;}

        /* ── Modals ── */
        .modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9990;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(2px);}
        .modal-box{background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius-xl);width:100%;box-shadow:0 24px 64px rgba(0,0,0,.4);display:flex;flex-direction:column;max-height:90vh;overflow:hidden;}
        .modal-box--wide{max-width:720px;}
        .modal-header{display:flex;align-items:flex-start;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--c-border);flex-shrink:0;}
        .modal-title{font-size:15px;font-weight:600;color:var(--c-text);}
        .modal-close{background:none;border:none;font-size:22px;color:var(--c-subtle);cursor:pointer;line-height:1;padding:0;transition:color .12s;}
        .modal-close:hover{color:var(--c-text);}
        .modal-body{padding:20px;overflow-y:auto;flex:1;}
        .modal-footer{display:flex;gap:10px;justify-content:flex-end;padding:16px 20px;border-top:1px solid var(--c-border);flex-shrink:0;}
        .modal-hint{font-size:12px;color:var(--c-muted);line-height:1.6;margin-bottom:14px;}
        .modal-msg{font-size:13px;color:var(--c-muted);line-height:1.6;}
        .confirm-detail{margin-top:12px;background:var(--c-surface2);border:1px solid var(--c-border);border-radius:var(--radius);padding:12px;display:flex;flex-direction:column;gap:6px;}
        .confirm-row{display:flex;justify-content:space-between;font-size:12px;}
        .confirm-row span:first-child{color:var(--c-muted);}
        .confirm-row span:last-child{font-weight:500;}

        /* ── Sidebar ── */
        .sidebar-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:8000;opacity:0;pointer-events:none;transition:opacity .25s;backdrop-filter:blur(2px);}
        .sidebar-backdrop--open{opacity:1;pointer-events:all;}
        .sidebar{position:fixed;top:0;right:0;bottom:0;width:var(--sidebar-w);max-width:100vw;background:var(--c-surface);border-left:1px solid var(--c-border);z-index:8001;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .28s cubic-bezier(.4,0,.2,1);box-shadow:-16px 0 48px rgba(0,0,0,.25);}
        .sidebar--open{transform:translateX(0);}
        .sidebar-header{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 24px 16px;border-bottom:1px solid var(--c-border);flex-shrink:0;}
        .sidebar-title{font-size:16px;font-weight:600;}
        .sidebar-subtitle{font-size:12px;color:var(--c-gold);margin-top:3px;}
        .sidebar-body{flex:1;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;gap:0;}
        .sidebar-footer{display:flex;gap:10px;justify-content:flex-end;padding:16px 24px;border-top:1px solid var(--c-border);flex-shrink:0;background:var(--c-surface);}

        /* ── Form ── */
        .form-section{margin-bottom:22px;}
        .form-section-label{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--c-subtle);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--c-border);}
        .form-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
        .form-field{display:flex;flex-direction:column;gap:5px;}
        .field-label{font-size:11px;font-weight:600;color:var(--c-muted);}
        .req{color:var(--c-red);margin-left:1px;}
        .field-input{background:var(--c-surface2);border:1px solid var(--c-border);border-radius:var(--radius);padding:8px 11px;font-size:13px;color:var(--c-text);width:100%;transition:border-color .12s;}
        .field-input:focus{outline:none;border-color:var(--c-gold);}
        .field-hint{font-size:11px;color:var(--c-subtle);}
        .field-error{font-size:11px;color:var(--c-red);margin-top:4px;}
        .form-images-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px;}

        /* ── Image uploader ── */
        .iup-slot{display:flex;flex-direction:column;gap:5px;}
        .iup-label-row{display:flex;align-items:center;gap:6px;}
        .iup-label{font-size:11px;font-weight:600;color:var(--c-muted);}
        .iup-dropzone{border:1.5px dashed var(--c-border);border-radius:var(--radius);cursor:pointer;overflow:hidden;transition:border-color .15s,background .15s;min-height:72px;display:flex;align-items:center;justify-content:center;background:var(--c-surface2);}
        .iup-dropzone:hover,.iup-dropzone.dragging{border-color:var(--c-gold);background:rgba(200,169,110,.04);}
        .iup-dropzone.has-image{min-height:90px;border-style:solid;}
        .iup-preview-wrap{position:relative;width:100%;height:90px;}
        .iup-preview{width:100%;height:90px;object-fit:cover;object-position:top;display:block;}
        .iup-preview-overlay{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s;font-size:11px;font-weight:600;color:#fff;}
        .iup-dropzone:hover .iup-preview-overlay{opacity:1;}
        .iup-empty{display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px;color:var(--c-subtle);}
        .iup-empty-text{font-size:10px;}
        .iup-spin{width:14px;height:14px;border:2px solid var(--c-border);border-top-color:var(--c-gold);border-radius:50%;animation:spin .7s linear infinite;}
        .iup-path-input{font-size:10px;padding:4px 7px;border:1px solid var(--c-border);border-radius:5px;background:var(--c-surface);color:var(--c-muted);font-family:monospace;width:100%;}
        .iup-error{font-size:10px;color:var(--c-red);}
        .iup-hint{font-size:10px;color:var(--c-subtle);line-height:1.5;}
        @keyframes spin{to{transform:rotate(360deg)}}

        /* ── CalibrationEditor v2 ── */
        .ce-root{margin-top:10px;}
        .ce-toggle{display:flex;align-items:center;gap:7px;width:100%;text-align:left;background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius);padding:8px 12px;font-size:12px;font-weight:500;color:var(--c-text);cursor:pointer;transition:background .12s;}
        .ce-toggle:hover{background:var(--c-surface2);}
        .ce-pill{padding:1px 7px;border-radius:20px;font-size:10px;font-weight:600;background:rgba(200,169,110,.15);color:#c9a96e;border:1px solid rgba(200,169,110,.3);}
        .ce-pill--blue{background:rgba(74,127,212,.15);color:#7ab8f5;border-color:rgba(74,127,212,.3);}
        .ce-chev{margin-left:auto;font-size:9px;opacity:.45;}
        .ce-panel{margin-top:8px;border:1px solid var(--c-border);border-radius:var(--radius-lg);overflow:hidden;}
        .ce-layout{display:grid;grid-template-columns:220px 1fr;}
        .ce-canvas-col{display:flex;flex-direction:column;background:#0c0804;border-right:1px solid rgba(200,169,110,.12);}
        .ce-canvas{display:block;width:220px;height:400px;touch-action:none;user-select:none;flex-shrink:0;}
        .ce-no-img{font-size:10px;color:rgba(200,169,110,.35);text-align:center;padding:6px 10px 2px;line-height:1.5;}
        .ce-legend{display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:6px 10px 8px;font-size:10px;color:rgba(250,249,247,.3);border-top:1px solid rgba(200,169,110,.1);}
        .ce-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
        .ce-sliders{padding:16px 18px;display:flex;flex-direction:column;gap:13px;overflow-y:auto;max-height:400px;background:var(--c-surface);}
        .ce-desc{font-size:11px;color:var(--c-muted);line-height:1.65;margin:0;}
        .ce-row{display:flex;flex-direction:column;gap:3px;}
        .ce-row-head{display:flex;justify-content:space-between;align-items:baseline;}
        .ce-row-label{font-size:11px;font-weight:600;color:var(--c-muted);}
        .ce-row-val{font-size:11px;font-weight:700;color:#c9a96e;font-variant-numeric:tabular-nums;}
        .ce-range{width:100%;accent-color:#c9a96e;}
        .ce-row-hint{font-size:10px;color:var(--c-subtle);line-height:1.5;margin:0;}
        .ce-btns{display:flex;gap:6px;flex-wrap:wrap;padding-top:2px;}
        .ce-ghost{display:inline-flex;align-items:center;gap:4px;background:var(--c-surface2);border:1px solid var(--c-border);border-radius:5px;padding:5px 10px;font-size:11px;color:var(--c-muted);cursor:pointer;transition:background .12s,color .12s;}
        .ce-ghost:hover{background:var(--c-surface);color:var(--c-text);}
        .ce-view-bar{display:flex;align-items:center;gap:4px;padding:6px 8px;border-bottom:1px solid rgba(200,169,110,.1);background:#0c0804;flex-wrap:wrap;}
        .ce-vbtn{background:rgba(200,169,110,.08);border:1px solid rgba(200,169,110,.2);border-radius:4px;color:#c9a96e;font-size:13px;line-height:1;padding:3px 7px;cursor:pointer;transition:background .12s;font-weight:600;}
        .ce-vbtn:hover{background:rgba(200,169,110,.18);}
        .ce-vbtn--sm{font-size:11px;padding:3px 6px;}
        .ce-zoom-label{font-size:10px;color:rgba(200,169,110,.55);min-width:32px;text-align:center;font-variant-numeric:tabular-nums;}
        .ce-group-label{font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(200,169,110,.45);margin:4px 0 2px;padding-bottom:4px;border-bottom:1px solid var(--c-border);}

        /* ── CalibrationEditor: full screen ── */
.ce-fs{position:fixed;inset:0;z-index:9100;background:var(--c-surface);display:flex;flex-direction:column;}
.ce-fs-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--c-border);flex-shrink:0;}
.ce-fs-title{font-size:14px;font-weight:600;color:var(--c-text);}
.ce-fs-btns{display:flex;gap:8px;flex-wrap:wrap;}
.ce-fs-body{flex:1;min-height:0;display:flex;}
.ce-fs-ref{flex:0 0 min(34vw,420px);display:flex;align-items:center;justify-content:center;padding:12px;background:#0c0804;border-right:1px solid rgba(200,169,110,.12);min-height:0;}
.ce-fs-ref img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;}
@media(max-width:900px){
  .ce-fs-ref{flex:0 0 28vh;width:100%;border-right:none;border-bottom:1px solid rgba(200,169,110,.12);}
}
.ce-fs .ce-panel{flex:1;min-width:0;min-height:0;margin:0;border:none;border-radius:0;display:flex;}
.ce-fs .ce-layout{flex:1;min-width:0;min-height:0;grid-template-columns:minmax(0,1fr) 440px;grid-template-rows:minmax(0,1fr);}
.ce-fs .ce-canvas-col{min-height:0;overflow:auto;align-items:center;}
.ce-fs .ce-view-bar{align-self:stretch;}
.ce-fs .ce-canvas{width:auto;height:calc(100vh - 190px);aspect-ratio:220/400;}
.ce-fs .ce-sliders{max-height:none;min-height:0;}
@media(max-width:900px){
  .ce-fs-body{flex-direction:column;}
  .ce-fs .ce-layout{grid-template-columns:1fr;grid-template-rows:auto;overflow:auto;}
  .ce-fs .ce-canvas{height:60vh;}
}

/* ── Inventory / Stock ── */
        .inv-editor{display:flex;flex-direction:column;gap:10px;}
        .stock-table{border:1px solid var(--c-border);border-radius:var(--radius);overflow:hidden;}
        .stock-header{display:grid;grid-template-columns:70px 80px 70px 60px 32px;gap:8px;padding:7px 12px;background:var(--c-surface2);font-size:10px;font-weight:700;color:var(--c-subtle);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--c-border);}
        .stock-row{display:grid;grid-template-columns:70px 80px 70px 60px 32px;gap:8px;padding:9px 12px;align-items:center;border-bottom:1px solid var(--c-border);}
        .stock-row:last-child{border-bottom:none;}
        .stock-size{font-weight:600;font-size:13px;}
        .stock-input{width:64px;padding:5px 8px;border:1px solid var(--c-border);border-radius:6px;font-size:13px;background:var(--c-surface);color:var(--c-text);}
        .stock-input:focus{outline:none;border-color:var(--c-gold);}
        .stock-res{font-size:11px;color:var(--c-subtle);}
        .stock-avail{font-size:12px;font-weight:600;color:var(--c-green);}
        .stock-avail.low{color:var(--c-warn);}
        .stock-avail.out{color:var(--c-red);}
        .stock-remove{background:none;border:none;font-size:17px;color:var(--c-subtle);cursor:pointer;line-height:1;padding:0 4px;transition:color .12s;}
        .stock-remove:hover{color:var(--c-red);}

        /* ── Stock Dropdown ── */
        .stock-dropdown-wrap{position:relative;}
        .stock-dropdown-panel{position:absolute;right:0;top:calc(100% + 6px);width:360px;background:var(--c-surface);border:1px solid var(--c-border2);border-radius:var(--radius-lg);box-shadow:0 8px 32px rgba(0,0,0,.35);z-index:500;padding:14px;}
        .stock-dropdown-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--c-border);}
        .stock-dropdown-title{font-size:12px;font-weight:600;color:var(--c-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:270px;}
        .stock-dropdown-footer{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;padding-top:10px;border-top:1px solid var(--c-border);}

        /* ── Buttons ── */
        .btn-primary{background:var(--c-gold);color:#1a1408;border:none;border-radius:var(--radius);padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .12s;}
        .btn-primary:hover:not(:disabled){opacity:.88;}
        .btn-primary:disabled{opacity:.4;cursor:not-allowed;}
        .btn-ghost{background:none;border:1px solid var(--c-border);border-radius:var(--radius);padding:9px 16px;font-size:13px;color:var(--c-muted);cursor:pointer;transition:background .12s,color .12s;}
        .btn-ghost:hover:not(:disabled){background:var(--c-surface2);color:var(--c-text);}
        .btn-ghost:disabled{opacity:.4;cursor:not-allowed;}
        .btn-danger{background:var(--c-red-dim);color:var(--c-red);border:1px solid var(--c-red-border);border-radius:var(--radius);padding:9px 16px;font-size:13px;font-weight:500;cursor:pointer;transition:background .12s;}
        .btn-danger:hover:not(:disabled){background:rgba(196,92,92,.2);}
        .btn-sm{display:inline-flex;align-items:center;gap:5px;background:var(--c-surface2);border:1px solid var(--c-border);border-radius:6px;padding:5px 10px;font-size:12px;font-weight:500;color:var(--c-text);cursor:pointer;text-decoration:none;transition:background .12s,border-color .12s;white-space:nowrap;}
        .btn-sm:hover{background:var(--c-surface);border-color:var(--c-border2);}
        .btn-sm--disabled{opacity:.35;cursor:not-allowed;pointer-events:none;}
        .btn-xs{display:inline-flex;align-items:center;gap:4px;background:var(--c-surface2);border:1px solid var(--c-border);border-radius:5px;padding:4px 8px;font-size:11px;color:var(--c-muted);cursor:pointer;transition:background .12s;text-decoration:none;}
        .btn-xs:hover:not(:disabled){background:var(--c-surface);color:var(--c-text);}
        .btn-xs:disabled{opacity:.35;cursor:not-allowed;}
        .btn-stock{background:var(--c-gold-dim)!important;color:var(--c-gold)!important;border-color:var(--c-gold-border)!important;}
        .btn-view{background:var(--c-blue-dim)!important;color:var(--c-blue)!important;border-color:var(--c-blue-border)!important;}
        .btn-restore{background:var(--c-green-dim)!important;color:var(--c-green)!important;border-color:rgba(76,175,130,.25)!important;}
        .btn-info{background:var(--c-blue-dim)!important;color:var(--c-blue)!important;border-color:var(--c-blue-border)!important;}
        .btn-info:hover{background:rgba(74,127,212,.2)!important;}

        /* ── Badges ── */
        .badge{display:inline-flex;align-items:center;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:600;letter-spacing:.02em;}
        .badge--neutral{background:var(--c-surface2);color:var(--c-muted);border:1px solid var(--c-border);}
        .badge--gold{background:var(--c-gold-dim);color:var(--c-gold);border:1px solid var(--c-gold-border);}
        .badge--blue{background:var(--c-blue-dim);color:var(--c-blue);border:1px solid var(--c-blue-border);}
        .badge--green{background:var(--c-green-dim);color:var(--c-green);border:1px solid rgba(76,175,130,.25);}
        .badge--warning{background:var(--c-warn-dim);color:var(--c-warn);border:1px solid rgba(212,148,58,.25);}
        .badge--danger{background:var(--c-red-dim);color:var(--c-red);border:1px solid var(--c-red-border);}

        /* ── Gown Cards ── */
        .gown-card{display:grid;grid-template-columns:72px 1fr auto;gap:14px;align-items:start;padding:14px 16px;border:1px solid var(--c-border);border-radius:var(--radius-lg);background:var(--c-surface);transition:border-color .15s;}
        .gown-card:hover{border-color:var(--c-border2);}
        .gown-card--archived{opacity:.65;}
        .gown-card-img{width:72px;height:90px;border-radius:var(--radius);overflow:hidden;background:var(--c-surface2);position:relative;flex-shrink:0;}
        .gown-card-img img{width:100%;height:100%;object-fit:cover;object-position:top;}
        .vto-badge{position:absolute;bottom:3px;right:3px;font-size:8px;font-weight:700;background:rgba(200,169,110,.92);color:#1a1408;border-radius:3px;padding:1px 4px;}
        .vto-badge--back{background:rgba(74,127,212,.85);color:#fff;bottom:18px;}
        .gown-card-body{min-width:0;}
        .gown-card-name{font-weight:600;font-size:13px;margin-bottom:3px;display:flex;align-items:center;flex-wrap:wrap;gap:5px;}
        .gown-card-meta{font-size:11px;color:var(--c-muted);margin-bottom:7px;}
        .gown-card-stock{display:flex;gap:5px;flex-wrap:wrap;}
        .gown-card-actions{display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0;}
        .stock-chip{font-size:10px;background:var(--c-surface2);border:1px solid var(--c-border);border-radius:20px;padding:2px 8px;color:var(--c-muted);}
        .stock-chip--none{color:var(--c-subtle);}
        .stock-chip--out{background:var(--c-red-dim);color:var(--c-red);border-color:var(--c-red-border);}
        .stock-chip--low{background:var(--c-warn-dim);color:var(--c-warn);border-color:rgba(212,148,58,.25);}

        /* ── Detail modal ── */
        .detail-layout{display:grid;grid-template-columns:220px 1fr;gap:24px;}
        .detail-images{display:flex;flex-direction:column;gap:10px;}
        .detail-main-img{width:100%;aspect-ratio:3/4;object-fit:cover;object-position:top;border-radius:var(--radius-lg);border:1px solid var(--c-border);}
        .detail-thumb-row{display:flex;gap:8px;}
        .detail-thumb-wrap{display:flex;flex-direction:column;gap:3px;align-items:center;}
        .detail-thumb{width:72px;height:90px;object-fit:cover;object-position:top;border-radius:var(--radius);border:1px solid var(--c-border);}
        .detail-thumb-label{font-size:9px;color:var(--c-subtle);text-transform:uppercase;letter-spacing:.06em;}
        .detail-info{display:flex;flex-direction:column;gap:14px;}
        .detail-price{font-size:22px;font-weight:600;color:var(--c-gold);}
        .detail-badges{display:flex;gap:5px;flex-wrap:wrap;}
        .detail-attrs{display:flex;flex-direction:column;gap:6px;}
        .detail-attr{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;padding-bottom:6px;border-bottom:1px solid var(--c-border);}
        .detail-attr-key{color:var(--c-muted);}
        .detail-desc{font-size:13px;color:var(--c-muted);line-height:1.7;}
        .detail-section-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--c-subtle);margin-bottom:8px;}
        .detail-inv-grid{display:flex;flex-wrap:wrap;gap:7px;}
        .detail-inv-chip{background:var(--c-surface2);border:1px solid var(--c-border);border-radius:var(--radius);padding:6px 10px;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:58px;}
        .detail-inv-chip.low{border-color:rgba(212,148,58,.35);background:var(--c-warn-dim);}
        .detail-inv-chip.out{border-color:var(--c-red-border);background:var(--c-red-dim);}
        .detail-inv-size{font-size:13px;font-weight:700;}
        .detail-inv-qty{font-size:10px;color:var(--c-muted);}
        .detail-inv-res{font-size:9px;color:var(--c-subtle);}
        .detail-links{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;}

        /* ── BG Remover ── */
        .bgr-preview-area{background:var(--c-surface2);border:1px solid var(--c-border);border-radius:var(--radius);min-height:140px;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:12px;}
        .bgr-canvas{max-width:100%;display:block;}
        .bgr-spin-wrap{display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--c-muted);font-size:12px;padding:24px;}
        .bgr-tolerance-row{display:flex;align-items:center;gap:10px;font-size:12px;}
        .tol-val{font-weight:700;color:var(--c-gold);min-width:24px;text-align:right;}
        .spin{display:inline-block;width:20px;height:20px;border:2px solid var(--c-border);border-top-color:var(--c-gold);border-radius:50%;animation:spin .7s linear infinite;}
        .range-input{width:100%;accent-color:var(--c-gold);}

        /* ── Page ── */
        .page{padding:28px 32px;max-width:900px;margin:0 auto;}
        .page-topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;}
        .page-title{font-size:22px;font-weight:700;letter-spacing:-.3px;color:var(--c-text);}
        .page-meta{font-size:12px;color:var(--c-muted);}
        .stats-bar{display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;}
        .stat-card{flex:1;min-width:100px;padding:12px 16px;border:1px solid var(--c-border);border-radius:var(--radius-lg);background:var(--c-surface);}
        .stat-card.warn{border-color:rgba(212,148,58,.35);background:var(--c-warn-dim);}
        .stat-card.danger{border-color:var(--c-red-border);background:var(--c-red-dim);}
        .stat-val{font-size:20px;font-weight:700;}
        .stat-lbl{font-size:11px;color:var(--c-muted);margin-top:2px;}
        .toolbar{display:flex;gap:10px;margin-bottom:16px;align-items:center;flex-wrap:wrap;}
        .search-wrap{position:relative;flex:1;min-width:180px;}
        .search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--c-subtle);pointer-events:none;}
        .search-input{width:100%;padding:8px 10px 8px 34px;background:var(--c-surface2);border:1px solid var(--c-border);border-radius:var(--radius);font-size:13px;color:var(--c-text);}
        .search-input:focus{outline:none;border-color:var(--c-gold);}
        .search-input::placeholder{color:var(--c-subtle);}
        .sort-select{padding:8px 12px;background:var(--c-surface2);border:1px solid var(--c-border);border-radius:var(--radius);font-size:12px;color:var(--c-text);cursor:pointer;}
        .sort-select:focus{outline:none;border-color:var(--c-gold);}
        .tabs{display:flex;gap:2px;margin-bottom:16px;border-bottom:1px solid var(--c-border);}
        .tab{background:none;border:none;border-bottom:2px solid transparent;padding:8px 16px;font-size:13px;font-weight:500;color:var(--c-muted);cursor:pointer;margin-bottom:-1px;transition:color .15s,border-color .15s;display:flex;align-items:center;gap:6px;}
        .tab.active{color:var(--c-text);border-bottom-color:var(--c-gold);}
        .tab-count{font-size:10px;background:var(--c-surface2);border:1px solid var(--c-border);border-radius:10px;padding:1px 6px;}
        .gown-list{display:flex;flex-direction:column;gap:8px;}
        .empty-state{text-align:center;padding:40px;color:var(--c-subtle);font-size:13px;}
        .archive-note{font-size:12px;color:var(--c-muted);margin-bottom:14px;padding:9px 12px;background:var(--c-surface2);border-radius:var(--radius);border:1px solid var(--c-border);}
        .back-link{display:inline-flex;align-items:center;gap:6px;color:var(--c-muted);font-size:12px;text-decoration:none;margin-top:32px;transition:color .12s;}
        .back-link:hover{color:var(--c-text);}
        .err-msg{font-size:13px;color:var(--c-red);padding:12px;background:var(--c-red-dim);border:1px solid var(--c-red-border);border-radius:var(--radius);margin-bottom:16px;}

        /* ── Responsive ── */
        @media(max-width:680px){
          .page{padding:16px;}
          .form-grid-2{grid-template-columns:1fr;}
          .form-images-grid{grid-template-columns:1fr;}
          .iup-dropzone.has-image{min-height:120px;}
          .iup-preview-wrap{height:120px;}
          .iup-preview{height:120px;}
          .ce-layout{grid-template-columns:1fr;}
          .ce-canvas-col{border-right:none;border-bottom:1px solid rgba(200,169,110,.1);}
          .ce-canvas{width:100%;height:auto;aspect-ratio:220/400;}
          .ce-sliders{max-height:none;}
          .gown-card{grid-template-columns:56px 1fr;row-gap:10px;}
          .gown-card-actions{flex-direction:row;grid-column:1/-1;flex-wrap:wrap;justify-content:flex-start;}
          .detail-layout{grid-template-columns:1fr;}
          .detail-main-img{max-height:260px;}
          .sidebar{max-width:100vw;width:100vw;}
          .stock-header,.stock-row{grid-template-columns:60px 70px 60px 50px 28px;}
          .stock-dropdown-panel{width:calc(100vw - 32px);right:auto;left:0;}
          .sp-grid{gap:4px;}
          .sp-btn{padding:5px 8px;font-size:11px;}
          .stats-bar{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
          .stat-card{min-width:0;}
          .toolbar{flex-direction:column;align-items:stretch;}
          .search-wrap{min-width:0;}
          .sort-select{width:100%;}
          .modal-body{padding:14px;}
          .modal-footer{padding:12px 14px;}
          .modal-header{padding:14px;}
          .tabs{overflow-x:auto;-webkit-overflow-scrolling:touch;}
          .tab{white-space:nowrap;padding:8px 12px;}
        }
        @media(max-width:400px){
          .gown-card-actions{flex-direction:column;align-items:stretch;}
          .gown-card-actions .btn-sm{justify-content:center;}
          .stats-bar{grid-template-columns:1fr;}
        }
      `}</style>

      {toast&&<Toast message={toast.message} type={toast.type} onDone={()=>setToast(null)}/>}
      {confirm&&<ConfirmModal {...confirm} onClose={()=>setConfirm(null)}/>}
      {viewingGown&&<ProductDetailModal gown={viewingGown} onClose={()=>setViewingGown(null)} onEdit={g=>{setViewingGown(null);openEdit(g)}}/>}

      <GownFormSidebar
        open={sidebarOpen}
        editingGown={editingGown}
        onClose={closeSidebar}
        onSaved={handleSaved}
        showToast={showToast}
      />

      <div className="page">
        <div className="page-topbar">
          <div>
            <h1 className="page-title">Catalogue</h1>
            <p className="page-meta">{gowns.length} active · {arcCount} archived</p>
          </div>
          <button className="btn-primary" onClick={openAdd}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Gown
          </button>
        </div>

        {!loading&&(
          <div className="stats-bar">
            <div className="stat-card"><div className="stat-val">{gowns.length}</div><div className="stat-lbl">Active Products</div></div>
            <div className="stat-card"><div className="stat-val">{totalUnits}</div><div className="stat-lbl">Units available</div></div>
            {lowCount>0&&<div className="stat-card warn"><div className="stat-val">{lowCount}</div><div className="stat-lbl">Low stock</div></div>}
            {outCount>0&&<div className="stat-card danger"><div className="stat-val">{outCount}</div><div className="stat-lbl">Sold out</div></div>}
          </div>
        )}

        {error&&<p className="err-msg">{error}</p>}

        <div className="tabs">
          <button className={`tab${tab==='active'?' active':''}`} onClick={()=>setTab('active')}>Active <span className="tab-count">{gowns.length}</span></button>
          <button className={`tab${tab==='archived'?' active':''}`} onClick={()=>setTab('archived')}>Archived <span className="tab-count">{arcCount}</span></button>
        </div>

        <div className="toolbar">
          <div className="search-wrap">
            <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input className="search-input" placeholder="Search by name, color, segment…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <select className="sort-select" value={sort} onChange={e=>setSort(e.target.value)}>
            {SORT_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="gown-list">
          {loading
            ?<p className="empty-state">Loading gowns…</p>
            :displayList.length===0
              ?<p className="empty-state">{search?'No results for that search.':tab==='active'?'No active products. Add one with the button above.':'No archived products.'}</p>
              :<>
                {tab==='archived'&&<p className="archive-note">Archived products are hidden from customers but preserved in order history.</p>}
                {displayList.map(g=>(
                  <GownCard key={g.id} g={g} archived={tab==='archived'}
                    onEdit={openEdit}
                    onView={setViewingGown}
                    onSaveStock={handleSaveStock}
                    onArchive={handleArchive}
                    onPermanentDelete={handlePermanentDelete}
                  />
                ))}
              </>
          }
        </div>

        <Link href="/admin" className="back-link">← Dashboard</Link>
      </div>
    </>
  )
}