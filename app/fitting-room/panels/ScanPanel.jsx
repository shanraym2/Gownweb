'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useFittingRoom } from '../FittingRoomProvider'
import SegmentGate from '../components/SegmentGate'
import { SKIN_TONES } from '../../constants/styleOptions'
import { SEGMENTS } from '../../constants/sizeConstants'
import {
  analyzePose,
  detectBodyShapeFromPose,
  smoothKpsDisplay,
  checkLighting,
  shouldAccumulateFrame,
  iqm, dist, mid, KP, CONF, HIGH_SEVERITY_ISSUES,
  HIST_SIZE,
} from '../../../lib/fitting-room/poseUtils'
import { estimateMeasurements, estimateMeasurementsWithDepth, getTorsoAnchor, MEAS_VARIANCE } from '../../../lib/fitting-room/measurementUtils'
import { sampleBackgroundColor, measureSilhouetteWidth } from '../../../lib/fitting-room/silhouetteUtils'
import { _detectSkinProfileFixed } from '../../utils/skinTone'

// ─────────────────────────────────────────────────────────────────────────────
// UNIT CONVERSION
// Internal storage is always cm. Conversion only at input and display
// boundaries — never inside measurement math or updateProfile calls.
// ─────────────────────────────────────────────────────────────────────────────

const CM_PER_INCH = 2.54
const cmToIn  = cm     => cm     != null ? Math.round((cm     / CM_PER_INCH) * 10) / 10 : null
const inToCm  = inches => inches != null ? Math.round(inches  * CM_PER_INCH  * 10) / 10 : null
const dispVal = (cm, unit) =>
  cm == null ? '—' : unit === 'in' ? `${cmToIn(cm)} in` : `${Math.round(cm)} cm`

// ─────────────────────────────────────────────────────────────────────────────
// GUIDANCE MAP
// ─────────────────────────────────────────────────────────────────────────────

const GUIDANCE_MAP = {
  no_pose:      'Stand in front of the camera — full body visible.',
  no_shoulders: 'Step back until your shoulders appear.',
  no_hips:      'Step back — your waist needs to be in view.',
  no_legs:      'Step back so your legs are visible.',
  too_close:    'Too close. Move back 1–2 metres.',
  head_cut:     'Move down — your head is cut off.',
  tilted:       'Stand straight — shoulders and hips should be level.',
  rotated:      'Face the camera directly.',
  too_dark:     'Too dark — move to better lighting or turn on a light.',
  too_bright:   'Too bright — avoid direct sunlight or bright backlighting.',
}

// Validation bounds per unit
const BOUNDS_CM = {
  bust: [50, 200], waist: [40, 180], hips: [50, 200],
  height: [100, 250], weight: [30, 300],
}
const BOUNDS_IN = {
  bust: [20, 79], waist: [16, 71], hips: [20, 79],
  height: [39, 98], weight: [30, 300],   // weight always kg
}

