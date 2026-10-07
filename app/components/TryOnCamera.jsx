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

const MAX_RENDER_SCALE = 2     // canvas pixels per camera pixel; lower to 1.5 if a phone gets slow
// ── CDN scripts ───────────────────────────────────────────────────────────────
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
    s.onload = resolve; s.onerror = () => reject(new Error('Failed: ' + src))
    document.head.appendChild(s)
  })
}

// ── Keypoints ─────────────────────────────────────────────────────────────────
import { KP, CONF } from '../../lib/fitting-room/poseUtils.js'
import { drawGownWarped, createKpFilter, autoCalibration } from '../../lib/fitting-room/gownWarp.js'
import { drawGownGL, prepareGownGL } from '../../lib/fitting-room/glGownRenderer.js'
import { drawSuit } from '../../lib/suitWarp.js'
import { getProfile } from '../../lib/fitting-room/gownWarp.js'
import { resolveCal, guessTags, NECKLINES, SLEEVES, ADV_FIELDS, GEO_GROUPS } from '../../lib/fitting-room/calibration.js'


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
    const rawSw = dist(ls, rs), sw = Math.min(rawSw, vw * 0.80)
  const rawHw = dist(lh, rh), hw = Math.max(rawHw, sw * 0.90)
  const neckOff = cal.necklineY ?? 0.18
  const topY = sm.y - torsoH * neckOff
  let bottomY
  if (la?.score > CONF && ra?.score > CONF) {
    // Prefer heel / foot-index landmarks so the hem lands on the floor.
    // Falls back to the ankle when they are missing (e.g. a 17-point model).
    const feet = [kps[KP.LHEEL ?? 29], kps[KP.RHEEL ?? 30], kps[KP.LFOOT ?? 31], kps[KP.RFOOT ?? 32]]
      .filter(k => k && k.score > CONF)
    const floorY = feet.length
      ? Math.max(...feet.map(k => k.y))
      : Math.max(la.y, ra.y) + torsoH * 0.12
    bottomY = floorY + torsoH * 0.03
  } else if (lk?.score > CONF && rk?.score > CONF) {
    const km = mid(lk, rk), legH = km.y - hm.y
    bottomY = km.y + legH * 1.1
  } else {
    const byTorso    = sm.y + torsoH * 4.8
    const byShoulder = sm.y + sw * 4.0
    bottomY = (byTorso + byShoulder) / 2
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
  // Editor values are px in its 220×400 preview; normalise by the preview
  // body (shoulder span 88px, torso 108px) so they carry over to live video.
  const calSX = cal.scaleX ?? 1, calSY = cal.scaleY ?? 1
  const dxPx  = ((cal.offsetX ?? 0) / 88)  * sw
  const dyPx  = ((cal.offsetY ?? 0) / 108) * torsoH
  const top2  = topY + dyPx
  const bot2  = top2 + (bottomY - topY) * calSY
  // arm / leg anchors: how far each wrist sits outside its shoulder (screen-left / screen-right), ankle midpoint
  const A = [[ls, kps[KP.LW ?? 15]], [rs, kps[KP.RW ?? 16]]].sort((a, b) => a[0].x - b[0].x)
  const reach = (s, wr, dir) => (wr && wr.score > CONF) ? Math.min(1, Math.max(-0.5, dir * (wr.x - s.x) / Math.max(sw, 1))) : 0.1
  const arms = { l: reach(A[0][0], A[0][1], -1), r: reach(A[1][0], A[1][1], 1) }
  const legX = (la?.score > CONF && ra?.score > CONF) ? (la.x + ra.x) / 2 : null
  const legSpan = (la?.score > CONF && ra?.score > CONF) ? Math.abs(la.x - ra.x) : null
  return { topY: top2, bottomY: bot2, cx: cx + dxPx, topW: topW * calSX, botW: botW * calSX,
           torsoH, widthScale: cal.widthScale ?? 1, sm, hm, sw, hw, rawHw, cal,
           dx: dxPx, dy: dyPx, scaleX: calSX, arms, legX, legSpan }
}

