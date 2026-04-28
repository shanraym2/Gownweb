'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser } from '../utils/authClient'

// ── CDN scripts (same versions as the try-on page) ────────────────────────────
const POSE_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.10.0/dist/tf-core.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.10.0/dist/tf-converter.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@4.10.0/dist/tf-backend-webgl.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js',
]

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = Object.assign(document.createElement('script'), { src, async: false })
    s.onload  = resolve
    s.onerror = () => reject(new Error('Failed: ' + src))
    document.head.appendChild(s)
  })
}

// ── Keypoint indices (MoveNet) ────────────────────────────────────────────────
const KP = { NOSE:0, LS:5, RS:6, LE:7, RE:8, LH:11, RH:12, LK:13, RK:14, LA:15, RA:16 }
const CONF = 0.25

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }
function mid(a, b)  { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }

// ── Size recommendation engine ────────────────────────────────────────────────
// Scores each size by average absolute distance from measurement midpoints.
// Returns { size, score, adjacentSizes }.
function recommendSize(meas, sizes) {
  if (!sizes?.length) return null
  const { bust, waist, hips } = meas
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

  const idx   = sizes.findIndex(s => s.label === best?.label)
  const adjacent = sizes.slice(Math.max(0, idx - 1), Math.min(sizes.length, idx + 2))
  return { size: best, score: bestScore, adjacent }
}

// ── Draw helpers ──────────────────────────────────────────────────────────────
function drawSkeleton(ctx, kps) {
  const connections = [
    [KP.LS, KP.RS], [KP.LS, KP.LH], [KP.RS, KP.RH], [KP.LH, KP.RH],
    [KP.LH, KP.LK], [KP.RH, KP.RK], [KP.LK, KP.LA], [KP.RK, KP.RA],
    [KP.LS, KP.LE], [KP.RS, KP.RE],
  ]
  ctx.strokeStyle = 'rgba(127,119,221,.75)'; ctx.lineWidth = 2
  for (const [a, b] of connections) {
    const ka = kps[a], kb = kps[b]
    if (ka?.score > CONF && kb?.score > CONF) {
      ctx.beginPath(); ctx.moveTo(ka.x, ka.y); ctx.lineTo(kb.x, kb.y); ctx.stroke()
    }
  }
  ctx.fillStyle = 'rgba(93,202,165,.9)'
  for (const k of kps) {
    if (k?.score > CONF) { ctx.beginPath(); ctx.arc(k.x, k.y, 4, 0, Math.PI * 2); ctx.fill() }
  }
}

