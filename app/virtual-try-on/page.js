'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser } from '../utils/authClient'

// ── CDN scripts ───────────────────────────────────────────────────────────────
// Must load in this exact order — each registers globals the next one needs.

const POSE_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.10.0/dist/tf-core.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.10.0/dist/tf-converter.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@4.10.0/dist/tf-backend-webgl.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js',
]
const SEG_SCRIPT = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/body-segmentation@1.0.1/dist/body-segmentation.min.js'

// ── Keypoint indices (MoveNet) ────────────────────────────────────────────────

const KP   = { LS:5, RS:6, LH:11, RH:12, LK:13, RK:14, LA:15, RA:16 }
const CONF = 0.26

// ── Script loader — sequential, idempotent ────────────────────────────────────

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script')
    s.src   = src
    s.async = false       // preserve execution order
    s.onload  = resolve
    s.onerror = () => reject(new Error('Failed to load: ' + src))
    document.head.appendChild(s)
  })
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function mid(a, b) { return { x:(a.x+b.x)/2, y:(a.y+b.y)/2 } }
function dist(a, b) { return Math.hypot(a.x-b.x, a.y-b.y) }

function lerpN(a, b, t) { return a + (b - a) * t }
function lerpPt(a, b, t) { return { x: lerpN(a.x,b.x,t), y: lerpN(a.y,b.y,t), score: b.score } }
function smoothKps(prev, curr, t = 0.22) {
  if (!prev) return curr
  return curr.map((k, i) => lerpPt(prev[i], k, t))
}

// ── Gown layout — torso + trapezoid skirt ─────────────────────────────────────

function getGownLayout(kps) {
  const ls=kps[KP.LS], rs=kps[KP.RS]
  const lh=kps[KP.LH], rh=kps[KP.RH]
  const la=kps[KP.LA], ra=kps[KP.RA]
  const lk=kps[KP.LK], rk=kps[KP.RK]

  if ([ls,rs,lh,rh].some(k => !k || k.score < CONF)) return null

  const sm = mid(ls, rs)   // shoulder midpoint
  const hm = mid(lh, rh)   // hip midpoint
  const sw = dist(ls, rs)  // shoulder width px
  const hw = dist(lh, rh)  // hip width px

  const topY = sm.y - sw * 0.22    // above neckline
  const hipY = hm.y

  let bottomY
  if (la?.score > CONF && ra?.score > CONF) {
    bottomY = Math.max(la.y, ra.y) + sw * 0.08
  } else if (lk?.score > CONF && rk?.score > CONF) {
    const km = mid(lk, rk)
    bottomY  = km.y + (km.y - hipY) * 0.9
  } else {
    const torsoH = hipY - sm.y
    bottomY = hipY + torsoH * 1.7
  }

  const torsoW    = sw * 1.55
  const skirtTopW = Math.max(hw * 1.8, torsoW)
  const skirtBotW = skirtTopW * 1.35  // A-line flare

  return {
    torso: { x: sm.x - torsoW/2, y: topY, width: torsoW, height: hipY - topY },
    skirt: { cx: hm.x, y: hipY, topWidth: skirtTopW, botWidth: skirtBotW, height: bottomY - hipY },
  }
}

// ── Brightness sample ─────────────────────────────────────────────────────────

function sampleBrightness(ctx, w, h) {
  try {
    const data = ctx.getImageData(0, 0, w, h).data
    let sum = 0, count = 0
    const step = Math.max(1, Math.floor(data.length / 800))
    for (let i = 0; i < data.length; i += step * 4) {
      sum += data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114
      count++
    }
    return count ? sum / count : 128
  } catch { return 128 }
}

// ── Draw gown: torso rectangle + trapezoid skirt ──────────────────────────────

