'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser } from '../utils/authClient'

// ── CDN scripts ───────────────────────────────────────────────────────────────
const POSE_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.10.0/dist/tf-core.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.10.0/dist/tf-converter.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@4.10.0/dist/tf-backend-webgl.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js',
]
const SEG_SCRIPT = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/body-segmentation@1.0.1/dist/body-segmentation.min.js'

const KP   = { NOSE:0, LS:5, RS:6, LH:11, RH:12, LK:13, RK:14, LA:15, RA:16 }
const CONF = 0.25

// ── Script loader ─────────────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = Object.assign(document.createElement('script'), { src, async: false })
    s.onload  = resolve
    s.onerror = () => reject(new Error('Failed to load: ' + src))
    document.head.appendChild(s)
  })
}

// ── Geometry ──────────────────────────────────────────────────────────────────
function mid(a, b)      { return { x:(a.x+b.x)/2, y:(a.y+b.y)/2 } }
function dist(a, b)     { return Math.hypot(a.x-b.x, a.y-b.y) }
function lerpN(a, b, t) { return a + (b-a)*t }
function lerpPt(a, b, t){ return { x:lerpN(a.x,b.x,t), y:lerpN(a.y,b.y,t), score:b.score } }

// FIX #3: increased lerp factor from 0.18 → 0.35 for more responsive tracking
// while still smoothing out single-frame jitter.
function smoothKps(prev, curr, t = 0.35) {
  if (!prev) return curr
  return curr.map((k, i) => lerpPt(prev[i], k, t))
}

// ── Pose analysis → issues list ───────────────────────────────────────────────
// Returns facingBack: true ONLY when the user has genuinely turned around —
// NOT when they are too close or partially out of frame.
//
// Three-condition back-facing gate (all must be true):
//   1. Face clearly invisible (nose score < 0.30)
//   2. Body stable — shoulders AND hips detected confidently
//   3. NOT a framing issue — shoulders not at frame edges, hips not too low
//      (those conditions mean "too close", not "turned around")
function analyzePose(kps, vw, vh) {
  if (!kps) return { ok:false, issues:['no_pose'], facingBack:false }
  const ls=kps[KP.LS], rs=kps[KP.RS], lh=kps[KP.LH], rh=kps[KP.RH]
  const lk=kps[KP.LK], rk=kps[KP.RK], la=kps[KP.LA], ra=kps[KP.RA]
  const nose=kps[KP.NOSE]
  const issues = []
  const shouldersOk = ls?.score>CONF && rs?.score>CONF
  const hipsOk      = lh?.score>CONF && rh?.score>CONF
  const kneesOk     = lk?.score>CONF && rk?.score>CONF
  const anklesOk    = la?.score>CONF && ra?.score>CONF

  // ── Frame quality gate ────────────────────────────────────────────────────
  // If shoulders are near the frame edge OR hips are very low in the frame,
  // the person is too close to the camera — treat as framing error, not back-facing.
  const margin       = vw * 0.08
  const tooCloseFrame = shouldersOk && (
    ls.x < margin ||
    rs.x > vw - margin ||
    (hipsOk && mid(lh, rh).y > vh * 0.72)
  )

  // ── True back-facing ──────────────────────────────────────────────────────
  const faceVisible    = nose && nose.score > 0.30
  const bodyStable     = shouldersOk && hipsOk
  const shoulderSpan   = shouldersOk ? dist(ls, rs) : 0
  // Shoulder span must be at least 10% of frame width — rules out sideways/far-away
  const bodyWideEnough = shoulderSpan > vw * 0.10
  // Only flag as back-facing if face is gone, body is solid, and framing is fine
  const facingBack = !faceVisible && bodyStable && bodyWideEnough && !tooCloseFrame

  // ── Guidance issues ───────────────────────────────────────────────────────
  if (!shouldersOk) { issues.push('no_shoulders'); return { ok:false, issues, shouldersOk, hipsOk, facingBack } }
  if (!hipsOk)      { issues.push('no_hips');      return { ok:false, issues, shouldersOk, hipsOk, facingBack } }
  if (!kneesOk)       issues.push('no_legs')
  if (tooCloseFrame)  issues.push('too_close')
  if (nose?.score > 0.15 && nose.y < vh * 0.06) issues.push('head_cut')
  if (!kneesOk && hipsOk && mid(lh,rh).y > vh * 0.55 && !tooCloseFrame) issues.unshift('too_close')
  if (kneesOk && !anklesOk && mid(lk,rk).y < vh*0.82) issues.push('too_close')
  const ok = shouldersOk && hipsOk && issues.length === 0
  return { ok, issues, shouldersOk, hipsOk, kneesOk, anklesOk, facingBack }
}

const GUIDANCE = {
  no_pose:      { icon:'🚶', text:'Stand in front of the camera so your full body is visible.' },
  no_shoulders: { icon:'⬆️', text:'Step back until your shoulders appear in frame.' },
  no_hips:      { icon:'⬇️', text:'Step back — your waist needs to be in view.' },
  no_legs:      { icon:'↕️', text:'Step back further so your legs are visible.' },
  too_close:    { icon:'↔️', text:"You're too close. Move back 1–2 metres from the camera." },
  head_cut:     { icon:'⬇️', text:'Move down slightly — your head is being cut off.' },
  dark:         { icon:'💡', text:'Too dark. Face a window or turn on a light in front of you.' },
  bright:       { icon:'🌤', text:"Too bright. Don't stand with a window directly behind you." },
}