function drawMeasurementLines(ctx, ls, rs, lh, rh) {
  ctx.save()
  ctx.strokeStyle = 'rgba(93,202,165,.65)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4])
  // Shoulder span
  ctx.beginPath(); ctx.moveTo(ls.x, ls.y - 8); ctx.lineTo(rs.x, rs.y - 8); ctx.stroke()
  // Hip span
  ctx.beginPath(); ctx.moveTo(lh.x, lh.y + 6); ctx.lineTo(rh.x, rh.y + 6); ctx.stroke()
  // Vertical torso center line
  const sx = (ls.x + rs.x) / 2, sy = Math.min(ls.y, rs.y) - 8
  const hx = (lh.x + rh.x) / 2, hy = Math.max(lh.y, rh.y) + 6
  ctx.strokeStyle = 'rgba(93,202,165,.3)'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

// ── Step indicator ────────────────────────────────────────────────────────────
function StepBar({ step }) {
  const labels = ['Measure', 'Optional details', 'Your size']
  return (
    <div className="sr-step-bar">
      {labels.map((label, i) => {
        const n      = i + 1
        const state  = n < step ? 'done' : n === step ? 'active' : 'idle'
        return (
          <div key={n} className={`sr-step sr-step--${state}`}>
            <div className="sr-step-dot">
              {state === 'done' ? '✓' : n}
            </div>
            <div className="sr-step-label">{label}</div>
            {i < labels.length - 1 && <div className="sr-step-line"/>}
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SizeRecommenderPage() {
  // ── Refs ──────────────────────────────────────────────────────────────────
  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const streamRef   = useRef(null)
  const detectorRef = useRef(null)
  const animRef     = useRef(null)
  const swHistRef   = useRef([])    // shoulder-width pixel history (smoothing)

  // ── State ─────────────────────────────────────────────────────────────────
  const [mounted,       setMounted      ] = useState(false)
  const [step,          setStep         ] = useState(1)     // 1=measure 2=details 3=result
  const [activeTab,     setActiveTab    ] = useState('camera')  // 'camera'|'manual'

  // Camera
  const [modelState,    setModelState   ] = useState('idle')  // idle|loading|ready|error
  const [camState,      setCamState     ] = useState('off')   // off|starting|on|error
  const [camError,      setCamError     ] = useState('')
  const [poseStatus,    setPoseStatus   ] = useState('')
  const [confidence,    setConfidence   ] = useState(0)
  const [camLocked,     setCamLocked    ] = useState(false)   // measurement locked from cam

  // Measurements collected
  const [camMeas,       setCamMeas      ] = useState(null)    // { bust,waist,hips } from camera
  const [adjBust,       setAdjBust      ] = useState('')
  const [adjWaist,      setAdjWaist     ] = useState('')
  const [adjHips,       setAdjHips      ] = useState('')

  // Manual tab
  const [mBust,         setMBust        ] = useState('')
  const [mWaist,        setMWaist       ] = useState('')
  const [mHips,         setMHips        ] = useState('')
  const [mHeight,       setMHeight      ] = useState('')
  const [mWeight,       setMWeight      ] = useState('')

  // Optional details step
  const [dHeight,       setDHeight      ] = useState('')
  const [dWeight,       setDWeight      ] = useState('')

  // Final measurements going into recommender
  const [finalMeas,     setFinalMeas    ] = useState(null)

  // Size chart from API
  const [sizes,         setSizes        ] = useState([])
  const [supplierName,  setSupplierName ] = useState('')

  // Result
  const [result,        setResult       ] = useState(null)   // { size, score, adjacent }

  // Save state
  const [saving,        setSaving       ] = useState(false)
  const [saveMsg,       setSaveMsg      ] = useState('')
  const [prevMeas,      setPrevMeas     ] = useState(null)   // previously saved

  const user = mounted ? getCurrentUser() : null

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => { setMounted(true) }, [])

  // Load size chart on mount
  useEffect(() => {
    fetch('/api/size-chart')
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setSizes(d.sizes); setSupplierName(d.supplierName || '') }
      })
      .catch(() => {})
  }, [])

  // Load previously saved measurements for logged-in users
  useEffect(() => {
    if (!mounted || !user) return
    fetch('/api/measurements', { headers: { 'x-user-id': user.id } })
      .then(r => r.json())
      .then(d => { if (d.ok && d.measurements) setPrevMeas(d.measurements) })
      .catch(() => {})
  }, [mounted, user])

  // Load pose model in background as soon as component mounts
  useEffect(() => {
    if (!mounted) return
    loadPoseModel()
  }, [mounted]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadPoseModel = useCallback(async () => {
    if (detectorRef.current) return   // already loaded
    setModelState('loading')
    try {
      for (const src of POSE_SCRIPTS) await loadScript(src)
      await window.tf.ready()
      try { await window.tf.setBackend('webgl') } catch { await window.tf.setBackend('cpu') }
      const pd = window.poseDetection
      detectorRef.current = await pd.createDetector(
        pd.SupportedModels.MoveNet,
        { modelType: pd.movenet.modelType.SINGLEPOSE_THUNDER }
      )
      setModelState('ready')
    } catch (err) {
      console.error('Pose model load failed:', err)
      setModelState('error')
    }
  }, [])

  // ── Camera ────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCamError(''); setCamState('starting')
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('Camera not supported in this browser.'); setCamState('error'); return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user', frameRate: { ideal: 30 } },
        audio: false,
      })
      streamRef.current        = stream
      videoRef.current.srcObject = stream
      await new Promise((res, rej) => {
        videoRef.current.onloadedmetadata = res
        setTimeout(() => rej(new Error('timeout')), 10000)
      })
      await videoRef.current.play()
      setCamState('on')
    } catch (err) {
      let msg = 'Could not start camera.'
      if (err.name === 'NotAllowedError')    msg = 'Camera permission denied. Allow camera access in your browser and try again.'
      else if (err.name === 'NotFoundError') msg = 'No camera found on this device.'
      else if (err.name === 'NotReadableError') msg = 'Camera is in use by another app. Close Zoom/Teams and retry.'
      else if (err.message === 'timeout')    msg = 'Camera took too long to start. Please try again.'
      setCamError(msg); setCamState('error')
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    swHistRef.current = []
    setCamState('off'); setPoseStatus(''); setConfidence(0)
  }, [])

  // ── Detect loop ───────────────────────────────────────────────────────────
  const detect = useCallback(async () => {
    const video = videoRef.current, canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) {
      animRef.current = requestAnimationFrame(detect); return
    }
    if (!detectorRef.current) { animRef.current = requestAnimationFrame(detect); return }

    const vw = video.videoWidth || 640
    const vh = video.videoHeight || 480
    canvas.width  = vw; canvas.height = vh
    const ctx = canvas.getContext('2d')

    // Draw mirrored video
    ctx.save(); ctx.translate(vw, 0); ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, vw, vh)
    ctx.restore()

    try {
      const poses = await detectorRef.current.estimatePoses(video)
      if (poses?.length > 0) {
        // Mirror x coordinates to match the mirrored canvas
        const kps = poses[0].keypoints.map(k => ({ ...k, x: vw - k.x }))
        const ls = kps[KP.LS], rs = kps[KP.RS]
        const lh = kps[KP.LH], rh = kps[KP.RH]
        const lk = kps[KP.LK], rk = kps[KP.RK]

        const shouldersOk = ls?.score > CONF && rs?.score > CONF
        const hipsOk      = lh?.score > CONF && rh?.score > CONF
        const kneesOk     = lk?.score > CONF && rk?.score > CONF

        drawSkeleton(ctx, kps)

        if (shouldersOk && hipsOk) {
          drawMeasurementLines(ctx, ls, rs, lh, rh)

          const swPx   = dist(ls, rs)
          const torsoH = mid(lh, rh).y - mid(ls, rs).y

          swHistRef.current.push(swPx)
          if (swHistRef.current.length > 24) swHistRef.current.shift()
          const avgSw = swHistRef.current.reduce((a, b) => a + b, 0) / swHistRef.current.length

          // Convert px to cm using torso-height reference (avg adult torso ≈ 52 cm)
          if (torsoH > 20) {
            const pxPerCm   = torsoH / 52
            const hwPx      = dist(lh, rh)
            const estShoulder = avgSw / pxPerCm

            // Derive bust/waist/hips from shoulder width using anthropometric ratios
            const estBust  = Math.round(estShoulder * 1.92)
            const estWaist = Math.round(estShoulder * 1.56)
            const estHips  = Math.round((hwPx / pxPerCm) * 1.08)

            // Confidence: more frames = more stable; knees visible adds surety
            const frames = Math.min(swHistRef.current.length, 24)
            const conf   = Math.min(Math.round(38 + (frames / 24) * 47 + (kneesOk ? 12 : 0)), 92)
            setConfidence(conf)
            setPoseStatus(conf >= 68 ? 'Ready to lock' : 'Hold still, calibrating…')

            // Draw label with live estimates
            ctx.font = '12px sans-serif'; ctx.fillStyle = 'rgba(93,202,165,.9)'
            ctx.fillText(`Bust ~${estBust}cm`, ls.x + 4, ls.y - 14)
            ctx.fillText(`Hips ~${estHips}cm`, lh.x + 4, lh.y + 18)
          }
        } else {
          const missing = !shouldersOk ? 'Step back — shoulders not detected' : 'Step back — hips not in frame'
          setPoseStatus(missing); setConfidence(0)
        }
      } else {
        setPoseStatus('Stand in front of the camera'); setConfidence(0)
      }
    } catch { /* skip frame */ }

    animRef.current = requestAnimationFrame(detect)
  }, [])

  // Start/stop detect loop when camera turns on/off
  useEffect(() => {
    if (camState === 'on') {
      detect()
    } else {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [camState, detect])

  useEffect(() => () => stopCamera(), [stopCamera])

  // ── Lock measurement from camera ──────────────────────────────────────────
  const lockMeasurement = useCallback(() => {
    if (!swHistRef.current.length) return
    const avgSw = swHistRef.current.reduce((a, b) => a + b, 0) / swHistRef.current.length
    // Re-derive from last known torso ratio
    // We approximate pxPerCm using shoulder / typical shoulder width (44 cm avg)
    const pxPerCm = avgSw / 44
    const estBust  = Math.round((avgSw / pxPerCm) * 1.92)
    const estWaist = Math.round((avgSw / pxPerCm) * 1.56)
    const estHips  = Math.round((avgSw / pxPerCm) * 2.15)

    setCamMeas({ bust: estBust, waist: estWaist, hips: estHips })
    setAdjBust(String(estBust)); setAdjWaist(String(estWaist)); setAdjHips(String(estHips))
    setCamLocked(true)
    stopCamera()
  }, [stopCamera])

  // ── Proceed from camera to details ────────────────────────────────────────
  const proceedFromCamera = useCallback(() => {
    const bust  = parseFloat(adjBust)  || camMeas?.bust  || null
    const waist = parseFloat(adjWaist) || camMeas?.waist || null
    const hips  = parseFloat(adjHips)  || camMeas?.hips  || null
    setFinalMeas({ bust, waist, hips, source: 'camera' })
    setStep(2)
  }, [adjBust, adjWaist, adjHips, camMeas])

  // ── Proceed from manual tab ───────────────────────────────────────────────
  const proceedFromManual = useCallback(() => {
    const bust   = parseFloat(mBust)   || null
    const waist  = parseFloat(mWaist)  || null
    const hips   = parseFloat(mHips)   || null
    const height = parseFloat(mHeight) || null
    const weight = parseFloat(mWeight) || null
    if (!bust && !waist && !hips) { alert('Enter at least one measurement.'); return }
    const meas = { bust, waist, hips, source: 'manual' }
    if (height) meas.height = height
    if (weight) meas.weight = weight
    setFinalMeas(meas)
    setStep(2)
  }, [mBust, mWaist, mHips, mHeight, mWeight])

  // ── Compute result ────────────────────────────────────────────────────────
  const computeResult = useCallback((extraHeight, extraWeight) => {
    if (!finalMeas) return
    const meas = { ...finalMeas }
    if (extraHeight) meas.height = parseFloat(extraHeight) || meas.height
    if (extraWeight) meas.weight = parseFloat(extraWeight) || meas.weight
    setFinalMeas(meas)
    const rec = recommendSize(meas, sizes)
    setResult(rec)
    setStep(3)
  }, [finalMeas, sizes])

  // ── Save to DB ────────────────────────────────────────────────────────────
  const saveMeasurements = useCallback(async () => {
    if (!user || !finalMeas) return
    setSaving(true); setSaveMsg('')
    try {
      const res  = await fetch('/api/measurements', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body:    JSON.stringify({
          bust_cm:   finalMeas.bust   ?? null,
          waist_cm:  finalMeas.waist  ?? null,
          hips_cm:   finalMeas.hips   ?? null,
          height_cm: finalMeas.height ?? null,
          weight_kg: finalMeas.weight ?? null,
          source:    finalMeas.source ?? 'manual',
        }),
      })
      const data = await res.json()
      setSaveMsg(data.ok ? '✓ Saved to your profile' : data.error || 'Save failed.')
      if (data.ok) setPrevMeas(data.measurements)
    } catch {
      setSaveMsg('Could not save. Check your connection.')
    } finally {
      setSaving(false)
    }
  }, [user, finalMeas])

  const resetAll = useCallback(() => {
    stopCamera(); setCamLocked(false); setCamMeas(null)
    setAdjBust(''); setAdjWaist(''); setAdjHips('')
    setFinalMeas(null); setResult(null); setSaveMsg(''); setStep(1)
    setActiveTab('camera'); setConfidence(0); setPoseStatus('')
  }, [stopCamera])

  // ── Render helpers ────────────────────────────────────────────────────────
  const confColor = confidence >= 70 ? '#1D9E75' : confidence >= 50 ? '#EF9F27' : '#E24B4A'
  const scoreConf = result ? Math.max(10, Math.round(100 - result.score * 3)) : 0
  const scoreConfClamped = Math.min(scoreConf, 95)
  const scoreColor = scoreConfClamped >= 75 ? '#1D9E75' : scoreConfClamped >= 55 ? '#EF9F27' : '#E24B4A'

  if (!mounted) return null

  return (
    <>
      <main className="sr-page">
        <Header solid/>
        <div className="sr-spacer"/>

        <section className="sr-hero">
          <div className="sr-hero-inner">
            <span className="sr-eyebrow">FitMatcher · Size Recommender</span>
            <h1 className="sr-h1">Find your <em>perfect fit</em></h1>
            <p className="sr-sub">
              Use your camera to estimate measurements instantly, or enter them yourself.
              We'll match you to the right size from our {supplierName ? `${supplierName} ` : ''}size chart.
            </p>
          </div>
        </section>

        <div className="sr-layout">
          <div className="sr-main">

            {/* Previously saved banner */}
            {prevMeas && step === 1 && (
              <div className="sr-prev-banner">
                <div className="sr-prev-text">
                  <strong>Saved measurements on file</strong>
                  <span>
                    {[
                      prevMeas.bust_cm  && `Bust ${prevMeas.bust_cm} cm`,
                      prevMeas.waist_cm && `Waist ${prevMeas.waist_cm} cm`,
                      prevMeas.hips_cm  && `Hips ${prevMeas.hips_cm} cm`,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <button
                  className="sr-btn sr-btn--ghost"
                  onClick={() => {
                    setFinalMeas({
                      bust:   prevMeas.bust_cm,
                      waist:  prevMeas.waist_cm,
                      hips:   prevMeas.hips_cm,
                      height: prevMeas.height_cm,
                      weight: prevMeas.weight_kg,
                      source: prevMeas.source,
                    })
                    computeResult(prevMeas.height_cm, prevMeas.weight_kg)
                  }}
                >
                  Use saved →
                </button>
              </div>
            )}

            <StepBar step={step}/>

            {/* ── STEP 1: MEASURE ───────────────────────────────────────── */}
            {step === 1 && (
              <div className="sr-card">
                {/* Tab bar */}
                <div className="sr-tab-row">
                  <button
                    className={`sr-tab${activeTab === 'camera' ? ' active' : ''}`}
                    onClick={() => setActiveTab('camera')}
                  >
                    Camera measurement
                  </button>
                  <button
                    className={`sr-tab${activeTab === 'manual' ? ' active' : ''}`}
                    onClick={() => setActiveTab('manual')}
                  >
                    Enter manually
                  </button>
                </div>

                {/* ── Camera pane ─────────────────────────────────────── */}
                {activeTab === 'camera' && (
                  <div>
                    <div className="sr-cam-area">
                      <video ref={videoRef} className="sr-video" playsInline muted/>
                      <canvas ref={canvasRef} className={`sr-canvas${camState === 'on' ? ' visible' : ''}`}/>

                      {camState !== 'on' && !camLocked && (
                        <div className="sr-cam-placeholder">
                          <svg width="52" height="52" viewBox="0 0 80 80" fill="none">
                            <rect x="8" y="22" width="64" height="44" rx="4" stroke="currentColor" strokeWidth="1.5"/>
                            <circle cx="40" cy="44" r="12" stroke="currentColor" strokeWidth="1.5"/>
                            <circle cx="40" cy="44" r="5" fill="currentColor" opacity=".25"/>
                            <path d="M30 22l4-8h12l4 8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                          </svg>
                          <span>
                            {camState === 'starting' ? 'Starting camera…'
                              : modelState === 'loading' ? 'Loading AI model…'
                              : 'Camera off'}
                          </span>
                        </div>
                      )}

                      {camState === 'on' && (
                        <div className="sr-cam-hud">
                          <div className="sr-hud-dot" style={{ background: confColor }}/>
                          <span className="sr-hud-status">{poseStatus || 'Detecting pose…'}</span>
                          {confidence > 0 && (
                            <span className="sr-hud-conf" style={{ color: confColor }}>
                              {confidence}%
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="sr-pane-body">
                      {!camLocked ? (
                        <>
                          <p className="sr-instruction">
                            Stand <strong>1.5–2 m</strong> from the camera in good light.
                            Keep arms slightly away from your body. Full body — head to feet — should be visible.
                          </p>

                          {camError && (
                            <div className="sr-alert sr-alert--error">{camError}</div>
                          )}
                          {modelState === 'error' && (
                            <div className="sr-alert sr-alert--error">
                              AI model failed to load. <button className="sr-link" onClick={loadPoseModel}>Retry</button>
                            </div>
                          )}

                          <div className="sr-btn-row">
                            {camState !== 'on' ? (
                              <button
                                className="sr-btn sr-btn--primary"
                                onClick={startCamera}
                                disabled={camState === 'starting' || modelState === 'loading'}
                              >
                                {camState === 'starting' || modelState === 'loading'
                                  ? <><span className="sr-spin"/>Starting…</>
                                  : <>▶ Start camera</>}
                              </button>
                            ) : (
                              <>
                                <button
                                  className="sr-btn sr-btn--primary"
                                  onClick={lockMeasurement}
                                  disabled={confidence < 50}
                                >
                                  📐 Lock measurement{confidence > 0 ? ` (${confidence}%)` : ''}
                                </button>
                                <button className="sr-btn sr-btn--ghost" onClick={stopCamera}>
                                  ■ Stop
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      ) : (
                        /* Locked — show adjustable estimates */
                        <div className="sr-locked">
                          <p className="sr-locked-title">
                            <span className="sr-badge sr-badge--success">✓ Measurement captured</span>
                            Adjust if needed before continuing.
                          </p>
                          <div className="sr-field-row">
                            <div className="sr-field">
                              <label>Bust (cm)</label>
                              <input type="number" value={adjBust} onChange={e => setAdjBust(e.target.value)} min="60" max="150"/>
                            </div>
                            <div className="sr-field">
                              <label>Waist (cm)</label>
                              <input type="number" value={adjWaist} onChange={e => setAdjWaist(e.target.value)} min="50" max="140"/>
                            </div>
                            <div className="sr-field">
                              <label>Hips (cm)</label>
                              <input type="number" value={adjHips} onChange={e => setAdjHips(e.target.value)} min="60" max="160"/>
                            </div>
                          </div>
                          <p className="sr-note">
                            Camera estimates carry ±4–6 cm variance. A tape measure gives the most precise fit.
                          </p>
                          <div className="sr-btn-row">
                            <button className="sr-btn sr-btn--ghost" onClick={() => { setCamLocked(false); setCamMeas(null) }}>
                              ↩ Retake
                            </button>
                            <button className="sr-btn sr-btn--primary" onClick={proceedFromCamera}>
                              Continue →
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Manual pane ─────────────────────────────────────── */}
                {activeTab === 'manual' && (
                  <div className="sr-pane-body">
                    <p className="sr-field-group-label">Your measurements (cm)</p>
                    <div className="sr-field-row">
                      <div className="sr-field">
                        <label>Bust / chest</label>
                        <input type="number" value={mBust} onChange={e => setMBust(e.target.value)} placeholder="e.g. 88" min="60" max="150"/>
                      </div>
                      <div className="sr-field">
                        <label>Waist</label>
                        <input type="number" value={mWaist} onChange={e => setMWaist(e.target.value)} placeholder="e.g. 70" min="50" max="140"/>
                      </div>
                    </div>
                    <div className="sr-field-row">
                      <div className="sr-field">
                        <label>Hips</label>
                        <input type="number" value={mHips} onChange={e => setMHips(e.target.value)} placeholder="e.g. 95" min="60" max="160"/>
                      </div>
                      <div className="sr-field">
                        <label>Height <span className="sr-optional">(optional)</span></label>
                        <input type="number" value={mHeight} onChange={e => setMHeight(e.target.value)} placeholder="e.g. 162" min="130" max="220"/>
                      </div>
                    </div>
                    <div className="sr-field-row sr-field-row--half">
                      <div className="sr-field">
                        <label>Weight kg <span className="sr-optional">(optional)</span></label>
                        <input type="number" value={mWeight} onChange={e => setMWeight(e.target.value)} placeholder="e.g. 58" min="35" max="200"/>
                      </div>
                    </div>
                    <button className="sr-btn sr-btn--primary" onClick={proceedFromManual}>
                      Find my size →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 2: OPTIONAL DETAILS ──────────────────────────────── */}
            {step === 2 && (
              <div className="sr-card">
                <div className="sr-pane-body">
                  <p className="sr-section-title">Optional — helps at size boundaries</p>
                  <div className="sr-field-row">
                    <div className="sr-field">
                      <label>Height (cm)</label>
                      <input type="number" value={dHeight} onChange={e => setDHeight(e.target.value)} placeholder="e.g. 162" min="130" max="220"/>
                    </div>
                    <div className="sr-field">
                      <label>Weight (kg)</label>
                      <input type="number" value={dWeight} onChange={e => setDWeight(e.target.value)} placeholder="e.g. 58" min="35" max="200"/>
                    </div>
                  </div>
                  <p className="sr-note">
                    These are never required. Height and weight help us flag cases where you're between sizes and suggest whether to size up or down.
                  </p>
                  <div className="sr-btn-row">
                    <button className="sr-btn sr-btn--ghost" onClick={() => computeResult(null, null)}>
                      Skip
                    </button>
                    <button className="sr-btn sr-btn--primary" onClick={() => computeResult(dHeight, dWeight)}>
                      Get my size →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 3: RESULT ────────────────────────────────────────── */}
            {step === 3 && result && (
              <div className="sr-card">
                <div className="sr-pane-body">

                  {/* Primary recommendation */}
                  <div className="sr-result-hero">
                    <div>
                      <div className="sr-result-label">Recommended size</div>
                      <div className="sr-result-size">{result.size?.label ?? '—'}</div>
                    </div>
                    <div className="sr-result-right">
                      <div className="sr-result-label">Match confidence</div>
                      <div className="sr-result-conf" style={{ color: scoreColor }}>
                        {scoreConfClamped}%
                      </div>
                    </div>
                  </div>

                  {/* Confidence bar */}
                  <div className="sr-conf-wrap">
                    <div className="sr-conf-track">
                      <div
                        className="sr-conf-fill"
                        style={{ width: `${scoreConfClamped}%`, background: scoreColor }}
                      />
                    </div>
                  </div>

                  {/* Adjacent sizes */}
                  <div className="sr-adjacent">
                    <div className="sr-result-label" style={{ marginBottom: 8 }}>Size range</div>
                    <div className="sr-pill-row">
                      {result.adjacent.map(sz => (
                        <span
                          key={sz.label}
                          className={`sr-pill${sz.label === result.size?.label ? ' sr-pill--match' : ''}`}
                        >
                          {sz.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Measurements used */}
                  <div className="sr-meas-grid">
                    {[
                      { label: 'Bust',   val: finalMeas?.bust,   unit: 'cm' },
                      { label: 'Waist',  val: finalMeas?.waist,  unit: 'cm' },
                      { label: 'Hips',   val: finalMeas?.hips,   unit: 'cm' },
                      { label: 'Height', val: finalMeas?.height, unit: 'cm' },
                      { label: 'Weight', val: finalMeas?.weight, unit: 'kg' },
                    ].filter(f => f.val != null).map(f => (
                      <div key={f.label} className="sr-meas-item">
                        <div className="sr-meas-label">{f.label}</div>
                        <div className="sr-meas-val">{f.val} {f.unit}</div>
                        <div className="sr-meas-src">{finalMeas?.source}</div>
                      </div>
                    ))}
                  </div>

                  {/* Size chart reference */}
                  {result.size && (
                    <div className="sr-chart-ref">
                      <div className="sr-result-label" style={{ marginBottom: 6 }}>
                        {supplierName || 'Standard'} size chart for {result.size.label}
                      </div>
                      <div className="sr-chart-row">
                        {result.size.bust_min  != null && <span>Bust {result.size.bust_min}–{result.size.bust_max} cm</span>}
                        {result.size.waist_min != null && <span>Waist {result.size.waist_min}–{result.size.waist_max} cm</span>}
                        {result.size.hip_min   != null && <span>Hips {result.size.hip_min}–{result.size.hip_max} cm</span>}
                      </div>
                    </div>
                  )}

                  {/* Borderline note */}
                  {result.score > 5 && (
                    <div className="sr-alert sr-alert--warn">
                      You're near a size boundary. For bridal gowns, it's generally easier to take in than let out — if in doubt, size up.
                    </div>
                  )}

                  {/* Camera accuracy note */}
                  {finalMeas?.source === 'camera' && (
                    <p className="sr-note">
                      Camera estimates carry ±4–6 cm variance. Confirm with a tape measure or visit us in-store for a precise fitting.
                    </p>
                  )}

                  {/* Save / actions */}
                  <div className="sr-btn-row">
                    <button className="sr-btn sr-btn--ghost" onClick={resetAll}>
                      ↩ Start over
                    </button>
                    {user ? (
                      <button
                        className="sr-btn sr-btn--primary"
                        onClick={saveMeasurements}
                        disabled={saving || saveMsg.startsWith('✓')}
                      >
                        {saving ? <><span className="sr-spin"/>Saving…</> : saveMsg || 'Save to profile'}
                      </button>
                    ) : (
                      <Link href="/login" className="sr-btn sr-btn--primary">
                        Log in to save →
                      </Link>
                    )}
                  </div>

                  {saveMsg && !saving && (
                    <p className={`sr-save-msg${saveMsg.startsWith('✓') ? ' sr-save-msg--ok' : ' sr-save-msg--err'}`}>
                      {saveMsg}
                    </p>
                  )}

                  {/* Shop CTA */}
                  <div className="sr-shop-cta">
                    <p className="sr-shop-label">Ready to find your gown?</p>
                    <div className="sr-btn-row">
                      <Link href="/gowns" className="sr-btn sr-btn--outline">Browse gowns</Link>
                      <Link href="/virtual-try-on" className="sr-btn sr-btn--primary">Virtual try-on →</Link>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tips sidebar card */}
            {step === 1 && (
              <div className="sr-tips-card">
                <p className="sr-tips-title">How to measure accurately</p>
                <ul className="sr-tips-list">
                  <li><strong>Bust</strong> — around the fullest part of your chest, arms relaxed</li>
                  <li><strong>Waist</strong> — narrowest part of your torso, usually 2–3 cm above your navel</li>
                  <li><strong>Hips</strong> — widest part of your hips and seat, usually 20 cm below the waist</li>
                  <li>Wear thin clothing or measure over undergarments</li>
                  <li>Keep the tape level and snug — not tight</li>
                </ul>
              </div>
            )}

          </div>
        </div>
        <Footer/>
      </main>

      <style>{`
        .sr-page { min-height: 100vh; display: flex; flex-direction: column; }
        .sr-spacer { height: 72px; }

        .sr-hero { padding: 3rem 1.5rem 2rem; text-align: center; }
        .sr-hero-inner { max-width: 560px; margin: 0 auto; }
        .sr-eyebrow { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--c-gold, #c8a96e); font-weight: 500; }
        .sr-h1 { font-size: clamp(2rem, 5vw, 3rem); font-weight: 400; margin: .5rem 0; line-height: 1.1; }
        .sr-h1 em { font-style: italic; color: var(--c-gold, #c8a96e); }
        .sr-sub { font-size: 1rem; color: #666; line-height: 1.6; }

        .sr-layout { max-width: 720px; margin: 0 auto; padding: 0 1rem 4rem; }
        .sr-main { display: flex; flex-direction: column; gap: 1.25rem; }

        /* Step bar */
        .sr-step-bar { display: flex; align-items: flex-start; margin-bottom: 1.5rem; }
        .sr-step { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; position: relative; }
        .sr-step-line {
          position: absolute; top: 13px; left: 60%; width: 80%;
          height: 0.5px; background: #ddd;
        }
        .sr-step-dot {
          width: 26px; height: 26px; border-radius: 50%;
          border: 1px solid #ddd; background: #fff;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 500; color: #999; z-index: 1;
          transition: all .2s;
        }
        .sr-step--active .sr-step-dot { border-color: #7F77DD; color: #7F77DD; border-width: 2px; }
        .sr-step--done   .sr-step-dot { background: #1D9E75; border-color: #1D9E75; color: #fff; font-size: 10px; }
        .sr-step-label { font-size: 11px; color: #999; text-align: center; }
        .sr-step--active .sr-step-label { color: #7F77DD; font-weight: 500; }
        .sr-step--done   .sr-step-label { color: #1D9E75; }

        /* Card */
        .sr-card { background: #fff; border: 0.5px solid #e5e5e5; border-radius: 12px; overflow: hidden; }

        /* Tab row */
        .sr-tab-row { display: flex; border-bottom: 0.5px solid #e5e5e5; }
        .sr-tab { flex: 1; padding: 12px; font-size: 13px; font-weight: 500; border: none; background: none; cursor: pointer; color: #999; border-bottom: 2px solid transparent; transition: all .15s; }
        .sr-tab.active { color: #7F77DD; border-bottom-color: #7F77DD; }

        /* Camera area */
        .sr-cam-area { position: relative; background: #0a0a0a; aspect-ratio: 4/3; max-height: 360px; overflow: hidden; }
        .sr-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
        .sr-canvas { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; transition: opacity .3s; }
        .sr-canvas.visible { opacity: 1; }
        .sr-cam-placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: rgba(255,255,255,.3); font-size: 13px; }
        .sr-cam-hud { position: absolute; bottom: 10px; left: 10px; right: 10px; background: rgba(0,0,0,.6); border-radius: 8px; padding: 8px 12px; display: flex; align-items: center; gap: 8px; }
        .sr-hud-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; transition: background .3s; }
        .sr-hud-status { font-size: 12px; color: rgba(255,255,255,.85); flex: 1; }
        .sr-hud-conf { font-size: 12px; font-weight: 600; }

        /* Pane body */
        .sr-pane-body { padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }

        /* Instruction */
        .sr-instruction { font-size: 13px; color: #555; line-height: 1.5; padding: 10px 12px; background: #f5f0ff; border-radius: 8px; border-left: 2px solid #7F77DD; }

        /* Alerts */
        .sr-alert { font-size: 12px; padding: 10px 12px; border-radius: 8px; line-height: 1.4; }
        .sr-alert--error { background: #FCEBEB; color: #501313; border: 0.5px solid #F09595; }
        .sr-alert--warn  { background: #FAEEDA; color: #633806; border: 0.5px solid #FAC775; }

        /* Fields */
        .sr-field-group-label { font-size: 12px; font-weight: 500; color: #555; }
        .sr-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .sr-field-row--half { grid-template-columns: 1fr; max-width: 50%; }
        .sr-field { display: flex; flex-direction: column; gap: 4px; }
        .sr-field label { font-size: 12px; color: #666; }
        .sr-optional { color: #aaa; font-weight: 400; }
        .sr-field input { padding: 8px 10px; border: 0.5px solid #ddd; border-radius: 8px; font-size: 14px; background: #fff; color: #222; width: 100%; }
        .sr-field input:focus { outline: none; border-color: #7F77DD; box-shadow: 0 0 0 2px rgba(127,119,221,.12); }
        .sr-section-title { font-size: 13px; font-weight: 500; color: #333; }

        /* Buttons */
        .sr-btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .sr-btn { padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer; border: 0.5px solid #ddd; background: #fff; color: #333; display: inline-flex; align-items: center; gap: 6px; text-decoration: none; transition: background .15s; }
        .sr-btn:hover:not(:disabled) { background: #f5f5f5; }
        .sr-btn:disabled { opacity: .45; cursor: not-allowed; }
        .sr-btn--primary { background: #7F77DD; border-color: #7F77DD; color: #fff; }
        .sr-btn--primary:hover:not(:disabled) { background: #534AB7; }
        .sr-btn--ghost { background: transparent; border-color: #ddd; color: #555; }
        .sr-btn--outline { border-color: #7F77DD; color: #7F77DD; background: transparent; }
        .sr-btn--outline:hover { background: #f5f0ff; }
        .sr-link { background: none; border: none; padding: 0; cursor: pointer; color: #7F77DD; font-size: inherit; text-decoration: underline; }

        /* Locked state */
        .sr-locked { display: flex; flex-direction: column; gap: 12px; }
        .sr-locked-title { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #555; }
        .sr-badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; }
        .sr-badge--success { background: #EAF3DE; color: #27500A; border: 0.5px solid #97C459; }

        /* Result */
        .sr-result-hero { display: flex; align-items: flex-end; justify-content: space-between; padding-bottom: 12px; border-bottom: 0.5px solid #eee; }
        .sr-result-label { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 2px; }
        .sr-result-size { font-size: 3rem; font-weight: 400; line-height: 1; color: #534AB7; }
        .sr-result-right { text-align: right; }
        .sr-result-conf { font-size: 1.4rem; font-weight: 500; line-height: 1; }

        .sr-conf-wrap { margin: 10px 0; }
        .sr-conf-track { height: 4px; background: #eee; border-radius: 2px; overflow: hidden; }
        .sr-conf-fill { height: 100%; border-radius: 2px; transition: width .5s ease; }

        .sr-adjacent { margin: 4px 0; }
        .sr-pill-row { display: flex; gap: 6px; flex-wrap: wrap; }
        .sr-pill { padding: 5px 14px; border-radius: 20px; font-size: 13px; font-weight: 500; border: 0.5px solid #ddd; color: #666; }
        .sr-pill--match { background: #EEEDFE; border-color: #AFA9EC; color: #3C3489; }

        .sr-meas-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; }
        .sr-meas-item { background: #f9f9f9; border-radius: 8px; padding: 10px 12px; }
        .sr-meas-label { font-size: 10px; color: #999; margin-bottom: 2px; }
        .sr-meas-val { font-size: 15px; font-weight: 500; color: #222; }
        .sr-meas-src { font-size: 10px; color: #7F77DD; margin-top: 2px; }

        .sr-chart-ref { background: #f5f0ff; border-radius: 8px; padding: 10px 14px; }
        .sr-chart-row { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: #534AB7; }

        .sr-save-msg { font-size: 12px; margin-top: -4px; }
        .sr-save-msg--ok  { color: #0F6E56; }
        .sr-save-msg--err { color: #A32D2D; }

        .sr-shop-cta { padding-top: 1rem; border-top: 0.5px solid #eee; }
        .sr-shop-label { font-size: 13px; color: #555; margin-bottom: 10px; }

        /* Previous banner */
        .sr-prev-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: #EAF3DE; border: 0.5px solid #97C459; border-radius: 10px; }
        .sr-prev-text { display: flex; flex-direction: column; gap: 2px; font-size: 13px; color: #27500A; }
        .sr-prev-text strong { font-weight: 600; }
        .sr-prev-text span { font-size: 12px; color: #3B6D11; }

        /* Tips */
        .sr-tips-card { background: #f9f9f9; border: 0.5px solid #eee; border-radius: 12px; padding: 1.25rem; }
        .sr-tips-title { font-size: 13px; font-weight: 500; color: #333; margin-bottom: 10px; }
        .sr-tips-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .sr-tips-list li { font-size: 12px; color: #666; line-height: 1.4; padding-left: 14px; position: relative; }
        .sr-tips-list li::before { content: '·'; position: absolute; left: 0; color: #7F77DD; font-weight: 700; }

        .sr-note { font-size: 11px; color: #999; line-height: 1.5; }
        .sr-spin { display: inline-block; width: 12px; height: 12px; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  )
}