'use client'

/**
 * app/components/GownMatteTool.jsx
 *
 * Staff tool: pick a gown photo -> transparent try-on cut-out.
 * Runs entirely in the browser (see lib/fitting-room/matte.js). No server calls.
 *
 * Props:
 *   onResult  fn({ file, blob, url, width, height, warnings })  optional. Called when a cut-out is ready,
 *             so a gown form can attach `file` as the gown's try-on image.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { matteGown } from '../../lib/fitting-room/matte.js'

const CHECKER = 'repeating-conic-gradient(#d9d6d0 0% 25%, #f4f2ee 0% 50%) 50% / 20px 20px'

export default function GownMatteTool({ onResult }) {
  const [src,        setSrc       ] = useState(null)      // original preview url
  const [fileName,   setFileName  ] = useState('')
  const [removeSkin, setRemoveSkin] = useState(true)
  const [busy,       setBusy      ] = useState(false)
  const [status,     setStatus    ] = useState('')
  const [result,     setResult    ] = useState(null)
  const [error,      setError     ] = useState('')
  const [dark,       setDark      ] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => () => {
    if (src) URL.revokeObjectURL(src)
    if (result?.url) URL.revokeObjectURL(result.url)
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async (file) => {
    if (!file) return
    setBusy(true); setError(''); setStatus('Starting…')
    setResult(prev => { if (prev?.url) URL.revokeObjectURL(prev.url); return null })
    try {
      const r = await matteGown(file, { removeSkin, onStatus: setStatus })
      setResult(r)
      if (r.ok && onResult) {
        const ext = r.blob.type === 'image/webp' ? 'webp' : 'png'
        const base = (file.name || 'gown').replace(/\.[^.]+$/, '')
        onResult({ ...r, file: new File([r.blob], `${base}-tryon.${ext}`, { type: r.blob.type }) })
      }
    } catch (e) {
      console.error('[GownMatteTool]', e)
      setError(e?.message || 'Cut-out failed. Check the console.')
    } finally {
      setBusy(false); setStatus('')
    }
  }, [removeSkin, onResult])

  const onPick = e => {
    const f = e.target.files?.[0]
    if (!f) return
    if (src) URL.revokeObjectURL(src)
    setSrc(URL.createObjectURL(f)); setFileName(f.name); setResult(null); setError('')
    fileRef.current = f
    run(f)
  }

  const ext = result?.blob?.type === 'image/webp' ? 'webp' : 'png'
  const dlName = `${(fileName || 'gown').replace(/\.[^.]+$/, '')}-tryon.${ext}`

  return (
    <div style={{ maxWidth: 880, fontSize: 13, color: '#1a1108' }}>
      <h3 style={{ margin: '0 0 4px', fontWeight: 600 }}>Try-on cut-out</h3>
      <p style={{ margin: '0 0 12px', color: '#777', lineHeight: 1.5 }}>
        Upload the product photo. The gown is cut out on your computer (nothing is uploaded) and saved with a transparent background for the try-on.
        First run downloads the model (~200 MB), then it is cached. Chrome or Edge on desktop is fastest.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onPick} disabled={busy} aria-label="Gown photo" />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={removeSkin} onChange={e => setRemoveSkin(e.target.checked)} disabled={busy} />
          Remove model (face, hair, skin)
        </label>
        {fileRef.current && !busy && (
          <button type="button" onClick={() => run(fileRef.current)}
            style={{ padding: '6px 12px', border: '1px solid #c9a96e', background: 'transparent', color: '#7a5a1a', borderRadius: 6, cursor: 'pointer' }}>
            Run again
          </button>
        )}
      </div>

      {busy && <p role="status" aria-live="polite" style={{ color: '#7a5a1a' }}>{status || 'Working…'}</p>}
      {error && <p role="alert" style={{ background: '#fcebeb', color: '#501313', border: '1px solid #f09595', padding: '8px 12px', borderRadius: 7 }}>{error}</p>}

      {result && !result.ok && (
        <div role="alert" style={{ background: '#fcebeb', color: '#501313', border: '1px solid #f09595', padding: '8px 12px', borderRadius: 7 }}>
          {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      {result?.ok && result.warnings.length > 0 && (
        <div role="status" style={{ background: '#fff8ec', color: '#7a5a1a', border: '1px solid #e8d5a8', padding: '8px 12px', borderRadius: 7, marginBottom: 10, lineHeight: 1.5 }}>
          {result.warnings.map((w, i) => <div key={i}>• {w}</div>)}
        </div>
      )}

      {(src || result?.ok) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <figure style={{ margin: 0 }}>
            <figcaption style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>Original</figcaption>
            {src && <img src={src} alt="Original gown photo" style={{ width: '100%', maxHeight: 520, objectFit: 'contain', background: '#f4f2ee', borderRadius: 8 }} />}
          </figure>
          <figure style={{ margin: 0 }}>
            <figcaption style={{ fontSize: 11, color: '#999', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
              <span>Cut-out{result?.ok ? ` · ${result.width}×${result.height} · ${(result.blob.size / 1024).toFixed(0)} KB · ${(result.ms / 1000).toFixed(1)}s` : ''}</span>
              <button type="button" onClick={() => setDark(d => !d)} style={{ border: 'none', background: 'none', color: '#7a5a1a', cursor: 'pointer', fontSize: 11 }}>
                {dark ? 'Checkerboard' : 'Dark'} background
              </button>
            </figcaption>
            <div style={{ background: dark ? '#0d0a07' : CHECKER, borderRadius: 8, minHeight: 120 }}>
              {result?.ok && <img src={result.url} alt="Gown cut-out preview" style={{ width: '100%', maxHeight: 520, objectFit: 'contain', display: 'block' }} />}
            </div>
          </figure>
        </div>
      )}

      {result?.ok && (
        <p style={{ marginTop: 12 }}>
          <a href={result.url} download={dlName}
            style={{ padding: '8px 14px', background: '#1a1108', color: '#faf9f7', borderRadius: 7, textDecoration: 'none', fontSize: 12, fontWeight: 500 }}>
            Download {dlName}
          </a>
        </p>
      )}
    </div>
  )
}