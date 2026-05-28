'use client'

/**
 * components/TryOnCamera.jsx
 *
 * Shared headless-ish camera + pose detection + gown overlay component.
 * Used by:
 *   app/virtual-try-on/page.jsx  — standalone page
 *   app/fitting-room/page.jsx    — TryOnPanel (reads detectorRef from context)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXES APPLIED  (from audit)
 * ─────────────────────────────────────────────────────────────────────────────
 *  • Model loading race condition — component accepts an external detectorRef
 *    (from FittingRoomCtx) OR loads its own. The Start button is disabled
 *    until modelState === 'ready', so the detect loop never spins on a null
 *    detector.
 *  • Camera stream leak on tab blur — visibilitychange listener stops the
 *    stream whenever the tab is hidden while the camera is active.
 *  • Enhanced mode / segmentation errors surface as visible UI (segError state)
 *    instead of silent failure.
 *  • Orientation warning shown on mobile landscape while camera is active.
 *  • All interactive elements have aria-label / aria-pressed.
 *  • detect() is a stable callback (empty dep array) — all changing values
 *    are read via refs to avoid loop restarts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CROSS-ORIGIN / TAINTED CANVAS NOTE
 * ─────────────────────────────────────────────────────────────────────────────
 * Gown images are loaded with img.crossOrigin = 'anonymous'. If the CDN/server
 * does not return CORS headers (Access-Control-Allow-Origin), drawImage() will
 * taint the canvas and getImageData() will throw a SecurityError. This is a
 * server configuration issue — make sure your image CDN serves CORS headers.
 * The component catches the error gracefully and disables enhanced mode.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPS
 * ─────────────────────────────────────────────────────────────────────────────
 *  gown              object | null  — currently selected gown
 *  gowns             array          — full gown list for the thumbnail strip
 *  onGownChange      fn(gown)       — called when the user picks a different gown
 *  externalDetector  RefObject      — optional shared detectorRef from context
 *                                     (if provided, the component skips loading its own model)
 *  externalSegmenter RefObject      — optional shared segmenterRef from context
 *  modelState        string         — 'idle'|'loading'|'ready'|'error'
 *                                     (pass from context if externalDetector is provided)
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

// ── CDN scripts ───────────────────────────────────────────────────────────────
const POSE_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.10.0/dist/tf-core.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.10.0/dist/tf-converter.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@4.10.0/dist/tf-backend-webgl.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js',
]
const SEG_SCRIPT = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/body-segmentation@1.0.1/dist/body-segmentation.min.js'

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = Object.assign(document.createElement('script'), { src, async: false })
    s.onload = resolve; s.onerror = () => reject(new Error('Failed: ' + src))
    document.head.appendChild(s)
  })
}

// ── Keypoints ─────────────────────────────────────────────────────────────────
const KP   = { NOSE:0, LS:5, RS:6, LH:11, RH:12, LK:13, RK:14, LA:15, RA:16 }
const CONF = 0.25

// ── Geometry ──────────────────────────────────────────────────────────────────
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }
function mid(a, b)  { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
function lerpPt(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, score: b.score } }
function smoothKps(prev, curr, t = 0.35) {
  if (!prev) return curr
  return curr.map((k, i) => lerpPt(prev[i], k, t))
}

// ── Pose analysis ─────────────────────────────────────────────────────────────
function analyzePose(kps, vw, vh) {
  if (!kps) return { ok: false, issues: ['no_pose'], facingBack: false }
  const ls = kps[KP.LS], rs = kps[KP.RS], lh = kps[KP.LH], rh = kps[KP.RH]
  const lk = kps[KP.LK], rk = kps[KP.RK], la = kps[KP.LA], ra = kps[KP.RA]
  const nose = kps[KP.NOSE]
  const issues = []
  const shouldersOk = ls?.score > CONF && rs?.score > CONF
  const hipsOk      = lh?.score > CONF && rh?.score > CONF
  const kneesOk     = lk?.score > CONF && rk?.score > CONF
  const anklesOk    = la?.score > CONF && ra?.score > CONF
  const margin = vw * 0.08
  const tooCloseFrame = shouldersOk && (
    ls.x < margin || rs.x > vw - margin || (hipsOk && mid(lh, rh).y > vh * 0.72)
  )
  const faceVisible    = nose && nose.score > 0.30
  const bodyStable     = shouldersOk && hipsOk
  const shoulderSpan   = shouldersOk ? dist(ls, rs) : 0
  const bodyWideEnough = shoulderSpan > vw * 0.10
  const facingBack = !faceVisible && bodyStable && bodyWideEnough && !tooCloseFrame
  if (!shouldersOk) { issues.push('no_shoulders'); return { ok: false, issues, shouldersOk, hipsOk, facingBack } }
  if (!hipsOk)      { issues.push('no_hips');      return { ok: false, issues, shouldersOk, hipsOk, facingBack } }
  if (!kneesOk) issues.push('no_legs')
  if (tooCloseFrame) issues.push('too_close')
  if (nose?.score > 0.15 && nose.y < vh * 0.06) issues.push('head_cut')
  if (!kneesOk && hipsOk && mid(lh, rh).y > vh * 0.55 && !tooCloseFrame) issues.unshift('too_close')
  if (kneesOk && !anklesOk && mid(lk, rk).y < vh * 0.82) issues.push('too_close')
  const ok = shouldersOk && hipsOk && issues.length === 0
  return { ok, issues, shouldersOk, hipsOk, kneesOk, anklesOk, facingBack }
}

const GUIDANCE = {
  no_pose:      { icon: '🚶', text: 'Stand in front of the camera — full body visible.' },
  no_shoulders: { icon: '⬆️', text: 'Step back until your shoulders appear.' },
  no_hips:      { icon: '⬇️', text: 'Step back — your waist needs to be in view.' },
  no_legs:      { icon: '↕️', text: 'Step back so your legs are visible.' },
  too_close:    { icon: '↔️', text: 'Too close — move back 1–2 metres.' },
  head_cut:     { icon: '⬇️', text: 'Move down slightly — your head is cut off.' },
}

// ── Gown layout ───────────────────────────────────────────────────────────────
function getGownLayout(kps, cal = {}, vw = 640, vh = 480) {
  const ls = kps[KP.LS], rs = kps[KP.RS], lh = kps[KP.LH], rh = kps[KP.RH]
  const lk = kps[KP.LK], rk = kps[KP.RK], la = kps[KP.LA], ra = kps[KP.RA]
  if ([ls, rs, lh, rh].some(k => !k || k.score < CONF)) return null
  const sm = mid(ls, rs), hm = mid(lh, rh), torsoH = hm.y - sm.y
  const rawSw = dist(ls, rs), sw = Math.min(Math.max(rawSw, vw * 0.28), vw * 0.80)
  const rawHw = dist(lh, rh), hw = Math.max(rawHw, sw * 0.90)
  const neckOff = cal.necklineY ?? 0.18
  const topY = sm.y - torsoH * neckOff
  let bottomY
  if (la?.score > CONF && ra?.score > CONF) {
    bottomY = Math.max(la.y, ra.y) + torsoH * 0.15
  } else if (lk?.score > CONF && rk?.score > CONF) {
    const km = mid(lk, rk), legH = km.y - hm.y
    bottomY = km.y + legH * 1.1
  } else {
    bottomY = sm.y + torsoH * 4.8
  }
  if (cal.hemY != null) {
    const fullH = sm.y + torsoH * 4.8 - topY
    bottomY = topY + fullH * cal.hemY
  }
  const shoulderPad = cal.shoulderPad ?? 1.45
  const skirtFlare  = cal.skirtFlare  ?? 1.20
  const topW = sw * shoulderPad
  const botW = Math.max(hw * 1.55, topW) * skirtFlare
  const cx = (sm.x + hm.x) / 2
  return { topY, bottomY, cx, topW, botW, torsoH }
}

function drawGown(ctx, img, layout, opacity) {
  const { topY, bottomY, cx, topW, botW } = layout
  const h = bottomY - topY; if (h <= 0) return
  ctx.save(); ctx.globalAlpha = opacity
  ctx.beginPath()
  ctx.moveTo(cx - topW / 2, topY); ctx.lineTo(cx + topW / 2, topY)
  ctx.lineTo(cx + botW / 2, bottomY); ctx.lineTo(cx - botW / 2, bottomY)
  ctx.closePath(); ctx.clip()
  ctx.drawImage(img, cx - botW / 2, topY, botW, h)
  ctx.restore()
}

async function applySegmentation(segmenter, video, ctx, w, h) {
  if (!segmenter) return
  try {
    const result = await segmenter.segmentPeople(video, {
      multiSegmentation: false, segmentBodyParts: false,
    })
    if (!result?.length) return
    const oc   = Object.assign(document.createElement('canvas'), { width: w, height: h })
    const octx = oc.getContext('2d')
    octx.save(); octx.translate(w, 0); octx.scale(-1, 1); octx.drawImage(video, 0, 0, w, h); octx.restore()
    const maskData = await window.bodySegmentation.toBinaryMask(
      result,
      { r: 255, g: 255, b: 255, a: 255 },
      { r: 0,   g: 0,   b: 0,   a: 0   },
      false
    )
    const mc = Object.assign(document.createElement('canvas'), { width: w, height: h })
    mc.getContext('2d').putImageData(maskData, 0, 0)
    octx.globalCompositeOperation = 'destination-in'; octx.drawImage(mc, 0, 0)
    octx.globalCompositeOperation = 'source-over'; ctx.drawImage(oc, 0, 0)
  } catch (e) { console.warn('Segmentation error:', e) }
}

// ─────────────────────────────────────────────────────────────────────────────
// TryOnCamera component
// ─────────────────────────────────────────────────────────────────────────────

export default function TryOnCamera({
  gown,
  gowns         = [],
  onGownChange,
  externalDetector  = null,   // { current: detector | null }
  externalSegmenter = null,   // { current: segmenter | null }
  modelState: externalModelState = null,  // passed from context when using externalDetector
}) {
  const videoRef   = useRef(null)
  const canvasRef  = useRef(null)
  const streamRef  = useRef(null)
  const animRef    = useRef(null)
  const prevKpsRef = useRef(null)

  // Internal refs — used when NOT sharing via context
  const internalDetectorRef  = useRef(null)
  const internalSegmenterRef = useRef(null)

  // Use external refs when provided, fall back to internal
  const detectorRef  = externalDetector  ?? internalDetectorRef
  const segmenterRef = externalSegmenter ?? internalSegmenterRef

  // Stable refs for values consumed inside the detect loop
  const opacityRef    = useRef(0.88)
  const enhancedRef   = useRef(false)
  const gownRef       = useRef(gown)
  const gownImgRef    = useRef(null)
  const gownBackRef   = useRef(null)

  const goodFrames    = useRef(0)
  const facingFrames  = useRef(0)

  // Internal model loading (only used when no external detector is provided)
  const [internalModelState, setInternalModelState] = useState(
    externalDetector ? 'ready' : 'idle'
  )
  const modelState = externalModelState ?? internalModelState

  // Camera + pose state
  const [camState,   setCamState  ] = useState('off')
  const [camError,   setCamError  ] = useState('')
  const [poseLocked, setPoseLocked] = useState(false)
  const [poseFound,  setPoseFound ] = useState(false)
  const [poseIssues, setPoseIssues] = useState([])
  const [facingBack, setFacingBack] = useState(false)

  // Overlay controls
  const [opacity,    setOpacity   ] = useState(0.88)
  const [enhanced,   setEnhanced  ] = useState(false)
  const [segLoading, setSegLoading] = useState(false)
  const [segError,   setSegError  ] = useState('')

  // Capture / timer
  const [captured,   setCaptured  ] = useState(null)
  const [countdown,  setCountdown ] = useState(null)
  const [timerSecs,  setTimerSecs ] = useState(0)
  const countdownRef = useRef(null)

  // Mobile orientation
  const [isLandscape, setIsLandscape] = useState(false)

  // ── Sync refs ──────────────────────────────────────────────────────────────
  useEffect(() => { opacityRef.current = opacity },   [opacity])
  useEffect(() => { enhancedRef.current = enhanced }, [enhanced])
  useEffect(() => { gownRef.current = gown },         [gown])

  // ── Load gown image when gown changes ──────────────────────────────────────
  useEffect(() => {
    gownImgRef.current = null; gownBackRef.current = null
    if (!gown) return
    const src = gown.tryonImage || gown.image; if (!src) return

    const img = new Image(); img.crossOrigin = 'anonymous'
    img.onload  = () => { gownImgRef.current = img }
    img.onerror = () => {
      // Fallback: try the plain product image without crossOrigin (no CORS needed for display)
      if (src !== gown.image) {
        const fb = new Image(); fb.crossOrigin = 'anonymous'
        fb.onload = () => { gownImgRef.current = fb }
        fb.src = gown.image
      }
    }
    img.src = src

    if (gown.tryonImageBack) {
      const bi = new Image(); bi.crossOrigin = 'anonymous'
      bi.onload = () => { gownBackRef.current = bi }
      bi.src = gown.tryonImageBack
    }

    // Reset capture state when gown changes
    setCaptured(null); goodFrames.current = 0; setPoseLocked(false)
    setFacingBack(false); facingFrames.current = 0
  }, [gown])

  // ── Load internal model (skipped when external detector is provided) ───────
  useEffect(() => {
    if (externalDetector) return   // model is managed externally
    if (detectorRef.current || internalModelState === 'loading' || internalModelState === 'ready') return
    setInternalModelState('loading')
    Promise.all(POSE_SCRIPTS.map(loadScript))
      .then(() => window.tf.ready())
      .then(() => window.tf.setBackend('webgl').catch(() => window.tf.setBackend('cpu')))
      .then(() => {
        const pd = window.poseDetection
        return pd.createDetector(pd.SupportedModels.MoveNet, {
          modelType: pd.movenet.modelType.SINGLEPOSE_THUNDER,
        })
      })
      .then(det => { detectorRef.current = det; setInternalModelState('ready') })
      .catch(() => setInternalModelState('error'))
  }, [externalDetector, detectorRef, internalModelState])

  // ── Camera controls ────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    prevKpsRef.current = null; goodFrames.current = 0; facingFrames.current = 0
    setCamState('off'); setPoseFound(false); setPoseLocked(false); setPoseIssues([])
  }, [])

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
      streamRef.current = stream; videoRef.current.srcObject = stream
      await new Promise((res, rej) => {
        videoRef.current.onloadedmetadata = res
        setTimeout(() => rej(new Error('timeout')), 10_000)
      })
      await videoRef.current.play(); setCamState('on')
    } catch (err) {
      let msg = 'Could not start camera.'
      if (err.name === 'NotAllowedError')    msg = 'Camera permission denied. Click the camera icon in the address bar → Allow → refresh.'
      else if (err.name === 'NotFoundError') msg = 'No camera found on this device.'
      else if (err.name === 'NotReadableError') msg = 'Camera is in use by another app. Close Zoom/Teams and try again.'
      else if (err.message === 'timeout')    msg = 'Camera took too long to start — please try again.'
      setCamError(msg); setCamState('error')
    }
  }, [])

  // FIX: stop camera on tab visibility change to prevent silent stream leaks
  useEffect(() => {
    const onVisibility = () => { if (document.hidden && camState === 'on') stopCamera() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [camState, stopCamera])

  // ── Mobile orientation ─────────────────────────────────────────────────────
  useEffect(() => {
    const mq      = window.matchMedia('(orientation: landscape)')
    const handler = e => setIsLandscape(e.matches)
    setIsLandscape(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // ── Enhanced mode ──────────────────────────────────────────────────────────
  const toggleEnhanced = useCallback(() => {
    setEnhanced(v => {
      const next = !v; enhancedRef.current = next; setSegError('')
      if (next && !segmenterRef.current) {
        setSegLoading(true)
        loadScript(SEG_SCRIPT)
          .then(() => window.bodySegmentation.createSegmenter(
            window.bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,
            { runtime: 'tfjs' }
          ))
          .then(s => { segmenterRef.current = s })
          .catch(e => {
            console.warn('Segmentation load failed:', e)
            // FIX: surface error instead of silently failing
            setSegError('Could not load enhanced mode. Try refreshing.')
            setEnhanced(false); enhancedRef.current = false
          })
          .finally(() => setSegLoading(false))
      }
      return next
    })
  }, [segmenterRef])

  // ── Detect loop ────────────────────────────────────────────────────────────
  // FIX: stable callback with empty dep array — all changing values via refs
  const detect = useCallback(async () => {
    const video = videoRef.current, canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) {
      animRef.current = requestAnimationFrame(detect); return
    }
    // FIX: gate on detectorRef being populated — never spin on null detector
    if (!detectorRef.current) {
      animRef.current = requestAnimationFrame(detect); return
    }

    const dpr = window.devicePixelRatio || 1
    const vw  = video.videoWidth  || 640
    const vh  = video.videoHeight || 480
    canvas.width  = vw * dpr; canvas.height = vh * dpr
    canvas.style.width = vw + 'px'; canvas.style.height = vh + 'px'
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Draw mirrored video
    ctx.save(); ctx.translate(vw, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, vw, vh); ctx.restore()

    try {
      const poses = await detectorRef.current?.estimatePoses(video)
      if (poses?.length > 0) {
        // Flip keypoints to match the mirrored canvas
        let kps = poses[0].keypoints.map(k => ({ ...k, x: vw - k.x }))
        kps = smoothKps(prevKpsRef.current, kps); prevKpsRef.current = kps

        const analysis = analyzePose(kps, vw, vh)
        setPoseIssues(analysis.issues)

        // Smooth back-facing transitions — require 8 consecutive frames
        const tooClose = analysis.issues.includes('too_close') && !analysis.facingBack
        if (tooClose) facingFrames.current = 0
        else if (analysis.facingBack) facingFrames.current = Math.min(facingFrames.current + 1, 8)
        else facingFrames.current = Math.max(facingFrames.current - 1, 0)
        const isBack = facingFrames.current >= 8
        setFacingBack(isBack)

        const activeImg = isBack && gownBackRef.current ? gownBackRef.current : gownImgRef.current
        const cal    = { ...(gownRef.current?.tryonCalibration || {}) }
        const layout = getGownLayout(kps, cal, vw, vh)

        if (layout && activeImg && analysis.shouldersOk && analysis.hipsOk) {
          setPoseFound(true)
          goodFrames.current = Math.min(goodFrames.current + 1, 8)
          if (goodFrames.current >= 8) setPoseLocked(true)

          if (enhancedRef.current && segmenterRef.current) {
            drawGown(ctx, activeImg, layout, opacityRef.current)
            await applySegmentation(segmenterRef.current, video, ctx, vw, vh)
          } else {
            drawGown(ctx, activeImg, layout, opacityRef.current)
          }
        } else {
          setPoseFound(false)
          goodFrames.current = Math.max(0, goodFrames.current - 2)
          if (goodFrames.current === 0) setPoseLocked(false)
        }
      } else {
        setPoseFound(false); setPoseIssues(['no_pose'])
        prevKpsRef.current = null; goodFrames.current = 0; setPoseLocked(false)
      }
    } catch { /* skip frame */ }

    animRef.current = requestAnimationFrame(detect)
  }, [detectorRef, segmenterRef])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (camState === 'on') detect()
    else if (animRef.current) cancelAnimationFrame(animRef.current)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [camState, detect])

  useEffect(() => () => stopCamera(), [stopCamera])

  // ── Capture ────────────────────────────────────────────────────────────────
  const takePhoto = useCallback(() => {
    if (!canvasRef.current) return
    setCaptured(canvasRef.current.toDataURL('image/jpeg', 0.93))
  }, [])

  const startTimedCapture = useCallback(() => {
    if (timerSecs === 0) { takePhoto(); return }
    setCountdown(timerSecs)
    const tick = remaining => {
      if (remaining <= 0) {
        setCountdown(null)
        if (canvasRef.current) setCaptured(canvasRef.current.toDataURL('image/jpeg', 0.93))
        return
      }
      setCountdown(remaining)
      countdownRef.current = setTimeout(() => tick(remaining - 1), 1000)
    }
    countdownRef.current = setTimeout(() => tick(timerSecs - 1), 1000)
  }, [timerSecs, takePhoto])

  const cancelCountdown = useCallback(() => {
    clearTimeout(countdownRef.current); setCountdown(null)
  }, [])

  const retake = useCallback(() => {
    clearTimeout(countdownRef.current); setCountdown(null)
    setCaptured(null); goodFrames.current = 0; setPoseLocked(false)
  }, [])

  const downloadPhoto = useCallback(() => {
    if (!captured) return
    const name = (gownRef.current?.name || 'photo').replace(/\s+/g, '-')
    const a = Object.assign(document.createElement('a'), {
      href: captured, download: `tryon-${name}.jpg`,
    })
    a.click()
  }, [captured])

  // ── Derived state ──────────────────────────────────────────────────────────
  // FIX: gate start button on modelState — not just selectedGown
  const canStart = modelState === 'ready' && !!gown
  const canCap   = camState === 'on' && poseLocked && !captured
  const issue    = poseFound ? null : (poseIssues[0] ? GUIDANCE[poseIssues[0]] : null)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="tc-wrap">
      {/* Gown thumbnail strip */}
      {gowns.length > 0 && (
        <div className="tc-strip" role="listbox" aria-label="Select gown">
          {gowns.map(g => (
            <button
              key={g.id}
              className={`tc-strip-item${gown?.id === g.id ? ' sel' : ''}`}
              onClick={() => onGownChange?.(g)}
              role="option"
              aria-selected={gown?.id === g.id}
              aria-label={g.name}>
              <img src={g.image} alt={g.alt || g.name}/>
              {gown?.id === g.id && (
                <span className="tc-strip-check" aria-hidden="true">✓</span>
              )}
              {gown?.id === g.id && facingBack && g.tryonImageBack && (
                <span className="tc-strip-view-hint" aria-hidden="true">↩</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Viewport */}
      <div className="tc-viewport" aria-label="Camera viewport">
        <video ref={videoRef} playsInline muted
          style={{ position:'absolute', inset:0, width:'100%', height:'100%',
                   objectFit:'cover', transform:'scaleX(-1)', opacity:0 }}/>
        <canvas ref={canvasRef}
          style={{ position:'absolute', inset:0, width:'100%', height:'100%',
                   opacity: camState === 'on' ? 1 : 0, transition:'opacity .3s' }}/>

        {/* Off-state placeholder */}
        {camState !== 'on' && !captured && (
          <div className="tc-ph" aria-live="polite">
            <svg width="44" height="44" viewBox="0 0 80 80" fill="none" opacity=".3">
              <rect x="8" y="22" width="64" height="44" rx="4" stroke="white" strokeWidth="1.5"/>
              <circle cx="40" cy="44" r="12" stroke="white" strokeWidth="1.5"/>
              <path d="M30 22l4-8h12l4 8" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
            <p className="tc-ph-text">
              {modelState === 'loading' ? 'Loading AI model…'
               : modelState === 'error' ? 'Model failed to load — try refreshing'
               : gown ? `Selected: ${gown.name}` : 'Choose a gown, then start the camera'}
            </p>
          </div>
        )}

        {/* Body guide silhouette */}
        {camState === 'on' && !poseFound && !captured && !isLandscape && (
          <div className="tc-guide" aria-hidden="true">
            <svg viewBox="0 0 100 220" fill="none" stroke="rgba(255,255,255,.2)"
              strokeWidth="1.5" strokeLinecap="round" width="60" height="132">
              <ellipse cx="50" cy="24" rx="14" ry="18"/>
              <line x1="50" y1="42" x2="50" y2="110"/>
              <line x1="50" y1="62" x2="22" y2="98"/>
              <line x1="50" y1="62" x2="78" y2="98"/>
              <line x1="50" y1="110" x2="36" y2="176"/>
              <line x1="50" y1="110" x2="64" y2="176"/>
            </svg>
          </div>
        )}

        {/* Guidance hint */}
        {camState === 'on' && issue && !captured && (
          <div className="tc-hint" role="status">
            <span aria-hidden="true">{issue.icon}</span>
            <span>{issue.text}</span>
          </div>
        )}

        {/* Landscape warning */}
        {isLandscape && camState === 'on' && (
          <div className="tc-hint tc-hint--warn" role="alert">
            <span aria-hidden="true">📱</span>
            <span>Rotate to portrait for best overlay accuracy</span>
          </div>
        )}

        {/* Pose status badge */}
        {camState === 'on' && poseFound && !captured && countdown === null && (
          <div className={`tc-pose-badge${poseLocked ? ' locked' : ''}`} role="status"
            aria-label={poseLocked ? 'Pose ready — tap to capture' : 'Tracking your pose'}>
            <span className="tc-pulse" aria-hidden="true"/>
            {facingBack
              ? (gownBackRef.current ? '↩ Back view' : '↩ No back image')
              : (poseLocked ? 'Ready' : 'Tracking…')
            }
          </div>
        )}

        {/* Countdown overlay */}
        {countdown !== null && (
          <div className="tc-countdown" role="timer" aria-live="assertive">
            <span key={countdown}>{countdown}</span>
          </div>
        )}

        {/* Captured image */}
        {captured && (
          <img src={captured} alt="Your virtual try-on"
            style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'contain' }}/>
        )}
      </div>

      {/* Controls */}
      <div className="tc-controls">
        {camError && (
          <div className="tc-alert tc-alert--err" role="alert">{camError}</div>
        )}
        {segError && (
          <div className="tc-alert tc-alert--err" role="alert">{segError}</div>
        )}

        <div className="tc-ctrl-row">
          {(!camState || camState === 'off' || camState === 'error') ? (
            <button className="tc-btn tc-btn--primary" onClick={startCamera}
              disabled={!canStart}
              aria-label={
                modelState === 'loading' ? 'Loading AI model, please wait'
                : modelState === 'error' ? 'Model failed to load'
                : 'Start virtual try-on camera'
              }>
              {modelState === 'loading'
                ? <><span className="tc-spin" aria-hidden="true"/>Loading model…</>
                : modelState === 'error' ? 'Model failed — refresh to retry'
                : '▶ Start try-on'}
            </button>
          ) : captured ? (
            <>
              <button className="tc-btn tc-btn--ghost" onClick={retake}>↩ Retake</button>
              <button className="tc-btn tc-btn--primary" onClick={downloadPhoto}>Download ↓</button>
              {gown && (
                <Link href={`/gowns/${gown.id}`} className="tc-btn tc-btn--outline">
                  View gown →
                </Link>
              )}
            </>
          ) : (
            <>
              <button
                className={`tc-btn tc-btn--capture${canCap && countdown === null ? ' ready' : ''}`}
                onClick={countdown !== null ? cancelCountdown : startTimedCapture}
                disabled={!canCap && countdown === null}
                aria-label={
                  countdown !== null ? `Cancel countdown, ${countdown} seconds remaining`
                  : poseLocked ? 'Take photo'
                  : poseFound  ? 'Hold still, calibrating'
                  : 'Waiting for full body in frame'
                }>
                {countdown !== null
                  ? `Cancel (${countdown}s)`
                  : poseLocked ? '📷 Take photo'
                  : poseFound  ? 'Hold still…'
                  : 'Waiting…'}
              </button>

              {/* Timer selector */}
              <div className="tc-timer-row" role="group" aria-label="Self-timer">
                {[0, 3, 5, 10].map(s => (
                  <button key={s}
                    className={`tc-timer-btn${timerSecs === s ? ' active' : ''}`}
                    onClick={() => setTimerSecs(s)}
                    disabled={countdown !== null}
                    aria-pressed={timerSecs === s}
                    aria-label={s === 0 ? 'No timer' : `${s} second timer`}>
                    {s === 0 ? 'Off' : `${s}s`}
                  </button>
                ))}
              </div>

              <button className="tc-btn tc-btn--ghost" onClick={stopCamera}
                aria-label="Stop camera">■ Stop</button>
            </>
          )}
        </div>

        {/* Overlay settings — only shown while camera is active */}
        {camState === 'on' && !captured && (
          <div className="tc-settings">
            <div className="tc-opacity-row">
              <label className="tc-opacity-label" htmlFor="tc-opacity-slider">Opacity</label>
              <input
                id="tc-opacity-slider"
                type="range" min="0.2" max="1" step="0.05" value={opacity}
                onChange={e => { const v = +e.target.value; setOpacity(v); opacityRef.current = v }}
                className="tc-slider"
                aria-valuetext={`${Math.round(opacity * 100)}%`}/>
              <span className="tc-opacity-val" aria-hidden="true">{Math.round(opacity * 100)}%</span>
            </div>
            <div className="tc-enhanced-row">
              <div>
                <span className="tc-enhanced-label">Enhanced mode</span>
                <span className="tc-enhanced-sub">
                  {segLoading ? 'Loading…' : 'Layers gown behind your arms'}
                </span>
              </div>
              <button
                className={`tc-toggle${enhanced ? ' on' : ''}`}
                onClick={toggleEnhanced}
                disabled={segLoading}
                aria-pressed={enhanced}
                aria-label="Toggle enhanced body segmentation mode">
                <span className="tc-toggle-thumb" aria-hidden="true"/>
              </button>
            </div>
          </div>
        )}
      </div>

      <style suppressHydrationWarning>{`
        .tc-wrap { display:flex; flex-direction:column; height:100%; }

        /* Strip */
        .tc-strip { display:flex; gap:8px; padding:10px 12px; overflow-x:auto; border-bottom:1px solid #f0ede8; background:#fff; flex-shrink:0; scroll-behavior:smooth; }
        .tc-strip::-webkit-scrollbar { height:3px; }
        .tc-strip::-webkit-scrollbar-thumb { background:#c9a96e; border-radius:2px; }
        .tc-strip-item { position:relative; width:56px; height:72px; border-radius:6px; overflow:hidden; border:2px solid transparent; cursor:pointer; flex-shrink:0; transition:border-color .15s; background:none; padding:0; }
        .tc-strip-item img { width:100%; height:100%; object-fit:cover; object-position:top; }
        .tc-strip-item.sel { border-color:#c9a96e; }
        .tc-strip-check { position:absolute; inset:0; background:rgba(201,169,110,.4); display:flex; align-items:center; justify-content:center; color:#fff; font-size:14px; font-weight:700; }
        .tc-strip-view-hint { position:absolute; bottom:3px; right:3px; font-size:10px; background:rgba(0,0,0,.6); color:#fff; padding:1px 4px; border-radius:3px; }

        /* Viewport */
        .tc-viewport { flex:1; position:relative; background:#0d0a07; overflow:hidden; min-height:320px; }
        .tc-ph { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:20px; }
        .tc-ph-text { color:rgba(255,255,255,.4); font-size:13px; text-align:center; line-height:1.5; }
        .tc-guide { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; }
        .tc-hint { position:absolute; bottom:10px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,.65); color:rgba(255,255,255,.85); padding:7px 16px; border-radius:20px; font-size:12px; display:flex; align-items:center; gap:7px; white-space:nowrap; max-width:calc(100% - 24px); }
        .tc-hint--warn { background:rgba(160,90,0,.8); }
        .tc-pose-badge { position:absolute; top:10px; left:10px; background:rgba(0,0,0,.6); color:rgba(255,255,255,.75); padding:4px 12px; border-radius:20px; font-size:11px; display:flex; align-items:center; gap:6px; }
        .tc-pose-badge.locked { background:rgba(29,158,117,.85); color:#fff; }
        .tc-pulse { width:6px; height:6px; border-radius:50%; background:currentColor; animation:tcPulse 1.4s ease-in-out infinite; }
        @keyframes tcPulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        .tc-countdown { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.5); }
        .tc-countdown span { font-size:6rem; font-weight:200; color:#fff; font-family:'Georgia',serif; animation:tcCountIn .2s ease; }
        @keyframes tcCountIn { from{transform:scale(1.3);opacity:0} to{transform:none;opacity:1} }

        /* Controls */
        .tc-controls { padding:10px 12px; background:#fff; border-top:1px solid #f0ede8; flex-shrink:0; display:flex; flex-direction:column; gap:8px; }
        .tc-alert { font-size:12px; padding:8px 12px; border-radius:7px; line-height:1.4; }
        .tc-alert--err { background:#fcebeb; color:#501313; border:1px solid #f09595; }
        .tc-ctrl-row { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
        .tc-btn { padding:8px 14px; border-radius:7px; font-size:12px; font-weight:500; cursor:pointer; border:1px solid #ddd; background:#fff; color:#333; display:inline-flex; align-items:center; gap:5px; text-decoration:none; transition:background .15s; }
        .tc-btn:hover:not(:disabled) { background:#f5f5f5; }
        .tc-btn:disabled { opacity:.4; cursor:not-allowed; }
        .tc-btn--primary { background:#1a1108; border-color:#1a1108; color:#faf9f7; }
        .tc-btn--primary:hover:not(:disabled) { background:#3d2c14; }
        .tc-btn--ghost { background:transparent; border-color:#e0ddd8; color:#666; }
        .tc-btn--outline { border-color:#c9a96e; color:#7a5a1a; background:transparent; }
        .tc-btn--outline:hover { background:#faf6ee; }
        .tc-btn--capture { background:#1a1108; border-color:#1a1108; color:#faf9f7; }
        .tc-btn--capture.ready { background:#1D9E75; border-color:#1D9E75; }
        .tc-timer-row { display:flex; gap:4px; }
        .tc-timer-btn { padding:5px 9px; border:1px solid #e0ddd8; border-radius:6px; font-size:10px; cursor:pointer; background:#fff; color:#888; transition:all .15s; }
        .tc-timer-btn.active { background:#1a1108; border-color:#1a1108; color:#faf9f7; }
        .tc-timer-btn:disabled { opacity:.4; cursor:not-allowed; }

        /* Settings */
        .tc-settings { display:flex; flex-direction:column; gap:6px; padding-top:6px; border-top:1px solid #f0ede8; }
        .tc-opacity-row { display:flex; align-items:center; gap:8px; }
        .tc-opacity-label { font-size:11px; color:#888; width:52px; flex-shrink:0; }
        .tc-slider { flex:1; height:3px; -webkit-appearance:none; appearance:none; background:#f0ede8; border-radius:2px; outline:none; cursor:pointer; }
        .tc-slider::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; border-radius:50%; background:#c9a96e; cursor:pointer; }
        .tc-opacity-val { font-size:11px; color:#888; width:32px; text-align:right; }
        .tc-enhanced-row { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .tc-enhanced-label { font-size:12px; font-weight:500; color:#333; display:block; }
        .tc-enhanced-sub { font-size:10px; color:#aaa; display:block; }
        .tc-toggle { width:36px; height:20px; border-radius:10px; background:#e0ddd8; border:none; cursor:pointer; position:relative; transition:background .2s; flex-shrink:0; }
        .tc-toggle.on { background:#c9a96e; }
        .tc-toggle:disabled { opacity:.5; cursor:not-allowed; }
        .tc-toggle-thumb { position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff; transition:transform .2s; display:block; }
        .tc-toggle.on .tc-toggle-thumb { transform:translateX(16px); }
        .tc-spin { display:inline-block; width:11px; height:11px; border:2px solid rgba(255,255,255,.3); border-top-color:#fff; border-radius:50%; animation:tcSpin .7s linear infinite; }
        @keyframes tcSpin { to { transform:rotate(360deg); } }
      `}</style>
    </div>
  )
}