function GuidanceOverlay({ issues, lightHint }) {
  const all = [...(issues||[])]
  if (lightHint === 'dark')   all.unshift('dark')
  if (lightHint === 'bright') all.unshift('bright')
  if (!all.length) return null
  const g = GUIDANCE[all[0]]; if (!g) return null
  return (
    <div className="to-guidance">
      <span className="to-guidance-icon">{g.icon}</span>
      <span className="to-guidance-text">{g.text}</span>
    </div>
  )
}

// ── Gown layout ───────────────────────────────────────────────────────────────
// vw/vh are passed in so we can compute minimum size floors relative to frame.
function getGownLayout(kps, cal = {}, vw = 640, vh = 480) {
  const ls=kps[KP.LS], rs=kps[KP.RS], lh=kps[KP.LH], rh=kps[KP.RH]
  const lk=kps[KP.LK], rk=kps[KP.RK], la=kps[KP.LA], ra=kps[KP.RA]
  if ([ls,rs,lh,rh].some(k=>!k||k.score<CONF)) return null

  const sm     = mid(ls, rs)
  const hm     = mid(lh, rh)
  const torsoH = hm.y - sm.y

  // ── Shoulder width — clamp to a sensible fraction of frame width.
  // If the camera is close or detection is shaky, raw sw can be tiny.
  // Floor at 28% of frame width so the dress is never a sliver.
  // Also cap at 80% of frame width to avoid overflow on very wide detections.
  const rawSw  = dist(ls, rs)
  const sw     = Math.min(Math.max(rawSw, vw * 0.28), vw * 0.80)

  // Hip width — floor at 90% of shoulder width for realistic skirt shape
  const rawHw  = dist(lh, rh)
  const hw     = Math.max(rawHw, sw * 0.90)

  // ── Top Y: start at the base of the neck / top of shoulder.
  // necklineY is how far ABOVE sm.y the dress starts, as a fraction of torsoH.
  // Default 0.18 = just above the shoulder line (not mid-chest).
  const neckOff = cal.necklineY ?? 0.18
  const topY    = sm.y - torsoH * neckOff

  // ── Bottom Y: prefer ankle → knee → frame-height fallback.
  let bottomY
  if (la?.score>CONF && ra?.score>CONF) {
    // Ankles visible — extend just past them
    bottomY = Math.max(la.y, ra.y) + torsoH * 0.15
  } else if (lk?.score>CONF && rk?.score>CONF) {
    // Knees visible — project downward to estimated ankle position
    const km   = mid(lk, rk)
    const legH = km.y - hm.y          // hip-to-knee distance
    bottomY    = km.y + legH * 1.1    // extend roughly one more leg-segment
  } else {
    // Nothing below hips — use torso multiplier, scaled up for full-length gowns
    bottomY = sm.y + torsoH * 4.8
  }

  // hemY override: fraction of the total dress height (0 = top, 1 = full length)
  if (cal.hemY != null) {
    const fullH = sm.y + torsoH * 4.8 - topY
    bottomY     = topY + fullH * cal.hemY
  }

  // ── Widths
  const shoulderPad = cal.shoulderPad ?? 1.45   // wider bodice to cover torso
  const skirtFlare  = cal.skirtFlare  ?? 1.20   // more flare for full gown look

  const topW = sw * shoulderPad
  const botW = Math.max(hw * 1.55, topW) * skirtFlare

  // ── Horizontal center: bias toward body vertical axis.
  // Shoulder midpoint alone can drift if one shoulder is occluded.
  // Average shoulder mid with hip mid for a more stable cx.
  const cx = (sm.x + hm.x) / 2

  return { topY, bottomY, cx, topW, botW }
}

// ── Draw gown — trapezoid clip centred on body ────────────────────────────────
function drawGown(ctx, img, layout, opacity) {
  const { topY, bottomY, cx, topW, botW } = layout
  const h = bottomY - topY
  if (h <= 0) return
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.beginPath()
  ctx.moveTo(cx - topW/2, topY)
  ctx.lineTo(cx + topW/2, topY)
  ctx.lineTo(cx + botW/2, bottomY)
  ctx.lineTo(cx - botW/2, bottomY)
  ctx.closePath()
  ctx.clip()
  // Draw the gown image centred on cx, filling the full bounding box
  ctx.drawImage(img, cx - botW/2, topY, botW, h)
  ctx.restore()
}

// ── Brightness sample ─────────────────────────────────────────────────────────
function sampleBrightness(ctx, w, h) {
  try {
    const data=ctx.getImageData(0,0,w,h).data; let sum=0,n=0
    const step=Math.max(1,Math.floor(data.length/800))
    for(let i=0;i<data.length;i+=step*4){sum+=data[i]*0.299+data[i+1]*0.587+data[i+2]*0.114;n++}
    return n?sum/n:128
  } catch{return 128}
}

