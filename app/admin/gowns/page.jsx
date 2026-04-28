'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { getAdminSecret } from '../layout'
import { useRoleGuard } from '../../utils/useRoleGuard'

/* ─────────────────────────────────────────────
   Constants & helpers
───────────────────────────────────────────── */
const emptyGown = {
  name:'', price:'₱', image:'/images/', alt:'',
  tryonImage:'', tryonImageBack:'', tryonCalibration:null,
  type:'Gowns', color:'', silhouette:'', fabric:'', neckline:'', description:'',
}
const TYPES = ['Gowns','Dresses','Suit']
const defaultCalibration = { necklineY:0.18, shoulderPad:1.25, skirtFlare:1.10, hemY:null }
const SORT_OPTIONS = [
  { value:'name-asc',  label:'Name A→Z' },
  { value:'name-desc', label:'Name Z→A' },
  { value:'price-asc', label:'Price Low→High' },
  { value:'price-desc',label:'Price High→Low' },
  { value:'stock-asc', label:'Stock Low→High' },
  { value:'stock-desc',label:'Stock High→Low' },
]

const PRESET_SIZES = ['XS','S','M','L','XL','2XL','3XL','4XL','6','8','10','12','14','16']
const CUSTOM_SIZE_VALUE = '__custom__'

function numericPrice(p) {
  return parseInt(String(p||'').replace(/[^\d]/g,'')) || 0
}
function totalAvail(g) {
  return (g.inventory||[]).reduce((s,i)=>s+Math.max(0,(i.stock||0)-(i.reserved||0)),0)
}
function headers() { return {'Content-Type':'application/json','X-Admin-Secret':getAdminSecret()||''} }