function drawGown(ctx, img, layout, opacity) {
  const t = ctx.getTransform()
  const size = { w: ctx.canvas.width / t.a, h: ctx.canvas.height / t.d }   // logical (camera-pixel) size at any render scale
  // Menswear has its own straight-cut renderer (no waist cinch / skirt flare / sway)
  if (layout.segment === 'men') {
    layout.suitProfile = getProfile(img)
    if (drawSuit(ctx, img, layout, opacity)) return
  }
  if (drawGownGL(ctx, img, layout, opacity, size)) return
  if (drawGownWarped(ctx, img, layout, opacity, size)) return
  const { topY, bottomY, cx, topW, botW } = layout
  const h = bottomY - topY; if (h <= 0) return

  // Off-screen canvas at logical pixel size (no DPR scaling) so the
  // trapezoid clip doesn't bleed into subsequent frames on the main canvas
    const vw = size.w
  const vh = size.h
  const oc = document.createElement('canvas')
  oc.width = vw; oc.height = vh
  const octx = oc.getContext('2d')

  // Uniform scale: height comes from the body, width follows the image's
  // own aspect ratio, so the gown can't be stretched flat.
  const aspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height)
  const imgW   = h * aspect * (layout.widthScale ?? 1)
  octx.drawImage(img, cx - imgW / 2, topY, imgW, h)

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(oc, 0, 0, vw, vh)
  ctx.restore()
}
let segOC = null, segAC = null
function applySegmentation(maskCanvas, video, ctx, w, h, kps, rawKps, layout) {
  try {
    if (!segOC) { segOC = document.createElement('canvas'); segAC = document.createElement('canvas') }
    if (segOC.width !== w || segOC.height !== h) {
      segOC.width = w; segOC.height = h; segAC.width = w; segAC.height = h
    }
    const octx = segOC.getContext('2d')
    octx.globalCompositeOperation = 'source-over'
    octx.clearRect(0, 0, w, h)
    // mirrored video, then keep only person pixels (mask mirrored the same way)
    octx.save(); octx.translate(w, 0); octx.scale(-1, 1); octx.drawImage(video, 0, 0, w, h); octx.restore()
    octx.globalCompositeOperation = 'destination-in'
    octx.save(); octx.translate(w, 0); octx.scale(-1, 1); octx.drawImage(maskCanvas, 0, 0, w, h); octx.restore()
    // keep only the arms, so the gown still covers the torso
    if (kps) {
      const actx = segAC.getContext('2d')
      actx.clearRect(0, 0, w, h)
      const sw0  = dist(kps[KP.LS], kps[KP.RS])
      const armW = Math.max(12, sw0 * 0.3)
      actx.strokeStyle = '#fff'; actx.lineCap = 'round'; actx.lineJoin = 'round'
      const chains = [[KP.LS, KP.LE ?? 13, KP.LW ?? 15], [KP.RS, KP.RE ?? 14, KP.RW ?? 16]]
      const sleeves = layout?.cal?.enh?.sleeves || 'none'
      const sleeveCoversUpper = sleeves !== 'none' && sleeves !== 'straps'   // the gown's own sleeve is drawn there
      const sleeveCoversFore  = sleeves === 'long' || sleeves === 'cape'
      const hz = [KP.LH, KP.RH].map(i => rawKps?.[i]?.z).filter(z => typeof z === 'number')
      const hipZ = hz.length ? hz.reduce((a, b) => a + b, 0) / hz.length : null
      const cx0 = layout?.cx ?? (kps[KP.LS].x + kps[KP.RS].x) / 2
      const halfW = Math.max(layout?.hw ?? 0, layout?.sw ?? sw0) * 0.62
      // a segment shows over the gown when it is beside the body, or nearer the camera than the hips
      const show = (ia, ib, a, b) => {
        if (Math.abs((a.x + b.x) / 2 - cx0) > halfW) return true
        const za = rawKps?.[ia]?.z, zb = rawKps?.[ib]?.z
        if (hipZ == null || typeof za !== 'number' || typeof zb !== 'number') return true   // no depth: old behaviour
        return (za + zb) / 2 < hipZ - sw0 * 0.12
      }
      const stroke = (a, b, wd) => { actx.lineWidth = wd; actx.beginPath(); actx.moveTo(a.x, a.y); actx.lineTo(b.x, b.y); actx.stroke() }
      for (const [si, ei, wi] of chains) {
        const s = kps[si], e = kps[ei], wr = kps[wi]
        if (![s, e, wr].every(k => k && k.score > CONF)) continue
        const hand = lerpPt(e, wr, 1.3)   // extend past the wrist so hands survive the background reveal
        if (!sleeveCoversUpper && show(si, ei, s, e)) stroke(lerpPt(s, e, 0.45), e, armW)
        if (show(ei, wi, e, wr)) {
          if (!sleeveCoversFore) stroke(e, wr, armW)
          stroke(wr, hand, armW * 1.2)    // hands always
        }
      }
      octx.globalCompositeOperation = 'destination-in'
      octx.filter = 'blur(1.5px)'; octx.drawImage(segAC, 0, 0); octx.filter = 'none'
    }
    octx.globalCompositeOperation = 'source-over'
    ctx.drawImage(segOC, 0, 0, w, h)
  } catch (e) { console.warn('Segmentation error:', e) }
}
// ─────────────────────────────────────────────────────────────────────────────
// TryOnCamera component
// ─────────────────────────────────────────────────────────────────────────────