// ── Segmentation ──────────────────────────────────────────────────────────────
// Draw order: 1) video frame  2) gown overlay  3) person silhouette on top
async function applySegmentation(segmenter, video, ctx, w, h) {
  if (!segmenter) return
  try {
    const result = await segmenter.segmentPeople(video, {
      multiSegmentation: false,
      segmentBodyParts: false,
    })
    if (!result?.length) return

    // Build a canvas with just the person pixels (background cut out)
    const oc   = Object.assign(document.createElement('canvas'), { width: w, height: h })
    const octx = oc.getContext('2d')

    // Draw mirrored video onto the person canvas
    octx.save(); octx.translate(w, 0); octx.scale(-1, 1)
    octx.drawImage(video, 0, 0, w, h)
    octx.restore()

    // Get binary mask:
    //   person pixels  → white opaque  (we KEEP these)
    //   background     → transparent   (we DISCARD these)
    const maskData = await window.bodySegmentation.toBinaryMask(
      result,
      { r: 255, g: 255, b: 255, a: 255 }, // foreground = person → opaque white
      { r: 0,   g: 0,   b: 0,   a: 0   }, // background         → transparent
      false                                 // don't flip (we mirror the video ourselves)
    )

    // Paint the mask onto a temp canvas, then use destination-in to cut out
    // everything except the person from the person canvas
    const mc   = Object.assign(document.createElement('canvas'), { width: w, height: h })
    mc.getContext('2d').putImageData(maskData, 0, 0)

    octx.globalCompositeOperation = 'destination-in'
    octx.drawImage(mc, 0, 0)
    octx.globalCompositeOperation = 'source-over'

    // Composite the person (with background removed) on top of the already-drawn gown
    ctx.drawImage(oc, 0, 0)
  } catch (e) { console.warn('Segmentation draw error:', e) }
}

// ── Camera check ──────────────────────────────────────────────────────────────
async function checkCameraAccess() {
  if (location.protocol==='http:'&&location.hostname!=='localhost')
    return{ok:false,error:'Camera requires HTTPS. Open localhost:3000 or deploy with HTTPS.'}
  if (!navigator.mediaDevices?.getUserMedia)
    return{ok:false,error:'Your browser does not support camera access. Try Chrome or Edge.'}
  try{const p=await navigator.permissions.query({name:'camera'});if(p.state==='denied')return{ok:false,error:'Camera is blocked. Click the camera icon in your address bar → Allow → then refresh.'}}catch{}
  try{const devs=await navigator.mediaDevices.enumerateDevices();if(!devs.some(d=>d.kind==='videoinput'))return{ok:false,error:'No camera found on this device.'}}catch{}
  return{ok:true}
}