function validateField(key, value, unit) {
  if (!value) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Must be a number'
  const boundsMap = unit === 'in' ? BOUNDS_IN : BOUNDS_CM
  const bounds    = boundsMap[key]
  if (bounds && (n < bounds[0] || n > bounds[1])) return `${bounds[0]}–${bounds[1]}`
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// SCAN PANEL
// ─────────────────────────────────────────────────────────────────────────────

export default function ScanPanel() {
  const { updateProfile, detectorRef, modelState, profile } = useFittingRoom()

  const videoRef          = useRef(null)
  const canvasRef         = useRef(null)
  const streamRef         = useRef(null)
  const animRef           = useRef(null)
  const swHistRef         = useRef([])
  const hipHistRef        = useRef([])
  const pxPerCmHistRef    = useRef([])
  const torsoHRef         = useRef(null)
  const prevKpsDisplayRef = useRef(null)
  const liveKpsRef        = useRef(null)
  const skinDebounceRef   = useRef(null)
  const shapeVotesRef     = useRef({})
  const goodFrames        = useRef(0)
  const bestSnapshotRef   = useRef(null)
  const scanWrapRef       = useRef(null)
  const isStartingRef     = useRef(false)   // hard guard against concurrent startCamera() calls

  // ── Side-scan refs ─────────────────────────────────────────────────────────
  // Populated at front-scan lock time so the side-scan stage can convert its
  // measured pixel depths into cm using the SAME scale anchor as the front
  // scan — the subject must stay the same distance from the camera between
  // the two captures for this to be valid.
  const lockedPxPerCmRef  = useRef(null)
  const lockedWidthsRef   = useRef(null)   // { shoulderCm, waistCm, hipCm } from front scan
  const bgColorRef          = useRef(null)
  const bustDepthHistRef    = useRef([])
  const waistDepthHistRef   = useRef([])
  const hipDepthHistRef     = useRef([])
  const bestSideSnapshotRef = useRef(null)   // best-confidence side frame, mirrors bestSnapshotRef

  // Unit state — reads from localStorage so all panels stay in sync
  const [unit, setUnit] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('fr_unit') || 'cm') : 'cm'
  )
  const toggleUnit = () => setUnit(u => {
    const n = u === 'cm' ? 'in' : 'cm'
    localStorage.setItem('fr_unit', n)
    return n
  })

  const [scanMode,         setScanMode        ] = useState('front')   // 'front' | 'side'
  const [sideStage,        setSideStage       ] = useState('idle')    // 'idle' | 'capturing' | 'done' | 'skipped'
  const [sideSamples,      setSideSamples     ] = useState(0)
  const [sideConfidence,   setSideConfidence  ] = useState(0)
  const [liveSideDepth,    setLiveSideDepth   ] = useState(null)      // live { bust, waist, hip } cm while capturing
  const [sideDepths,       setSideDepths      ] = useState(null)      // { bust, waist, hip } cm — locked result
  const [sideSnapshot,     setSideSnapshot    ] = useState(null)      // best-frame capture, mirrors `snapshot`
  const [showSideSnapshot, setShowSideSnapshot] = useState(false)
  const [activeTab,     setActiveTab    ] = useState('camera')
  const [camState,      setCamState     ] = useState('off')
  const [camError,      setCamError     ] = useState('')
  const [locked,        setLocked       ] = useState(false)
  const [confidence,    setConfidence   ] = useState(0)
  const [poseIssues,    setPoseIssues   ] = useState([])
  const [poseFound,     setPoseFound    ] = useState(false)
  const [detectedTone,  setDetectedTone ] = useState(null)
  const [detectedShape, setDetectedShape] = useState(null)
  const [liveEst,       setLiveEst      ] = useState(null)
  const [fullscreen,    setFullscreen   ] = useState(false)
  const [snapshot,      setSnapshot     ] = useState(null)
  const [showSnapshot,  setShowSnapshot ] = useState(false)

  const [heightInput, setHeightInput] = useState('')
  const [heightSet,   setHeightSet  ] = useState(false)

  // adjBust/Waist/Hips are always stored as cm strings internally
  const [adjBust,  setAdjBust ] = useState('')
  const [adjWaist, setAdjWaist] = useState('')
  const [adjHips,  setAdjHips ] = useState('')
  const [scanConf, setScanConf] = useState(0)

  const [mBust,   setMBust  ] = useState('')
  const [mWaist,  setMWaist ] = useState('')
  const [mHips,   setMHips  ] = useState('')
  const [mHeight, setMHeight] = useState('')
  const [mWeight, setMWeight] = useState('')
  const [mErrors, setMErrors] = useState({})

  // When profile.height is loaded from saved profile, pre-fill height input
  // converting to the active unit for display
  useEffect(() => {
    if (profile.height && !heightSet) {
      const display = unit === 'in' ? String(cmToIn(profile.height) ?? '') : String(profile.height)
      setHeightInput(display)
      setHeightSet(true)
    }
  }, [profile.height, heightSet, unit])

  const stopCamera = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    swHistRef.current = []; hipHistRef.current = []; pxPerCmHistRef.current = []
    prevKpsDisplayRef.current = null; shapeVotesRef.current = {}
    goodFrames.current = 0; liveKpsRef.current = null
    setCamState('off'); setPoseFound(false); setConfidence(0); setPoseIssues([])
    setLiveEst(null)
  }, [])

  const startCamera = useCallback(async () => {
    // Hard synchronous guard — the `disabled` attribute on the button relies
    // on camState re-rendering, which is async and batched. A fast
    // double-click (or a dev-mode double-invoke) can slip two calls through
    // before that re-render lands, opening two concurrent getUserMedia()
    // requests that fight over the same device.
    if (isStartingRef.current) return
    isStartingRef.current = true

    // Defensive: release any stream this component instance already holds
    // before requesting a new one.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }

    if (heightInput) {
      const h = parseFloat(heightInput)
      // Input boundary — convert to cm before storing
      const heightCm = unit === 'in' ? inToCm(h) : h
      const minH = unit === 'in' ? 39 : 100
      const maxH = unit === 'in' ? 98 : 250
      if (heightCm != null && heightCm >= 100 && heightCm <= 250 && h >= minH && h <= maxH) {
        updateProfile({ height: heightCm })
      }
    }
    setCamError(''); setCamState('starting')
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('Camera not supported.'); setCamState('error'); isStartingRef.current = false; return
    }
    if (!window.isSecureContext) {
      setCamError('Camera requires HTTPS (or localhost) — this page is loaded over an insecure connection.')
      setCamState('error'); isStartingRef.current = false; return
    }

    let stream = null
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user', frameRate: { ideal: 30 } },
          audio: false,
        })
      } catch (constrainedErr) {
        if (constrainedErr.name !== 'NotReadableError') throw constrainedErr
        // Driver couldn't service the requested ideal constraints — retry
        // with a bare request and let the browser pick a mode it can serve.
        console.warn('[ScanPanel] Constrained getUserMedia failed, retrying with defaults:', constrainedErr)
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }
      streamRef.current = stream; videoRef.current.srcObject = stream
      await new Promise((res, rej) => {
        videoRef.current.onloadedmetadata = res
        setTimeout(() => rej(new Error('timeout')), 10000)
      })
      await videoRef.current.play(); setCamState('on')
    } catch (err) {

       console.error("Camera error:", err);
        console.log("Error name:", err.name);
        console.log("Error message:", err.message);
      // Release the stream on ANY failure past this point. Without this,
      // a partial failure (metadata timeout, autoplay rejection) leaves the
      // camera locked by this page's own orphaned stream — and the next
      // attempt reports "in use by another app" even though nothing else
      // is using it.
      if (stream) stream.getTracks().forEach(t => t.stop())
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null

      let msg = 'Could not start camera.'
      if (err.name === 'NotAllowedError') {
        msg = "Camera permission denied. Click the camera icon in your browser's address bar, allow access, then try again."
        if (navigator.permissions?.query) {
          try {
            const status = await navigator.permissions.query({ name: 'camera' })
            if (status.state === 'granted') {
              msg = "Camera is allowed for this site, but access was still denied — this points to an OS-level block. On Windows: Settings → Privacy & security → Camera → make sure \"Let desktop apps access your camera\" is on. On Mac: System Settings → Privacy & Security → Camera. Also check no other app currently has the camera open."
            }
          } catch {
            // permissions.query({name:'camera'}) isn't supported everywhere.
          }
        }
      } else if (err.name === 'NotFoundError')       msg = 'No camera found.'
      else if (err.name === 'NotReadableError')      msg = 'Camera in use by another app.'
      else if (err.name === 'OverconstrainedError')  msg = `Camera doesn't support the requested resolution/settings.`
      else if (err.message === 'timeout')            msg = 'Camera took too long to start — try again.'
      setCamError(msg); setCamState('error')
    } finally {
      isStartingRef.current = false
    }
  }, [heightInput, unit, updateProfile])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenEnabled) { setFullscreen(v => !v); return }
    if (!document.fullscreenElement) {
      scanWrapRef.current?.requestFullscreen().catch(() => setFullscreen(v => !v))
    } else {
      document.exitFullscreen()
    }
  }, [])

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  useEffect(() => {
    const onVis = () => { if (document.hidden && camState === 'on') stopCamera() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [camState, stopCamera])

  const detect = useCallback(async () => {
    const video = videoRef.current, canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) {
      animRef.current = requestAnimationFrame(detect); return
    }
    if (!detectorRef.current) {
      animRef.current = requestAnimationFrame(detect); return
    }

    const vw = video.videoWidth || 640, vh = video.videoHeight || 480
    canvas.width = vw; canvas.height = vh
    const ctx = canvas.getContext('2d')

    ctx.save(); ctx.translate(vw, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, vw, vh); ctx.restore()

    // ── LIGHTING GATE ──────────────────────────────────────────────────────
    const lighting = checkLighting(ctx, vw, vh)
    if (!lighting.ok) {
      goodFrames.current = Math.max(0, goodFrames.current - 3)
      setPoseIssues([lighting.reason])
      setPoseFound(false)
      setConfidence(0)
      setLiveEst(null)
      animRef.current = requestAnimationFrame(detect)
      return
    }
    // ── END LIGHTING GATE ──────────────────────────────────────────────────

    try {
      const poses = await detectorRef.current.estimatePoses(video)
      if (poses?.length > 0) {
        const rawKps = poses[0].keypoints.map(k => ({ ...k, x: vw - k.x }))
        const dispKps = smoothKpsDisplay(prevKpsDisplayRef.current, rawKps)
        prevKpsDisplayRef.current = dispKps
        liveKpsRef.current = rawKps

        const analysis = analyzePose(rawKps, vw, vh)
        setPoseIssues(analysis.issues); setPoseFound(analysis.shouldersOk && analysis.hipsOk)

        const hasHighSeverityIssue = analysis.issues.some(i => HIGH_SEVERITY_ISSUES.has(i))

        if (analysis.shouldersOk && analysis.hipsOk) {
          if (hasHighSeverityIssue) {
            goodFrames.current = Math.max(0, goodFrames.current - 4)
          } else {
            goodFrames.current = Math.min(goodFrames.current + 1, 60)
          }

          const ls   = rawKps[KP.LS],  rs   = rawKps[KP.RS]
          const lh   = rawKps[KP.LH],  rh   = rawKps[KP.RH]
          const nose = rawKps[KP.NOSE]
          const la   = rawKps[KP.LA],  ra   = rawKps[KP.RA]

          const hasFullHeight = profile.height && nose?.score > CONF && la?.score > CONF && ra?.score > CONF

          const pxPerCm = (() => {
            if (hasFullHeight) {
              const ankleMid     = mid(la, ra)
              const fullHeightPx = ankleMid.y - nose.y
              return fullHeightPx / profile.height
            }
            const torsoAnchor = getTorsoAnchor(profile.segment, profile.height)
            const torsoH      = mid(lh, rh).y - mid(ls, rs).y
            return torsoH / torsoAnchor
          })()

          const torsoH = mid(lh, rh).y - mid(ls, rs).y

          if (torsoH > 20 && pxPerCm > 0) {
            torsoHRef.current = torsoH

            const prevMeanPxPerCm = pxPerCmHistRef.current.length
              ? pxPerCmHistRef.current.reduce((a, b) => a + b, 0) / pxPerCmHistRef.current.length
              : pxPerCm
            const scaleOk = Math.abs(pxPerCm - prevMeanPxPerCm) / prevMeanPxPerCm < 0.06
            pxPerCmHistRef.current.push(pxPerCm)
            if (pxPerCmHistRef.current.length > 30) pxPerCmHistRef.current.shift()

            const swPx = dist(ls, rs)
            const hwPx = dist(lh, rh)

            if (shouldAccumulateFrame(analysis.issues, lighting.ok) && scaleOk) {
              swHistRef.current.push(swPx)
              if (swHistRef.current.length > HIST_SIZE) swHistRef.current.shift()
              hipHistRef.current.push(hwPx)
              if (hipHistRef.current.length > HIST_SIZE) hipHistRef.current.shift()
            }

            const estSwPx  = iqm(swHistRef.current) || swPx
            const estHipPx = iqm(hipHistRef.current) || hwPx

            const estSwCm    = estSwPx  / pxPerCm
            const estHipCm   = estHipPx / pxPerCm
            const estWaistCm = estSwCm * 0.80

            const { bust: estBust, waist: estWaist, hips: estHips } = estimateMeasurements({
              shoulderCm: estSwCm,
              waistCm:    estWaistCm,
              hipCm:      estHipCm,
              bodyShape:  detectedShape,
              segment:    profile.segment,
            })

            let conf = 0
            conf += Math.min((goodFrames.current / 60) * 55, 55)
            conf += hasFullHeight ? 15 : 0
            conf += analysis.kneesOk  ? 8 : 0
            conf += analysis.anklesOk ? 7 : 0
            conf += !analysis.issues.length ? 10 : 0
            conf += swHistRef.current.length >= 40 ? 5 : 0
            conf = Math.min(Math.round(conf), 95)

            setConfidence(conf)
            setLiveEst({ bust: estBust, waist: estWaist, hips: estHips })

            if (conf > (bestSnapshotRef.current?.confidence ?? 0) && conf >= 70) {
              const snap = document.createElement('canvas')
              snap.width = vw; snap.height = vh
              snap.getContext('2d').drawImage(canvas, 0, 0)
              bestSnapshotRef.current = {
                dataUrl:    snap.toDataURL('image/jpeg', 0.82),
                confidence: conf,
                est:        { bust: estBust, waist: estWaist, hips: estHips },
              }
            }

            const confColor = conf >= 70 ? 'rgba(29,158,117,' : conf >= 50 ? 'rgba(239,159,39,' : 'rgba(226,75,74,'
            ctx.strokeStyle = `${confColor}${conf > 60 ? '0.7)' : '0.35)'})`
            ctx.lineWidth   = 2
            const drawLine  = (a, b) => {
              if (a?.score > CONF && b?.score > CONF) {
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
              }
            }
            const dk = dispKps
            drawLine(dk[KP.LS], dk[KP.RS])
            drawLine(dk[KP.LS], dk[KP.LH])
            drawLine(dk[KP.RS], dk[KP.RH])
            drawLine(dk[KP.LH], dk[KP.RH])
            drawLine(dk[KP.LH], dk[KP.LK])
            drawLine(dk[KP.RH], dk[KP.RK])

            ctx.fillStyle = conf >= 70 ? '#1D9E75' : conf >= 50 ? '#EF9F27' : '#E24B4A'
            ;[KP.LS, KP.RS, KP.LH, KP.RH, KP.LK, KP.RK].forEach(idx => {
              const k = dk[idx]
              if (k?.score > CONF) {
                ctx.beginPath(); ctx.arc(k.x, k.y, 4, 0, Math.PI * 2); ctx.fill()
              }
            })

            const sm = mid(dk[KP.LS], dk[KP.RS]), hm = mid(dk[KP.LH], dk[KP.RH])
            ctx.setLineDash([4, 4])
            ctx.strokeStyle = 'rgba(201,169,110,0.25)'
            ctx.lineWidth   = 1
            ctx.beginPath(); ctx.moveTo(0, sm.y); ctx.lineTo(vw, sm.y); ctx.stroke()
            ctx.beginPath(); ctx.moveTo(0, hm.y); ctx.lineTo(vw, hm.y); ctx.stroke()
            ctx.setLineDash([])

            ctx.font      = '11px system-ui'
            ctx.fillStyle = 'rgba(201,169,110,0.7)'
            ctx.fillText('shoulder', 8, sm.y - 5)
            ctx.fillText('hip', 8, hm.y - 5)

            if (conf >= 65) {
              const shape = detectBodyShapeFromPose(rawKps, vw)
              if (shape) {
                shapeVotesRef.current[shape] = (shapeVotesRef.current[shape] || 0) + 1
                const votes      = shapeVotesRef.current
                const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0)
                if (totalVotes >= 20) {
                  const leading      = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]
                  const leadingShare = leading[1] / totalVotes
                  if (leadingShare > 0.55) setDetectedShape(leading[0])
                }
              }
            }

            if (nose?.score > 0.4 && conf >= 65) {
              clearTimeout(skinDebounceRef.current)
              skinDebounceRef.current = setTimeout(() => {
                const sp = _detectSkinProfileFixed(ctx, rawKps, vw, vh)
                if (sp) setDetectedTone(sp)
              }, 2000)
            }
          }
        } else {
          goodFrames.current = Math.max(0, goodFrames.current - 2)
          setConfidence(0); setLiveEst(null)
        }
      } else {
        setPoseFound(false); setPoseIssues(['no_pose']); prevKpsDisplayRef.current = null
        setConfidence(0); setLiveEst(null); liveKpsRef.current = null
      }
    } catch {}

    animRef.current = requestAnimationFrame(detect)
  }, [detectorRef, profile.height, profile.segment, detectedShape])

  // ── SIDE-SCAN DETECT LOOP ────────────────────────────────────────────────
  // Runs instead of detect() while scanMode === 'side'. Unlike the front
  // scan, only one side of the body is reliably visible in profile — so the
  // pose gate requires just one shoulder AND one hip point above threshold,
  // not both left+right like analyzePose() expects for a frontal pose.
  const detectSide = useCallback(async () => {
    const video = videoRef.current, canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) {
      animRef.current = requestAnimationFrame(detectSide); return
    }
    if (!detectorRef.current || !lockedPxPerCmRef.current) {
      animRef.current = requestAnimationFrame(detectSide); return
    }

    const vw = video.videoWidth || 640, vh = video.videoHeight || 480
    canvas.width = vw; canvas.height = vh
    const ctx = canvas.getContext('2d')
    ctx.save(); ctx.translate(vw, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, vw, vh); ctx.restore()

    // Background sample taken once on the first usable frame.
    if (!bgColorRef.current) {
      bgColorRef.current = sampleBackgroundColor(ctx, vw, vh)
    }

    try {
      const poses = await detectorRef.current.estimatePoses(video)
      const kps = poses?.[0]?.keypoints?.map(k => ({ ...k, x: vw - k.x }))

      const ls = kps?.[KP.LS], rs = kps?.[KP.RS]
      const lh = kps?.[KP.LH], rh = kps?.[KP.RH]
      const lk = kps?.[KP.LK], rk = kps?.[KP.RK]
      const la = kps?.[KP.LA], ra = kps?.[KP.RA]
      const shoulderPt = [ls, rs].filter(k => k?.score > CONF)
      const hipPt      = [lh, rh].filter(k => k?.score > CONF)
      // Profile view only reliably shows ONE side — take whichever knee/ankle
      // scored higher rather than requiring both, same idea as shoulder/hip below.
      const kneePt  = [lk, rk].filter(k => k?.score > CONF).sort((a, b) => b.score - a.score)[0]
      const anklePt = [la, ra].filter(k => k?.score > CONF).sort((a, b) => b.score - a.score)[0]

      if (!kps || shoulderPt.length === 0 || hipPt.length === 0) {
        setPoseFound(false); setPoseIssues(['no_pose'])
        animRef.current = requestAnimationFrame(detectSide)
        return
      }

      setPoseFound(true); setPoseIssues([])

      const shoulderPtBest = [...shoulderPt].sort((a, b) => b.score - a.score)[0]
      const hipPtBest      = [...hipPt].sort((a, b) => b.score - a.score)[0]
      const smY = shoulderPt.reduce((s, k) => s + k.y, 0) / shoulderPt.length
      const hmY = hipPt.reduce((s, k) => s + k.y, 0) / hipPt.length
      const smX = shoulderPt.reduce((s, k) => s + k.x, 0) / shoulderPt.length
      const hmX = hipPt.reduce((s, k) => s + k.x, 0) / hipPt.length
      const torsoH = hmY - smY

      if (torsoH > 20 && bgColorRef.current) {
        const bustRowY  = smY + torsoH * 0.15
        const waistRowY = smY + torsoH * 0.70
        const hipRowY   = hmY

        const bustMeas  = measureSilhouetteWidth(ctx, bustRowY,  vw, bgColorRef.current)
        const waistMeas = measureSilhouetteWidth(ctx, waistRowY, vw, bgColorRef.current)
        const hipMeas   = measureSilhouetteWidth(ctx, hipRowY,   vw, bgColorRef.current)

        if (bustMeas)  { bustDepthHistRef.current.push(bustMeas.widthPx);   if (bustDepthHistRef.current.length  > HIST_SIZE) bustDepthHistRef.current.shift() }
        if (waistMeas) { waistDepthHistRef.current.push(waistMeas.widthPx); if (waistDepthHistRef.current.length > HIST_SIZE) waistDepthHistRef.current.shift() }
        if (hipMeas)   { hipDepthHistRef.current.push(hipMeas.widthPx);     if (hipDepthHistRef.current.length   > HIST_SIZE) hipDepthHistRef.current.shift() }

        const sampleCount = bustDepthHistRef.current.length
        setSideSamples(sampleCount)

        // Confidence heuristic — proportion of a 30-sample target, capped at
        // 95, same shape as the front scan's confidence-building UX.
        const TARGET_SIDE_SAMPLES = 30
        const conf = Math.min(95, Math.round((sampleCount / TARGET_SIDE_SAMPLES) * 95))
        setSideConfidence(conf)

        const pxPerCm = lockedPxPerCmRef.current
        const bustDepthCmLive  = bustMeas  ? bustMeas.widthPx  / pxPerCm : null
        const waistDepthCmLive = waistMeas ? waistMeas.widthPx / pxPerCm : null
        const hipDepthCmLive   = hipMeas   ? hipMeas.widthPx   / pxPerCm : null
        setLiveSideDepth({
          bust:  bustDepthCmLive  != null ? Math.round(bustDepthCmLive)  : null,
          waist: waistDepthCmLive != null ? Math.round(waistDepthCmLive) : null,
          hip:   hipDepthCmLive   != null ? Math.round(hipDepthCmLive)   : null,
        })

        // ── SKELETON ── profile view only shows one side reliably, so draw
        // the highest-confidence point per joint rather than left+right pairs.
        const confColorSide = conf >= 70 ? '#1D9E75' : conf >= 40 ? '#EF9F27' : '#E24B4A'
        ctx.strokeStyle = confColorSide
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(smX, smY); ctx.lineTo(hmX, hmY); ctx.stroke()
        if (kneePt)             { ctx.beginPath(); ctx.moveTo(hmX, hmY); ctx.lineTo(kneePt.x, kneePt.y); ctx.stroke() }
        if (anklePt && kneePt)  { ctx.beginPath(); ctx.moveTo(kneePt.x, kneePt.y); ctx.lineTo(anklePt.x, anklePt.y); ctx.stroke() }

        ctx.fillStyle = confColorSide
        ;[shoulderPtBest, hipPtBest, kneePt, anklePt].forEach(k => {
          if (!k) return
          ctx.beginPath(); ctx.arc(k.x, k.y, 4, 0, Math.PI * 2); ctx.fill()
        })

        ctx.setLineDash([4, 4])
        ctx.strokeStyle = 'rgba(201,169,110,0.4)'
        ctx.lineWidth = 1
        ;[bustRowY, waistRowY, hipRowY].forEach(y => {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(vw, y); ctx.stroke()
        })
        ctx.setLineDash([])

        // Save the best-confidence frame, mirroring bestSnapshotRef in the front scan.
        if (conf > (bestSideSnapshotRef.current?.confidence ?? 0) && conf >= 60) {
          const snap = document.createElement('canvas')
          snap.width = vw; snap.height = vh
          snap.getContext('2d').drawImage(canvas, 0, 0)
          bestSideSnapshotRef.current = {
            dataUrl: snap.toDataURL('image/jpeg', 0.82),
            confidence: conf,
            depths: {
              bust:  bustDepthCmLive  != null ? Math.round(bustDepthCmLive)  : null,
              waist: waistDepthCmLive != null ? Math.round(waistDepthCmLive) : null,
              hip:   hipDepthCmLive   != null ? Math.round(hipDepthCmLive)   : null,
            },
          }
        }
      }
    } catch {}

    animRef.current = requestAnimationFrame(detectSide)
  }, [detectorRef])

  useEffect(() => {
    if (camState === 'on') {
      if (scanMode === 'side') detectSide()
      else detect()
    } else if (animRef.current) cancelAnimationFrame(animRef.current)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [camState, scanMode, detect, detectSide])

  useEffect(() => () => stopCamera(), [stopCamera])

  const startSideScan = useCallback(() => {
    bgColorRef.current = null
    bustDepthHistRef.current = []; waistDepthHistRef.current = []; hipDepthHistRef.current = []
    bestSideSnapshotRef.current = null
    setSideSamples(0); setSideConfidence(0); setLiveSideDepth(null); setSideSnapshot(null)
    setScanMode('side')
    setSideStage('capturing')
    startCamera()
  }, [startCamera])

  const skipSideScan = useCallback(() => {
    setSideStage('skipped')
  }, [])

  const lockSideScan = useCallback(() => {
    if (!lockedPxPerCmRef.current || !lockedWidthsRef.current) return
    const pxPerCm = lockedPxPerCmRef.current

    const bustPx  = iqm(bustDepthHistRef.current)
    const waistPx = iqm(waistDepthHistRef.current)
    const hipPx   = iqm(hipDepthHistRef.current)

    const bustDepthCm  = bustPx  > 0 ? bustPx  / pxPerCm : null
    const waistDepthCm = waistPx > 0 ? waistPx / pxPerCm : null
    const hipDepthCm   = hipPx   > 0 ? hipPx   / pxPerCm : null

    const { shoulderCm, waistCm, hipCm } = lockedWidthsRef.current

    const { bust: estBust, waist: estWaist, hips: estHips } = estimateMeasurementsWithDepth({
      shoulderCm, waistCm, hipCm,
      bustDepthCm, waistDepthCm, hipDepthCm,
      bodyShape: detectedShape,
      segment:   profile.segment,
    })

    setAdjBust(String(estBust))
    setAdjWaist(String(estWaist))
    setAdjHips(String(estHips))
    setSideDepths({
      bust:  bustDepthCm  != null ? Math.round(bustDepthCm)  : null,
      waist: waistDepthCm != null ? Math.round(waistDepthCm) : null,
      hip:   hipDepthCm   != null ? Math.round(hipDepthCm)   : null,
    })
    if (bestSideSnapshotRef.current) setSideSnapshot(bestSideSnapshotRef.current)
    setSideStage('done')
    stopCamera()
    setScanMode('front')
  }, [detectedShape, profile.segment, stopCamera])

  const lockMeasurement = useCallback(() => {
    if (!swHistRef.current.length) return
    const kps  = liveKpsRef.current
    const nose = kps?.[KP.NOSE]
    const la   = kps?.[KP.LA]
    const ra   = kps?.[KP.RA]

    const hasFullHeight = profile.height && kps &&
      nose?.score > CONF && la?.score > CONF && ra?.score > CONF

    const pxPerCm = (() => {
      if (hasFullHeight) {
        const ankleMid     = mid(la, ra)
        const fullHeightPx = ankleMid.y - nose.y
        return fullHeightPx / profile.height
      }
      if (pxPerCmHistRef.current.length > 0) return iqm(pxPerCmHistRef.current)
      const torsoH      = torsoHRef.current ?? 0
      const torsoAnchor = getTorsoAnchor(profile.segment, profile.height)
      return torsoH > 0 ? torsoH / torsoAnchor : 1
    })()

    const estSwPx  = iqm(swHistRef.current)
    const estHipPx = iqm(hipHistRef.current) || estSwPx * 1.05

    const lockSwCm    = estSwPx  / pxPerCm
    const lockHipCm   = estHipPx / pxPerCm
    const lockWaistCm = lockSwCm * 0.80

    const { bust: estBust, waist: estWaist, hips: estHips } = estimateMeasurements({
      shoulderCm: lockSwCm,
      waistCm:    lockWaistCm,
      hipCm:      lockHipCm,
      bodyShape:  detectedShape,
      segment:    profile.segment,
    })

    // Persist the scale anchor and widths from THIS scan so an optional
    // side scan (same session, same distance from camera) can convert its
    // measured depth in pixels to cm using the identical pxPerCm — a side
    // scan run against a different anchor would silently produce garbage.
    lockedPxPerCmRef.current = pxPerCm
    lockedWidthsRef.current  = { shoulderCm: lockSwCm, waistCm: lockWaistCm, hipCm: lockHipCm }

    // adj values stored as cm strings — display boundary converts to active unit
    setAdjBust(String(estBust))
    setAdjWaist(String(estWaist))
    setAdjHips(String(estHips))
    setScanConf(confidence)
    setLocked(true)
    stopCamera()

    if (bestSnapshotRef.current) setSnapshot(bestSnapshotRef.current)

    const patch = {}
    if (detectedTone)  { patch.skinTone = detectedTone.skinTone; patch.undertone = detectedTone.undertone }
    if (detectedShape) { patch.bodyShape = detectedShape }
    if (Object.keys(patch).length) updateProfile(patch)
  }, [stopCamera, detectedTone, detectedShape, updateProfile, profile, confidence])

  const confirmMeasurements = useCallback(() => {
    // adjBust/Waist/Hips are cm strings — parse directly, no unit conversion needed
    updateProfile({
      bust:   parseFloat(adjBust)  || null,
      waist:  parseFloat(adjWaist) || null,
      hips:   parseFloat(adjHips)  || null,
      source: 'camera',
      ...(detectedTone  ? { skinTone: detectedTone.skinTone, undertone: detectedTone.undertone } : {}),
      ...(detectedShape ? { bodyShape: detectedShape } : {}),
    })
  }, [adjBust, adjWaist, adjHips, detectedTone, detectedShape, updateProfile])

  const confirmManual = useCallback(() => {
    const rawFields = { bust: mBust, waist: mWaist, hips: mHips, height: mHeight, weight: mWeight }
    const errors = {}
    for (const [k, v] of Object.entries(rawFields)) {
      // weight is always kg regardless of unit toggle
      const effectiveUnit = k === 'weight' ? 'cm' : unit
      const err = validateField(k, v, effectiveUnit)
      if (err) errors[k] = err
    }
    if (!mBust && !mWaist && !mHips) {
      setMErrors({ _form: 'Enter at least one of bust, waist, or hips.' }); return
    }
    if (Object.keys(errors).length) { setMErrors(errors); return }
    setMErrors({})

    // Input boundary — convert from active unit to cm before storing
    const toCm = (val) => {
      const n = parseFloat(val)
      if (!Number.isFinite(n)) return null
      return unit === 'in' ? inToCm(n) : n
    }

    updateProfile({
      bust:   toCm(mBust)   || null,
      waist:  toCm(mWaist)  || null,
      hips:   toCm(mHips)   || null,
      height: toCm(mHeight) || null,
      weight: parseFloat(mWeight) || null,   // weight always kg, no conversion
      source: 'manual',
    })
  }, [mBust, mWaist, mHips, mHeight, mWeight, unit, updateProfile])

  const confColor = confidence >= 70 ? '#1D9E75' : confidence >= 50 ? '#EF9F27' : '#E24B4A'
  const issue     = poseFound ? null : (poseIssues[0] ? GUIDANCE_MAP[poseIssues[0]] : null)
  const canScan   = modelState === 'ready'
  const canLock   = true
  const toneHex   = detectedTone ? SKIN_TONES.find(t => t.id === detectedTone.skinTone)?.hex : null
  const segLabel  = SEGMENTS.find(s => s.id === (profile.segment ?? 'women'))?.label || 'Women'
  const hasHeight = !!profile.height

  const variantKey   = hasHeight ? 'withHeight' : 'withoutHeight'
  const measVariance = {
    bust:  MEAS_VARIANCE.bust[variantKey],
    waist: MEAS_VARIANCE.waist[variantKey],
    hip:   MEAS_VARIANCE.hip[variantKey],
  }

  // Unit toggle button used in multiple places
  const UnitToggleBtn = (
    <button
      onClick={toggleUnit}
      style={{
        fontSize: '11px', padding: '2px 8px', borderRadius: '10px', cursor: 'pointer',
        border: '0.5px solid #e0ddd8', background: '#f5f3ef', color: '#888',
      }}
      aria-label={`Switch to ${unit === 'cm' ? 'inches' : 'centimetres'}`}
    >
      {unit === 'cm' ? 'cm' : 'in'}
    </button>
  )

  // Locked scan field helpers — adj values are cm strings; display boundary converts
  const adjDisplayVal = (cmStr) => {
    const cm = parseFloat(cmStr)
    if (!Number.isFinite(cm)) return ''
    return unit === 'in' ? String(cmToIn(cm) ?? '') : cmStr
  }
  const adjOnChange = (setter) => (e) => {
    const raw = parseFloat(e.target.value)
    if (!Number.isFinite(raw)) { setter(''); return }
    const cm = unit === 'in' ? String(inToCm(raw) ?? '') : String(raw)
    setter(cm)
  }

  // Manual entry placeholders per unit
  const PH = unit === 'in'
    ? { bust: 'e.g. 34.5', waist: 'e.g. 27.5', hips: 'e.g. 37.5', height: 'e.g. 64', weight: 'e.g. 58' }
    : { bust: 'e.g. 88',   waist: 'e.g. 70',   hips: 'e.g. 95',   height: 'e.g. 162', weight: 'e.g. 58' }

  return (
    <SegmentGate>
      <div className="fr-panel-content">
        <div className="fr-tab-row">
          <button className={`fr-tab${activeTab === 'camera' ? ' active' : ''}`} onClick={() => setActiveTab('camera')}>Camera scan</button>
          <button className={`fr-tab${activeTab === 'manual' ? ' active' : ''}`} onClick={() => setActiveTab('manual')}>Manual entry</button>
        </div>

        {activeTab === 'camera' && (
          <div className="scan-layout">
            <div ref={scanWrapRef} className={`scan-cam-wrap${fullscreen ? ' scan-cam-wrap--fs' : ''}`}>
              <div className="fr-cam-area">
                <video
                  ref={videoRef}
                  playsInline muted
                  style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',transform:'scaleX(-1)',opacity:0 }}
                />
                <canvas
                  ref={canvasRef}
                  style={{ position:'absolute',inset:0,width:'100%',height:'100%',opacity:camState==='on'?1:0,transition:'opacity .3s' }}
                />

                {camState !== 'on' && !locked && (
                  <div className="fr-cam-ph">
                    <div className="cam-ph-icon">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                        <circle cx="12" cy="13" r="4"/>
                      </svg>
                    </div>
                    <span className="cam-ph-text">
                      {modelState === 'loading' ? 'Loading AI model…'
                       : modelState === 'error'  ? 'Model failed to load'
                       : 'Camera off'}
                    </span>
                    {modelState === 'loading' && <div className="cam-ph-bar"><div className="cam-ph-bar-fill"/></div>}
                  </div>
                )}

                {camState === 'on' && (
                  <button className="cam-fs-btn" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
                    {fullscreen ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                      </svg>
                    )}
                  </button>
                )}

                {camState === 'on' && !locked && (
                  <div className="cam-conf-ring-wrap">
                    <svg width="48" height="48" viewBox="0 0 48 48">
                      <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3"/>
                      <circle
                        cx="24" cy="24" r="20" fill="none"
                        stroke={confColor} strokeWidth="3"
                        strokeDasharray={`${(confidence / 100) * 125.6} 125.6`}
                        strokeLinecap="round"
                        transform="rotate(-90 24 24)"
                        style={{ transition: 'stroke-dasharray .4s, stroke .4s' }}
                      />
                      <text x="24" y="28" textAnchor="middle" fill="white" fontSize="11" fontWeight="600">{confidence}%</text>
                    </svg>
                  </div>
                )}

                {camState === 'on' && scanMode === 'side' && (
                  <div className="fr-cam-hud">
                    <span className="fr-hud-dot" style={{ background: sideSamples >= 20 ? '#1D9E75' : '#EF9F27' }}/>
                    <span className="fr-hud-text">
                      {poseFound
                        ? `Turn to your side, keep the same distance — ${sideSamples}/20 samples`
                        : 'Turn 90° so your side profile is visible'}
                    </span>
                  </div>
                )}

                {camState === 'on' && scanMode === 'front' && (
                  <div className="fr-cam-hud">
                    <span className="fr-hud-dot" style={{ background: confColor }}/>
                    <span className="fr-hud-text">
                      {issue ? issue
                        : poseIssues.some(i => HIGH_SEVERITY_ISSUES.has(i))
                          ? GUIDANCE_MAP[poseIssues.find(i => HIGH_SEVERITY_ISSUES.has(i))]
                          : confidence > 0
                            ? (confidence < 65 ? 'Hold still — building confidence…' : 'Good — ready to lock')
                            : 'Detecting pose…'}
                    </span>
                  </div>
                )}

                {camState === 'on' && poseFound && (detectedShape || detectedTone) && (
                  <div className="fr-cam-badges">
                    {detectedShape && <span className="fr-cam-badge">{detectedShape}</span>}
                    {detectedTone  && (
                      <span className="fr-cam-badge">
                        <span style={{ display:'inline-block',width:'8px',height:'8px',borderRadius:'50%',background:toneHex,verticalAlign:'middle',marginRight:'3px' }}/>
                        {detectedTone.skinTone}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {!locked ? (
                <div className="scan-controls">
                  {camError && <div className="fr-alert fr-alert--err">{camError}</div>}
                  {modelState === 'error' && <div className="fr-alert fr-alert--err">AI model failed to load. Try refreshing.</div>}

                  {camState !== 'on' ? (
                    <>
                      <div className="scan-height-prompt">
                        <label className="scan-height-label">
                          <span>Your height</span>
                          <span className="scan-height-badge">+30% accuracy</span>
                        </label>
                        <div className="scan-height-row">
                          <input
                            type="number"
                            className="scan-height-input"
                            value={heightInput}
                            placeholder={unit === 'in' ? 'e.g. 64' : 'e.g. 162'}
                            onChange={e => setHeightInput(e.target.value)}
                          />
                          {/* Unit toggle inline with height unit label */}
                          {UnitToggleBtn}
                        </div>
                        <p className="scan-height-hint">Enter before scanning for significantly better accuracy. You can skip this.</p>
                      </div>
                      <button
                        className="fr-btn fr-btn--primary scan-btn-full"
                        onClick={startCamera}
                        disabled={camState === 'starting' || !canScan}
                      >
                        {camState === 'starting'
                          ? <><span className="fr-spin"/>Starting…</>
                          : modelState === 'loading'
                            ? <><span className="fr-spin"/>Loading model…</>
                            : 'Start scan'}
                      </button>
                    </>
                  ) : (
                    <div className="scan-btn-pair">
                      <button
                        className="fr-btn fr-btn--primary"
                        onClick={lockMeasurement}
                        title={!canLock ? `Build more confidence (${confidence}% / 65% needed)` : ''}
                      >
                        {canLock ? `Lock measurements (${confidence}%)` : `Need ${65 - confidence}% more…`}
                      </button>
                      <button className="fr-btn fr-btn--ghost" onClick={stopCamera}>Stop</button>
                    </div>
                  )}
                </div>
              ) : scanMode === 'side' ? (
                <div className="scan-controls side-scan-controls">
                  {camError && <div className="fr-alert fr-alert--err">{camError}</div>}

                  {camState !== 'on' ? (
                    <button className="fr-btn fr-btn--primary scan-btn-full" onClick={startSideScan}>
                      {camState === 'starting' ? <><span className="fr-spin"/>Starting…</> : '📐 Start side scan'}
                    </button>
                  ) : (
                    <>
                      {liveSideDepth && (
                        <div className="scan-live-est" style={{ marginBottom: '10px' }}>
                          <p className="scan-live-heading">Live depth estimate</p>
                          <div className="scan-live-grid">
                            <div className="scan-live-item"><span className="scan-live-label">Bust</span><span className="scan-live-val">{liveSideDepth.bust ?? '—'} cm</span></div>
                            <div className="scan-live-item"><span className="scan-live-label">Waist</span><span className="scan-live-val">{liveSideDepth.waist ?? '—'} cm</span></div>
                            <div className="scan-live-item"><span className="scan-live-label">Hip</span><span className="scan-live-val">{liveSideDepth.hip ?? '—'} cm</span></div>
                          </div>
                          <div className="scan-conf-bar-wrap">
                            <div className="scan-conf-track">
                              <div className="scan-conf-fill" style={{ width: `${sideConfidence}%`, background: sideConfidence >= 70 ? '#1D9E75' : sideConfidence >= 40 ? '#EF9F27' : '#E24B4A' }}/>
                            </div>
                            <span className="scan-conf-label">{sideConfidence}%</span>
                          </div>
                        </div>
                      )}

                      {sideSnapshot && (
                        <button className="fr-btn fr-btn--ghost scan-snapshot-btn" onClick={() => setShowSideSnapshot(true)}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                          </svg>
                          Best side snapshot ({sideSnapshot.confidence}% confidence)
                        </button>
                      )}

                      <div className="scan-btn-pair">
                        <button
                          className="fr-btn fr-btn--primary"
                          onClick={lockSideScan}
                          disabled={sideSamples < 8}
                          title={sideSamples < 8 ? `Hold your side pose — ${sideSamples}/8 samples needed` : ''}
                        >
                          {sideSamples < 8 ? `Hold still… ${sideSamples}/8` : `Lock side scan (${sideConfidence}%)`}
                        </button>
                        <button className="fr-btn fr-btn--ghost" onClick={() => { stopCamera(); setScanMode('front'); setSideStage('skipped') }}>
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="scan-locked">
                  <div className="scan-locked-header">
                    <span className={`fr-badge ${scanConf >= 75 ? 'fr-badge--ok' : 'fr-badge--warn'}`}>
                      {scanConf >= 75 ? 'Captured' : `Captured · low confidence (${scanConf}%)`}
                    </span>
                    <div className="scan-locked-detections">
                      {detectedTone && (
                        <span className="scan-detection-tag">
                          <span style={{ display:'inline-block',width:'10px',height:'10px',borderRadius:'50%',background:toneHex,flexShrink:0 }}/>
                          {detectedTone.skinTone} · {detectedTone.undertone}
                        </span>
                      )}
                      {detectedShape && <span className="scan-detection-tag">{detectedShape}</span>}
                    </div>
                  </div>

                  {sideStage === 'idle' && (
                    <div className="fr-alert" style={{ background:'#f5f3ef', border:'1px solid #e0ddd8', color:'#555' }}>
                      <strong>Improve accuracy:</strong> add a side scan to measure your actual body depth
                      instead of estimating it. Takes 10 seconds.
                      <div className="fr-btn-row" style={{ marginTop:'8px' }}>
                        <button className="fr-btn fr-btn--primary" onClick={startSideScan}>📐 Add side scan</button>
                        <button className="fr-btn fr-btn--ghost" onClick={skipSideScan}>Skip</button>
                      </div>
                    </div>
                  )}

                  {sideStage === 'done' && sideDepths && (
                    <div className="fr-alert" style={{ background:'#eef9f4', border:'1px solid #bfe6d4', color:'#0F6E56', marginBottom:'10px' }}>
                      ✓ Side scan applied — measurements below now use your actual body depth
                      (bust {sideDepths.bust ?? '—'} cm · waist {sideDepths.waist ?? '—'} cm · hip {sideDepths.hip ?? '—'} cm deep).
                      <div style={{ marginTop:'6px' }}>
                        <button className="fr-btn fr-btn--ghost" onClick={startSideScan}>Redo side scan</button>
                      </div>
                    </div>
                  )}

                  {sideStage === 'skipped' && (
                    <div className="fr-alert" style={{ background:'#f5f3ef', border:'1px solid #e0ddd8', color:'#888' }}>
                      Side scan skipped — measurements use an estimated body depth.
                      <button className="fr-btn fr-btn--ghost" style={{ marginLeft:'8px' }} onClick={startSideScan}>Add it now</button>
                    </div>
                  )}

                  {snapshot && (
                    <button className="fr-btn fr-btn--ghost scan-snapshot-btn" onClick={() => setShowSnapshot(true)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                      Best snapshot ({snapshot.confidence}% confidence)
                    </button>
                  )}

                  {/* Locked scan result fields — display boundary: adj values are cm,
                      shown in active unit. Input boundary: convert back to cm on change. */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
                    {UnitToggleBtn}
                  </div>
                  <div className="fr-field-row">
                    {[
                      ['Bust',  adjBust,  setAdjBust,  measVariance.bust ],
                      ['Waist', adjWaist, setAdjWaist, measVariance.waist],
                      ['Hips',  adjHips,  setAdjHips,  measVariance.hip  ],
                    ].map(([l, v, s, variance]) => (
                      <div key={l} className="fr-field">
                        <label>
                          {l} ({unit})
                          {/* Variance always shown in cm regardless of toggle */}
                          <span className="fr-field-variance">±{variance} cm</span>
                        </label>
                        <input
                          type="number"
                          value={adjDisplayVal(v)}
                          onChange={adjOnChange(s)}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="scan-variance-row">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{flexShrink:0,marginTop:'1px'}}>
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <span>
                      {hasHeight
                        ? 'Height-anchored scan. Waist has highest variance — confirm with tape for bridal orders.'
                        : 'No height entered — estimates carry higher variance. Enter height in the sidebar to improve future scans.'}
                    </span>
                  </div>

                  <div className="fr-btn-row">
                    <button className="fr-btn fr-btn--ghost" onClick={() => {
                      setLocked(false); setConfidence(0); shapeVotesRef.current = {}
                      setSnapshot(null); bestSnapshotRef.current = null
                      swHistRef.current = []; hipHistRef.current = []; pxPerCmHistRef.current = []
                      goodFrames.current = 0
                      // Reset side-scan state — a retaken front scan invalidates
                      // the pxPerCm anchor any previous side scan was measured against
                      setSideStage('idle'); setSideDepths(null); setSideSamples(0)
                      setSideConfidence(0); setLiveSideDepth(null); setSideSnapshot(null)
                      lockedPxPerCmRef.current = null; lockedWidthsRef.current = null
                      bgColorRef.current = null; bestSideSnapshotRef.current = null
                      bustDepthHistRef.current = []; waistDepthHistRef.current = []; hipDepthHistRef.current = []
                    }}>Retake</button>
                    <button className="fr-btn fr-btn--primary" onClick={confirmMeasurements}>Apply</button>
                  </div>
                </div>
              )}
            </div>

            <div className="scan-info-col">
              <div className="scan-tip-card">
                <p className="scan-tip-heading">Scanning for {segLabel}</p>
                <p className="scan-tip-body">Stand 1.5–2 m away, arms slightly out, full body visible.</p>
                {!hasHeight && camState === 'off' && (
                  <p className="scan-tip-height-hint">↑ Enter height above before scanning for best results.</p>
                )}
              </div>

              {liveEst && camState === 'on' && !locked && (
                <div className="scan-live-est">
                  <p className="scan-live-heading">Live estimate</p>
                  {/* Display boundary — convert stored cm to active unit */}
                  <div className="scan-live-grid">
                    <div className="scan-live-item"><span className="scan-live-label">Bust</span><span className="scan-live-val">{dispVal(liveEst.bust,  unit)}</span></div>
                    <div className="scan-live-item"><span className="scan-live-label">Waist</span><span className="scan-live-val">{dispVal(liveEst.waist, unit)}</span></div>
                    <div className="scan-live-item"><span className="scan-live-label">Hips</span><span className="scan-live-val">{dispVal(liveEst.hips,  unit)}</span></div>
                  </div>
                  <div className="scan-conf-bar-wrap">
                    <div className="scan-conf-track">
                      <div className="scan-conf-fill" style={{ width: `${confidence}%`, background: confColor }}/>
                    </div>
                    <span className="scan-conf-label" style={{ color: confColor }}>{confidence}%</span>
                  </div>
                  <p className="scan-conf-hint">Lock available at any time. best frame is saved automatically.</p>
                </div>
              )}

              <div className="scan-detects-list">
                <p className="scan-detects-heading">This scan detects</p>
                {[
                  'Measurements (bust · waist · hips)',
                  'Body shape — for style recommendations',
                  'Skin tone & undertone',
                ].map(item => (
                  <div key={item} className="scan-detect-row">
                    <span className="scan-detect-dot"/>
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              {camState === 'on' && (
                <div className="scan-buffer-status">
                  <p className="scan-detects-heading">Clean frames</p>
                  <div className="scan-buffer-bar-wrap">
                    <div className="scan-buffer-track">
                      <div
                        className="scan-buffer-fill"
                        style={{
                          width: `${Math.min((swHistRef.current.length / 60) * 100, 100)}%`,
                          background: swHistRef.current.length >= 60 ? '#1D9E75' : '#EF9F27',
                        }}
                      />
                    </div>
                    <span className="scan-conf-label">{swHistRef.current.length}/60</span>
                  </div>
                  {swHistRef.current.length < 60 && (
                    <p className="scan-conf-hint">Tilted/rotated/dark frames are excluded</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'manual' && (
          <div className="fr-scan-body">
            <div className="scan-tip-card" style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <p className="scan-tip-heading" style={{ margin: 0 }}>Manual entry for {segLabel}</p>
                {UnitToggleBtn}
              </div>
              <p className="scan-tip-body">
                Enter your measurements in {unit === 'in' ? 'inches' : 'centimetres'}. At least one of bust, waist, or hips is required.
              </p>
            </div>
            {mErrors._form && <div className="fr-alert fr-alert--err">{mErrors._form}</div>}
            <div className="fr-field-row">
              <div className="fr-field">
                <label>Bust ({unit})</label>
                <input type="number" value={mBust}
                  onChange={e => { setMBust(e.target.value); setMErrors(p => ({ ...p, bust: undefined, _form: undefined })) }}
                  placeholder={PH.bust}/>
                {mErrors.bust && <span className="fr-field-err">{mErrors.bust}</span>}
              </div>
              <div className="fr-field">
                <label>Waist ({unit})</label>
                <input type="number" value={mWaist}
                  onChange={e => { setMWaist(e.target.value); setMErrors(p => ({ ...p, waist: undefined, _form: undefined })) }}
                  placeholder={PH.waist}/>
                {mErrors.waist && <span className="fr-field-err">{mErrors.waist}</span>}
              </div>
            </div>
            <div className="fr-field-row">
              <div className="fr-field">
                <label>Hips ({unit})</label>
                <input type="number" value={mHips}
                  onChange={e => { setMHips(e.target.value); setMErrors(p => ({ ...p, hips: undefined, _form: undefined })) }}
                  placeholder={PH.hips}/>
                {mErrors.hips && <span className="fr-field-err">{mErrors.hips}</span>}
              </div>
              <div className="fr-field">
                <label>Height ({unit})</label>
                <input type="number" value={mHeight}
                  onChange={e => { setMHeight(e.target.value); setMErrors(p => ({ ...p, height: undefined })) }}
                  placeholder={PH.height}/>
                {mErrors.height && <span className="fr-field-err">{mErrors.height}</span>}
              </div>
            </div>
            <div className="fr-field-row fr-field-row--half">
              <div className="fr-field">
                <label>Weight (kg)</label>
                <input type="number" value={mWeight}
                  onChange={e => { setMWeight(e.target.value); setMErrors(p => ({ ...p, weight: undefined })) }}
                  placeholder={PH.weight}/>
                {mErrors.weight && <span className="fr-field-err">{mErrors.weight}</span>}
              </div>
            </div>
            <button className="fr-btn fr-btn--primary" onClick={confirmManual}>Apply measurements</button>
          </div>
        )}
      </div>

      {showSnapshot && snapshot && (
        <div className="scan-snap-overlay" onClick={() => setShowSnapshot(false)}>
          <div className="scan-snap-modal" onClick={e => e.stopPropagation()}>
            <div className="scan-snap-header">
              <span className="scan-snap-title">Best scan — {snapshot.confidence}% confidence</span>
              <button className="scan-snap-close" onClick={() => setShowSnapshot(false)}>✕</button>
            </div>
            <img src={snapshot.dataUrl} className="scan-snap-img" alt="Best scan capture"/>
            <div className="scan-snap-est">
              {/* Snapshot estimates always shown in cm — they are archival records */}
              {[['Bust', snapshot.est.bust], ['Waist', snapshot.est.waist], ['Hips', snapshot.est.hips]].map(([l, v]) => (
                <div key={l} className="scan-snap-stat">
                  <span>{l}</span>
                  <strong>{v} cm</strong>
                </div>
              ))}
            </div>
            <div className="scan-snap-actions">
              <a href={snapshot.dataUrl} download="scan-snapshot.jpg" className="fr-btn fr-btn--primary">
                ↓ Download snapshot
              </a>
            </div>
          </div>
        </div>
      )}

      {showSideSnapshot && sideSnapshot && (
        <div className="scan-snap-overlay" onClick={() => setShowSideSnapshot(false)}>
          <div className="scan-snap-modal" onClick={e => e.stopPropagation()}>
            <div className="scan-snap-header">
              <span className="scan-snap-title">Best side scan — {sideSnapshot.confidence}% confidence</span>
              <button className="scan-snap-close" onClick={() => setShowSideSnapshot(false)}>✕</button>
            </div>
            <img src={sideSnapshot.dataUrl} className="scan-snap-img" alt="Best side scan capture"/>
            <div className="scan-snap-est">
              {[['Bust depth', sideSnapshot.depths.bust], ['Waist depth', sideSnapshot.depths.waist], ['Hip depth', sideSnapshot.depths.hip]].map(([l, v]) => (
                <div key={l} className="scan-snap-stat">
                  <span>{l}</span>
                  <strong>{v ?? '—'} cm</strong>
                </div>
              ))}
            </div>
            <div className="scan-snap-actions">
              <a href={sideSnapshot.dataUrl} download="side-scan-snapshot.jpg" className="fr-btn fr-btn--primary">
                ↓ Download snapshot
              </a>
            </div>
          </div>
        </div>
      )}
    </SegmentGate>
  )
}