function drawGown(ctx, img, layout, opacity) {
  const { torso, skirt } = layout
  const gH = img.naturalHeight || img.height
  const gW = img.naturalWidth  || img.width
  const splitFrac = 0.42   // ~hip line in most gown photos

  ctx.save()
  ctx.globalAlpha = opacity

  // Torso
  ctx.save()
  ctx.beginPath()
  ctx.rect(torso.x, torso.y, torso.width, torso.height)
  ctx.clip()
  ctx.drawImage(img, 0, 0, gW, gH * splitFrac, torso.x, torso.y, torso.width, torso.height)
  ctx.restore()

  // Skirt — trapezoid clip
  const { cx, y: sy, topWidth: tw, botWidth: bw, height: sh } = skirt
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(cx - tw/2, sy)
  ctx.lineTo(cx + tw/2, sy)
  ctx.lineTo(cx + bw/2, sy + sh)
  ctx.lineTo(cx - bw/2, sy + sh)
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(img, 0, gH * splitFrac, gW, gH * (1 - splitFrac), cx - bw/2, sy, bw, sh)
  ctx.restore()

  ctx.restore()
}

// ── Segmentation: person composited on top of gown ───────────────────────────

async function applySegmentation(segmenter, video, ctx, w, h) {
  if (!segmenter) return
  try {
    const result = await segmenter.segmentPeople(video, { multiSegmentation: false, segmentBodyParts: false })
    if (!result?.length) return

    const mask = await window.bodySegmentation.toBinaryMask(
      result,
      { r:0, g:0, b:0, a:0 },
      { r:0, g:0, b:0, a:255 },
      false
    )

    // Build person-only canvas
    const oc  = document.createElement('canvas')
    oc.width  = w; oc.height = h
    const octx = oc.getContext('2d')
    octx.save()
    octx.translate(w, 0); octx.scale(-1, 1)
    octx.drawImage(video, 0, 0, w, h)
    octx.restore()

    // Invert mask — keep person pixels, drop background
    octx.globalCompositeOperation = 'destination-in'
    const mc   = document.createElement('canvas')
    mc.width   = w; mc.height = h
    const mctx = mc.getContext('2d')
    const mdat = mctx.createImageData(w, h)
    for (let i = 0; i < mask.data.length; i += 4) {
      mdat.data[i]   = 255
      mdat.data[i+1] = 255
      mdat.data[i+2] = 255
      mdat.data[i+3] = 255 - mask.data[i+3]  // invert alpha
    }
    mctx.putImageData(mdat, 0, 0)
    octx.drawImage(mc, 0, 0)

    ctx.drawImage(oc, 0, 0)
  } catch { /* silent — segmentation is best-effort */ }
}

// ── Camera access check ───────────────────────────────────────────────────────