// ── Onboarding overlay (shown once, dismissed to localStorage) ────────────────
function OnboardingOverlay({ onDismiss }) {
  return (
    <div className="to-onboard-backdrop">
      <div className="to-onboard-box">
        <p className="to-onboard-title">Before you start</p>
        <div className="to-onboard-steps">
          {[
            { icon:'↔️', label:'Distance',  tip:'Stand 1.5–2 metres from the camera' },
            { icon:'🖼',  label:'Full body', tip:'Make sure head to feet are in frame' },
            { icon:'💡', label:'Lighting',  tip:'Face a window or light source in front of you' },
            { icon:'👕', label:'Clothing',  tip:'Wear fitted clothes for best overlay accuracy' },
          ].map(s => (
            <div key={s.label} className="to-onboard-step">
              <span className="to-onboard-icon">{s.icon}</span>
              <div>
                <p className="to-onboard-step-label">{s.label}</p>
                <p className="to-onboard-step-tip">{s.tip}</p>
              </div>
            </div>
          ))}
        </div>
        <button className="to-btn to-btn--primary" style={{width:'100%',justifyContent:'center'}} onClick={onDismiss}>
          I understand
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function VirtualTryOnPage() {
  const searchParams = useSearchParams()

  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const containerRef= useRef(null)
  const detectorRef = useRef(null)
  const segmenterRef= useRef(null)
  const gownImgRef  = useRef(null)
  const gownBackImgRef = useRef(null)   // back-view gown image
  const prevKpsRef  = useRef(null)
  const animRef     = useRef(null)
  const streamRef   = useRef(null)

  // FIX #4: stable refs for values consumed inside the detect loop.
  // Updating these refs never triggers a re-render or cancels the loop.
  const opacityRef       = useRef(0.88)
  const enhancedModeRef  = useRef(false)
  const selectedGownRef  = useRef(null)

  // Pose-lock: require N consecutive good frames before enabling capture
  const goodFramesRef   = useRef(0)
  const LOCK_THRESHOLD  = 8  // ~0.27s at 30fps

  const [gowns,        setGowns       ]=useState([])
  const [loadingGowns, setLoadingGowns]=useState(true)
  const [selectedGown, setSelectedGown]=useState(null)
  const [modelState,   setModelState  ]=useState('idle')
  const [modelStep,    setModelStep   ]=useState('')
  const [modelPct,     setModelPct    ]=useState(0)
  const [camState,     setCamState    ]=useState('off')
  const [camError,     setCamError    ]=useState('')
  const [poseLocked,   setPoseLocked  ]=useState(false)   // replaces poseFound for capture gate
  const [poseFound,    setPoseFound   ]=useState(false)   // visual indicator
  const [poseIssues,   setPoseIssues  ]=useState([])
  const [facingBack,   setFacingBack  ]=useState(false)   // true when user turns around
  // Smooth facing transitions — require N consecutive frames before switching
  const facingBackFrames  = useRef(0)
  const FACING_THRESHOLD  = 8   // ~0.27s at 30fps — sustained back-facing required
  const [opacity,      setOpacity     ]=useState(0.88)
  const [brightness,   setBrightness  ]=useState(128)
  const [enhancedMode, setEnhancedMode]=useState(false)
  const [segLoading,   setSegLoading  ]=useState(false)
  const [segError,     setSegError    ]=useState('')      // FIX: surface seg load failures
  const [captured,     setCaptured    ]=useState(null)
  const [saving,       setSaving      ]=useState(false)
  const [saveMsg,      setSaveMsg     ]=useState('')
  const [sidebarOpen,  setSidebarOpen ]=useState(true)
  const [fullscreen,   setFullscreen  ]=useState(false)
  const [showOnboard,  setShowOnboard ]=useState(false)
  const [mounted,      setMounted     ]=useState(false)
  const [timerSecs,    setTimerSecs   ]=useState(0)      // 0 = off, 3/5/10 = countdown
  const [countdown,    setCountdown   ]=useState(null)   // null = idle, number = ticking
  const countdownRef  = useRef(null)

  const user     = mounted ? getCurrentUser() : null
  const camReady = camState==='on'
  const canCap   = camReady && poseLocked && !captured
  const lightHint= brightness<55?'dark':brightness>210?'bright':''

  // Sync refs when state changes — detect loop reads refs, not state
  useEffect(() => { opacityRef.current = opacity },           [opacity])
  useEffect(() => { enhancedModeRef.current = enhancedMode }, [enhancedMode])
  useEffect(() => { selectedGownRef.current = selectedGown }, [selectedGown])

  // FIX: set mounted on client only — all sessionStorage/window reads must be
  // gated behind this so server and client first render are identical.
  useEffect(() => {
    setMounted(true)
    if (sessionStorage.getItem('tryon_onboard_seen')) return
    setShowOnboard(true)
  }, [])

  // FIX: collapse sidebar by default on mobile — only after mount
  useEffect(() => {
    if (!mounted) return
    if (window.innerWidth < 768) setSidebarOpen(false)
  }, [mounted])

  useEffect(()=>{
    const paramId=searchParams.get('gown')
    fetch('/api/gowns').then(r=>r.json()).then(d=>{
      const list=(d.gowns||[]).filter(g=>g.image); setGowns(list)
      if(!list.length)return
      const fromParam=paramId?list.find(g=>String(g.id)===String(paramId)):null
      const chosen = fromParam||list[0]
      setSelectedGown(chosen)
      selectedGownRef.current = chosen
    }).catch(()=>{}).finally(()=>setLoadingGowns(false))
  },[searchParams])

  useEffect(()=>{
    if(!selectedGown)return
    // Load front try-on image
    const src=selectedGown.tryonImage||selectedGown.image; if(!src)return
    const img=new Image(); img.crossOrigin='anonymous'
    img.onload=()=>{gownImgRef.current=img}
    img.onerror=()=>{
      if(src!==selectedGown.image){
        const fallback=new Image(); fallback.crossOrigin='anonymous'
        fallback.onload=()=>{gownImgRef.current=fallback}
        fallback.onerror=()=>{gownImgRef.current=null}
        fallback.src=selectedGown.image
      } else { gownImgRef.current=null }
    }
    img.src=src

    // Load back try-on image (if provided)
    gownBackImgRef.current=null
    const backSrc=selectedGown.tryonImageBack
    if(backSrc){
      const backImg=new Image(); backImg.crossOrigin='anonymous'
      backImg.onload=()=>{gownBackImgRef.current=backImg}
      backImg.onerror=()=>{gownBackImgRef.current=null}
      backImg.src=backSrc
    }

    setCaptured(null); setSaveMsg('')
    goodFramesRef.current=0; setPoseLocked(false)
    facingBackFrames.current=0; setFacingBack(false)
  },[selectedGown])

  const loadPoseModel=useCallback(async()=>{
    setModelState('loading');setModelPct(0);setCamError('')
    try{
      for(let i=0;i<POSE_SCRIPTS.length;i++){
        setModelStep(`Loading library ${i+1} / ${POSE_SCRIPTS.length}…`);setModelPct(Math.round((i/POSE_SCRIPTS.length)*80))
        await loadScript(POSE_SCRIPTS[i])
      }
      setModelStep('Initialising TensorFlow…');setModelPct(85)
      await window.tf.ready()
      try{await window.tf.setBackend('webgl')}catch{await window.tf.setBackend('cpu')}
      setModelStep('Loading pose detector…');setModelPct(92)
      const pd=window.poseDetection
      detectorRef.current=await pd.createDetector(pd.SupportedModels.MoveNet,{modelType:pd.movenet.modelType.SINGLEPOSE_THUNDER})
      setModelPct(100);setModelStep('Ready');setModelState('ready')

      // FIX: preload segmentation model in the background after pose model is ready,
      // so it's available instantly when the user enables enhanced mode.
      setTimeout(()=>{
        loadScript(SEG_SCRIPT).then(()=>{
          window.bodySegmentation.createSegmenter(
            window.bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,{runtime:'tfjs'})
          .then(s=>{segmenterRef.current=s})
          .catch(e=>console.warn('Background seg preload failed:',e))
        }).catch(()=>{})
      }, 500)

    }catch(err){console.error(err);setModelState('error');setModelStep(err.message||'Failed to load AI model.')}
  },[])

  useEffect(()=>{loadPoseModel()},[loadPoseModel])

  // FIX: enhanced mode toggle — if model already preloaded, just enable.
  // If not ready yet, show loading. If failed, surface error.
  const toggleEnhanced = useCallback(() => {
    setEnhancedMode(v => {
      const next = !v
      enhancedModeRef.current = next
      if (next && !segmenterRef.current) {
        setSegLoading(true); setSegError('')
        loadScript(SEG_SCRIPT)
          .then(() => window.bodySegmentation.createSegmenter(
            window.bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,{runtime:'tfjs'}))
          .then(s => { segmenterRef.current = s })
          .catch(e => {
            console.warn('Segmentation failed:', e)
            setSegError('Could not load enhanced mode. Try refreshing.')
            // auto-disable toggle on failure
            setEnhancedMode(false); enhancedModeRef.current = false
          })
          .finally(() => setSegLoading(false))
      }
      return next
    })
  }, [])

  const startCamera=useCallback(async()=>{
    setCamError('');setCamState('starting')
    const check=await checkCameraAccess()
    if(!check.ok){setCamError(check.error);setCamState('error');return}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({
        video:{width:{ideal:1280,max:1920},height:{ideal:720,max:1080},facingMode:'user',frameRate:{ideal:30}},audio:false
      })
      streamRef.current=stream; videoRef.current.srcObject=stream
      await new Promise((res,rej)=>{videoRef.current.onloadedmetadata=res;videoRef.current.onerror=rej;setTimeout(()=>rej(new Error('timeout')),10000)})
      await videoRef.current.play(); setCamState('on')
    }catch(err){
      let msg='Could not start camera.'
      if(err.name==='NotAllowedError') msg='Camera permission denied. Click the camera icon in your address bar → Allow → refresh.'
      else if(err.name==='NotFoundError') msg='No camera found on this device.'
      else if(err.name==='NotReadableError') msg='Camera is in use by another app (Zoom, Teams). Close those apps and try again.'
      else if(err.message==='timeout') msg='Camera took too long to start. Please try again.'
      else if(err.name==='OverconstrainedError'){
        try{const s2=await navigator.mediaDevices.getUserMedia({video:true,audio:false});streamRef.current=s2;videoRef.current.srcObject=s2;await videoRef.current.play();setCamState('on');return}catch{}
        msg='Camera does not meet the required resolution.'
      }
      setCamError(msg);setCamState('error')
    }
  },[])

  const stopCamera=useCallback(()=>{
    if(animRef.current)cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach(t=>t.stop()); streamRef.current=null
    canvasRef.current?.getContext('2d')?.clearRect(0,0,canvasRef.current.width,canvasRef.current.height)
    prevKpsRef.current=null; goodFramesRef.current=0
    setCamState('off');setPoseFound(false);setPoseLocked(false);setPoseIssues([]);setBrightness(128)
  },[])

  // FIX #4: detect is now a stable function — it reads all changing values
  // through refs rather than closing over state. This means the useCallback
  // has NO reactive dependencies and the animation loop NEVER restarts due to
  // opacity changes, gown selection changes, or mode toggles.
  const detect=useCallback(async()=>{
    const video=videoRef.current,canvas=canvasRef.current
    if(!video||!canvas||video.readyState<2){animRef.current=requestAnimationFrame(detect);return}

    const dpr=window.devicePixelRatio||1
    const vw=video.videoWidth||640
    const vh=video.videoHeight||480
    canvas.width=vw*dpr;canvas.height=vh*dpr
    canvas.style.width=vw+'px';canvas.style.height=vh+'px'
    const ctx=canvas.getContext('2d')
    ctx.setTransform(dpr,0,0,dpr,0,0)

    // Draw mirrored video frame
    ctx.save();ctx.translate(vw,0);ctx.scale(-1,1);ctx.drawImage(video,0,0,vw,vh);ctx.restore()

    const br=sampleBrightness(ctx,vw,vh); setBrightness(br)

    try{
      const poses=await detectorRef.current?.estimatePoses(video)
      if(poses?.length>0){
        let kps=poses[0].keypoints.map(k=>({...k,x:vw-k.x}))
        kps=smoothKps(prevKpsRef.current,kps); prevKpsRef.current=kps
        const analysis=analyzePose(kps,vw,vh); setPoseIssues(analysis.issues)

        // Smooth facing direction — require FACING_THRESHOLD consecutive clean frames
        // before switching, and instantly reset to 0 if framing issues are present
        // (prevents "too close" from ever triggering back view).
        const tooCloseFrame = analysis.issues.includes('too_close') && !analysis.facingBack
        if (tooCloseFrame) {
          // Hard reset — close framing is NOT back-facing
          facingBackFrames.current = 0
        } else if (analysis.facingBack) {
          facingBackFrames.current = Math.min(facingBackFrames.current + 1, FACING_THRESHOLD)
        } else {
          facingBackFrames.current = Math.max(facingBackFrames.current - 1, 0)
        }
        const isBackFacing = facingBackFrames.current >= FACING_THRESHOLD
        setFacingBack(isBackFacing)

        // Pick front or back gown image
        const activeImg = isBackFacing && gownBackImgRef.current
          ? gownBackImgRef.current
          : gownImgRef.current

        // Read calibration from the ref so gown changes don't restart the loop
        const cal={...(selectedGownRef.current?.tryonCalibration||{})}
        const layout=getGownLayout(kps,cal,vw,vh)
        const currentOpacity = opacityRef.current
        const isEnhanced     = enhancedModeRef.current

        if(layout&&activeImg&&analysis.shouldersOk&&analysis.hipsOk){
          setPoseFound(true)

          goodFramesRef.current = Math.min(goodFramesRef.current + 1, LOCK_THRESHOLD)
          if (goodFramesRef.current >= LOCK_THRESHOLD) setPoseLocked(true)

          const adj=currentOpacity*(br<60?0.82:br>200?0.96:1)

          if(isEnhanced&&segmenterRef.current){
            drawGown(ctx,activeImg,layout,adj)
            await applySegmentation(segmenterRef.current,video,ctx,vw,vh)
          } else {
            drawGown(ctx,activeImg,layout,adj)
          }
        } else {
          setPoseFound(false)
          goodFramesRef.current = Math.max(0, goodFramesRef.current - 2)
          if (goodFramesRef.current === 0) setPoseLocked(false)
        }
      } else {
        setPoseFound(false);setPoseIssues(['no_pose']);prevKpsRef.current=null
        goodFramesRef.current=0; setPoseLocked(false)
      }
    }catch{/*skip frame*/}
    animRef.current=requestAnimationFrame(detect)
  // FIX #4: empty dependency array — detect never gets recreated.
  // All changing values are read via refs.
  },[]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{
    if(camState==='on'&&modelState==='ready')detect()
    else if(animRef.current)cancelAnimationFrame(animRef.current)
    return()=>{if(animRef.current)cancelAnimationFrame(animRef.current)}
  },[camState,modelState,detect])

  const toggleFullscreen=useCallback(()=>{
    const el=containerRef.current; if(!el)return
    if(!document.fullscreenElement)el.requestFullscreen?.().then(()=>setFullscreen(true)).catch(()=>{})
    else document.exitFullscreen?.().then(()=>setFullscreen(false)).catch(()=>{})
  },[])
  useEffect(()=>{const fn=()=>setFullscreen(!!document.fullscreenElement);document.addEventListener('fullscreenchange',fn);return()=>document.removeEventListener('fullscreenchange',fn)},[])

  const takePhoto=useCallback(()=>{if(!canvasRef.current)return;setCaptured(canvasRef.current.toDataURL('image/jpeg',0.93))},[])

  const startTimedCapture=useCallback(()=>{
    if(!canCap) return
    if(timerSecs===0){ takePhoto(); return }
    // start countdown
    setCountdown(timerSecs)
    const tick=(remaining)=>{
      if(remaining<=0){
        setCountdown(null)
        if(canvasRef.current) setCaptured(canvasRef.current.toDataURL('image/jpeg',0.93))
        return
      }
      setCountdown(remaining)
      countdownRef.current=setTimeout(()=>tick(remaining-1),1000)
    }
    countdownRef.current=setTimeout(()=>tick(timerSecs-1),1000)
  },[canCap,timerSecs,takePhoto])

  const cancelCountdown=useCallback(()=>{
    clearTimeout(countdownRef.current)
    setCountdown(null)
  },[])
  const retake=useCallback(()=>{
    clearTimeout(countdownRef.current); setCountdown(null)
    setCaptured(null);setSaveMsg('');goodFramesRef.current=0;setPoseLocked(false)
  },[])
  const downloadPhoto=useCallback(()=>{
    if(!captured)return
    const a=Object.assign(document.createElement('a'),{href:captured,download:`jce-tryon-${(selectedGownRef.current?.name||'photo').replace(/\s+/g,'-')}.jpg`});a.click()
  },[captured])
  const savePhoto=useCallback(async()=>{
    if(!captured||!user)return; setSaving(true);setSaveMsg('')
    try{
      const res=await fetch('/api/auth/save-tryon',{method:'POST',headers:{'Content-Type':'application/json','x-user-id':user.id},body:JSON.stringify({image:captured,gownId:selectedGownRef.current?.id,gownName:selectedGownRef.current?.name})})
      const data=await res.json(); setSaveMsg(data.ok?'✓ Saved to profile':data.error||'Save failed.')
    }catch{setSaveMsg('Could not save. Please try again.')}
    finally{setSaving(false)}
  },[captured,user])

  useEffect(()=>()=>{stopCamera();detectorRef.current?.dispose?.();segmenterRef.current?.dispose?.()},[stopCamera])

  const handleOnboardDismiss = useCallback(() => {
    sessionStorage.setItem('tryon_onboard_seen', '1')
    setShowOnboard(false)
    // Auto-start camera after dismissing onboarding if model is ready
    if (modelState === 'ready') startCamera()
  }, [modelState, startCamera])

  return(
    <>
      {/* FIX: only render onboarding after mount — prevents SSR/client mismatch */}
      {mounted && showOnboard && <OnboardingOverlay onDismiss={handleOnboardDismiss} />}

      <main className="to-page">
        <Header solid />
        <div className="to-spacer"/>

        <section className="to-hero">
          <div className="to-hero-inner">
            <span className="to-eyebrow">FitMatcher · Virtual Try-On</span>
            <h1 className="to-h1">See it on <em>you</em></h1>
            <p className="to-sub">AI tracks your pose in real time and drapes the gown over your body — no fitting room needed.</p>
          </div>
        </section>

        <div className="to-layout" ref={containerRef}>
          <button className={`to-sidebar-toggle${sidebarOpen?' open':''}`} onClick={()=>setSidebarOpen(v=>!v)} aria-label={sidebarOpen?'Hide sidebar':'Show sidebar'}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>

          <aside className={`to-sidebar${sidebarOpen?'':' collapsed'}`}>
            <div className="to-sidebar-inner">
              <div className="to-sidebar-section">
                <p className="to-sidebar-title">Choose a gown</p>
                {loadingGowns?(
                  <div className="to-gown-list">{[1,2,3].map(i=><div key={i} className="to-gown-sk"/>)}</div>
                ):gowns.length===0?(<p className="to-muted">No gowns available.</p>):(
                  <div className="to-gown-list">
                    {gowns.map(g=>(
                      <button key={g.id} className={`to-gown-item${selectedGown?.id===g.id?' is-sel':''}`} onClick={()=>setSelectedGown(g)}>
                        <div className="to-gown-thumb" style={{position:'relative'}}>
                          {/* Front image */}
                          <img
                            src={g.image} alt={g.alt||g.name}
                            style={{
                              position:'absolute',inset:0,width:'100%',height:'100%',
                              objectFit:'cover',objectPosition:'top',
                              opacity: selectedGown?.id===g.id && facingBack && g.tryonImageBack ? 0 : 1,
                              transition:'opacity .3s',
                            }}
                          />
                          {/* Back image — only shown when facing back and image exists */}
                          {g.tryonImageBack&&(
                            <img
                              src={g.tryonImageBack} alt={(g.alt||g.name)+' back'}
                              style={{
                                position:'absolute',inset:0,width:'100%',height:'100%',
                                objectFit:'cover',objectPosition:'top',
                                opacity: selectedGown?.id===g.id && facingBack ? 1 : 0,
                                transition:'opacity .3s',
                              }}
                            />
                          )}
                          {selectedGown?.id===g.id&&<span className="to-gown-check">✓</span>}
                        </div>
                        <div className="to-gown-meta">
                          <span className="to-gown-name">{g.name}</span>
                          <span className="to-gown-price">{g.price}</span>
                          {g.color&&<span className="to-gown-color">{g.color}</span>}
                          {selectedGown?.id===g.id&&g.tryonImageBack&&(
                            <span className="to-gown-view-hint">{facingBack?'↩ Back':'↪ Front'}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {selectedGown&&<Link href={`/gowns/${selectedGown.id}`} className="to-view-link">← Back to {selectedGown.name}</Link>}
              </div>

              {camReady&&(
                <div className="to-ctrl-card">
                  <div>
                    <div className="to-opacity-row"><span className="to-opacity-lbl">Gown opacity</span><span className="to-opacity-val">{Math.round(opacity*100)}%</span></div>
                    <input type="range" min="0.2" max="1" step="0.05" value={opacity}
                      onChange={e=>{
                        const v=+e.target.value
                        setOpacity(v)
                        opacityRef.current=v  // FIX #4: update ref directly for zero-lag effect
                      }}
                      className="to-slider" aria-label="Gown opacity"/>
                  </div>
                  <div className="to-divider"/>
                  <div className="to-mode-row">
                    <div className="to-mode-text">
                      <p className="to-mode-title">Enhanced mode</p>
                      <p className="to-mode-desc">
                        Segments your body so the gown appears behind your arms.
                        {segLoading&&<span className="to-mode-loading"> Loading…</span>}
                      </p>
                      {/* FIX: surface segmentation load errors */}
                      {segError&&<p className="to-mode-error">{segError}</p>}
                    </div>
                    <button className={`to-toggle${enhancedMode?' on':''}`} onClick={toggleEnhanced} disabled={segLoading} aria-pressed={enhancedMode}><span className="to-toggle-thumb"/></button>
                  </div>
                </div>
              )}

              <div className="to-tips">
                <p className="to-tips-title">For best results</p>
                <ul>
                  <li>Stand 1.5–2 m back from the camera</li>
                  <li>Make sure your full body is in frame</li>
                  <li>Face a window or light in front of you</li>
                  <li>Use a plain, uncluttered background</li>
                  <li>Wear fitted clothing</li>
                  <li>Keep arms slightly away from your body</li>
                </ul>
              </div>
            </div>
          </aside>

          <div className="to-main">
            {modelState==='loading'&&(
              <div className="to-model-bar">
                <span className="to-spin to-spin--lt"/><span className="to-model-step">{modelStep}</span>
                <div className="to-model-track"><div className="to-model-fill" style={{width:modelPct+'%'}}/></div>
                <span className="to-model-pct">{modelPct}%</span>
              </div>
            )}
            {modelState==='error'&&(
              <div className="to-model-bar to-model-bar--err">
                <span>⚠</span><span className="to-bar-msg">{modelStep}</span>
                <button className="to-retry-btn" onClick={loadPoseModel}>Retry</button>
              </div>
            )}

            <div className="to-viewport">
              <video ref={videoRef} className="to-video-hidden" playsInline muted/>
              <canvas ref={canvasRef} className={`to-canvas${camReady?' on':''}`}/>

              {camReady&&!captured&&(
                <div className="to-vp-toolbar">
                  <button className="to-vp-btn" onClick={toggleFullscreen} title={fullscreen?'Exit fullscreen':'Fullscreen'}>
                    {fullscreen
                      ?<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
                      :<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                    }
                  </button>
                </div>
              )}

              {!camReady&&!captured&&(
                <div className="to-placeholder">
                  <div className="to-ph-icon"><svg viewBox="0 0 80 80" fill="none"><rect x="8" y="22" width="64" height="44" rx="4" stroke="rgba(250,247,244,.18)" strokeWidth="1.5"/><circle cx="40" cy="44" r="12" stroke="rgba(250,247,244,.18)" strokeWidth="1.5"/><circle cx="40" cy="44" r="5" fill="rgba(250,247,244,.1)"/><path d="M30 22l4-8h12l4 8" stroke="rgba(250,247,244,.18)" strokeWidth="1.5" strokeLinejoin="round"/></svg></div>
                  {camState==='starting'
                    ?<p className="to-ph-text"><span className="to-spin"/>Starting camera…</p>
                    :<><p className="to-ph-text">Camera is off</p><p className="to-ph-sub">{modelState==='ready'?'Press Start camera, then stand back so your full body is visible.':'AI model is loading — this only takes a moment.'}</p></>
                  }
                </div>
              )}

              {camReady&&!poseFound&&!captured&&(
                <div className="to-pose-guide">
                  <svg className="to-pose-fig" viewBox="0 0 100 220" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="1.5" strokeLinecap="round">
                    <ellipse cx="50" cy="24" rx="14" ry="18"/>
                    <line x1="50" y1="42" x2="50" y2="110"/><line x1="50" y1="62" x2="22" y2="98"/><line x1="50" y1="62" x2="78" y2="98"/>
                    <line x1="50" y1="110" x2="36" y2="176"/><line x1="50" y1="110" x2="64" y2="176"/>
                    <line x1="36" y1="176" x2="32" y2="216"/><line x1="64" y1="176" x2="68" y2="216"/>
                  </svg>
                </div>
              )}

              {camReady&&!captured&&(
                <GuidanceOverlay issues={poseFound?[]:poseIssues} lightHint={lightHint}/>
              )}

              {/* Pose badge — small, bottom-left */}
              {camReady&&poseFound&&!captured&&countdown===null&&(
                <div className={`to-pose-badge${poseLocked?' to-pose-badge--locked':''}`}>
                  <span className="to-pulse"/>
                  {facingBack ? (gownBackImgRef.current ? '↩ Back view' : '↩ No back image') : (poseLocked ? 'Ready' : 'Tracking')}
                </div>
              )}

              {/* Countdown overlay */}
              {countdown!==null&&(
                <div className="to-countdown">
                  <span className="to-countdown-num" key={countdown}>{countdown}</span>
                </div>
              )}

              {captured&&(
                <div className="to-captured">
                  <img src={captured} alt="Try-on capture" className="to-captured-img"/>
                  <div className="to-captured-bar">
                    <button onClick={downloadPhoto} className="to-cap-btn">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      Download
                    </button>
                    {user?(
                      <button onClick={savePhoto} disabled={saving||saveMsg.startsWith('✓')} className="to-cap-btn to-cap-btn--gold">{saving?'Saving…':saveMsg||'Save to profile'}</button>
                    ):(
                      <Link href="/login" className="to-cap-btn to-cap-btn--gold">Log in to save</Link>
                    )}
                    <button onClick={retake} className="to-cap-btn">↩ Retake</button>
                  </div>
                  {selectedGown&&(
                    <div className="to-post-capture">
                      <p className="to-post-label">Like what you see?</p>
                      <div className="to-post-links">
                        <Link href={`/gowns/${selectedGown.id}`} className="to-post-btn to-post-btn--outline">View {selectedGown.name}</Link>
                        <Link href={`/gowns/${selectedGown.id}#sizes`} className="to-post-btn to-post-btn--primary">Add to Cart →</Link>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {camError&&(
              <div className="to-cam-error" role="alert">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <div>{camError.split('\n').map((l,i)=><p key={i}>{l}</p>)}</div>
              </div>
            )}

            <div className="to-controls">
              {!camReady?(
                <button className="to-btn to-btn--primary" onClick={startCamera} disabled={modelState!=='ready'||camState==='starting'}>
                  {camState==='starting'?<><span className="to-spin"/>Starting…</>:modelState!=='ready'?<><span className="to-spin"/>Loading AI…</>:<><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>Start camera</>}
                </button>
              ):captured?(
                <button className="to-btn to-btn--outline" onClick={retake}>↩ Retake photo</button>
              ):(
                <>
                  <button className={`to-btn to-btn--capture${canCap&&countdown===null?' ready':''}`}
                    onClick={countdown!==null ? cancelCountdown : startTimedCapture}
                    disabled={!canCap&&countdown===null}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 3l-4-2-4 2"/></svg>
                    {countdown!==null?`Cancel (${countdown}s)`:poseLocked?'Take photo':poseFound?'Hold still…':'Waiting for full body…'}
                  </button>
                  {/* Timer selector */}
                  <div className="to-timer-row">
                    {[0,3,5,10].map(s=>(
                      <button key={s} className={`to-timer-btn${timerSecs===s?' active':''}`}
                        onClick={()=>setTimerSecs(s)} disabled={countdown!==null}>
                        {s===0?'Off':`${s}s`}
                      </button>
                    ))}
                  </div>
                  <button className="to-btn to-btn--outline" onClick={stopCamera}>Stop</button>
                  <button className="to-btn to-btn--outline" onClick={toggleFullscreen} style={{marginLeft:'auto'}}>{fullscreen?'⤡ Exit':'⤢ Fullscreen'}</button>
                </>
              )}
            </div>

            <div className="to-how">
              <p className="to-how-title">How it works</p>
              <div className="to-how-grid">
                {[
                  {n:'1',t:'Stays in your browser',  d:'No video is uploaded. AI runs entirely on your device using your GPU.'},
                  {n:'2',t:'Gown follows your pose', d:'Scales to your shoulder and hip width in real time as you move.'},
                  {n:'3',t:'Enhanced layers it',     d:'Body segmentation places the gown behind your arms for realism.'},
                  {n:'4',t:'Capture & keep',         d:'Download or save to your profile to revisit your favourite look.'},
                ].map(s=>(
                  <div key={s.n} className="to-how-item">
                    <span className="to-how-n">{s.n}</span>
                    <div><p className="to-how-t">{s.t}</p><p className="to-how-d">{s.d}</p></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <Footer/>
      </main>
    </>
  )
}