/* ─────────────────────────────────────────────
   SizePicker
───────────────────────────────────────────── */
function SizePicker({ inventory, onAdd, error, onClearErr }) {
  const taken       = new Set((inventory||[]).map(i => i.size))
  const available   = PRESET_SIZES.filter(s => !taken.has(s))
  const [custom, setCustom]     = useState('')
  const [showCustom, setShowCustom] = useState(false)

  function validateCustom(val) {
    const v = val.trim().toUpperCase()
    if (!v)                           return 'Enter a size label.'
    if (v.length > 8)                 return 'Max 8 characters.'
    if (/\s/.test(v))                 return 'No spaces allowed.'
    if (taken.has(v))                 return `"${v}" already added.`
    if (PRESET_SIZES.includes(v))     return `Use the "${v}" button above.`
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
          {PRESET_SIZES.map(size => {
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
  const inputRef   = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [uploading,setUploading]= useState(false)
  const [uploadErr,setUploadErr]= useState('')

  const upload = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) { setUploadErr('Please select an image file.'); return }
    setUploading(true); setUploadErr('')
    try {
      const reader = new FileReader()
      const dataUrl = await new Promise((res,rej) => { reader.onload=e=>res(e.target.result); reader.onerror=rej; reader.readAsDataURL(file) })
      const res  = await fetch('/api/admin/upload-tryon-image', { method:'POST', headers:headers(), body:JSON.stringify({image:dataUrl}) })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error||'Upload failed')
      onChange(data.path)
    } catch(e) { setUploadErr(e.message) }
    finally    { setUploading(false) }
  }, [onChange])

  const onDrop = useCallback(e => { e.preventDefault(); setDragging(false); const f=e.dataTransfer.files?.[0]; if(f)upload(f) }, [upload])
  const onPick = useCallback(e => { const f=e.target.files?.[0]; if(f)upload(f) }, [upload])
  const hasImage = value && value !== '/images/'
  const err = uploadErr || (error ? 'Image failed to load' : '')

  return (
    <div className="iup-slot">
      <div className="iup-label-row">
        <span className="iup-label">{label}</span>
        {badge}
      </div>
      <div
        className={`iup-dropzone${dragging?' dragging':''}${hasImage?' has-image':''}`}
        onDragEnter={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)}
        onDragOver={e=>e.preventDefault()} onDrop={onDrop}
        onClick={()=>!uploading&&inputRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={e=>{if(e.key==='Enter'||e.key===' ')inputRef.current?.click()}}
      >
        <input ref={inputRef} type="file" accept="image/*" style={{display:'none'}} onChange={onPick}/>
        {hasImage ? (
          <div className="iup-preview-wrap">
            <img src={value} alt={label} className="iup-preview" onError={onError}/>
            <div className="iup-preview-overlay"><span>{uploading?'Uploading…':'Replace'}</span></div>
          </div>
        ) : (
          <div className="iup-empty">
            {uploading ? (
              <><span className="iup-spin"/><span className="iup-empty-text">Uploading…</span></>
            ) : (
              <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span className="iup-empty-text">Drop or click</span></>
            )}
          </div>
        )}
      </div>
      <input className="iup-path-input" value={value||''} onChange={e=>onChange(e.target.value)} placeholder="/images/filename.png" spellCheck={false}/>
      {err && <p className="iup-error">{err}</p>}
      {hint && <p className="iup-hint">{hint}</p>}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Background Remover
───────────────────────────────────────────── */
function removeBg(imgSrc, tolerance=32) {
  return new Promise((resolve,reject) => {
    const img=new Image(); img.crossOrigin='anonymous'
    img.onload=()=>{
      const w=img.naturalWidth,h=img.naturalHeight
      const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h
      const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0)
      let data
      try { data=ctx.getImageData(0,0,w,h) }
      catch(e) { reject(new Error('Image is cross-origin or tainted. Host it on the same origin.')); return }
      const d=data.data
      const seeds=[]
      const pts=[[0,0],[w-1,0],[0,h-1],[w-1,h-1],[Math.floor(w/2),0],[Math.floor(w/2),h-1],[0,Math.floor(h/2)],[w-1,Math.floor(h/2)]]
      pts.forEach(([x,y])=>{ const i=(y*w+x)*4; seeds.push({r:d[i],g:d[i+1],b:d[i+2]}) })
      function isBg(x,y){ const i=(y*w+x)*4; return d[i+3]<10||seeds.some(s=>Math.abs(d[i]-s.r)+Math.abs(d[i+1]-s.g)+Math.abs(d[i+2]-s.b)<tolerance*3) }
      const visited=new Uint8Array(w*h); const queue=new Uint32Array(w*h); let head=0,tail=0
      function enq(x,y){ if(x<0||y<0||x>=w||y>=h)return; const idx=y*w+x; if(visited[idx])return; visited[idx]=1; if(isBg(x,y))queue[tail++]=idx }
      for(let x=0;x<w;x++){enq(x,0);enq(x,h-1)} for(let y=0;y<h;y++){enq(0,y);enq(w-1,y)}
      while(head<tail){ const idx=queue[head++]; const x=idx%w,y=(idx-x)/w; d[idx*4+3]=0; enq(x-1,y);enq(x+1,y);enq(x,y-1);enq(x,y+1) }
      ctx.putImageData(data,0,0); resolve(canvas.toDataURL('image/png'))
    }
    img.onerror=()=>reject(new Error('Could not load image.')); img.src=imgSrc
  })
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
      const res=await fetch('/api/admin/upload-tryon-image',{method:'POST',headers:headers(),body:JSON.stringify({image:result})})
      const data=await res.json(); if(!data.ok)throw new Error(data.error||'Upload failed')
      onDone(data.path)
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
   Calibration Editor
───────────────────────────────────────────── */
function CalibrationEditor({ calibration, onChange }) {
  const [open,setOpen]=useState(false)
  const cal={...defaultCalibration,...(calibration||{})}
  const previewRef=useRef(null)
  const sliders=[
    {key:'necklineY',label:'Neckline offset',min:0.05,max:0.50,step:0.01,hint:'How far above the shoulder the dress top starts.'},
    {key:'shoulderPad',label:'Shoulder width',min:0.80,max:2.50,step:0.05,hint:'Bodice width relative to detected shoulder span.'},
    {key:'skirtFlare',label:'Skirt flare',min:0.80,max:2.00,step:0.05,hint:'How much wider the hem is compared to the bodice.'},
    {key:'hemY',label:'Hem length',min:0.40,max:1.20,step:0.01,hint:'Override hem position. 1.0 = full ankle length.'},
  ]
  useEffect(()=>{
    const c=previewRef.current; if(!c||!open)return
    const ctx=c.getContext('2d'),W=c.width,H=c.height; ctx.clearRect(0,0,W,H)
    const shoulderY=H*0.18,hipY=H*0.44,cx=W/2,shoulderW=W*0.22
    const nOff=cal.necklineY,sPad=cal.shoulderPad,sFlare=cal.skirtFlare,hemFrac=cal.hemY??1.0
    const topY=shoulderY-(hipY-shoulderY)*nOff,hemY2=shoulderY+(hipY-shoulderY)*4.8*Math.min(hemFrac,1.2)
    const topHW=shoulderW*sPad,botHW=Math.max(shoulderW*1.2,topHW)*sFlare
    ctx.save();ctx.strokeStyle='rgba(180,160,120,.18)';ctx.lineWidth=1;ctx.setLineDash([3,3])
    ctx.beginPath();ctx.arc(cx,H*0.07,H*0.055,0,Math.PI*2);ctx.stroke()
    ctx.restore();ctx.save()
    const grad=ctx.createLinearGradient(0,topY,0,hemY2); grad.addColorStop(0,'rgba(200,169,110,.55)'); grad.addColorStop(0.4,'rgba(200,169,110,.38)'); grad.addColorStop(1,'rgba(200,169,110,.18)')
    ctx.fillStyle=grad; ctx.strokeStyle='rgba(200,169,110,.78)'; ctx.lineWidth=1.5; ctx.setLineDash([])
    const waistY=shoulderY+(hipY-shoulderY)*0.55,waistHW=topHW*0.80
    ctx.beginPath(); ctx.moveTo(cx-topHW,topY); ctx.lineTo(cx+topHW,topY)
    ctx.bezierCurveTo(cx+topHW,shoulderY+10,cx+waistHW,waistY,cx+botHW,hemY2)
    ctx.lineTo(cx-botHW,hemY2); ctx.bezierCurveTo(cx-waistHW,waistY,cx-topHW,shoulderY+10,cx-topHW,topY)
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore()
  },[cal,open])
  return(
    <div className="cal-editor">
      <button type="button" className="cal-toggle" onClick={()=>setOpen(v=>!v)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
        Try-On Calibration
        {calibration&&<span className="badge badge--green">Custom</span>}
        <span style={{marginLeft:'auto',fontSize:10,opacity:.5}}>{open?'▲':'▼'}</span>
      </button>
      {open&&(
        <div className="cal-panel">
          <div className="cal-inner">
            <div className="cal-sliders">
              <p className="cal-desc">Fine-tune dress positioning for virtual try-on. Preview updates live.</p>
              {sliders.map(s=>(
                <div key={s.key} className="cal-row">
                  <div className="cal-row-header">
                    <span className="field-label">{s.label}</span>
                    <span className="cal-val">{s.key==='hemY'&&cal.hemY==null?'auto':cal[s.key]?.toFixed(2)??'auto'}</span>
                  </div>
                  <input type="range" min={s.min} max={s.max} step={s.step}
                    value={s.key==='hemY'?(cal.hemY??1.0):cal[s.key]}
                    onChange={e=>onChange({...cal,[s.key]:parseFloat(e.target.value)})} className="range-input"/>
                  <p className="cal-hint">{s.hint}</p>
                </div>
              ))}
              <div style={{display:'flex',gap:6,marginTop:4}}>
                <button type="button" className="btn-ghost btn-xs" onClick={()=>onChange(null)}>Reset defaults</button>
                {cal.hemY!=null&&<button type="button" className="btn-ghost btn-xs" onClick={()=>onChange({...cal,hemY:null})}>Auto hem</button>}
              </div>
            </div>
            <div className="cal-preview-wrap">
              <p className="cal-preview-label">Live preview</p>
              <canvas ref={previewRef} width={140} height={240} className="cal-preview-canvas"/>
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
                  ? <Link href={`/virtual-try-on?gown=${gown.id}`} target="_blank" rel="noopener noreferrer" className="btn-info btn-sm">Virtual try-on ↗</Link>
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
  const [open, setOpen] = useState(false)
  const [inventory, setInventory] = useState([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const wrapRef = useRef(null)

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
      <button
        className="btn-sm btn-stock"
        onClick={() => setOpen(v => !v)}
        title="Manage stock"
      >
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
                    <input
                      type="number" min="0" value={inv.stock} className="stock-input"
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
            <SizePicker
              inventory={inventory}
              onAdd={handleAdd}
              error={err}
              onClearErr={() => setErr('')}
            />
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
  const [form,setForm]=useState(emptyGown)
  const [inventory,setInventory]=useState([])
  const [saving,setSaving]=useState(false)
  const [formError,setFormError]=useState('')
  const [imgError,setImgError]=useState(false)
  const [tryonImgError,setTryonImgError]=useState(false)
  const [tryonBackImgError,setTryonBackImgError]=useState(false)
  const [bgRemoverSrc,setBgRemoverSrc]=useState(null)
  const [bgRemoverTarget,setBgRemoverTarget]=useState('front')
  const [confirm,setConfirm]=useState(null)
  const isEdit=!!editingGown

  useEffect(()=>{
    if(editingGown){
      const raw=String(editingGown.price||'').replace(/[^\d]/g,'')
      setForm({
        name:editingGown.name||'',
        price:'₱'+(raw?Number(raw).toLocaleString('en-PH'):''),
        image:editingGown.image||'/images/',
        alt:editingGown.alt||'',
        tryonImage:editingGown.tryonImage||'',
        tryonImageBack:editingGown.tryonImageBack||'',
        tryonCalibration:editingGown.tryonCalibration||null,
        type:editingGown.type||'Gowns',
        color:editingGown.color||'',
        silhouette:editingGown.silhouette||'',
        fabric:editingGown.fabric||'',
        neckline:editingGown.neckline||'',
        description:editingGown.description||'',
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
    const detail=isEdit?(
      <div>
        <div className="confirm-row"><span>Name</span><span>{form.name}</span></div>
        <div className="confirm-row"><span>Price</span><span>{form.price}</span></div>
        <div className="confirm-row"><span>Type</span><span>{form.type}</span></div>
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
      const res=await fetch('/api/admin/gowns',{method,headers:headers(),body:JSON.stringify(payload)})
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

      <div className={`sidebar-backdrop${open?' sidebar-backdrop--open':''}`} onClick={onClose}/>

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
              </div>
            </div>
            <CalibrationEditor calibration={form.tryonCalibration} onChange={cal=>setForm(p=>({...p,tryonCalibration:cal}))}/>
          </div>

          <div className="form-section">
            <p className="form-section-label">Inventory</p>
            <InlineInventoryEditor inventory={inventory} onChange={setInventory}/>
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
function InlineInventoryEditor({ inventory, onChange }) {
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
      <SizePicker
        inventory={inventory}
        onAdd={handleAdd}
        error={err}
        onClearErr={() => setErr('')}
      />

      {inventory.length === 0 && (
        <p className="field-hint" style={{marginTop:8}}>
          Add at least one size and set its stock quantity above.
        </p>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Gown Card
───────────────────────────────────────────── */
function GownCard({ g, onEdit, onView, onSaveStock, onArchive, onPermanentDelete, archived=false }) {
  const inv=g.inventory||[]
  const avail=inv.reduce((s,i)=>s+Math.max(0,(i.stock||0)-(i.reserved||0)),0)
  const outSizes=inv.filter(i=>(i.stock-(i.reserved||0))<=0)
  const lowSizes=inv.filter(i=>{const a=i.stock-(i.reserved||0);return a>0&&a<=2})
  return(
    <div className={`gown-card${archived?' gown-card--archived':''}`}>
      <div className="gown-card-img">
        <img src={g.image} alt={g.alt||g.name} onError={e=>{e.target.style.display='none'}}/>
        {g.tryonImage&&<div className="vto-badge">VTO</div>}
        {g.tryonImageBack&&<div className="vto-badge vto-badge--back">↩</div>}
      </div>
      <div className="gown-card-body">
        <div className="gown-card-name">
          {g.name}
          {archived&&<span className="badge badge--warning">Archived</span>}
          {g.tryonCalibration&&<span className="badge badge--neutral">⚙ Cal</span>}
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
        fetch('/api/admin/gowns',{headers:headers()}),
        fetch('/api/admin/gowns?tab=archived',{headers:headers()})
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
    if(search.trim()){const q=search.toLowerCase(); list=list.filter(g=>[g.name,g.color,g.silhouette,g.fabric,g.neckline,g.type].some(v=>(v||'').toLowerCase().includes(q)))}
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
    return archived.filter(g=>[g.name,g.color,g.silhouette].some(v=>(v||'').toLowerCase().includes(q)))
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
    const res=await fetch('/api/admin/gowns',{method:'PUT',headers:headers(),body:JSON.stringify({id,inventory})})
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
        const res=await fetch(`/api/admin/gowns?id=${id}`,{method:'DELETE',headers:headers()}); const data=await res.json(); if(!res.ok)throw new Error(data.error||'Failed')
        const gown=gowns.find(g=>String(g.id)===String(id))
        setGowns(p=>p.filter(g=>String(g.id)!==String(id))); if(gown){setArchived(p=>[{...gown,isActive:false},...p]);setArcCount(c=>c+1)}
        showToast(`"${name}" archived`)
      }else{
        const res=await fetch('/api/admin/gowns',{method:'PUT',headers:headers(),body:JSON.stringify({id,restore:true})}); const data=await res.json(); if(!res.ok)throw new Error(data.error||'Failed')
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
      const res=await fetch(`/api/admin/gowns?id=${id}&permanent`,{method:'DELETE',headers:headers()}); const data=await res.json(); if(!res.ok)throw new Error(data.error||'Failed')
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
      {/*
        ── NO :root or @media tokens here ──────────────────────────────────────
        All CSS custom properties (--c-bg, --c-surface, etc.) are defined in
        layout.js with three-layer priority:
          1. :root                       dark default
          2. @media prefers-color-scheme OS light (with dark-override guard)
          3. [data-adm-theme]            manual toggle, always wins
        This style block contains only component-scoped rules.
      */}
      <style>{`
        /* ── SizePicker ── */
        .sp-root{display:flex;flex-direction:column;gap:8px;}
        .sp-section-label{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--c-subtle);}
        .sp-grid{display:flex;flex-wrap:wrap;gap:5px;}
        .sp-btn{
          padding:5px 11px;border-radius:6px;font-size:12px;font-weight:500;
          border:1px solid var(--c-border);background:var(--c-surface2);
          color:var(--c-text);cursor:pointer;transition:all .13s;
          display:inline-flex;align-items:center;gap:4px;
          white-space:nowrap;user-select:none;
        }
        .sp-btn:not(:disabled):hover{border-color:var(--c-gold);background:var(--c-gold-dim);color:var(--c-gold);}
        .sp-btn--taken{opacity:.38;cursor:not-allowed;background:var(--c-surface);}
        .sp-btn--custom{border-style:dashed;color:var(--c-muted);}
        .sp-btn--custom:not(:disabled):hover{border-color:var(--c-blue);background:var(--c-blue-dim);color:var(--c-blue);}
        .sp-btn--custom-active{border-color:var(--c-blue);background:var(--c-blue-dim);color:var(--c-blue);}
        .sp-check{font-size:9px;color:var(--c-green);}
        .sp-custom-row{display:flex;gap:7px;align-items:center;}
        .sp-custom-input{
          flex:1;padding:7px 10px;border:1px solid var(--c-border);border-radius:var(--radius);
          font-size:13px;background:var(--c-surface2);color:var(--c-text);min-width:0;
        }
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

        /* ── Calibration ── */
        .cal-editor{margin-top:10px;}
        .cal-toggle{display:flex;align-items:center;gap:7px;background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius);padding:8px 12px;font-size:12px;font-weight:500;color:var(--c-text);cursor:pointer;width:100%;text-align:left;transition:background .12s;}
        .cal-toggle:hover{background:var(--c-surface2);}
        .cal-panel{margin-top:8px;border:1px solid var(--c-border);border-radius:var(--radius-lg);overflow:hidden;}
        .cal-inner{display:grid;grid-template-columns:1fr 160px;}
        .cal-sliders{padding:14px;display:flex;flex-direction:column;gap:10px;border-right:1px solid var(--c-border);}
        .cal-desc{font-size:11px;color:var(--c-muted);line-height:1.6;}
        .cal-row{display:flex;flex-direction:column;gap:3px;}
        .cal-row-header{display:flex;justify-content:space-between;align-items:baseline;}
        .cal-val{font-size:11px;font-weight:600;color:var(--c-gold);font-variant-numeric:tabular-nums;}
        .cal-hint{font-size:10px;color:var(--c-subtle);}
        .cal-preview-wrap{display:flex;flex-direction:column;align-items:center;padding:12px;background:var(--c-surface2);}
        .cal-preview-label{font-size:10px;font-weight:700;color:var(--c-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;}
        .cal-preview-canvas{border-radius:6px;background:var(--c-surface);border:1px solid var(--c-border);}
        .range-input{width:100%;accent-color:var(--c-gold);}

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

        /* ── Page ── */
        .page{padding:28px 32px;max-width:900px;margin:0 auto;}
        .page-topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;}
        .page-title{font-size:22px;font-weight:700;letter-spacing:-.3px;}
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

        @media(max-width:680px){
          .page{padding:16px;}
          .form-grid-2{grid-template-columns:1fr;}
          .form-images-grid{grid-template-columns:1fr;}
          .cal-inner{grid-template-columns:1fr;}
          .gown-card{grid-template-columns:56px 1fr;}
          .gown-card-actions{flex-direction:row;grid-column:1/-1;flex-wrap:wrap;}
          .detail-layout{grid-template-columns:1fr;}
          .sidebar{max-width:100vw;}
          .stock-header,.stock-row{grid-template-columns:60px 70px 60px 50px 28px;}
          .stock-dropdown-panel{width:calc(100vw - 32px);right:auto;left:0;}
          .sp-grid{gap:4px;}
          .sp-btn{padding:5px 8px;font-size:11px;}
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
            <input className="search-input" placeholder="Search by name, color, silhouette…" value={search} onChange={e=>setSearch(e.target.value)}/>
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