async function checkCameraAccess() {
  const isInsecure = location.protocol === 'http:' && location.hostname !== 'localhost'
  if (isInsecure) {
    return {
      ok: false,
      error: `Camera requires HTTPS.\nYou're on http://${location.hostname} — open http://localhost:3000 or deploy with HTTPS (Vercel/Netlify do this automatically).`,
    }
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, error: 'Your browser does not support camera access. Try Chrome or Edge.' }
  }
  try {
    const perm = await navigator.permissions.query({ name: 'camera' })
    if (perm.state === 'denied') {
      return {
        ok: false,
        error: 'Camera access is blocked.\nClick the camera icon in your address bar → Allow → then refresh.',
      }
    }
  } catch {}
  try {
    const devs = await navigator.mediaDevices.enumerateDevices()
    if (!devs.some(d => d.kind === 'videoinput')) {
      return { ok: false, error: 'No camera found on this device.' }
    }
  } catch {}
  return { ok: true }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VirtualTryOnPage() {
  const searchParams = useSearchParams()

  const videoRef     = useRef(null)
  const canvasRef    = useRef(null)
  const detectorRef  = useRef(null)
  const segmenterRef = useRef(null)
  const gownImgRef   = useRef(null)
  const prevKpsRef   = useRef(null)
  const animRef      = useRef(null)
  const streamRef    = useRef(null)

  const [gowns,        setGowns       ] = useState([])
  const [loadingGowns, setLoadingGowns] = useState(true)
  const [selectedGown, setSelectedGown] = useState(null)

  const [modelState,   setModelState  ] = useState('idle')   // idle|loading|ready|error
  const [modelStep,    setModelStep   ] = useState('')
  const [modelPct,     setModelPct    ] = useState(0)

  const [camState,     setCamState    ] = useState('off')    // off|starting|on|error
  const [camError,     setCamError    ] = useState('')
  const [poseFound,    setPoseFound   ] = useState(false)

  const [opacity,      setOpacity     ] = useState(0.88)
  const [lightHint,    setLightHint   ] = useState('')       // ''|'dark'|'bright'|'good'
  const [enhancedMode, setEnhancedMode] = useState(false)
  const [segLoading,   setSegLoading  ] = useState(false)

  const [captured,     setCaptured    ] = useState(null)
  const [saving,       setSaving      ] = useState(false)
  const [saveMsg,      setSaveMsg     ] = useState('')

  const user     = typeof window !== 'undefined' ? getCurrentUser() : null
  const camReady = camState === 'on'
  const canCap   = camReady && poseFound && !captured

  // ── Load gowns + honour ?gown= param ─────────────────────────────────────────
  // Connection: detail page passes /try-on?gown=<id> — we pre-select that gown.

  useEffect(() => {
    const paramId = searchParams.get('gown')
    fetch('/api/gowns')
      .then(r => r.json())
      .then(d => {
        const list = (d.gowns || []).filter(g => g.image)
        setGowns(list)
        if (!list.length) return
        // If URL has ?gown=id, pre-select it; otherwise default to first
        const fromParam = paramId ? list.find(g => String(g.id) === String(paramId)) : null
        setSelectedGown(fromParam || list[0])
      })
      .catch(() => {})
      .finally(() => setLoadingGowns(false))
  }, [searchParams])

  // Preload gown image on selection change
  useEffect(() => {
    if (!selectedGown?.image) return
    const img       = new Image()
    img.crossOrigin = 'anonymous'
    img.onload      = () => { gownImgRef.current = img }
    img.onerror     = () => { gownImgRef.current = null }
    img.src         = selectedGown.image
    setCaptured(null)
    setSaveMsg('')
  }, [selectedGown])

  // ── Load pose model ───────────────────────────────────────────────────────────

  const loadPoseModel = useCallback(async () => {
    setModelState('loading'); setModelPct(0); setCamError('')
    try {
      for (let i = 0; i < POSE_SCRIPTS.length; i++) {
        setModelStep(`Loading library ${i+1} of ${POSE_SCRIPTS.length}…`)
        setModelPct(Math.round((i / POSE_SCRIPTS.length) * 80))
        await loadScript(POSE_SCRIPTS[i])
      }

      setModelStep('Initialising TensorFlow…'); setModelPct(85)
      await window.tf.ready()
      try { await window.tf.setBackend('webgl') }
      catch { await window.tf.setBackend('cpu') }

      setModelStep('Loading pose detector…'); setModelPct(92)
      const pd = window.poseDetection
      detectorRef.current = await pd.createDetector(
        pd.SupportedModels.MoveNet,
        { modelType: pd.movenet.modelType.SINGLEPOSE_THUNDER }
      )

      setModelPct(100); setModelStep('Ready'); setModelState('ready')
    } catch (err) {
      console.error('Model load error:', err)
      setModelState('error')
      setModelStep(err.message || 'Failed to load AI model.')
    }
  }, [])

  useEffect(() => { loadPoseModel() }, [loadPoseModel])

  // ── Load segmentation model (enhanced mode only) ──────────────────────────────

  useEffect(() => {
    if (!enhancedMode || segmenterRef.current) return
    setSegLoading(true)
    ;(async () => {
      try {
        await loadScript(SEG_SCRIPT)
        const bs = window.bodySegmentation
        segmenterRef.current = await bs.createSegmenter(
          bs.SupportedModels.MediaPipeSelfieSegmentation,
          { runtime: 'tfjs' }
        )
      } catch (e) {
        console.warn('Segmentation failed to load:', e)
      } finally {
        setSegLoading(false)
      }
    })()
  }, [enhancedMode])

  // ── Camera ────────────────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    setCamError(''); setCamState('starting')
    const check = await checkCameraAccess()
    if (!check.ok) { setCamError(check.error); setCamState('error'); return }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width:{ideal:1280,max:1920}, height:{ideal:720,max:1080}, facingMode:'user', frameRate:{ideal:30} },
        audio: false,
      })
      streamRef.current          = stream
      videoRef.current.srcObject = stream

      await new Promise((res, rej) => {
        videoRef.current.onloadedmetadata = res
        videoRef.current.onerror          = rej
        setTimeout(() => rej(new Error('timeout')), 10000)
      })

      await videoRef.current.play()
      setCamState('on')
    } catch (err) {
      let msg = 'Could not start camera.'
      if (err.name === 'NotAllowedError')  msg = 'Camera permission denied.\nClick the camera icon in your address bar → Allow → refresh.'
      else if (err.name === 'NotFoundError')    msg = 'No camera found on this device.'
      else if (err.name === 'NotReadableError') msg = 'Camera is in use by another app (Zoom, Teams, etc.). Close those apps and try again.'
      else if (err.name === 'OverconstrainedError') {
        try {
          const s2 = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          streamRef.current = s2; videoRef.current.srcObject = s2
          await videoRef.current.play(); setCamState('on'); return
        } catch {}
        msg = 'Camera does not meet resolution requirements. Try a different camera.'
      } else if (err.message === 'timeout') {
        msg = 'Camera took too long to start. Please try again.'
      }
      setCamError(msg); setCamState('error')
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    prevKpsRef.current = null
    setCamState('off'); setPoseFound(false); setLightHint('')
  }, [])

  // ── Detection loop ────────────────────────────────────────────────────────────

  const detect = useCallback(async () => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) {
      animRef.current = requestAnimationFrame(detect); return
    }

    const dpr = window.devicePixelRatio || 1
    const vw  = video.videoWidth  || 640
    const vh  = video.videoHeight || 480

    canvas.width        = vw * dpr
    canvas.height       = vh * dpr
    canvas.style.width  = vw + 'px'
    canvas.style.height = vh + 'px'

    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Draw mirrored video
    ctx.save()
    ctx.translate(vw, 0); ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, vw, vh)
    ctx.restore()

    // Lighting hint
    const brightness = sampleBrightness(ctx, vw, vh)
    setLightHint(brightness < 55 ? 'dark' : brightness > 210 ? 'bright' : 'good')

    // Pose detection
    try {
      const poses = await detectorRef.current?.estimatePoses(video)
      if (poses?.length > 0) {
        let kps  = poses[0].keypoints.map(k => ({ ...k, x: vw - k.x }))
        kps      = smoothKps(prevKpsRef.current, kps)
        prevKpsRef.current = kps

        const layout = getGownLayout(kps)
        if (layout && gownImgRef.current) {
          setPoseFound(true)
          const adj = opacity * (brightness < 60 ? 0.78 : brightness > 200 ? 0.96 : 1)

          if (enhancedMode && segmenterRef.current) {
            drawGown(ctx, gownImgRef.current, layout, adj)
            await applySegmentation(segmenterRef.current, video, ctx, vw, vh)
          } else {
            drawGown(ctx, gownImgRef.current, layout, adj)
          }
        } else {
          setPoseFound(false)
        }
      } else {
        setPoseFound(false); prevKpsRef.current = null
      }
    } catch { /* skip frame */ }

    animRef.current = requestAnimationFrame(detect)
  }, [opacity, enhancedMode])

  useEffect(() => {
    if (camState === 'on' && modelState === 'ready') {
      detect()
    } else {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [camState, modelState, detect])

  // ── Capture / save / download ─────────────────────────────────────────────────

  const takePhoto = useCallback(() => {
    if (!canvasRef.current) return
    setCaptured(canvasRef.current.toDataURL('image/jpeg', 0.93))
  }, [])

  const retake = useCallback(() => { setCaptured(null); setSaveMsg('') }, [])

  const downloadPhoto = useCallback(() => {
    if (!captured) return
    const a = Object.assign(document.createElement('a'), {
      href:     captured,
      download: `jce-tryon-${(selectedGown?.name || 'photo').replace(/\s+/g, '-')}.jpg`,
    })
    a.click()
  }, [captured, selectedGown])

  const savePhoto = useCallback(async () => {
    if (!captured || !user) return
    setSaving(true); setSaveMsg('')
    try {
      const res  = await fetch('/api/auth/save-tryon', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body:    JSON.stringify({ image: captured, gownId: selectedGown?.id, gownName: selectedGown?.name }),
      })
      const data = await res.json()
      setSaveMsg(data.ok ? '✓ Saved to profile' : data.error || 'Save failed.')
    } catch { setSaveMsg('Could not save. Please try again.') }
    finally { setSaving(false) }
  }, [captured, user, selectedGown])

  // Cleanup
  useEffect(() => () => {
    stopCamera()
    detectorRef.current?.dispose?.()
    segmenterRef.current?.dispose?.()
  }, [stopCamera])

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <main className="to-page">
      <Header solid />
      <div className="to-spacer" />

      {/* Hero */}
      <section className="to-hero">
        <div className="to-hero-inner">
          <span className="to-eyebrow">FitMatcher · Virtual Try-On</span>
          <h1 className="to-h1">See it on <em>you</em></h1>
          <p className="to-sub">
            AI tracks your silhouette in real time and drapes the gown over your body.
            No fitting room. No commitment. Just clarity.
          </p>
        </div>
      </section>

      <div className="to-layout">

        {/* ── Sidebar ── */}
        <aside className="to-sidebar">
          <p className="to-sidebar-title">Choose a gown</p>

          {loadingGowns ? (
            <div className="to-gown-list">
              {[1,2,3].map(i => <div key={i} className="to-gown-sk" />)}
            </div>
          ) : gowns.length === 0 ? (
            <p className="to-muted">No gowns available.</p>
          ) : (
            <div className="to-gown-list">
              {gowns.map(g => (
                <button
                  key={g.id}
                  className={`to-gown-item${selectedGown?.id === g.id ? ' is-sel' : ''}`}
                  onClick={() => setSelectedGown(g)}
                >
                  <div className="to-gown-thumb">
                    <img src={g.image} alt={g.alt || g.name} />
                    {selectedGown?.id === g.id && <span className="to-gown-check">✓</span>}
                  </div>
                  <div className="to-gown-meta">
                    <span className="to-gown-name">{g.name}</span>
                    <span className="to-gown-price">{g.price}</span>
                    {g.color && <span className="to-gown-color">{g.color}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ── Connection: link back to the gown detail page ── */}
          {selectedGown && (
            <Link href={`/gowns/${selectedGown.id}`} className="to-view-link">
              ← Back to {selectedGown.name}
            </Link>
          )}

          {/* Opacity control — only when camera is running */}
          {camReady && (
            <div className="to-opacity-card">
              <div className="to-opacity-row">
                <span className="to-opacity-lbl">Gown opacity</span>
                <span className="to-opacity-val">{Math.round(opacity * 100)}%</span>
              </div>
              <input
                type="range" min="0.2" max="1" step="0.05"
                value={opacity} onChange={e => setOpacity(+e.target.value)}
                className="to-slider" aria-label="Gown opacity"
              />
            </div>
          )}

          {/* Enhanced mode */}
          <div className="to-mode-card">
            <div className="to-mode-row">
              <div className="to-mode-text">
                <p className="to-mode-title">Enhanced mode</p>
                <p className="to-mode-desc">
                  Segments your body so the gown appears behind your arms — more realistic but slower on older devices.
                  {segLoading && <span className="to-mode-loading"> Loading…</span>}
                </p>
              </div>
              <button
                className={`to-toggle${enhancedMode ? ' on' : ''}`}
                onClick={() => setEnhancedMode(v => !v)}
                aria-pressed={enhancedMode}
                aria-label="Toggle enhanced mode"
              >
                <span className="to-toggle-thumb" />
              </button>
            </div>
          </div>

          {/* Lighting feedback */}
          {lightHint && lightHint !== 'good' && (
            <div className={`to-light-hint to-light-hint--${lightHint}`}>
              {lightHint === 'dark'
                ? '⚠ Poor lighting — move to a brighter area for best results.'
                : '⚠ Very bright — try to avoid direct light behind you.'}
            </div>
          )}

          <div className="to-tips">
            <p className="to-tips-title">Tips for best results</p>
            <ul>
              <li>Stand 1.5 – 2 m from your camera</li>
              <li>Good front-facing light</li>
              <li>Plain, uncluttered background</li>
              <li>Wear fitted clothing</li>
              <li>Arms slightly away from body</li>
              <li>Full body visible in frame</li>
            </ul>
          </div>
        </aside>

        {/* ── Main ── */}
        <div className="to-main">

          {/* Model status */}
          {modelState === 'loading' && (
            <div className="to-model-bar">
              <span className="to-spin" />
              <span className="to-model-step">{modelStep}</span>
              <div className="to-model-track">
                <div className="to-model-fill" style={{ width: modelPct + '%' }} />
              </div>
              <span className="to-model-pct">{modelPct}%</span>
            </div>
          )}
          {modelState === 'error' && (
            <div className="to-model-bar to-model-bar--err">
              <span className="to-bar-icon">⚠</span>
              <span className="to-bar-msg">{modelStep}</span>
              <button className="to-retry-btn" onClick={loadPoseModel}>Retry</button>
            </div>
          )}

          {/* Viewport */}
          <div className="to-viewport">
            <video ref={videoRef} className="to-video-hidden" playsInline muted />
            <canvas ref={canvasRef} className={`to-canvas${camReady ? ' on' : ''}`} />

            {/* Placeholder */}
            {!camReady && !captured && (
              <div className="to-placeholder">
                <div className="to-ph-icon">
                  <svg viewBox="0 0 80 80" fill="none">
                    <rect x="8" y="22" width="64" height="44" rx="4" stroke="rgba(250,247,244,.18)" strokeWidth="1.5"/>
                    <circle cx="40" cy="44" r="12" stroke="rgba(250,247,244,.18)" strokeWidth="1.5"/>
                    <circle cx="40" cy="44" r="5" fill="rgba(250,247,244,.1)"/>
                    <path d="M30 22l4-8h12l4 8" stroke="rgba(250,247,244,.18)" strokeWidth="1.5" strokeLinejoin="round"/>
                  </svg>
                </div>
                {camState === 'starting'
                  ? <p className="to-ph-text"><span className="to-spin to-spin--lt" />Starting camera…</p>
                  : <>
                      <p className="to-ph-text">Camera is off</p>
                      <p className="to-ph-sub">
                        {modelState === 'ready' ? 'Press "Start camera" below' : 'AI model is loading…'}
                      </p>
                    </>
                }
              </div>
            )}

            {/* Pose guide silhouette */}
            {camReady && !poseFound && !captured && (
              <div className="to-pose-guide">
                <svg className="to-pose-fig" viewBox="0 0 100 220" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.5" strokeLinecap="round">
                  <ellipse cx="50" cy="24" rx="14" ry="18"/>
                  <line x1="50" y1="42" x2="50" y2="110"/>
                  <line x1="50" y1="62" x2="22" y2="98"/>
                  <line x1="50" y1="62" x2="78" y2="98"/>
                  <line x1="50" y1="110" x2="36" y2="176"/>
                  <line x1="50" y1="110" x2="64" y2="176"/>
                  <line x1="36" y1="176" x2="32" y2="216"/>
                  <line x1="64" y1="176" x2="68" y2="216"/>
                </svg>
                <p className="to-pose-text">Stand so your full body is visible</p>
              </div>
            )}

            {/* Pose detected badge */}
            {camReady && poseFound && !captured && (
              <div className="to-pose-badge">
                <span className="to-pulse" />
                Body detected
              </div>
            )}

            {/* Captured photo */}
            {captured && (
              <div className="to-captured">
                <img src={captured} alt="Captured try-on" className="to-captured-img" />
                <div className="to-captured-bar">
                  <button onClick={downloadPhoto} className="to-cap-btn">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download
                  </button>
                  {user ? (
                    <button
                      onClick={savePhoto}
                      disabled={saving || saveMsg.startsWith('✓')}
                      className="to-cap-btn to-cap-btn--gold"
                    >
                      {saving ? 'Saving…' : saveMsg || 'Save to profile'}
                    </button>
                  ) : (
                    <Link href="/login" className="to-cap-btn to-cap-btn--gold">
                      Log in to save
                    </Link>
                  )}
                  <button onClick={retake} className="to-cap-btn">↩ Retake</button>
                </div>

                {/* Connection: after capture, link to the gown detail & cart */}
                {selectedGown && (
                  <div className="to-post-capture">
                    <p className="to-post-label">Like what you see?</p>
                    <div className="to-post-links">
                      <Link href={`/gowns/${selectedGown.id}`} className="to-post-btn to-post-btn--outline">
                        View {selectedGown.name}
                      </Link>
                      <Link href={`/gowns/${selectedGown.id}#sizes`} className="to-post-btn to-post-btn--primary">
                        Add to Cart →
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Camera error */}
          {camError && (
            <div className="to-cam-error" role="alert">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <div>{camError.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div>
            </div>
          )}

          {/* Controls */}
          <div className="to-controls">
            {!camReady ? (
              <button
                className="to-btn to-btn--primary"
                onClick={startCamera}
                disabled={modelState !== 'ready' || camState === 'starting'}
              >
                {camState === 'starting'
                  ? <><span className="to-spin" />Starting…</>
                  : modelState !== 'ready'
                    ? <><span className="to-spin" />Loading AI model…</>
                    : <>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                        </svg>
                        Start camera
                      </>
                }
              </button>
            ) : captured ? (
              <button className="to-btn to-btn--outline" onClick={retake}>↩ Retake photo</button>
            ) : (
              <>
                <button
                  className={`to-btn to-btn--capture${canCap ? ' ready' : ''}`}
                  onClick={takePhoto}
                  disabled={!canCap}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
                    <path d="M16 3l-4-2-4 2"/>
                  </svg>
                  {poseFound ? 'Take photo' : 'Waiting for pose…'}
                </button>
                <button className="to-btn to-btn--outline" onClick={stopCamera}>Stop camera</button>
              </>
            )}
          </div>

          {/* How it works */}
          <div className="to-how">
            <p className="to-how-title">How it works</p>
            <div className="to-how-grid">
              {[
                { n:'1', t:'AI runs in your browser',   d:'MoveNet detects 17 body keypoints using your GPU — no video leaves your device.' },
                { n:'2', t:'Gown scales to you',         d:'Torso and skirt fit independently to your shoulder and hip width — no squishing.' },
                { n:'3', t:'Enhanced mode layers gown',  d:'Body segmentation composites the gown behind your arms for a realistic layered look.' },
                { n:'4', t:'Capture & save',              d:'Download the photo or save it to your profile to reference when visiting in-store.' },
              ].map(s => (
                <div key={s.n} className="to-how-item">
                  <span className="to-how-n">{s.n}</span>
                  <div>
                    <p className="to-how-t">{s.t}</p>
                    <p className="to-how-d">{s.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      <Footer />
    </main>
  )
}

// ── CSS ───────────────────────────────────────────────────────────────────────