export default function TryOnCamera({
  calibrate = false,
  onSaveCalibration = null,
  gown,
  gowns         = [],
  onGownChange,
  externalDetector  = null,   // { current: detector | null }
  externalSegmenter = null,   // { current: segmenter | null }
  modelState: externalModelState = null,  // passed from context when using externalDetector
  onSave,
  bodyMeasures = null,
}) {
  const videoRef      = useRef(null)
  const canvasRef     = useRef(null)
  const streamRef     = useRef(null)
  const animRef       = useRef(null)
  const prevKpsRef    = useRef(null)
  const kpFilterRef   = useRef(createKpFilter())
  const isStartingRef = useRef(false)
  const cancelledRef  = useRef(null)   // set by startCamera(); called on unmount
  const tcWrapRef     = useRef(null)   // fullscreen target — wraps the viewport
  const liveCalRef    = useRef(null)   // live calibration values (calibrate mode only)
  const [liveCal, setLiveCal] = useState(null)

  // Internal refs — used when NOT sharing via context
  const internalDetectorRef  = useRef(null)
  const internalSegmenterRef = useRef(null)

  // Use external refs when provided, fall back to internal
  const detectorRef  = externalDetector  ?? internalDetectorRef
  const segmenterRef = externalSegmenter ?? internalSegmenterRef

  // Stable refs for values consumed inside the detect loop
    const opacityRef    = useRef(1)
  const enhancedRef   = useRef(false)
  const gownRef       = useRef(gown)
  const measRef       = useRef(bodyMeasures)
  const gownImgRef    = useRef(null)
  const gownBackRef   = useRef(null)

  const goodFrames    = useRef(0)
  const facingFrames  = useRef(0)
  const lastLayoutRef = useRef(null)   // last layout that passed the sanity check
  const lightRef      = useRef(1)      // smoothed brightness factor for the gown
  const lightSlopeRef = useRef(0)      // smoothed left-vs-right room brightness (+ = brighter on the right)
  const dbgRef        = useRef(null)
  const lightCanvas   = useRef(null)
  const badLayoutRef  = useRef(0)      // consecutive rejected frames
  const smoothLayoutRef = useRef(null) // low-pass filtered layout scalars
  const smoothTRef      = useRef(0)
    const lastVidTimeRef  = useRef(-1)   // skip pose when no new video frame
  const plateRef        = useRef(null) // clean background (mirrored), captured when the person leaves frame
  const noPoseFrames    = useRef(0)
  const lightTintRef    = useRef([1, 1, 1])
  const [plateReady, setPlateReady] = useState(false)
    const frozenRef  = useRef(null)    // { frame, kps, seg } while a frame is frozen (calibrate mode)
  const lastSegRef = useRef(null)    // latest person mask, copied into the freeze
  const [frozen, setFrozen] = useState(false)

  // Internal model loading (only used when no external detector is provided)
  const [internalModelState, setInternalModelState] = useState(
    externalDetector ? 'ready' : 'idle'
  )
  const modelState = externalModelState ?? internalModelState

  // Camera + pose state
  const [camState,   setCamState  ] = useState('off')
  const [camError,   setCamError  ] = useState('')
  const [camQuality, setCamQuality] = useState('requested')  // 'requested' | 'reduced' | 'minimal'
  const [poseLocked, setPoseLocked] = useState(false)
  const [poseFound,  setPoseFound ] = useState(false)
  const [poseIssues, setPoseIssues] = useState([])
  const [facingBack, setFacingBack] = useState(false)

  // Overlay controls
    const [opacity,    setOpacity   ] = useState(1)
  const [enhanced,   setEnhanced  ] = useState(false)
  const [segLoading, setSegLoading] = useState(false)
  const [segError,   setSegError  ] = useState('')
  const [revealOn,   setRevealOn  ] = useState(true)    // hide clothing / body that sticks out past the gown edge
  const [armsOn,     setArmsOn    ] = useState(true)    // draw arms and hands over the gown
  const revealRef = useRef(true)
  const armsRef   = useRef(true)

  // Capture / timer
  const [captured,   setCaptured  ] = useState(null)
  const [countdown,  setCountdown ] = useState(null)
  const [timerSecs,  setTimerSecs ] = useState(0)
  const countdownRef = useRef(null)

  // Mobile orientation
  const [isLandscape, setIsLandscape] = useState(false)

  // Fullscreen
  const [fullscreen, setFullscreen] = useState(false)

  // ── Sync refs ──────────────────────────────────────────────────────────────
  useEffect(() => { opacityRef.current = opacity },   [opacity])
  useEffect(() => { enhancedRef.current = enhanced }, [enhanced])
  useEffect(() => { gownRef.current = gown },         [gown])
  useEffect(() => {
    const c = gown?.tryonCalibration
    console.log('[TryOnCamera] gown cal', gown?.id, {
      mode: c?.mode, curveOn: c?.enhanced?.curveOn,
      curveL: c?.enhanced?.curveL?.length, curveR: c?.enhanced?.curveR?.length,
      keys: c ? Object.keys(c) : null,
    })
  }, [gown])

  // Calibrate mode: start from the gown's saved calibration, edit live
  useEffect(() => {
    if (!calibrate) { liveCalRef.current = null; setLiveCal(null); return }
    const base = { ...(gown?.tryonCalibration || {}) }
    liveCalRef.current = base; setLiveCal(base)
  }, [calibrate, gown?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  const setCalKey = (k, v) => {
    const next = { ...(liveCalRef.current || {}), [k]: v }
    liveCalRef.current = next; setLiveCal(next)
  }
  useEffect(() => { measRef.current = bodyMeasures }, [bodyMeasures?.bust, bodyMeasures?.waist, bodyMeasures?.hips])

  // ── Load gown image when gown changes ──────────────────────────────────────
  // The previous gown stays on screen until the new image has loaded, so
  // swapping while the camera is on does not flash an empty frame.
  useEffect(() => {
    if (!gown) { gownImgRef.current = null; gownBackRef.current = null; return }
    const src = gown.tryonImage || gown.image
    if (!src) { gownImgRef.current = null; gownBackRef.current = null; return }

    let stale = false

    const img = new Image(); img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (stale) return
      gownImgRef.current = img
      prepareGownGL(img)
      setCaptured(null)
      setFacingBack(false)
      facingFrames.current = 0
    }
    img.onerror = () => {
      if (stale) return
      // Fallback: try the plain product image
      if (src !== gown.image) {
        const fb = new Image(); fb.crossOrigin = 'anonymous'
        fb.onload = () => { if (!stale) { gownImgRef.current = fb; setCaptured(null) } }
        fb.src = gown.image
      }
    }
    img.src = src

    if (gown.tryonImageBack) {
      const bi = new Image(); bi.crossOrigin = 'anonymous'
      bi.onload = () => { if (!stale) gownBackRef.current = bi }
      bi.src = gown.tryonImageBack
    } else {
      gownBackRef.current = null
    }

    return () => { stale = true }
  }, [gown?.id])   // stable dep: only re-runs when gown ID changes, not on object identity churn

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
    console.trace('[TryOnCamera] stopCamera() called — stream was:', streamRef.current?.id)
    if (animRef.current) cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    prevKpsRef.current = null; kpFilterRef.current.reset(); goodFrames.current = 0; facingFrames.current = 0
        plateRef.current = null; noPoseFrames.current = 0; setPlateReady(false)
            frozenRef.current = null; setFrozen(false)
    setCamState('off'); setPoseFound(false); setPoseLocked(false); setPoseIssues([])
  }, [])

  const startCamera = useCallback(async () => {
    // Hard guard against a second concurrent call (double-click / re-render).
    if (isStartingRef.current) return
    isStartingRef.current = true

    // Track whether this component is still mounted by the time the async
    // work below resolves. Without this, navigating away from the Try On
    // tab WHILE getUserMedia()'s permission prompt is pending causes the
    // component to unmount and run stopCamera() before the stream exists —
    // then the promise resolves afterward and assigns a live stream to a
    // ref nothing will ever clean up again. That orphaned stream holds the
    // camera device until the tab is fully closed, and every subsequent
    // attempt anywhere on the site fails with "in use by another app."
    let cancelled = false
    cancelledRef.current = () => { cancelled = true }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }

    setCamError(''); setCamState('starting'); setCamQuality('requested')
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('Camera not supported in this browser.'); setCamState('error')
      isStartingRef.current = false; return
    }

    let stream = null
    try {
      console.log('[TryOnCamera] before getUserMedia')
      try {
        // Tier 1 — full quality: resolution, framerate, and front camera
        stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user', frameRate: { ideal: 30 } },
          audio: false,
        })
        setCamQuality('requested')
      } catch (fullErr) {
        if (fullErr.name !== 'NotReadableError') throw fullErr
        console.warn('[TryOnCamera] Full-quality getUserMedia failed, retrying without frameRate:', fullErr)
        try {
          // Tier 2 — drop the framerate ask, keep resolution + front camera preference
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
            audio: false,
          })
          setCamQuality('reduced')
        } catch (reducedErr) {
          if (reducedErr.name !== 'NotReadableError') throw reducedErr
          console.warn('[TryOnCamera] Reduced-quality getUserMedia failed, retrying with defaults:', reducedErr)
          // Tier 3 — let the browser pick whatever it can actually open
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          setCamQuality('minimal')
        }
      }
      console.log('[TryOnCamera] after getUserMedia, stream id:', stream.id, 'tracks:', stream.getVideoTracks().map(t => t.readyState))

      if (cancelled) {
        // Component unmounted while the permission prompt was pending —
        // release immediately instead of assigning to a dead ref.
        stream.getTracks().forEach(t => t.stop())
        return
      }

      streamRef.current = stream; videoRef.current.srcObject = stream
      console.log('[TryOnCamera] waiting for metadata')
      await new Promise((res, rej) => {
        videoRef.current.onloadedmetadata = res
        setTimeout(() => rej(new Error('timeout')), 10_000)
      })
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); streamRef.current = null; return }

      console.log('[TryOnCamera] calling play()')
      await videoRef.current.play()
      console.log('[TryOnCamera] play() succeeded — setting camState to on')
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); streamRef.current = null; return }
      setCamState('on')
    } catch (err) {
      console.error('[TryOnCamera] Camera error:', err)
      console.log('[TryOnCamera] Error name:', err.name, '| message:', err.message)
      if (stream) stream.getTracks().forEach(t => t.stop())
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
      if (!cancelled) {
        let msg = 'Could not start camera.'
        if (err.name === 'NotAllowedError')       msg = 'Camera permission denied. Click the camera icon in the address bar → Allow → refresh.'
        else if (err.name === 'NotFoundError')    msg = 'No camera found on this device.'
        else if (err.name === 'NotReadableError') msg = 'Camera is in use by another app. Close Zoom/Teams and try again.'
        else if (err.name === 'OverconstrainedError') msg = `Camera doesn't support the requested resolution/settings.`
        else if (err.message === 'timeout')       msg = 'Camera took too long to start — please try again.'
        setCamError(msg); setCamState('error')
      }
    } finally {
      isStartingRef.current = false
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
    const mq      = window.matchMedia('(orientation: landscape) and (pointer: coarse)')
    const handler = e => setIsLandscape(e.matches)
    setIsLandscape(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const freezeFrame = useCallback(() => {
    const video = videoRef.current
    if (!video || !prevKpsRef.current) return
    const vw = video.videoWidth || 640, vh = video.videoHeight || 480
    const fc = document.createElement('canvas'); fc.width = vw; fc.height = vh
    const fx = fc.getContext('2d')
    fx.save(); fx.translate(vw, 0); fx.scale(-1, 1); fx.drawImage(video, 0, 0, vw, vh); fx.restore()
    let seg = null
    const ls = lastSegRef.current
    if (ls) { seg = document.createElement('canvas'); seg.width = ls.width; seg.height = ls.height; seg.getContext('2d').drawImage(ls, 0, 0) }
    frozenRef.current = { frame: fc, kps: prevKpsRef.current.map(k => ({ ...k })), seg }
    setFrozen(true)
  }, [])
  const unfreezeFrame = useCallback(() => { frozenRef.current = null; setFrozen(false) }, [])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenEnabled) { setFullscreen(v => !v); return }
    if (!document.fullscreenElement) {
      tcWrapRef.current?.requestFullscreen().catch(() => setFullscreen(v => !v))
    } else {
      document.exitFullscreen()
    }
  }, [])

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

    // ── Swap gowns while the camera is on ──────────────────────────────────────
  const stripRef = useRef(null)
  const swipeRef = useRef(null)

  const stepGown = useCallback((dir) => {
    if (gowns.length < 2) return
    const i = gowns.findIndex(g => g.id === gown?.id)
    const next = i < 0 ? gowns[0] : gowns[(i + dir + gowns.length) % gowns.length]
    if (next) onGownChange?.(next)
  }, [gowns, gown?.id, onGownChange])

  const canSwap = camState === 'on' && !captured && countdown === null && !calibrate && gowns.length > 1

  const onSwipeStart = e => {
    if (e.target.closest('button, input, select, a')) { swipeRef.current = null; return }
    swipeRef.current = { x: e.clientX, y: e.clientY }
  }
  const onSwipeEnd = e => {
    const s = swipeRef.current; swipeRef.current = null
    if (!s || !canSwap) return
    const dx = e.clientX - s.x, dy = e.clientY - s.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) stepGown(dx < 0 ? 1 : -1)
  }

  // Arrow keys on desktop
  useEffect(() => {
    if (!canSwap) return
    const onKey = e => {
      if (e.target.closest?.('input, select, textarea')) return
      if (e.key === 'ArrowLeft')  stepGown(-1)
      if (e.key === 'ArrowRight') stepGown(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canSwap, stepGown])

  // Keep the selected thumbnail visible in the strip
  useEffect(() => {
    stripRef.current?.querySelector('.sel')
      ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [gown?.id])

  // ── Enhanced mode ──────────────────────────────────────────────────────────
    const toggleEnhanced = useCallback(() => {
    setSegError('')
    const det = detectorRef.current
    if (!enhancedRef.current && !det?.setMask) {
      setSegError('Enhanced mode needs the MediaPipe model.')
      return
    }
    const next = !enhancedRef.current
    enhancedRef.current = next
    setEnhanced(next)
    det?.setMask?.(next)
  }, [detectorRef])

  // release the mask on unmount (shared detector outlives this component)
  useEffect(() => () => { detectorRef.current?.setMask?.(false) }, [detectorRef])

  // ── Detect loop ────────────────────────────────────────────────────────────
  // FIX: stable callback with empty dep array — all changing values via refs
  const detect = useCallback(async () => {
    const video = videoRef.current, canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) {
      animRef.current = requestAnimationFrame(detect); return
    }
        if (video.currentTime === lastVidTimeRef.current) {
      animRef.current = requestAnimationFrame(detect); return
    }
    lastVidTimeRef.current = video.currentTime
    // FIX: gate on detectorRef being populated — never spin on null detector
    if (!detectorRef.current) {
      animRef.current = requestAnimationFrame(detect); return
    }



  const dpr = window.devicePixelRatio || 1
    const vw  = video.videoWidth  || 640
    const vh  = video.videoHeight || 480
    // Render at the size the canvas is actually shown, so the gown stays sharp on big screens.
    const rect = canvas.getBoundingClientRect()
    const fit  = Math.min(rect.width / vw, rect.height / vh) || 1       // CSS px per camera px (object-fit: contain)
    const S    = Math.round(Math.min(MAX_RENDER_SCALE, Math.max(1, fit * dpr)) * 4) / 4
    const cw = Math.round(vw * S), ch = Math.round(vh * S)
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
    // Do NOT set canvas.style.width/height here — that would overwrite the
    // 100%/objectFit:contain styling set via the JSX style prop on every
    // single frame (this runs 60x/sec), which is what was silently
    // cancelling out the CSS fullscreen/centering fix.
    const ctx = canvas.getContext('2d')
        ctx.setTransform(S, 0, 0, S, 0, 0)

    // Draw mirrored video
        if (frozenRef.current) ctx.drawImage(frozenRef.current.frame, 0, 0, vw, vh)
    else { ctx.save(); ctx.translate(vw, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, vw, vh); ctx.restore() }

    try {
            const frozen = frozenRef.current
      const poses = frozen ? [{ keypoints: [], segmentation: frozen.seg }] : await detectorRef.current?.estimatePoses(video)
      if (poses?.length > 0) {
        // Flip keypoints to match the mirrored canvas
                noPoseFrames.current = 0
        let kps
        if (frozen) kps = frozen.kps          // stored, already mirrored and filtered
        else {
          kps = poses[0].keypoints.map(k => ({ ...k, x: vw - k.x }))
          kps = kpFilterRef.current.apply(kps, performance.now()); prevKpsRef.current = kps
        }

        const analysis = analyzePose(kps, vw, vh)
        setPoseIssues(analysis.issues)

        /* TEMP DEBUG — remove after diagnosing overlay offset
        ;[KP.LS, KP.RS, KP.LH, KP.RH].forEach(idx => {
          const k = kps[idx]
          if (k?.score > CONF) {
            ctx.beginPath()
            ctx.arc(k.x, k.y, 8, 0, Math.PI * 2)
            ctx.fillStyle = 'red'
            ctx.fill()
          }
        })*/

        // Smooth back-facing transitions — require 8 consecutive frames
        const tooClose = analysis.issues.includes('too_close') && !analysis.facingBack
        if (tooClose) facingFrames.current = 0
        else if (analysis.facingBack) facingFrames.current = Math.min(facingFrames.current + 1, 8)
        else facingFrames.current = Math.max(facingFrames.current - 1, 0)
        const isBack = facingFrames.current >= 8
        setFacingBack(isBack)

        const activeImg = isBack && gownBackRef.current ? gownBackRef.current : gownImgRef.current
        const cal    = resolveCal({ ...autoCalibration(gownRef.current), ...(gownRef.current?.tryonCalibration || {}), ...(liveCalRef.current || {}) }, gownRef.current)
        const rawLayout = getGownLayout(kps, cal, vw, vh)
        if (rawLayout) rawLayout.meas = measRef.current
        let layout = rawLayout
        if (rawLayout) {
          const prev   = lastLayoutRef.current
          const ratio  = rawLayout.torsoH / Math.max(rawLayout.sw, 1)   // normal adult front view is roughly 1.0-1.6
          const jump   = prev
            ? Math.max(Math.abs(rawLayout.sw / Math.max(prev.sw, 1) - 1),
                       Math.abs(rawLayout.torsoH / Math.max(prev.torsoH, 1) - 1))
            : 0
          const glitch = ratio < 0.7 || ratio > 3 || jump > 0.35
          if (glitch && prev && badLayoutRef.current < 6) {
            badLayoutRef.current += 1
            layout = prev                       // hold the last good frame for up to 6 frames
          } else {
            badLayoutRef.current = 0
            lastLayoutRef.current = rawLayout   // real movement is accepted after 6 frames
          }
        }
                if (layout) {
          const now = performance.now()
          const gap = now - smoothTRef.current
          smoothTRef.current = now
          const sp = gap < 500 ? smoothLayoutRef.current : null   // reset after a pose dropout
          const a  = 1 - Math.exp(-Math.min(gap, 100) / 1000 / 0.12)   // frame-rate independent, ~120ms
          const out = { ...layout }
          if (sp) for (const k of ['topY', 'bottomY', 'cx', 'sw', 'hw', 'rawHw', 'torsoH', 'topW', 'botW', 'legSpan']) {
            if (typeof layout[k] === 'number' && typeof sp[k] === 'number') out[k] = sp[k] + (layout[k] - sp[k]) * a
          }
          smoothLayoutRef.current = out
          layout = out
        }
        if (layout && activeImg && analysis.shouldersOk && analysis.hipsOk) {
          setPoseFound(true)
                    try {
            // Sample the ROOM, not the person: the two outer edge strips of the frame.
            const lc = lightCanvas.current || (lightCanvas.current = Object.assign(document.createElement('canvas'), { width: 16, height: 8 }))
            const lg = lc.getContext('2d', { willReadFrequently: true })
            const cw = canvas.width, ch = canvas.height, sx = Math.max(8, Math.round(cw * 0.1))
            lg.drawImage(canvas, 0, 0, sx, ch, 0, 0, 8, 8)
            lg.drawImage(canvas, cw - sx, 0, sx, ch, 8, 0, 8, 8)
            const px = lg.getImageData(0, 0, 16, 8).data
            let R = 0, Gc = 0, B = 0
            for (let i = 0; i < px.length; i += 4) { R += px[i]; Gc += px[i + 1]; B += px[i + 2] }
            const n = (px.length / 4) * 255
            R /= n; Gc /= n; B /= n
            let lL = 0, lR = 0
            for (let i = 0; i < px.length; i += 4) {
              const yl = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
              if (((i / 4) % 16) < 8) lL += yl; else lR += yl
            }
            const slopeT = Math.max(-0.15, Math.min(0.15, ((lR - lL) / Math.max(lR + lL, 1)) * 1.5))
            lightSlopeRef.current += (slopeT - lightSlopeRef.current) * 0.05
            const L = 0.299 * R + 0.587 * Gc + 0.114 * B
            const target = Math.min(1.1, Math.max(0.75, 0.6 + 0.8 * L))   // mid-grey room = 1.0
            lightRef.current += (target - lightRef.current) * 0.08
            // colour cast: lean the gown 40% toward the room's tint, capped at ±12%
            const tt = [R, Gc, B].map(c => Math.min(1.12, Math.max(0.88, 1 + 0.4 * (c / Math.max(L, 0.02) - 1))))
            const tc = lightTintRef.current
            for (let i = 0; i < 3; i++) tc[i] += (tt[i] - tc[i]) * 0.08
          } catch { /* ignore a failed sample */ }
          layout.brightness = lightRef.current
          layout.lightSlope = lightSlopeRef.current
          layout.tint = lightTintRef.current
          dbgRef.current = { kps, sw: layout.sw, torsoH: layout.torsoH, bright: layout.brightness, bad: badLayoutRef.current,
            mode: layout.cal?.mode, curveOn: !!layout.cal?.enh?.curve?.on, rawCurve: !!gownRef.current?.tryonCalibration?.enhanced?.curveL }
          goodFrames.current = Math.min(goodFrames.current + 1, 8)
          if (goodFrames.current >= 8) setPoseLocked(true)

          const seg = poses[0].segmentation
                    if (!frozen) lastSegRef.current = seg || null
          const plate = plateRef.current
                    layout.noCloth = !!frozen
          layout.segment = String(gownRef.current?.segment || 'women').toLowerCase()
          layout.reveal = (enhancedRef.current && revealRef.current && seg && plate && plate.width === vw && plate.height === vh)
            ? { plate, mask: seg, margin: layout.sw * 0.1 }
            : null
          drawGown(ctx, activeImg, layout, opacityRef.current)
          if (enhancedRef.current && seg && armsRef.current) {
            applySegmentation(poses[0].segmentation, video, ctx, vw, vh, kps, poses[0].keypoints, layout)
          }
        } else {
          setPoseFound(false)
          goodFrames.current = Math.max(0, goodFrames.current - 2)
          if (goodFrames.current === 0) setPoseLocked(false)
        }
      } else {
        setPoseFound(false); setPoseIssues(['no_pose'])
        prevKpsRef.current = null; kpFilterRef.current.reset(); goodFrames.current = 0; setPoseLocked(false)
                // clean background plate: person out of frame for ~1s while Enhanced is on
        if (enhancedRef.current) {
          const cov = detectorRef.current?.coverage
          if (cov != null && cov > 0.01) noPoseFrames.current = 0
          else if (++noPoseFrames.current === 30) {
            const pc = (plateRef.current && plateRef.current.width === vw && plateRef.current.height === vh)
              ? plateRef.current
              : (plateRef.current = Object.assign(document.createElement('canvas'), { width: vw, height: vh }))
            pc.getContext('2d').drawImage(canvas, 0, 0, vw, vh)
            setPlateReady(true)
          }
        }
      }
    } catch { /* skip frame */ }
    if (dbgRef.current && window.location.search.includes('tryondebug')) {
      const d = dbgRef.current
      ctx.save(); ctx.fillStyle = 'lime'
      ;[KP.LS, KP.RS, KP.LH, KP.RH, 15, 16, 27, 28, 29, 30, 31, 32].forEach(i => {
        const k = d.kps?.[i]
        if (k && k.score > CONF) { ctx.beginPath(); ctx.arc(k.x, k.y, 4, 0, Math.PI * 2); ctx.fill() }
      })
      ctx.font = '12px monospace'; ctx.fillStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 3
      ;[`pts ${d.kps?.length}  sw ${d.sw | 0}  torso ${d.torsoH | 0}  ratio ${(d.torsoH / d.sw).toFixed(2)}`,
        `light ${d.bright?.toFixed(2)}  heldFrames ${d.bad}`,
        `mode ${d.mode}  savedCurve ${d.rawCurve}  curveActive ${d.curveOn}`,
        `video ${vw}x${vh}  canvas ${canvas.width}x${canvas.height}  scale ${S}  shown ${rect.width | 0}x${rect.height | 0} css px`
      ].forEach((t, i) => ctx.fillText(t, 8, vh - 42 + i * 14))
      ctx.restore()
    }

    animRef.current = requestAnimationFrame(detect)
    }, [detectorRef])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (camState === 'on') detect()
    else if (animRef.current) cancelAnimationFrame(animRef.current)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [camState, detect])

  useEffect(() => () => {
    cancelledRef.current?.()   // flag any in-flight startCamera() as cancelled
    stopCamera()
  }, [stopCamera])

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
        <div className="tc-strip" ref={stripRef} role="listbox" aria-label="Select gown">
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
      <div
        ref={tcWrapRef}
        className={`tc-viewport${fullscreen ? ' tc-viewport--fs' : ''}`}
        aria-label="Camera viewport"
        onPointerDown={onSwipeStart}
        onPointerUp={onSwipeEnd}
        onPointerCancel={() => { swipeRef.current = null }}
      >
        <video ref={videoRef} playsInline muted
          style={{ position:'absolute', inset:0, width:'100%', height:'100%',
                   objectFit:'cover', transform:'scaleX(-1)', opacity:0 }}/>
        <canvas ref={canvasRef}
          style={{ width:'100%', height:'100%', objectFit:'contain',
                   display:'block', opacity: camState === 'on' ? 1 : 0, transition:'opacity .3s' }}/>

        {camState === 'on' && (
          <button
            className="tc-fs-btn"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? '⤢' : '⤡'} <span>{fullscreen ? 'Exit' : 'Fullscreen'}</span>
          </button>
        )}

        {/* Swap controls (also visible in fullscreen) */}
        {canSwap && (
          <>
            <button className="tc-swap tc-swap--prev" onClick={() => stepGown(-1)}
              aria-label="Previous gown">‹</button>
            <button className="tc-swap tc-swap--next" onClick={() => stepGown(1)}
              aria-label="Next gown">›</button>
            {gown && (
              <div className="tc-gown-name" role="status" aria-live="polite">
                {gown.name}
                <span className="tc-gown-count">
                  {gowns.findIndex(g => g.id === gown.id) + 1}/{gowns.length}
                </span>
              </div>
            )}
          </>
        )}

        {/* Swap arrows (also visible in fullscreen) */}
        {canSwap && (
          <>
            <button className="tc-swap tc-swap--prev" onClick={() => stepGown(-1)}
              aria-label="Previous gown">‹</button>
            <button className="tc-swap tc-swap--next" onClick={() => stepGown(1)}
              aria-label="Next gown">›</button>
            {gown && (
              <div className="tc-gown-name" role="status" aria-live="polite">
                {gown.name}
                <span className="tc-gown-count">
                  {gowns.findIndex(g => g.id === gown.id) + 1}/{gowns.length}
                </span>
              </div>
            )}
          </>
        )}

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
        {frozen && camState === 'on' && (
          <div className="tc-hint tc-hint--warn" role="status">
            <span aria-hidden="true">❄</span>
            <span>Frame frozen. Adjust the sliders, then press Resume live.</span>
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
        {camState === 'on' && camQuality !== 'requested' && (
          <div className="tc-alert" style={{ background: '#fff8ec', color: '#7a5a1a', border: '1px solid #e8d5a8' }} role="status">
            Camera running at reduced quality on this device — try-on still works, image may be softer than usual.
          </div>
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
              {onSave && (
                <button className="tc-btn tc-btn--outline" onClick={() => onSave(captured)}>
                  ♡ Save to profile
                </button>
              )}
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

              {/* Timer selector — grouped + labeled so it reads as "self-timer
                  duration", distinct from the camera Stop control below */}
              <div className="tc-timer-group">
                <span className="tc-timer-caption">Self-timer</span>
                <div className="tc-timer-row" role="group" aria-label="Self-timer duration">
                  {[0, 3, 5, 10].map(s => (
                    <button key={s}
                      className={`tc-timer-btn${timerSecs === s ? ' active' : ''}`}
                      onClick={() => setTimerSecs(s)}
                      disabled={countdown !== null}
                      aria-pressed={timerSecs === s}
                      aria-label={s === 0 ? 'No timer' : `${s} second timer`}>
                      {s === 0 ? 'No timer' : `${s}s`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="tc-ctrl-divider" aria-hidden="true"/>

              <button className="tc-btn tc-btn--danger" onClick={stopCamera}
                aria-label="Stop camera and turn off the video feed"
                title="Stop camera">
                ■ Stop camera
              </button>
            </>
          )}
        </div>

        {calibrate && liveCal && camState === 'on' && (
          <div className="tc-settings" style={{ borderTop: '2px solid #c9a96e' }}>
            <span className="tc-enhanced-label">Calibration mode — {gown?.name}</span>
                        <div className="tc-ctrl-row">
              {['simple', 'enhanced'].map(m => (
                <button key={m} type="button"
                  className={`tc-btn ${(liveCal.mode || 'simple') === m ? 'tc-btn--primary' : 'tc-btn--ghost'}`}
                  aria-pressed={(liveCal.mode || 'simple') === m}
                  onClick={() => setCalKey('mode', m)}>
                  {m === 'simple' ? 'Simple' : 'Enhanced'}
                </button>
              ))}
            </div>
            {liveCal.mode === 'enhanced' && (() => {
              const r = resolveCal(liveCal, gown), e = r.enh
              const setEnh = (k, v) => setCalKey('enhanced', { ...(liveCalRef.current?.enhanced || {}), [k]: v })
              const rows = [
                { k: 'topAt',        label: 'Top edge',     min: -0.4, max: 0.4, step: 0.01, v: -r.necklineY },
                { k: 'shoulderEase', label: 'Top width',    min: 0.8,  max: 2.0, step: 0.01, v: r.shoulderPad },
                { k: 'seamL',        label: 'Left sleeve',  min: 0,    max: 0.4, step: 0.01, v: e.seamL },
                { k: 'seamR',        label: 'Right sleeve', min: 0,    max: 0.4, step: 0.01, v: e.seamR },
              ]
              return (
                <>
                  <div className="tc-ctrl-row">
                    <select aria-label="Neckline" value={e.neckline} onChange={ev => setEnh('neckline', ev.target.value)}
                      style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid #ddd' }}>
                      {NECKLINES.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                    </select>
                    <select aria-label="Sleeves" value={e.sleeves} onChange={ev => setEnh('sleeves', ev.target.value)}
                      style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid #ddd' }}>
                      {SLEEVES.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                    </select>
                    <button type="button" className="tc-btn tc-btn--ghost"
                      onClick={() => setCalKey('enhanced', { neckline: e.neckline, sleeves: e.sleeves })}>
                      Reset to tag defaults
                    </button>
                  </div>
                  {rows.map(s => (
                    <div key={s.k} className="tc-opacity-row">
                      <label className="tc-opacity-label" style={{ width: 110 }}>{s.label}</label>
                      <input type="range" className="tc-slider" min={s.min} max={s.max} step={s.step}
                        value={s.v} onChange={ev => setEnh(s.k, parseFloat(ev.target.value))}/>
                      <span className="tc-opacity-val" style={{ width: 40 }}>{Number(s.v).toFixed(2)}</span>
                    </div>
                  ))}
                                    {GEO_GROUPS.map(g => (
                    <div key={g.id}>
                      <span className="tc-enhanced-label">{g.title}</span>
                      {g.fields.map(f => (
                        <div key={f.k} className="tc-opacity-row">
                          <label className="tc-opacity-label" style={{ width: 110 }}>{f.label}</label>
                          <input type="range" className="tc-slider" min={f.min} max={f.max} step={f.step}
                            value={r.enh.geo[f.k]} onChange={ev => setEnh(f.k, parseFloat(ev.target.value))}/>
                          <span className="tc-opacity-val" style={{ width: 40 }}>{Number(r.enh.geo[f.k]).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  {ADV_FIELDS.map(f => (
                    <div key={f.k} className="tc-opacity-row">
                      <label className="tc-opacity-label" style={{ width: 110 }}>{f.label}</label>
                      <input type="range" className="tc-slider" min={f.min} max={f.max} step={f.step}
                        value={r.enh.adv[f.k]} onChange={ev => setEnh(f.k, parseFloat(ev.target.value))}/>
                      <span className="tc-opacity-val" style={{ width: 40 }}>{Number(r.enh.adv[f.k]).toFixed(2)}</span>
                    </div>
                  ))}
                </>
              )
            })()}
            {[
              { k: 'necklineY',   label: 'Top position',   min: -0.15, max: 0.5, step: 0.01, def: 0.18 },
              { k: 'waistRow',    label: 'Waist position', min: 0.1,   max: 0.8, step: 0.01, def: 0.3  },
              { k: 'shoulderPad', label: 'Shoulder width', min: 0.6,   max: 2.0, step: 0.01, def: 1.15 },
              { k: 'waistEase',   label: 'Waist ease',     min: 0.8,   max: 1.4, step: 0.01, def: 1.05 },
              { k: 'hipEase',     label: 'Hip ease',       min: 0.8,   max: 1.4, step: 0.01, def: 1.1  },
              { k: 'skirtFlare',  label: 'Skirt flare',    min: 0.7,   max: 2.0, step: 0.01, def: 1.1  },
            ].map(s => {
                            if (liveCal.mode === 'enhanced' && (s.k === 'necklineY' || s.k === 'shoulderPad' || s.k === 'skirtFlare')) return null
              const v = liveCal[s.k] ?? autoCalibration(gown)[s.k] ?? s.def
              return (
                <div key={s.k} className="tc-opacity-row">
                  <label className="tc-opacity-label" style={{ width: 110 }}>{s.label}</label>
                  <input type="range" className="tc-slider" min={s.min} max={s.max} step={s.step}
                    value={v} onChange={e => setCalKey(s.k, parseFloat(e.target.value))}/>
                  <span className="tc-opacity-val" style={{ width: 40 }}>
                    {s.k === 'waistRow' && liveCal.waistRow == null ? 'auto' : Number(v).toFixed(2)}
                  </span>
                </div>
              )
            })}
            <div className="tc-ctrl-row">
              {frozen
                ? <button type="button" className="tc-btn tc-btn--outline" onClick={unfreezeFrame}>▶ Resume live</button>
                : <button type="button" className="tc-btn tc-btn--outline" onClick={freezeFrame} disabled={!poseFound}
                    title="Freeze the current frame and pose, so you can adjust sliders without holding still">
                    ❄ Freeze frame
                  </button>}
              <button className="tc-btn tc-btn--primary" onClick={() => onSaveCalibration?.(liveCalRef.current || {})}>
                Save calibration
              </button>
              <button className="tc-btn tc-btn--ghost" onClick={() => { liveCalRef.current = {}; setLiveCal({}) }}>
                Reset to auto
              </button>
            </div>
          </div>
        )}

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
                  {segLoading ? 'Loading…' : !enhanced ? 'Layers gown behind your arms' : plateReady ? 'Background captured' : 'Step out of frame ~1s to capture background'}
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
            {enhanced && (
              <>
                <div className="tc-enhanced-row">
                  <div>
                    <span className="tc-enhanced-label">Hide clothing behind gown</span>
                    <span className="tc-enhanced-sub">Replaces your body or clothes near the gown edge with the background</span>
                  </div>
                  <button
                    className={`tc-toggle${revealOn ? ' on' : ''}`}
                    onClick={() => { const v = !revealRef.current; revealRef.current = v; setRevealOn(v) }}
                    aria-pressed={revealOn}
                    aria-label="Toggle hiding clothing behind the gown">
                    <span className="tc-toggle-thumb" aria-hidden="true"/>
                  </button>
                </div>
                <div className="tc-enhanced-row">
                  <div>
                    <span className="tc-enhanced-label">Arms over gown</span>
                    <span className="tc-enhanced-sub">Shows your arms and hands in front of the gown</span>
                  </div>
                  <button
                    className={`tc-toggle${armsOn ? ' on' : ''}`}
                    onClick={() => { const v = !armsRef.current; armsRef.current = v; setArmsOn(v) }}
                    aria-pressed={armsOn}
                    aria-label="Toggle showing arms over the gown">
                    <span className="tc-toggle-thumb" aria-hidden="true"/>
                  </button>
                </div>
              </>
            )}
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
        .tc-viewport {
          flex:1; position:relative; background:#0d0a07; overflow:hidden; min-height:320px;
          display:flex; align-items:center; justify-content:center;
        }
        .tc-viewport--fs {
          position:fixed; inset:0; z-index:9999; min-height:100vh;
        }
        .tc-viewport:fullscreen { background:#0d0a07; }
        .tc-swap {
          position:absolute; top:50%; transform:translateY(-50%); z-index:6;
          width:40px; height:40px; border-radius:50%; border:1.5px solid rgba(255,255,255,.8);
          background:rgba(0,0,0,.5); color:#fff; font-size:24px; line-height:1;
          display:flex; align-items:center; justify-content:center; cursor:pointer;
          backdrop-filter:blur(4px);
        }
        .tc-swap:hover { background:rgba(0,0,0,.75); }
        .tc-swap--prev { left:10px; }
        .tc-swap--next { right:10px; }
        .tc-gown-name {
          position:absolute; bottom:48px; left:50%; transform:translateX(-50%); z-index:5;
          background:rgba(0,0,0,.6); color:#fff; padding:5px 14px; border-radius:20px;
          font-size:12px; white-space:nowrap; max-width:calc(100% - 110px);
          overflow:hidden; text-overflow:ellipsis; pointer-events:none;
        }
        .tc-gown-count { margin-left:8px; opacity:.6; font-size:10px; }
        .tc-viewport { touch-action: pan-y; user-select: none; -webkit-user-select: none; }
        .tc-swap {
          position:absolute; top:50%; transform:translateY(-50%); z-index:6;
          width:40px; height:40px; border-radius:50%; border:1.5px solid rgba(255,255,255,.8);
          background:rgba(0,0,0,.5); color:#fff; font-size:24px; line-height:1;
          display:flex; align-items:center; justify-content:center; cursor:pointer;
          backdrop-filter:blur(4px);
        }
        .tc-swap:hover { background:rgba(0,0,0,.75); }
        .tc-swap--prev { left:10px; }
        .tc-swap--next { right:10px; }
        .tc-gown-name {
          position:absolute; bottom:48px; left:50%; transform:translateX(-50%); z-index:5;
          background:rgba(0,0,0,.6); color:#fff; padding:5px 14px; border-radius:20px;
          font-size:12px; white-space:nowrap; max-width:calc(100% - 110px);
          overflow:hidden; text-overflow:ellipsis; pointer-events:none;
        }
        .tc-gown-count { margin-left:8px; opacity:.6; font-size:10px; }
        .tc-fs-btn {
          position:absolute; top:12px; right:12px; z-index:6;
          display:flex; align-items:center; gap:6px;
          padding:8px 14px; border-radius:20px; border:1.5px solid rgba(255,255,255,.9);
          background:rgba(0,0,0,.6); color:#fff; font-size:13px; font-weight:600;
          cursor:pointer; backdrop-filter:blur(4px);
          box-shadow:0 2px 10px rgba(0,0,0,.35);
        }
        .tc-fs-btn:hover { background:rgba(0,0,0,.8); border-color:#fff; }
        .tc-fs-btn span { line-height:1; }
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
        .tc-timer-group { display:flex; flex-direction:column; gap:3px; }
        .tc-timer-caption { font-size:9px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:#aaa; padding-left:2px; }
        .tc-timer-row { display:flex; gap:4px; padding:3px; background:#f5f3ef; border-radius:8px; }
        .tc-timer-btn { padding:5px 9px; border:1px solid transparent; border-radius:6px; font-size:10px; cursor:pointer; background:transparent; color:#888; transition:all .15s; }
        .tc-timer-btn.active { background:#1a1108; border-color:#1a1108; color:#faf9f7; }
        .tc-timer-btn:disabled { opacity:.4; cursor:not-allowed; }
        .tc-ctrl-divider { width:1px; align-self:stretch; background:#e8e5e0; margin:2px 2px; }
        .tc-btn--danger { background:#fff; border-color:#e0a5a5; color:#a02020; }
        .tc-btn--danger:hover:not(:disabled) { background:#fcebeb; border-color:#c96060; }

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