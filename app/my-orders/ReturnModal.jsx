'use client'

// app/my-orders/ReturnModal.jsx
// Changes vs original:
//   • New EvidenceUploader section — drag-drop or click to add photos / videos
//   • Files are uploaded to /api/returns/upload BEFORE the return is submitted
//   • evidenceUrls array is included in the POST /api/returns body

import { useState, useEffect, useCallback, useRef } from 'react'

const REQUEST_TYPES = [
  { id: 'return',   label: 'Return',   icon: '↩', desc: 'Send item(s) back to the boutique.' },
  { id: 'refund',   label: 'Refund',   icon: '₱', desc: 'Request your money back.' },
  { id: 'exchange', label: 'Exchange', icon: '⇄', desc: 'Swap for a different size or style.' },
]

const REASONS = [
  'Item is defective or damaged',
  'Item differs significantly from description',
  'Wrong size received',
  'Wrong item received',
  'Other',
]

const MAX_FILES     = 5
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/x-m4v',
]

function fmtPhp(n) {
  return '₱' + Number(n || 0).toLocaleString('en-PH')
}

function isVideo(type) {
  return type?.startsWith('video/')
}

// ── EvidenceUploader ──────────────────────────────────────────────────────────

function EvidenceUploader({ files, setFiles, uploading, setUploading, userId, order }) {
  const inputRef    = useRef(null)
  const [dragOver,  setDragOver ] = useState(false)
  const [uploadErr, setUploadErr] = useState('')

  const addFiles = useCallback(async (incoming) => {
    setUploadErr('')
    const filtered = []

    for (const f of incoming) {
      if (!ALLOWED_TYPES.includes(f.type)) {
        setUploadErr(`"${f.name}" is not a supported format (JPEG, PNG, WEBP, GIF, MP4, MOV).`)
        return
      }
      if (f.size > MAX_FILE_SIZE) {
        setUploadErr(`"${f.name}" exceeds the 20 MB limit.`)
        return
      }
      filtered.push(f)
    }

    if (files.length + filtered.length > MAX_FILES) {
      setUploadErr(`You can attach up to ${MAX_FILES} files.`)
      return
    }

    // Upload immediately so we have URLs ready when the form submits
    setUploading(true)
    try {
      const form = new FormData()
      filtered.forEach(f => form.append('file', f))

      const res  = await fetch('/api/returns/upload', {
        method:  'POST',
        credentials: 'include',
        body:    form,
      })
      const data = await res.json()
      if (!data.ok) {
        setUploadErr(data.error || 'Upload failed. Please try again.')
        return
      }
      // Merge with local preview info
      const enriched = data.files.map((f, i) => ({
        ...f,
        localUrl: URL.createObjectURL(filtered[i]),
      }))
      setFiles(prev => [...prev, ...enriched])
    } catch {
      setUploadErr('Could not reach the server. Please try again.')
    } finally {
      setUploading(false)
    }
  }, [files, order.userId, setFiles, setUploading])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length) addFiles(dropped)
  }, [addFiles])

  const handleInput = useCallback((e) => {
    const chosen = Array.from(e.target.files || [])
    if (chosen.length) addFiles(chosen)
    e.target.value = ''
  }, [addFiles])

  const removeFile = useCallback((idx) => {
    setFiles(prev => {
      const next = [...prev]
      if (next[idx]?.localUrl) URL.revokeObjectURL(next[idx].localUrl)
      next.splice(idx, 1)
      return next
    })
    setUploadErr('')
  }, [setFiles])

  return (
    <div style={{ marginBottom: 24 }}>
      <label style={{
        display: 'block', fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase',
        color: 'var(--mu, #9a8880)', marginBottom: 8, fontFamily: 'Jost, sans-serif',
      }}>
        Evidence photos / videos{' '}
        <span style={{ fontSize: 9, fontWeight: 300, opacity: .7 }}>(optional · max {MAX_FILES})</span>
      </label>

      {/* Drop zone */}
      {files.length < MAX_FILES && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !uploading && inputRef.current?.click()}
          style={{
            border: `1.5px dashed ${dragOver ? 'var(--wb, #7a5a44)' : 'var(--ch, #e8e0da)'}`,
            borderRadius: 4,
            padding: '20px 12px',
            textAlign: 'center',
            cursor: uploading ? 'wait' : 'pointer',
            background: dragOver ? 'rgba(122,90,68,.05)' : 'transparent',
            transition: 'all .15s',
            marginBottom: files.length ? 10 : 0,
          }}
        >
          <div style={{ fontSize: 22, marginBottom: 6, opacity: .5 }}>
            {uploading ? '⏳' : '📎'}
          </div>
          <p style={{
            margin: 0, fontSize: 12, color: 'var(--mu, #9a8880)',
            fontFamily: 'Jost, sans-serif', lineHeight: 1.6,
          }}>
            {uploading
              ? 'Uploading…'
              : <>
                  <span style={{ color: 'var(--wb, #7a5a44)', fontWeight: 500 }}>Click to add</span>
                  {' '}or drag &amp; drop<br />
                  <span style={{ fontSize: 10 }}>JPEG · PNG · WEBP · GIF · MP4 · MOV — max 20 MB each</span>
                </>
            }
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ALLOWED_TYPES.join(',')}
            onChange={handleInput}
            style={{ display: 'none' }}
          />
        </div>
      )}

      {/* Thumbnails */}
      {files.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
          gap: 8,
          marginTop: 8,
        }}>
          {files.map((f, i) => (
            <div key={i} style={{ position: 'relative' }}>
              {isVideo(f.type) ? (
                <video
                  src={f.localUrl}
                  style={{
                    width: '100%', aspectRatio: '1', objectFit: 'cover',
                    borderRadius: 4, border: '1px solid var(--ch, #e8e0da)',
                    display: 'block',
                  }}
                  muted
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={f.localUrl}
                  alt={f.name}
                  style={{
                    width: '100%', aspectRatio: '1', objectFit: 'cover',
                    borderRadius: 4, border: '1px solid var(--ch, #e8e0da)',
                    display: 'block',
                  }}
                />
              )}
              {/* Video badge */}
              {isVideo(f.type) && (
                <span style={{
                  position: 'absolute', bottom: 4, left: 4,
                  fontSize: 9, background: 'rgba(0,0,0,.55)', color: '#fff',
                  borderRadius: 2, padding: '1px 4px', fontFamily: 'Jost, sans-serif',
                }}>
                  VIDEO
                </span>
              )}
              {/* Remove button */}
              <button
                onClick={() => removeFile(i)}
                aria-label="Remove file"
                style={{
                  position: 'absolute', top: 3, right: 3,
                  width: 18, height: 18, borderRadius: '50%',
                  background: 'rgba(44,36,32,.7)', color: '#fff',
                  border: 'none', cursor: 'pointer',
                  fontSize: 10, lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {uploadErr && (
        <p style={{ fontSize: 11, color: '#a32d2d', marginTop: 6, fontFamily: 'Jost, sans-serif' }}>
          {uploadErr}
        </p>
      )}
    </div>
  )
}

// ── ReturnModal ───────────────────────────────────────────────────────────────

export default function ReturnModal({ order, onClose, onSuccess }) {
  const [type,        setType       ] = useState('return')
  const [reason,      setReason     ] = useState('')
  const [details,     setDetails    ] = useState('')
  const [selectedIds, setSelectedIds] = useState(() =>
    (order.items || []).map((_, i) => i)
  )
  const [evidenceFiles, setEvidenceFiles] = useState([])   // { url, name, type, localUrl }[]
  const [uploading,     setUploading    ] = useState(false)
  const [submitting,    setSubmitting   ] = useState(false)
  const [error,         setError        ] = useState('')
  const [done,          setDone         ] = useState(false)

  // Escape key closes
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Revoke object URLs on unmount
  useEffect(() => {
    return () => {
      evidenceFiles.forEach(f => { if (f.localUrl) URL.revokeObjectURL(f.localUrl) })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleItem = useCallback((idx) => {
    setSelectedIds(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    )
  }, [])

  const handleSubmit = async () => {
    setError('')
    if (!reason)               { setError('Please select a reason.'); return }
    if (selectedIds.length === 0) { setError('Select at least one item.'); return }
    if (uploading)             { setError('Please wait for uploads to finish.'); return }

    setSubmitting(true)
    try {
      const items = selectedIds.map(idx => {
        const item = order.items[idx]
        return {
          gownId:    item.id    || item.gownId,
          gownName:  item.name  || item.gownName,
          sizeLabel: item.size  || item.sizeLabel || null,
          quantity:  item.qty   || item.quantity  || 1,
        }
      })

      const res  = await fetch('/api/returns', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          orderId:      order.id,
          type,
          reason,
          details:      details.trim(),
          items,
          // Strip the local preview URL before sending — only send the server URLs
          evidenceUrls: evidenceFiles.map(({ url, name, type: t }) => ({ url, name, type: t })),
        }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error || 'Submission failed. Please try again.'); return }
      setDone(true)
      if (onSuccess) setTimeout(onSuccess, 1600)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(44,36,32,.45)',
          zIndex: 1200,
          backdropFilter: 'blur(2px)',
          animation: 'mo-fade-in .18s ease',
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Submit after-sales request"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: 'min(460px, 100vw)',
          background: 'var(--iv, #faf7f4)',
          zIndex: 1201,
          display: 'flex', flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(44,26,16,.12)',
          animation: 'mo-slide-in .22s ease',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '24px 28px 20px',
          borderBottom: '1px solid var(--ch, #e8e0da)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        }}>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase', color: 'var(--mu, #9a8880)', fontFamily: 'Jost, sans-serif' }}>
              After-Sales Request
            </p>
            <h2 style={{ margin: '0 0 4px', fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 400, color: 'var(--es, #2c2420)' }}>
              {order.orderNumber}
            </h2>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--mu, #9a8880)', fontFamily: 'Jost, sans-serif' }}>
              {fmtPhp(order.total)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--mu, #9a8880)', fontSize: 18, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {done ? (
            <div style={{ textAlign: 'center', paddingTop: 60 }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: '#d4edda',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24, margin: '0 auto 18px',
              }}>
                ✓
              </div>
              <p style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, fontWeight: 400, color: 'var(--es, #2c2420)', margin: '0 0 10px' }}>
                Request submitted
              </p>
              <p style={{ fontSize: 13, color: 'var(--mu, #9a8880)', lineHeight: 1.7, margin: 0 }}>
                We&rsquo;ll review your request within 1&ndash;2 business days and notify you by email.
              </p>
            </div>
          ) : (
            <>
              {/* Policy reminder */}
              <div style={{
                padding: '12px 14px', marginBottom: 24,
                background: '#fff8f0', border: '1px solid #f0ddc0',
                borderRadius: 4, fontSize: 11, color: '#7a5a2a', lineHeight: 1.6,
                fontFamily: 'Jost, sans-serif',
              }}>
                <strong>Policy:</strong> Returns accepted within 48 hours of order completion for defective or significantly different items. Items must be unworn, unaltered, with tags attached.
              </div>

              {/* Request type */}
              <fieldset style={{ border: 'none', margin: '0 0 24px', padding: 0 }}>
                <legend style={{ fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase', color: 'var(--mu, #9a8880)', marginBottom: 10, fontFamily: 'Jost, sans-serif' }}>
                  Request type
                </legend>
                <div style={{ display: 'flex', gap: 8 }}>
                  {REQUEST_TYPES.map(rt => (
                    <button
                      key={rt.id}
                      onClick={() => setType(rt.id)}
                      style={{
                        flex: 1, padding: '10px 6px',
                        border: `1px solid ${type === rt.id ? 'var(--wb, #7a5a44)' : 'var(--ch, #e8e0da)'}`,
                        borderRadius: 4, background: type === rt.id ? 'var(--ch, #e8e0da)' : 'transparent',
                        cursor: 'pointer', textAlign: 'center', transition: 'all .15s',
                        fontFamily: 'Jost, sans-serif',
                      }}
                    >
                      <div style={{ fontSize: 16, marginBottom: 4 }}>{rt.icon}</div>
                      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--es, #2c2420)' }}>{rt.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--mu, #9a8880)', lineHeight: 1.4, marginTop: 2 }}>{rt.desc}</div>
                    </button>
                  ))}
                </div>
              </fieldset>

              {/* Items */}
              <fieldset style={{ border: 'none', margin: '0 0 24px', padding: 0 }}>
                <legend style={{ fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase', color: 'var(--mu, #9a8880)', marginBottom: 10, fontFamily: 'Jost, sans-serif' }}>
                  Items included
                </legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(order.items || []).map((item, idx) => {
                    const checked = selectedIds.includes(idx)
                    return (
                      <label
                        key={idx}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 12px',
                          border: `1px solid ${checked ? 'var(--wb, #7a5a44)' : 'var(--ch, #e8e0da)'}`,
                          borderRadius: 4, cursor: 'pointer',
                          background: checked ? 'rgba(122,90,68,.05)' : 'transparent',
                          transition: 'all .15s', fontFamily: 'Jost, sans-serif',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleItem(idx)}
                          style={{ accentColor: 'var(--wb, #7a5a44)', width: 15, height: 15 }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: 'var(--es, #2c2420)', fontWeight: 400 }}>
                            {item.name || item.gownName}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--mu, #9a8880)' }}>
                            {[item.size || item.sizeLabel, `×${item.qty || item.quantity || 1}`].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </fieldset>

              {/* Reason */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase', color: 'var(--mu, #9a8880)', marginBottom: 8, fontFamily: 'Jost, sans-serif' }}>
                  Reason <span style={{ color: '#e24b4a' }}>*</span>
                </label>
                <select
                  value={reason}
                  onChange={e => { setReason(e.target.value); setError('') }}
                  style={{
                    width: '100%', padding: '10px 12px',
                    border: '1px solid var(--ch, #e8e0da)', borderRadius: 4,
                    background: 'transparent', color: reason ? 'var(--es, #2c2420)' : 'var(--mu, #9a8880)',
                    fontSize: 13, fontFamily: 'Jost, sans-serif', appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239a8880' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
                  }}
                >
                  <option value="">Select a reason…</option>
                  {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* Details */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 9, letterSpacing: '.35em', textTransform: 'uppercase', color: 'var(--mu, #9a8880)', marginBottom: 8, fontFamily: 'Jost, sans-serif' }}>
                  Additional details <span style={{ fontSize: 9, fontWeight: 300, opacity: .7 }}>(optional)</span>
                </label>
                <textarea
                  value={details}
                  onChange={e => setDetails(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Describe the issue in more detail…"
                  style={{
                    width: '100%', padding: '10px 12px',
                    border: '1px solid var(--ch, #e8e0da)', borderRadius: 4,
                    background: 'transparent', color: 'var(--es, #2c2420)',
                    fontSize: 13, fontFamily: 'Jost, sans-serif',
                    resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6,
                  }}
                />
                <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--mu, #9a8880)', textAlign: 'right' }}>
                  {details.length}/500
                </p>
              </div>

              {/* ── Evidence uploader (NEW) ── */}
              <EvidenceUploader
                files={evidenceFiles}
                setFiles={setEvidenceFiles}
                uploading={uploading}
                setUploading={setUploading}
                userId={order.userId}
                order={order}
              />

              {error && (
                <p style={{ fontSize: 12, color: '#a32d2d', marginBottom: 16, fontFamily: 'Jost, sans-serif' }}>
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!done && (
          <div style={{
            padding: '18px 28px',
            borderTop: '1px solid var(--ch, #e8e0da)',
            display: 'flex', gap: 10,
          }}>
            <button
              onClick={handleSubmit}
              disabled={submitting || uploading}
              style={{
                flex: 1, padding: '12px 0',
                background: (submitting || uploading) ? 'var(--mu, #9a8880)' : 'var(--es, #2c2420)',
                color: 'var(--iv, #faf7f4)',
                border: 'none', borderRadius: 0,
                cursor: (submitting || uploading) ? 'not-allowed' : 'pointer',
                fontSize: 10, letterSpacing: '.3em', textTransform: 'uppercase',
                fontFamily: 'Jost, sans-serif', fontWeight: 500,
                transition: 'background .15s',
              }}
            >
              {uploading ? 'Uploading files…' : submitting ? 'Submitting…' : 'Submit request'}
            </button>
            <button
              onClick={onClose}
              disabled={submitting || uploading}
              style={{
                padding: '12px 20px', background: 'transparent',
                border: '1px solid var(--ch, #e8e0da)', borderRadius: 0,
                cursor: 'pointer', fontSize: 10, letterSpacing: '.3em', textTransform: 'uppercase',
                fontFamily: 'Jost, sans-serif', color: 'var(--mu, #9a8880)',
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes mo-fade-in  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes mo-slide-in { from { transform: translateX(100%) } to { transform: translateX(0) } }
      `}</style>
    </>
  )
}