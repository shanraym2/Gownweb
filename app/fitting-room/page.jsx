'use client'

import { useCallback, useEffect, useRef, useState, createContext, useContext } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser } from '../utils/authClient'

// ── Shared constants & scoring engine ────────────────────────────────────────
import {
  BODY_SHAPES, SKIN_TONES, UNDERTONES, OCCASIONS,
  COLOR_OPTIONS, FABRIC_OPTIONS, BUDGET_RANGES,
  scoreGown, normaliseScore, MAX_RAW_SCORE,
} from '../constants/styleOptions'

// ── Skin tone detection utilities ─────────────────────────────────────────────
import {
  detectSkinProfile,
  detectSkinToneFromPixels,
  detectUndertone,
  sampleFaceRegion,
} from '../utils/skinTone'

// ── Shared TryOnCamera component ─────────────────────────────────────────────
import TryOnCamera from '../components/TryOnCamera'

// ─────────────────────────────────────────────────────────────────────────────
// POSE / AI CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const POSE_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.10.0/dist/tf-core.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.10.0/dist/tf-converter.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@4.10.0/dist/tf-backend-webgl.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js',
]
const SEG_SCRIPT = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/body-segmentation@1.0.1/dist/body-segmentation.min.js'

const KP   = { NOSE:0, LS:5, RS:6, LE:7, RE:8, LH:11, RH:12, LK:13, RK:14, LA:15, RA:16 }
const CONF = 0.25

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = Object.assign(document.createElement('script'), { src, async: false })
    s.onload = resolve; s.onerror = () => reject(new Error('Failed: ' + src))
    document.head.appendChild(s)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// GEOMETRY UTILS
// ─────────────────────────────────────────────────────────────────────────────

function dist(a, b)  { return Math.hypot(a.x - b.x, a.y - b.y) }
function mid(a, b)   { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
function lerpPt(a, b, t) { return { x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t, score: b.score } }
function smoothKps(prev, curr, t = 0.35) {
  if (!prev) return curr
  return curr.map((k, i) => lerpPt(prev[i], k, t))
}

// ─────────────────────────────────────────────────────────────────────────────
// BODY SHAPE DETECTION FROM KEYPOINTS
// Infers a body shape ID from shoulder, waist, and hip proportions.
// Returns null when data is insufficient or confidence is low.
// ─────────────────────────────────────────────────────────────────────────────

function detectBodyShapeFromPose(kps, vw) {
  const ls = kps[KP.LS], rs = kps[KP.RS]
  const lh = kps[KP.LH], rh = kps[KP.RH]
  const lk = kps[KP.LK], rk = kps[KP.RK]
  if (!ls || !rs || !lh || !rh) return null
  if (ls.score < CONF || rs.score < CONF || lh.score < CONF || rh.score < CONF) return null

  const shoulderW = dist(ls, rs)
  const hipW      = dist(lh, rh)

  // Approximate waist: midpoint between shoulders and hips
  const sm = mid(ls, rs), hm = mid(lh, rh)
  const waistY = sm.y + (hm.y - sm.y) * 0.55
  // Shoulder width is our proxy for waist width when we can't see arms
  const waistProxy = shoulderW * 0.72

  const sToH = shoulderW / hipW       // > 1 = inverted triangle, < 1 = pear
  const wToH = waistProxy / hipW      // high = apple/rectangle, low = defined waist

  // Height-based size: use fraction of frame
  const torsoH = hm.y - sm.y
  const frameH = kps[KP.LA]?.score > CONF && kps[KP.RA]?.score > CONF
    ? Math.max(kps[KP.LA].y, kps[KP.RA].y) - sm.y
    : torsoH * 4.5
  const heightFraction = torsoH / Math.max(frameH, 1)
  const likelyPetite   = heightFraction < 0.19

  if (likelyPetite) return 'petite'

  if (sToH > 1.18)               return 'invertedTriangle'  // shoulders clearly wider
  if (sToH < 0.83)               return 'pear'              // hips clearly wider
  if (wToH > 0.90 && sToH > 0.93) return 'rectangle'        // straight up/down
  if (wToH < 0.78)               return 'hourglass'         // defined waist
  if (wToH > 0.88 && sToH < 0.93) return 'apple'            // wider mid

  return null  // not confident enough
}

// ─────────────────────────────────────────────────────────────────────────────
// POSE ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

function analyzePose(kps, vw, vh) {
  if (!kps) return { ok:false, issues:['no_pose'], facingBack:false }
  const ls=kps[KP.LS],rs=kps[KP.RS],lh=kps[KP.LH],rh=kps[KP.RH]
  const lk=kps[KP.LK],rk=kps[KP.RK],la=kps[KP.LA],ra=kps[KP.RA]
  const nose=kps[KP.NOSE]
  const issues=[]
  const shouldersOk=ls?.score>CONF&&rs?.score>CONF
  const hipsOk=lh?.score>CONF&&rh?.score>CONF
  const kneesOk=lk?.score>CONF&&rk?.score>CONF
  const anklesOk=la?.score>CONF&&ra?.score>CONF
  const margin=vw*0.08
  const tooCloseFrame=shouldersOk&&(ls.x<margin||rs.x>vw-margin||(hipsOk&&mid(lh,rh).y>vh*0.72))
  const faceVisible=nose&&nose.score>0.30
  const bodyStable=shouldersOk&&hipsOk
  const shoulderSpan=shouldersOk?dist(ls,rs):0
  const bodyWideEnough=shoulderSpan>vw*0.10
  const facingBack=!faceVisible&&bodyStable&&bodyWideEnough&&!tooCloseFrame
  if (!shouldersOk){issues.push('no_shoulders');return{ok:false,issues,shouldersOk,hipsOk,facingBack}}
  if (!hipsOk){issues.push('no_hips');return{ok:false,issues,shouldersOk,hipsOk,facingBack}}
  if (!kneesOk) issues.push('no_legs')
  if (tooCloseFrame) issues.push('too_close')
  if (nose?.score>0.15&&nose.y<vh*0.06) issues.push('head_cut')
  if (!kneesOk&&hipsOk&&mid(lh,rh).y>vh*0.55&&!tooCloseFrame) issues.unshift('too_close')
  if (kneesOk&&!anklesOk&&mid(lk,rk).y<vh*0.82) issues.push('too_close')
  const ok=shouldersOk&&hipsOk&&issues.length===0
  return{ok,issues,shouldersOk,hipsOk,kneesOk,anklesOk,facingBack}
}

// ─────────────────────────────────────────────────────────────────────────────
// GOWN OVERLAY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getGownLayout(kps, cal={}, vw=640, vh=480) {
  const ls=kps[KP.LS],rs=kps[KP.RS],lh=kps[KP.LH],rh=kps[KP.RH]
  const lk=kps[KP.LK],rk=kps[KP.RK],la=kps[KP.LA],ra=kps[KP.RA]
  if ([ls,rs,lh,rh].some(k=>!k||k.score<CONF)) return null
  const sm=mid(ls,rs),hm=mid(lh,rh),torsoH=hm.y-sm.y
  const rawSw=dist(ls,rs),sw=Math.min(Math.max(rawSw,vw*0.28),vw*0.80)
  const rawHw=dist(lh,rh),hw=Math.max(rawHw,sw*0.90)
  const neckOff=cal.necklineY??0.18,topY=sm.y-torsoH*neckOff
  let bottomY
  if (la?.score>CONF&&ra?.score>CONF) { bottomY=Math.max(la.y,ra.y)+torsoH*0.15 }
  else if (lk?.score>CONF&&rk?.score>CONF) { const km=mid(lk,rk),legH=km.y-hm.y; bottomY=km.y+legH*1.1 }
  else { bottomY=sm.y+torsoH*4.8 }
  if (cal.hemY!=null){const fullH=sm.y+torsoH*4.8-topY;bottomY=topY+fullH*cal.hemY}
  const shoulderPad=cal.shoulderPad??1.45,skirtFlare=cal.skirtFlare??1.20
  const topW=sw*shoulderPad,botW=Math.max(hw*1.55,topW)*skirtFlare
  const cx=(sm.x+hm.x)/2
  return{topY,bottomY,cx,topW,botW,torsoH}
}

function drawGown(ctx, img, layout, opacity) {
  const{topY,bottomY,cx,topW,botW}=layout; const h=bottomY-topY; if(h<=0)return
  ctx.save(); ctx.globalAlpha=opacity
  ctx.beginPath()
  ctx.moveTo(cx-topW/2,topY); ctx.lineTo(cx+topW/2,topY)
  ctx.lineTo(cx+botW/2,bottomY); ctx.lineTo(cx-botW/2,bottomY)
  ctx.closePath(); ctx.clip()
  ctx.drawImage(img,cx-botW/2,topY,botW,h); ctx.restore()
}

async function applySegmentation(segmenter, video, ctx, w, h) {
  if (!segmenter) return
  try {
    const result=await segmenter.segmentPeople(video,{multiSegmentation:false,segmentBodyParts:false})
    if(!result?.length) return
    const oc=Object.assign(document.createElement('canvas'),{width:w,height:h})
    const octx=oc.getContext('2d')
    octx.save();octx.translate(w,0);octx.scale(-1,1);octx.drawImage(video,0,0,w,h);octx.restore()
    const maskData=await window.bodySegmentation.toBinaryMask(result,{r:255,g:255,b:255,a:255},{r:0,g:0,b:0,a:0},false)
    const mc=Object.assign(document.createElement('canvas'),{width:w,height:h})
    mc.getContext('2d').putImageData(maskData,0,0)
    octx.globalCompositeOperation='destination-in'; octx.drawImage(mc,0,0)
    octx.globalCompositeOperation='source-over'; ctx.drawImage(oc,0,0)
  } catch(e){console.warn('Seg error:',e)}
}

// ─────────────────────────────────────────────────────────────────────────────
// FITTING ROOM CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

const FittingRoomCtx = createContext(null)
function useFittingRoom() { return useContext(FittingRoomCtx) }

function FittingRoomProvider({ children, gowns, sizes, supplierName }) {
  const [profile, setProfile] = useState({
    bust: null, waist: null, hips: null, height: null, weight: null,
    source: null, bodyShape: null, skinTone: null, undertone: null,
    occasion: null, colors: [], fabrics: [], budget: null,
  })
  const [sizeResult,   setSizeResult  ] = useState(null)
  const [styleResults, setStyleResults] = useState(null)
  const detectorRef  = useRef(null)
  const segmenterRef = useRef(null)
  const [modelState, setModelState] = useState('idle')

  const updateProfile = useCallback((patch) => {
    setProfile(p => ({ ...p, ...patch }))
  }, [])

  useEffect(() => {
    if (profile.bust || profile.waist || profile.hips) {
      if (!sizes?.length) return
      const { bust, waist, hips } = profile
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
      const idx      = sizes.findIndex(s => s.label === best?.label)
      const adjacent = sizes.slice(Math.max(0, idx - 1), Math.min(sizes.length, idx + 2))
      setSizeResult(best ? { size: best, score: bestScore, adjacent } : null)
    }
  }, [profile.bust, profile.waist, profile.hips, sizes])

  useEffect(() => {
    if (!gowns?.length || !profile.bodyShape) return
    const scored = gowns
      .map(g => { const { score, reasons } = scoreGown(g, profile); return { ...g, _score: score, _reasons: reasons } })
      .filter(g => g._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 8)
    setStyleResults(scored)
  }, [profile.bodyShape, profile.skinTone, profile.undertone, profile.occasion,
      profile.colors, profile.fabrics, profile.budget, profile.height, gowns])

  // Load model once — shared between Scan + TryOn panels
  useEffect(() => {
    if (detectorRef.current || modelState === 'loading' || modelState === 'ready') return
    setModelState('loading')
    Promise.all(POSE_SCRIPTS.map(loadScript))
      .then(() => window.tf.ready())
      .then(() => window.tf.setBackend('webgl').catch(() => window.tf.setBackend('cpu')))
      .then(() => {
        const pd = window.poseDetection
        return pd.createDetector(pd.SupportedModels.MoveNet, { modelType: pd.movenet.modelType.SINGLEPOSE_THUNDER })
      })
      .then(det => { detectorRef.current = det; setModelState('ready') })
      .catch(() => setModelState('error'))
  }, [modelState])

  return (
    <FittingRoomCtx.Provider value={{
      profile, updateProfile, sizeResult, styleResults,
      sizes, supplierName, gowns, detectorRef, segmenterRef, modelState,
    }}>
      {children}
    </FittingRoomCtx.Provider>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────

function ProfileSidebar({ user, onSave, saving, saveMsg }) {
  const { profile, sizeResult, updateProfile, sizes, supplierName } = useFittingRoom()
  const scoreConf  = sizeResult ? Math.min(95, Math.max(10, Math.round(100 - sizeResult.score * 3))) : 0
  const scoreColor = scoreConf >= 75 ? '#1D9E75' : scoreConf >= 55 ? '#EF9F27' : '#E24B4A'
  const tone       = SKIN_TONES.find(t => t.id === profile.skinTone)
  const hasProfile = profile.bust || profile.waist || profile.hips

  return (
    <aside className="fr-sidebar">
      <div className="fr-sidebar-header">
        <span className="fr-sidebar-eyebrow">Your Profile</span>
        {user && <span className="fr-sidebar-user">{user.name || user.email}</span>}
      </div>

      <div className="fr-sidebar-section">
        <p className="fr-sidebar-label">Measurements</p>
        {hasProfile ? (
          <div className="fr-meas-grid">
            {[['Bust',profile.bust,'cm'],['Waist',profile.waist,'cm'],['Hips',profile.hips,'cm'],
              ['Height',profile.height,'cm'],['Weight',profile.weight,'kg']].filter(([,v])=>v).map(([l,v,u])=>(
              <div key={l} className="fr-meas-chip">
                <span className="fr-meas-key">{l}</span>
                <span className="fr-meas-val">{v} {u}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="fr-sidebar-empty">Use the Scan tab to capture measurements</p>
        )}
      </div>

      {sizeResult?.size && (
        <div className="fr-sidebar-section fr-sidebar-size">
          <p className="fr-sidebar-label">{supplierName || 'Standard'} Size</p>
          <div className="fr-size-display">
            <span className="fr-size-label">{sizeResult.size.label}</span>
            <div className="fr-size-conf">
              <div className="fr-conf-bar"><div className="fr-conf-fill" style={{width:`${scoreConf}%`,background:scoreColor}}/></div>
              <span style={{color:scoreColor,fontSize:'11px',fontWeight:500}}>{scoreConf}%</span>
            </div>
          </div>
          <div className="fr-size-range">
            {sizeResult.adjacent.map(sz => (
              <span key={sz.label} className={`fr-size-pill${sz.label===sizeResult.size.label?' fr-size-pill--match':''}`}>{sz.label}</span>
            ))}
          </div>
        </div>
      )}

      {(profile.bodyShape || profile.skinTone || profile.occasion) && (
        <div className="fr-sidebar-section">
          <p className="fr-sidebar-label">Style Profile</p>
          <div className="fr-profile-chips">
            {profile.bodyShape && (
              <span className="fr-chip">
                {BODY_SHAPES.find(b=>b.id===profile.bodyShape)?.icon || '👤'} {profile.bodyShape}
              </span>
            )}
            {profile.skinTone && (
              <span className="fr-chip fr-chip--tone">
                <span className="fr-chip-swatch" style={{background: tone?.hex}}/>
                {profile.skinTone}
              </span>
            )}
            {profile.undertone && <span className="fr-chip">{profile.undertone} tone</span>}
            {profile.occasion  && <span className="fr-chip">{OCCASIONS.find(o=>o.id===profile.occasion)?.icon} {profile.occasion}</span>}
          </div>
        </div>
      )}

      {user && hasProfile && (
        <div className="fr-sidebar-section">
          <button className="fr-save-btn" onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
          {saveMsg && <p className={`fr-save-msg${saveMsg.startsWith('✓')?' ok':' err'}`}>{saveMsg}</p>}
        </div>
      )}

      <div className="fr-sidebar-section fr-sidebar-manual">
        <p className="fr-sidebar-label">Override measurements</p>
        <div className="fr-manual-grid">
          {[['Bust','bust','cm'],['Waist','waist','cm'],['Hips','hips','cm']].map(([l,k,u])=>(
            <label key={k} className="fr-manual-field">
              <span>{l}</span>
              <input type="number" value={profile[k]||''} placeholder="—"
                onChange={e => updateProfile({[k]: parseFloat(e.target.value)||null})}/>
              <span className="fr-manual-unit">{u}</span>
            </label>
          ))}
        </div>
      </div>
    </aside>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SCAN PANEL
// Detects: measurements · skin tone · undertone · body shape (all from camera)
// ─────────────────────────────────────────────────────────────────────────────

const GUIDANCE_MAP = {
  no_pose:      { icon:'🚶', text:'Stand in front of the camera — full body visible.' },
  no_shoulders: { icon:'⬆️', text:'Step back until your shoulders appear.' },
  no_hips:      { icon:'⬇️', text:'Step back — your waist needs to be in view.' },
  no_legs:      { icon:'↕️', text:'Step back so your legs are visible.' },
  too_close:    { icon:'↔️', text:'Too close. Move back 1–2 metres.' },
  head_cut:     { icon:'⬇️', text:'Move down — your head is cut off.' },
}

const MEASUREMENT_BOUNDS = {
  bust:   [50, 200], waist:  [40, 180], hips:   [50, 200],
  height: [100, 250], weight: [30, 300],
}
function validateField(key, value) {
  if (!value) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Must be a number'
  const bounds = MEASUREMENT_BOUNDS[key]
  if (bounds && (n < bounds[0] || n > bounds[1])) return `${bounds[0]}–${bounds[1]}`
  return null
}

function ScanPanel() {
  const { updateProfile, detectorRef, modelState } = useFittingRoom()
  const videoRef        = useRef(null)
  const canvasRef       = useRef(null)
  const streamRef       = useRef(null)
  const animRef         = useRef(null)
  const swHistRef       = useRef([])
  const torsoHRef       = useRef(null)
  const prevKpsRef      = useRef(null)
  const skinDebounceRef = useRef(null)
  // Accumulate body-shape votes across frames
  const shapeVotesRef   = useRef({})
  const goodFrames      = useRef(0)

  const [activeTab,    setActiveTab   ] = useState('camera')
  const [camState,     setCamState    ] = useState('off')
  const [camError,     setCamError    ] = useState('')
  const [locked,       setLocked      ] = useState(false)
  const [confidence,   setConfidence  ] = useState(0)
  const [poseIssues,   setPoseIssues  ] = useState([])
  const [poseFound,    setPoseFound   ] = useState(false)
  const [detectedTone, setDetectedTone] = useState(null)
  // Live detected shape (voted across frames, shown in HUD)
  const [detectedShape,setDetectedShape] = useState(null)

  const [adjBust,  setAdjBust ] = useState('')
  const [adjWaist, setAdjWaist] = useState('')
  const [adjHips,  setAdjHips ] = useState('')

  const [mBust,   setMBust  ] = useState('')
  const [mWaist,  setMWaist ] = useState('')
  const [mHips,   setMHips  ] = useState('')
  const [mHeight, setMHeight] = useState('')
  const [mWeight, setMWeight] = useState('')
  const [mErrors, setMErrors] = useState({})

  const stopCamera = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    swHistRef.current = []; prevKpsRef.current = null; torsoHRef.current = null
    shapeVotesRef.current = {}; goodFrames.current = 0
    setCamState('off'); setPoseFound(false); setConfidence(0); setPoseIssues([])
  }, [])

  const startCamera = useCallback(async () => {
    setCamError(''); setCamState('starting')
    if (!navigator.mediaDevices?.getUserMedia) { setCamError('Camera not supported.'); setCamState('error'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width:{ideal:1280}, height:{ideal:720}, facingMode:'user', frameRate:{ideal:30} }, audio: false,
      })
      streamRef.current = stream; videoRef.current.srcObject = stream
      await new Promise((res, rej) => { videoRef.current.onloadedmetadata=res; setTimeout(()=>rej(new Error('timeout')),10000) })
      await videoRef.current.play(); setCamState('on')
    } catch (err) {
      let msg = 'Could not start camera.'
      if (err.name==='NotAllowedError') msg = 'Camera permission denied.'
      else if (err.name==='NotFoundError') msg = 'No camera found.'
      else if (err.name==='NotReadableError') msg = 'Camera in use by another app.'
      setCamError(msg); setCamState('error')
    }
  }, [])

  // Stop camera when tab is hidden (privacy fix)
  useEffect(() => {
    const onVis = () => { if (document.hidden && camState === 'on') stopCamera() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [camState, stopCamera])

  const detect = useCallback(async () => {
    const video=videoRef.current, canvas=canvasRef.current
    if (!video||!canvas||video.readyState<2){animRef.current=requestAnimationFrame(detect);return}
    if (!detectorRef.current){animRef.current=requestAnimationFrame(detect);return}
    const vw=video.videoWidth||640, vh=video.videoHeight||480
    canvas.width=vw; canvas.height=vh
    const ctx=canvas.getContext('2d')
    ctx.save();ctx.translate(vw,0);ctx.scale(-1,1);ctx.drawImage(video,0,0,vw,vh);ctx.restore()
    try {
      const poses=await detectorRef.current.estimatePoses(video)
      if (poses?.length>0) {
        let kps=poses[0].keypoints.map(k=>({...k,x:vw-k.x}))
        kps=smoothKps(prevKpsRef.current,kps); prevKpsRef.current=kps
        const analysis=analyzePose(kps,vw,vh)
        setPoseIssues(analysis.issues); setPoseFound(analysis.shouldersOk&&analysis.hipsOk)
        const ls=kps[KP.LS],rs=kps[KP.RS],lh=kps[KP.LH],rh=kps[KP.RH]
        if (analysis.shouldersOk&&analysis.hipsOk) {
          goodFrames.current=Math.min(goodFrames.current+1,24)
          const torsoH=mid(lh,rh).y-mid(ls,rs).y
          if (torsoH>20) {
            torsoHRef.current = torsoH
            const swPx=dist(ls,rs)
            swHistRef.current.push(swPx)
            if (swHistRef.current.length>24) swHistRef.current.shift()
            const avgSw=swHistRef.current.reduce((a,b)=>a+b,0)/swHistRef.current.length
            const pxPerCm = torsoH / 52
            const estBust  = Math.round(avgSw / pxPerCm * 1.92)
            const estWaist = Math.round(avgSw / pxPerCm * 1.56)
            const estHips  = Math.round((dist(lh,rh) / pxPerCm) * 1.08)
            const frames=goodFrames.current
            const conf=Math.min(Math.round(38+(frames/24)*47+(analysis.kneesOk?12:0)),92)
            setConfidence(conf)

            ctx.font='12px sans-serif'; ctx.fillStyle='rgba(93,202,165,.9)'
            ctx.fillText(`Bust ~${estBust}cm`,ls.x+4,ls.y-14)
            ctx.fillText(`Hips ~${estHips}cm`,lh.x+4,lh.y+18)

            // ── Body shape voting ──────────────────────────────────────────
            if (conf >= 55) {
              const shape = detectBodyShapeFromPose(kps, vw)
              if (shape) {
                shapeVotesRef.current[shape] = (shapeVotesRef.current[shape] || 0) + 1
                // Determine leading vote after ≥10 frames
                const votes = shapeVotesRef.current
                const totalVotes = Object.values(votes).reduce((a,b)=>a+b,0)
                if (totalVotes >= 10) {
                  const leading = Object.entries(votes).sort((a,b)=>b[1]-a[1])[0]
                  const leadingShare = leading[1] / totalVotes
                  if (leadingShare > 0.45) setDetectedShape(leading[0])
                }
              }
            }

            // ── Skin tone detection (debounced, coordinates already flipped) ─
            const nose=kps[KP.NOSE]
            if (nose?.score>0.4&&conf>=60) {
              clearTimeout(skinDebounceRef.current)
              skinDebounceRef.current=setTimeout(()=>{
                // kps are already flipped — sampleFaceRegion reads at nose.x/y directly
                const profile = detectSkinProfile(ctx, kps, vw, vh, KP)
                if (profile) setDetectedTone(profile)
              }, 2000)
            }
          }
        } else {
          goodFrames.current=Math.max(0,goodFrames.current-2); setConfidence(0)
        }
      } else {
        setPoseFound(false); setPoseIssues(['no_pose']); prevKpsRef.current=null; setConfidence(0)
      }
    } catch{}
    animRef.current=requestAnimationFrame(detect)
  }, [detectorRef])

  useEffect(() => {
    if (camState==='on') detect()
    else if (animRef.current) cancelAnimationFrame(animRef.current)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [camState, detect])

  useEffect(() => () => stopCamera(), [stopCamera])

  const lockMeasurement = useCallback(() => {
    if (!swHistRef.current.length) return
    const torsoH  = torsoHRef.current || 130
    const pxPerCm = torsoH / 52
    const avgSw   = swHistRef.current.reduce((a,b)=>a+b,0)/swHistRef.current.length
    const estBust  = Math.round(avgSw / pxPerCm * 1.92)
    const estWaist = Math.round(avgSw / pxPerCm * 1.56)
    const estHips  = Math.round(avgSw / pxPerCm * 2.15)
    setAdjBust(String(estBust)); setAdjWaist(String(estWaist)); setAdjHips(String(estHips))
    setLocked(true); stopCamera()
    const patch = {}
    if (detectedTone) { patch.skinTone = detectedTone.skinTone; patch.undertone = detectedTone.undertone }
    if (detectedShape) patch.bodyShape = detectedShape
    if (Object.keys(patch).length) updateProfile(patch)
  }, [stopCamera, detectedTone, detectedShape, updateProfile])

  const confirmMeasurements = useCallback(() => {
    updateProfile({
      bust:      parseFloat(adjBust)  || null,
      waist:     parseFloat(adjWaist) || null,
      hips:      parseFloat(adjHips)  || null,
      source:    'camera',
      ...(detectedTone  ? { skinTone: detectedTone.skinTone, undertone: detectedTone.undertone } : {}),
      ...(detectedShape ? { bodyShape: detectedShape } : {}),
    })
  }, [adjBust, adjWaist, adjHips, detectedTone, detectedShape, updateProfile])

  const confirmManual = useCallback(() => {
    const fields = { bust: mBust, waist: mWaist, hips: mHips, height: mHeight, weight: mWeight }
    const errors = {}
    for (const [k, v] of Object.entries(fields)) {
      const err = validateField(k, v); if (err) errors[k] = err
    }
    if (!mBust && !mWaist && !mHips) { setMErrors({ _form: 'Enter at least one of bust, waist, or hips.' }); return }
    if (Object.keys(errors).length) { setMErrors(errors); return }
    setMErrors({})
    updateProfile({
      bust: parseFloat(mBust)||null, waist: parseFloat(mWaist)||null,
      hips: parseFloat(mHips)||null, height: parseFloat(mHeight)||null,
      weight: parseFloat(mWeight)||null, source: 'manual',
    })
  }, [mBust,mWaist,mHips,mHeight,mWeight,updateProfile])

  const confColor = confidence>=70?'#1D9E75':confidence>=50?'#EF9F27':'#E24B4A'
  const issue = poseFound ? null : (poseIssues[0] ? GUIDANCE_MAP[poseIssues[0]] : null)
  const canScan = modelState === 'ready'
  const shapeInfo = detectedShape ? BODY_SHAPES.find(b=>b.id===detectedShape) : null
  const toneHex   = detectedTone ? SKIN_TONES.find(t=>t.id===detectedTone.skinTone)?.hex : null

  return (
    <div className="fr-panel-content">
      <div className="fr-tab-row">
        <button className={`fr-tab${activeTab==='camera'?' active':''}`} onClick={()=>setActiveTab('camera')}>📷 Camera scan</button>
        <button className={`fr-tab${activeTab==='manual'?' active':''}`} onClick={()=>setActiveTab('manual')}>✏️ Manual entry</button>
      </div>

      {activeTab==='camera' && (
        <div>
          <div className="fr-cam-area">
            <video ref={videoRef} playsInline muted style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',transform:'scaleX(-1)',opacity:0}}/>
            <canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',opacity:camState==='on'?1:0,transition:'opacity .3s'}}/>
            {camState!=='on'&&!locked&&(
              <div className="fr-cam-ph">
                <svg width="40" height="40" viewBox="0 0 80 80" fill="none" opacity=".4">
                  <rect x="8" y="22" width="64" height="44" rx="4" stroke="white" strokeWidth="1.5"/>
                  <circle cx="40" cy="44" r="12" stroke="white" strokeWidth="1.5"/>
                  <path d="M30 22l4-8h12l4 8" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
                <span style={{color:'rgba(255,255,255,.4)',fontSize:'12px'}}>
                  {modelState==='loading'?'Loading AI model…':modelState==='error'?'Model failed to load':'Camera off'}
                </span>
              </div>
            )}
            {camState==='on'&&(
              <div className="fr-cam-hud">
                <span className="fr-hud-dot" style={{background:confColor}}/>
                <span className="fr-hud-text">{issue?`${issue.icon} ${issue.text}`:confidence>0?'Hold still, calibrating…':'Detecting pose…'}</span>
                {confidence>0&&<span style={{color:confColor,fontWeight:600,fontSize:'12px'}}>{confidence}%</span>}
              </div>
            )}
            {/* Live detection badges */}
            {camState==='on'&&poseFound&&(
              <div className="fr-cam-badges">
                {detectedShape&&(
                  <span className="fr-cam-badge fr-cam-badge--shape">
                    {shapeInfo?.icon||'👤'} {detectedShape}
                  </span>
                )}
                {detectedTone&&(
                  <span className="fr-cam-badge fr-cam-badge--tone">
                    <span style={{display:'inline-block',width:'10px',height:'10px',borderRadius:'50%',background:toneHex,verticalAlign:'middle',marginRight:'4px'}}/>
                    {detectedTone.skinTone}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* What the camera detects — info strip */}
          <div className="fr-scan-detects">
            <span className="fr-detect-item">📐 Measurements</span>
            <span className="fr-detect-item">👤 Body shape</span>
            <span className="fr-detect-item">🎨 Skin tone</span>
          </div>

          <div className="fr-scan-body">
            {!locked ? (
              <>
                <p className="fr-scan-tip">Stand 1.5–2 m away, arms slightly out, full body visible. The camera will detect your measurements, body shape, and skin tone automatically.</p>
                {camError&&<div className="fr-alert fr-alert--err">{camError}</div>}
                {modelState==='error'&&<div className="fr-alert fr-alert--err">AI model failed to load. Try refreshing the page.</div>}
                <div className="fr-btn-row">
                  {camState!=='on'?(
                    <button className="fr-btn fr-btn--primary" onClick={startCamera}
                      disabled={camState==='starting'||!canScan}>
                      {camState==='starting'?<><span className="fr-spin"/>Starting…</>
                       :modelState==='loading'?<><span className="fr-spin"/>Loading model…</>
                       :'▶ Start scan'}
                    </button>
                  ):(
                    <>
                      <button className="fr-btn fr-btn--primary" onClick={lockMeasurement} disabled={confidence<50}>
                        📐 Lock ({confidence}%)
                      </button>
                      <button className="fr-btn fr-btn--ghost" onClick={stopCamera}>■ Stop</button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div>
                <div className="fr-locked-header">
                  <span className="fr-badge fr-badge--ok">✓ Captured</span>
                  <div className="fr-locked-detections">
                    {detectedTone&&(
                      <span className="fr-tone-detected">
                        <span className="fr-tone-dot" style={{background:toneHex}}/>
                        {detectedTone.skinTone} · {detectedTone.undertone}
                      </span>
                    )}
                    {detectedShape&&(
                      <span className="fr-tone-detected">
                        {shapeInfo?.icon||'👤'} {detectedShape}
                      </span>
                    )}
                  </div>
                </div>
                <div className="fr-field-row">
                  {[['Bust',adjBust,setAdjBust],['Waist',adjWaist,setAdjWaist],['Hips',adjHips,setAdjHips]].map(([l,v,s])=>(
                    <div key={l} className="fr-field">
                      <label>{l} (cm)</label>
                      <input type="number" value={v} onChange={e=>s(e.target.value)}/>
                    </div>
                  ))}
                </div>
                <p className="fr-note">Camera estimates carry ±4–6 cm variance. Confirm with a tape measure for bridal orders.</p>
                <div className="fr-btn-row">
                  <button className="fr-btn fr-btn--ghost" onClick={()=>{setLocked(false);setConfidence(0);shapeVotesRef.current={}}}>↩ Retake</button>
                  <button className="fr-btn fr-btn--primary" onClick={confirmMeasurements}>Apply →</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab==='manual' && (
        <div className="fr-scan-body">
          {mErrors._form&&<div className="fr-alert fr-alert--err">{mErrors._form}</div>}
          <div className="fr-field-row">
            <div className="fr-field">
              <label>Bust (cm)</label>
              <input type="number" value={mBust} onChange={e=>{setMBust(e.target.value);setMErrors(p=>({...p,bust:undefined,_form:undefined}))}} placeholder="e.g. 88"/>
              {mErrors.bust&&<span className="fr-field-err">{mErrors.bust}</span>}
            </div>
            <div className="fr-field">
              <label>Waist (cm)</label>
              <input type="number" value={mWaist} onChange={e=>{setMWaist(e.target.value);setMErrors(p=>({...p,waist:undefined,_form:undefined}))}} placeholder="e.g. 70"/>
              {mErrors.waist&&<span className="fr-field-err">{mErrors.waist}</span>}
            </div>
          </div>
          <div className="fr-field-row">
            <div className="fr-field">
              <label>Hips (cm)</label>
              <input type="number" value={mHips} onChange={e=>{setMHips(e.target.value);setMErrors(p=>({...p,hips:undefined,_form:undefined}))}} placeholder="e.g. 95"/>
              {mErrors.hips&&<span className="fr-field-err">{mErrors.hips}</span>}
            </div>
            <div className="fr-field">
              <label>Height (cm)</label>
              <input type="number" value={mHeight} onChange={e=>{setMHeight(e.target.value);setMErrors(p=>({...p,height:undefined}))}} placeholder="e.g. 162"/>
              {mErrors.height&&<span className="fr-field-err">{mErrors.height}</span>}
            </div>
          </div>
          <div className="fr-field-row fr-field-row--half">
            <div className="fr-field">
              <label>Weight (kg)</label>
              <input type="number" value={mWeight} onChange={e=>{setMWeight(e.target.value);setMErrors(p=>({...p,weight:undefined}))}} placeholder="e.g. 58"/>
              {mErrors.weight&&<span className="fr-field-err">{mErrors.weight}</span>}
            </div>
          </div>
          <button className="fr-btn fr-btn--primary" onClick={confirmManual}>Apply measurements →</button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SIZE PANEL
// ─────────────────────────────────────────────────────────────────────────────

function SizePanel() {
  const { profile, sizeResult, sizes, supplierName } = useFittingRoom()
  const scoreConf  = sizeResult ? Math.min(95, Math.max(10, Math.round(100 - sizeResult.score * 3))) : 0
  const scoreColor = scoreConf>=75?'#1D9E75':scoreConf>=55?'#EF9F27':'#E24B4A'

  if (!profile.bust && !profile.waist && !profile.hips) {
    return (
      <div className="fr-panel-empty">
        <p className="fr-empty-icon">📏</p>
        <p className="fr-empty-title">No measurements yet</p>
        <p className="fr-empty-sub">Use the Scan panel to capture your measurements and we'll find your size instantly.</p>
      </div>
    )
  }

  if (!sizeResult) {
    return <div className="fr-panel-empty"><p className="fr-empty-sub">Calculating…</p></div>
  }

  return (
    <div className="fr-panel-content">
      <div className="fr-size-hero">
        <div>
          <p className="fr-size-hero-label">Recommended size</p>
          <p className="fr-size-hero-value">{sizeResult.size?.label ?? '—'}</p>
          <p className="fr-size-hero-supplier">{supplierName || 'Standard'} size chart</p>
        </div>
        <div className="fr-size-conf-block">
          <p className="fr-size-hero-label">Match confidence</p>
          <p className="fr-size-conf-pct" style={{color:scoreColor}}>{scoreConf}%</p>
        </div>
      </div>
      <div className="fr-conf-bar-wrap">
        <div className="fr-conf-bar-track">
          <div className="fr-conf-bar-fill" style={{width:`${scoreConf}%`,background:scoreColor}}/>
        </div>
      </div>
      <div className="fr-size-section">
        <p className="fr-size-section-label">Size range</p>
        <div className="fr-size-pills">
          {sizeResult.adjacent.map(sz=>(
            <span key={sz.label} className={`fr-size-pill-lg${sz.label===sizeResult.size?.label?' match':''}`}>{sz.label}</span>
          ))}
        </div>
      </div>
      <div className="fr-size-section">
        <p className="fr-size-section-label">Your measurements</p>
        <div className="fr-meas-grid-lg">
          {[['Bust',profile.bust,'cm'],['Waist',profile.waist,'cm'],['Hips',profile.hips,'cm'],
            ['Height',profile.height,'cm'],['Weight',profile.weight,'kg']].filter(([,v])=>v).map(([l,v,u])=>(
            <div key={l} className="fr-meas-box">
              <span className="fr-meas-box-label">{l}</span>
              <span className="fr-meas-box-val">{v} <span className="fr-meas-box-unit">{u}</span></span>
              <span className="fr-meas-box-src">{profile.source}</span>
            </div>
          ))}
        </div>
      </div>
      {sizeResult.size && (
        <div className="fr-size-chart-ref">
          <p className="fr-size-section-label">{supplierName||'Standard'} chart for {sizeResult.size.label}</p>
          <div className="fr-chart-row">
            {sizeResult.size.bust_min!=null&&<span>Bust {sizeResult.size.bust_min}–{sizeResult.size.bust_max} cm</span>}
            {sizeResult.size.waist_min!=null&&<span>Waist {sizeResult.size.waist_min}–{sizeResult.size.waist_max} cm</span>}
            {sizeResult.size.hip_min!=null&&<span>Hips {sizeResult.size.hip_min}–{sizeResult.size.hip_max} cm</span>}
          </div>
        </div>
      )}
      {sizeResult.score>5&&(
        <div className="fr-alert fr-alert--warn">
          You're near a size boundary. For bridal gowns, size up when in doubt — it's easier to take in than let out.
        </div>
      )}
      {profile.source==='camera'&&(
        <p className="fr-note">Camera estimates carry ±4–6 cm variance. Confirm with a tape measure for bridal orders.</p>
      )}
      <div className="fr-size-section">
        <p className="fr-size-section-label">Full size chart</p>
        <div className="fr-full-chart">
          <div className="fr-chart-header"><span>Size</span><span>Bust</span><span>Waist</span><span>Hips</span></div>
          {sizes.map(sz=>(
            <div key={sz.label} className={`fr-chart-row-item${sz.label===sizeResult.size?.label?' fr-chart-row-item--match':''}`}>
              <span className="fr-chart-size-label">{sz.label}</span>
              <span>{sz.bust_min}–{sz.bust_max}</span>
              <span>{sz.waist_min}–{sz.waist_max}</span>
              <span>{sz.hip_min}–{sz.hip_max}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BODY SHAPE PICKER — with illustrated SVG silhouettes
// ─────────────────────────────────────────────────────────────────────────────

const SHAPE_SVGS = {
  hourglass: (
    <svg viewBox="0 0 40 80" fill="none" className="fr-shape-svg">
      <ellipse cx="20" cy="12" rx="10" ry="8" fill="currentColor" opacity=".18"/>
      <path d="M10 20 Q6 40 10 50 Q14 58 20 60 Q26 58 30 50 Q34 40 30 20" fill="currentColor" opacity=".55"/>
      <ellipse cx="20" cy="62" rx="11" ry="7" fill="currentColor" opacity=".25"/>
    </svg>
  ),
  pear: (
    <svg viewBox="0 0 40 80" fill="none" className="fr-shape-svg">
      <ellipse cx="20" cy="12" rx="8" ry="7" fill="currentColor" opacity=".18"/>
      <path d="M12 20 Q9 36 9 46 Q9 58 20 62 Q31 58 31 46 Q31 36 28 20" fill="currentColor" opacity=".55"/>
    </svg>
  ),
  apple: (
    <svg viewBox="0 0 40 80" fill="none" className="fr-shape-svg">
      <ellipse cx="20" cy="12" rx="9" ry="7" fill="currentColor" opacity=".18"/>
      <path d="M11 20 Q7 34 9 44 Q11 56 20 60 Q29 56 31 44 Q33 34 29 20" fill="currentColor" opacity=".55"/>
      <ellipse cx="20" cy="34" rx="12" ry="8" fill="currentColor" opacity=".20"/>
    </svg>
  ),
  rectangle: (
    <svg viewBox="0 0 40 80" fill="none" className="fr-shape-svg">
      <ellipse cx="20" cy="12" rx="9" ry="7" fill="currentColor" opacity=".18"/>
      <path d="M11 20 L11 58 Q20 62 29 58 L29 20 Z" fill="currentColor" opacity=".55"/>
    </svg>
  ),
  invertedTriangle: (
    <svg viewBox="0 0 40 80" fill="none" className="fr-shape-svg">
      <ellipse cx="20" cy="12" rx="9" ry="7" fill="currentColor" opacity=".18"/>
      <path d="M8 20 L32 20 Q30 40 26 52 Q23 60 20 62 Q17 60 14 52 Q10 40 8 20 Z" fill="currentColor" opacity=".55"/>
    </svg>
  ),
  petite: (
    <svg viewBox="0 0 40 70" fill="none" className="fr-shape-svg">
      <ellipse cx="20" cy="10" rx="8" ry="7" fill="currentColor" opacity=".18"/>
      <path d="M12 18 Q9 32 11 44 Q14 54 20 56 Q26 54 29 44 Q31 32 28 18" fill="currentColor" opacity=".55"/>
    </svg>
  ),
  tall: (
    <svg viewBox="0 0 40 90" fill="none" className="fr-shape-svg">
      <ellipse cx="20" cy="10" rx="8" ry="7" fill="currentColor" opacity=".18"/>
      <path d="M12 18 Q9 38 11 55 Q14 70 20 74 Q26 70 29 55 Q31 38 28 18" fill="currentColor" opacity=".55"/>
    </svg>
  ),
}

function BodyShapePicker({ selected, onChange }) {
  return (
    <div className="fr-shape-grid">
      {BODY_SHAPES.map(s => (
        <button
          key={s.id}
          className={`fr-shape-card${selected===s.id?' sel':''}`}
          onClick={() => onChange(s.id)}
          aria-pressed={selected===s.id}
          title={s.desc}>
          <div className="fr-shape-figure" style={{color: selected===s.id?'#c9a96e':'#bbb'}}>
            {SHAPE_SVGS[s.id]}
          </div>
          <span className="fr-shape-card-label">{s.label}</span>
          <span className="fr-shape-card-desc">{s.desc}</span>
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SKIN TONE PICKER — visual swatches with undertone + description
// ─────────────────────────────────────────────────────────────────────────────

const TONE_DESCRIPTIONS = {
  fair:   'Very light, burns easily',
  light:  'Light, sometimes freckles',
  medium: 'Medium beige, tans moderately',
  olive:  'Olive, tans easily',
  tan:    'Tan / caramel, tans well',
  deep:   'Deep brown, rarely burns',
  ebony:  'Very deep, richly pigmented',
}

const UNDERTONE_DESCRIPTIONS = {
  warm:    'Golden, peachy or yellow hues',
  cool:    'Pink, red or bluish hues',
  neutral: 'Mix of warm & cool',
}

function SkinTonePicker({ selectedTone, selectedUndertone, onToneChange, onUndertoneChange }) {
  return (
    <div>
      <div className="fr-tone-grid">
        {SKIN_TONES.map(t => (
          <button
            key={t.id}
            className={`fr-tone-card${selectedTone===t.id?' sel':''}`}
            onClick={() => onToneChange(t.id)}
            aria-pressed={selectedTone===t.id}
            aria-label={`${t.label}: ${TONE_DESCRIPTIONS[t.id]}`}
            title={TONE_DESCRIPTIONS[t.id]}>
            <span className="fr-tone-swatch-lg" style={{background:t.hex}}/>
            <span className="fr-tone-card-label">{t.label}</span>
            <span className="fr-tone-card-desc">{TONE_DESCRIPTIONS[t.id]}</span>
          </button>
        ))}
      </div>
      <p className="fr-style-section-title" style={{marginTop:'14px',marginBottom:'8px'}}>Undertone</p>
      <div className="fr-undertone-cards">
        {UNDERTONES.map(u => (
          <button
            key={u.id}
            className={`fr-undertone-card${selectedUndertone===u.id?' sel':''}`}
            onClick={() => onUndertoneChange(u.id)}
            aria-pressed={selectedUndertone===u.id}>
            <span className="fr-undertone-swatch" style={{background:u.hex}}/>
            <div>
              <span className="fr-undertone-card-label">{u.label}</span>
              <span className="fr-undertone-card-desc">{UNDERTONE_DESCRIPTIONS[u.id]}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLE PANEL
// ─────────────────────────────────────────────────────────────────────────────

function StylePanel() {
  const { profile, updateProfile, styleResults } = useFittingRoom()
  const [refineOpen, setRefineOpen] = useState(false)

  function set(key, val) { updateProfile({ [key]: val }) }
  function toggleMulti(key, val, max=4) {
    const arr = profile[key]||[]
    if (arr.includes(val)) updateProfile({ [key]: arr.filter(v=>v!==val) })
    else if (arr.length < max) updateProfile({ [key]: [...arr, val] })
  }

  return (
    <div className="fr-panel-content">
      {/* Body shape */}
      <div className="fr-style-section">
        <p className="fr-style-section-title">Body shape</p>
        {profile.bodyShape && (
          <p className="fr-scan-detected-note">
            🎯 Auto-detected from camera scan — adjust if needed
          </p>
        )}
        <BodyShapePicker selected={profile.bodyShape} onChange={v=>set('bodyShape',v)}/>
      </div>

      {/* Skin tone */}
      <div className="fr-style-section">
        <p className="fr-style-section-title">Skin tone &amp; undertone</p>
        {(profile.skinTone || profile.undertone) && (
          <p className="fr-scan-detected-note">
            🎨 Auto-detected from camera scan — adjust if needed
          </p>
        )}
        <SkinTonePicker
          selectedTone={profile.skinTone}
          selectedUndertone={profile.undertone}
          onToneChange={v=>set('skinTone',v)}
          onUndertoneChange={v=>set('undertone',v)}
        />
      </div>

      {/* Occasion */}
      <div className="fr-style-section">
        <p className="fr-style-section-title">Occasion</p>
        <div className="fr-occasion-row">
          {OCCASIONS.map(o=>(
            <button key={o.id} className={`fr-occasion-btn${profile.occasion===o.id?' sel':''}`}
              onClick={()=>set('occasion',o.id)} aria-pressed={profile.occasion===o.id}>
              <span className="fr-occasion-icon">{o.icon}</span>
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Refine */}
      <div className="fr-refine-toggle" onClick={()=>setRefineOpen(v=>!v)} role="button" tabIndex={0}
        onKeyDown={e=>(e.key==='Enter'||e.key===' ')&&setRefineOpen(v=>!v)}>
        <span>⚙️ Refine preferences</span>
        <span className={`fr-refine-arrow${refineOpen?' open':''}`}>▾</span>
      </div>

      {refineOpen && (
        <div className="fr-refine-content">
          <div className="fr-style-section">
            <p className="fr-style-section-title">Preferred colors</p>
            <div className="fr-color-row">
              {COLOR_OPTIONS.map(c=>(
                <button key={c.id} className={`fr-color-btn${(profile.colors||[]).includes(c.id)?' sel':''}`}
                  onClick={()=>toggleMulti('colors',c.id,4)} aria-label={c.id} aria-pressed={(profile.colors||[]).includes(c.id)} title={c.id}>
                  <span className="fr-color-swatch" style={{background:c.hex}}/>
                  <span>{c.id}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="fr-style-section">
            <p className="fr-style-section-title">Preferred fabrics</p>
            <div className="fr-fabric-row">
              {FABRIC_OPTIONS.map(f=>(
                <button key={f} className={`fr-fabric-btn${(profile.fabrics||[]).includes(f)?' sel':''}`}
                  onClick={()=>toggleMulti('fabrics',f,6)} aria-pressed={(profile.fabrics||[]).includes(f)}>{f}</button>
              ))}
            </div>
          </div>
          <div className="fr-style-section">
            <p className="fr-style-section-title">Budget</p>
            <div className="fr-budget-row">
              {BUDGET_RANGES.map(b=>(
                <button key={b.id} className={`fr-budget-btn${profile.budget===b.id?' sel':''}`}
                  onClick={()=>set('budget',b.id)} aria-pressed={profile.budget===b.id}>{b.label}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!profile.bodyShape && (
        <div className="fr-style-empty">
          <p>Select your body shape above to see gown recommendations.</p>
        </div>
      )}
      {profile.bodyShape && !styleResults?.length && (
        <div className="fr-style-empty">
          <p>No matches found. Try relaxing your budget or occasion filter.</p>
        </div>
      )}
      {styleResults?.length > 0 && (
        <div className="fr-style-results">
          <p className="fr-results-label">{styleResults.length} matches · updates as you refine</p>
          <div className="fr-gown-grid">
            {styleResults.map((g, i) => {
              const displayScore = normaliseScore(g._score)
              return (
                <div key={g.id} className="fr-gown-card" style={{animationDelay:`${i*0.05}s`}}>
                  <div className="fr-gown-img">
                    <img src={g.image} alt={g.alt||g.name}/>
                    {i===0&&<span className="fr-gown-badge">Best match</span>}
                    <span className="fr-gown-rank">#{i+1}</span>
                  </div>
                  <div className="fr-gown-info">
                    <p className="fr-gown-name">{g.name}</p>
                    <p className="fr-gown-price">{g.price}</p>
                    {g.silhouette&&<p className="fr-gown-meta">{g.silhouette}{g.color?` · ${g.color}`:''}</p>}
                    <div className="fr-gown-reasons">
                      {g._reasons.slice(0,2).map((r,j)=>(
                        <div key={j} className="fr-gown-reason"><span className="fr-reason-dot"/>{r}</div>
                      ))}
                    </div>
                    <div className="fr-score-row">
                      <div className="fr-score-bar"><div className="fr-score-fill" style={{width:`${displayScore}%`}}/></div>
                      <span className="fr-score-pct">{displayScore}%</span>
                    </div>
                    <div className="fr-gown-actions">
                      <Link href={`/gowns/${g.id}`} className="fr-gown-btn fr-gown-btn--ghost">Details</Link>
                      <Link href={`/fitting-room?gown=${g.id}`} className="fr-gown-btn fr-gown-btn--primary">Try on →</Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TRY-ON PANEL — uses shared TryOnCamera component
// ─────────────────────────────────────────────────────────────────────────────

function TryOnPanel({ initialGownId }) {
  const { gowns, detectorRef, segmenterRef, modelState } = useFittingRoom()
  const [selectedGown, setSelectedGown] = useState(null)
  const [saving,       setSaving      ] = useState(false)
  const [saveMsg,      setSaveMsg     ] = useState('')
  const [captured,     setCaptured    ] = useState(null)

  useEffect(() => {
    if (!gowns.length) return
    const chosen = (initialGownId ? gowns.find(g=>String(g.id)===String(initialGownId)) : null) || gowns[0]
    setSelectedGown(chosen)
  }, [gowns, initialGownId])

  const saveTryon = useCallback(async (imageDataUrl) => {
    const user = getCurrentUser()
    if (!user) { setSaveMsg('Sign in to save your try-on.'); return }
    setSaving(true); setSaveMsg('')
    try {
      const res = await fetch('/api/auth/save-tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({ image: imageDataUrl, gownId: selectedGown?.id, gownName: selectedGown?.name || '' }),
      })
      const d = await res.json()
      setSaveMsg(d.ok ? '✓ Saved to your profile' : (d.error || 'Save failed'))
    } catch { setSaveMsg('Could not save. Check connection.') }
    finally { setSaving(false) }
  }, [selectedGown])

  return (
    <div className="fr-tryon-layout">
      <TryOnCamera
        gown={selectedGown}
        gowns={gowns}
        onGownChange={setSelectedGown}
        externalDetector={detectorRef}
        externalSegmenter={segmenterRef}
        modelState={modelState}
      />
      {saveMsg && (
        <p className={`fr-save-msg${saveMsg.startsWith('✓')?' ok':' err'}`} style={{padding:'4px 12px',fontSize:'12px'}}>{saveMsg}</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SKELETON LOADER
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonLoader() {
  return (
    <main style={{minHeight:'100vh',background:'#faf9f7'}}>
      <div style={{height:'72px',background:'#1a1108'}}/>
      <div style={{background:'#1a1108',padding:'2.5rem 1.5rem 2rem'}}>
        <div className="sk-line" style={{width:'80px',height:'10px',marginBottom:'12px'}}/>
        <div className="sk-line" style={{width:'340px',height:'36px',marginBottom:'12px'}}/>
        <div className="sk-line" style={{width:'420px',height:'13px'}}/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'240px 1fr',maxWidth:'1160px',margin:'0 auto'}}>
        <div style={{padding:'1.25rem',borderRight:'1px solid #eee',display:'flex',flexDirection:'column',gap:'12px'}}>
          <div className="sk-line" style={{height:'14px',width:'80px'}}/>
          <div className="sk-line" style={{height:'80px'}}/>
          <div className="sk-line" style={{height:'60px'}}/>
        </div>
        <div style={{padding:'1.25rem',display:'flex',flexDirection:'column',gap:'12px'}}>
          <div style={{display:'flex',gap:'8px'}}>
            {[1,2,3,4].map(i=><div key={i} className="sk-line" style={{flex:1,height:'72px',borderRadius:'8px'}}/>)}
          </div>
          <div className="sk-line" style={{height:'320px',borderRadius:'10px'}}/>
        </div>
      </div>
      <style>{`
        .sk-line { background:linear-gradient(90deg,#e8e3db 25%,#f5f0e8 50%,#e8e3db 75%);
          background-size:200% 100%; animation:sk-shimmer 1.4s ease-in-out infinite; border-radius:6px; }
        @keyframes sk-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL NAV — redesigned tab bar with emoji icons + active indicator
// ─────────────────────────────────────────────────────────────────────────────

const PANELS = [
  { id:'scan',   label:'Scan',   icon:'📷', sub:'Measure & detect' },
  { id:'size',   label:'Size',   icon:'📐', sub:'Find your fit'    },
  { id:'style',  label:'Style',  icon:'✨', sub:'Gown matches'     },
  { id:'tryon',  label:'Try On', icon:'👗', sub:'See it on you'    },
]

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE INNER
// ─────────────────────────────────────────────────────────────────────────────

function FittingRoomInner() {
  const searchParams = useSearchParams()
  const gownId       = searchParams.get('gown')
  const { profile, sizeResult, updateProfile } = useFittingRoom()
  const [activePanel, setActivePanel] = useState(gownId ? 'tryon' : 'scan')
  const [mounted,     setMounted    ] = useState(false)
  const [saving,      setSaving     ] = useState(false)
  const [saveMsg,     setSaveMsg    ] = useState('')
  const user = mounted ? getCurrentUser() : null

  useEffect(() => {
    setMounted(true)
    if (typeof window === 'undefined') return
    const u = getCurrentUser()
    if (!u) return
    fetch('/api/measurements', { headers: { 'x-user-id': u.id } })
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.measurements) {
          const m = d.measurements
          updateProfile({ bust: m.bust_cm, waist: m.waist_cm, hips: m.hips_cm, height: m.height_cm, weight: m.weight_kg, source: m.source })
        }
      }).catch(() => {})
    fetch('/api/auth/style-prefs', { headers: { 'x-user-id': u.id } })
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.prefs) {
          const p = d.prefs
          updateProfile({ bodyShape: p.bodyType||null, skinTone: p.skinTone||null, occasion: p.styleTags?.[0]||null, colors: p.preferredColors||[] })
        }
      }).catch(() => {})
  }, [updateProfile])

  const saveProfile = useCallback(async () => {
    if (!user || !profile) return
    setSaving(true); setSaveMsg('')
    try {
      const [measRes, styleRes] = await Promise.all([
        fetch('/api/measurements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
          body: JSON.stringify({ bust_cm: profile.bust??null, waist_cm: profile.waist??null, hips_cm: profile.hips??null, height_cm: profile.height??null, weight_kg: profile.weight??null, source: profile.source??'manual' }),
        }).then(r=>r.json()),
        fetch('/api/auth/save-style-prefs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
          body: JSON.stringify({ bodyType: profile.bodyShape||null, skinTone: profile.skinTone||null, styleTags: profile.occasion?[profile.occasion]:[], preferredSilhouettes: [], preferredColors: profile.colors||[] }),
        }).then(r=>r.json()),
      ])
      if (measRes.ok && styleRes.ok) setSaveMsg('✓ Profile saved')
      else setSaveMsg(measRes.error || styleRes.error || 'Save failed')
    } catch { setSaveMsg('Could not save. Check connection.') }
    finally { setSaving(false) }
  }, [user, profile])

  if (!mounted) return null

  return (
    <main className="fr-page">
      <Header solid/>
      <div className="fr-spacer"/>

      <section className="fr-hero">
        <div className="fr-hero-inner">
          <span className="fr-eyebrow">Fitting Room</span>
          <h1 className="fr-h1">Your personal <em>fitting room</em></h1>
          <p className="fr-hero-sub">Scan your measurements, find your size, get style matches, and try on gowns — all in one place.</p>
        </div>
      </section>

      <div className="fr-layout">
        <ProfileSidebar user={user} onSave={saveProfile} saving={saving} saveMsg={saveMsg}/>

        <div className="fr-main">
          {/* ── Redesigned panel nav ── */}
          <nav className="fr-panel-nav" aria-label="Fitting room sections">
            {PANELS.map((p, i) => {
              const isActive = activePanel === p.id
              const hasBadge = (p.id==='size'&&sizeResult?.size) || (p.id==='scan'&&profile.bust)
              return (
                <button key={p.id}
                  className={`fr-panel-tab${isActive?' active':''}`}
                  onClick={() => setActivePanel(p.id)}
                  aria-selected={isActive} role="tab">
                  <span className="fr-tab-step">{i + 1}</span>
                  <span className="fr-tab-icon">{p.icon}</span>
                  <div className="fr-tab-text">
                    <span className="fr-tab-label">{p.label}</span>
                    <span className="fr-tab-sub">{p.sub}</span>
                  </div>
                  {hasBadge && (
                    <span className="fr-panel-badge">
                      {p.id==='size' ? sizeResult.size.label : '✓'}
                    </span>
                  )}
                  {isActive && <span className="fr-tab-active-bar"/>}
                </button>
              )
            })}
          </nav>

          <div className="fr-panel-body" role="tabpanel">
            {activePanel==='scan'  && <ScanPanel/>}
            {activePanel==='size'  && <SizePanel/>}
            {activePanel==='style' && <StylePanel/>}
            {activePanel==='tryon' && <TryOnPanel initialGownId={gownId}/>}
          </div>
        </div>
      </div>

      <Footer/>

      <style suppressHydrationWarning>{`
        /* ── Page shell ────────────────────────────────────────────────── */
        .fr-page { min-height:100vh; display:flex; flex-direction:column; background:#faf9f7; }
        .fr-spacer { height:72px; }

        /* ── Hero ──────────────────────────────────────────────────────── */
        .fr-hero { background:#2c1a0e; padding:2rem 2.5rem; }
        .fr-hero-inner { max-width:680px; margin:0 auto; }
        .fr-eyebrow { font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:#c9a96e; display:block; margin-bottom:8px; font-weight:500; }
        .fr-h1 { font-size:clamp(1.8rem,3.5vw,2.4rem); font-weight:400; color:#faf9f7; margin:0 0 8px; line-height:1.12; font-family:'Georgia',serif; }
        .fr-h1 em { font-style:italic; color:#c9a96e; }
        .fr-hero-sub { font-size:13px; color:rgba(250,249,247,.55); line-height:1.65; max-width:520px; }

        /* ── Layout ────────────────────────────────────────────────────── */
        .fr-layout { display:grid; grid-template-columns:240px 1fr; gap:0; max-width:1160px; margin:0 auto; width:100%; min-height:calc(100vh - 200px); }

        /* ── Sidebar ───────────────────────────────────────────────────── */
        .fr-sidebar { background:#fff; border-right:1px solid #eee; padding:1.25rem; display:flex; flex-direction:column; gap:0; position:sticky; top:72px; height:calc(100vh - 72px); overflow-y:auto; }
        .fr-sidebar-header { padding-bottom:1rem; border-bottom:1px solid #f0ede8; }
        .fr-sidebar-eyebrow { font-size:10px; letter-spacing:.35em; text-transform:uppercase; color:#c9a96e; display:block; }
        .fr-sidebar-user { font-size:12px; color:#888; display:block; margin-top:2px; }
        .fr-sidebar-section { padding:1rem 0; border-bottom:1px solid #f0ede8; }
        .fr-sidebar-label { font-size:10px; letter-spacing:.2em; text-transform:uppercase; color:#aaa; margin-bottom:8px; }
        .fr-sidebar-empty { font-size:12px; color:#bbb; line-height:1.5; }
        .fr-sidebar-manual { background:#faf9f7; border-radius:8px; padding:10px; margin-top:4px; }
        .fr-meas-grid { display:flex; flex-direction:column; gap:4px; }
        .fr-meas-chip { display:flex; justify-content:space-between; font-size:12px; padding:4px 0; }
        .fr-meas-key { color:#999; }
        .fr-meas-val { font-weight:500; color:#333; }
        .fr-sidebar-size { background:linear-gradient(135deg,#faf6ee,#fff); border-radius:10px; padding:12px; margin:4px -4px; }
        .fr-size-display { display:flex; align-items:flex-end; justify-content:space-between; margin-bottom:8px; }
        .fr-size-label { font-size:2.2rem; font-weight:300; color:#1a1108; font-family:'Georgia',serif; line-height:1; }
        .fr-size-conf { display:flex; align-items:center; gap:6px; margin-top:4px; }
        .fr-conf-bar { flex:1; height:3px; background:#eee; border-radius:2px; overflow:hidden; min-width:60px; }
        .fr-conf-fill { height:100%; border-radius:2px; transition:width .4s; }
        .fr-size-range { display:flex; gap:4px; flex-wrap:wrap; }
        .fr-size-pill { padding:3px 10px; border-radius:20px; font-size:11px; border:1px solid #ddd; color:#888; }
        .fr-size-pill--match { background:#fff8ee; border-color:#c9a96e; color:#7a5a1a; }
        .fr-profile-chips { display:flex; flex-wrap:wrap; gap:4px; }
        .fr-chip { font-size:10px; padding:3px 8px; border-radius:20px; background:#f0ede8; color:#666; display:flex; align-items:center; gap:4px; }
        .fr-chip-swatch { width:10px; height:10px; border-radius:50%; }
        .fr-save-btn { width:100%; padding:9px; background:#1a1108; color:#faf9f7; border:none; border-radius:8px; font-size:12px; font-weight:500; cursor:pointer; transition:background .2s; }
        .fr-save-btn:hover:not(:disabled) { background:#3d2c14; }
        .fr-save-btn:disabled { opacity:.5; cursor:not-allowed; }
        .fr-save-msg { font-size:11px; margin-top:4px; }
        .fr-save-msg.ok { color:#1D9E75; }
        .fr-save-msg.err { color:#A32D2D; }
        .fr-manual-grid { display:flex; flex-direction:column; gap:6px; }
        .fr-manual-field { display:flex; align-items:center; gap:6px; font-size:11px; color:#888; }
        .fr-manual-field span:first-child { width:38px; flex-shrink:0; }
        .fr-manual-field input { flex:1; padding:5px 8px; border:1px solid #e0ddd8; border-radius:6px; font-size:12px; background:#fff; min-width:0; }
        .fr-manual-field input:focus { outline:none; border-color:#c9a96e; }
        .fr-manual-unit { color:#bbb; font-size:10px; }

        /* ── Redesigned panel nav ──────────────────────────────────────── */
        .fr-main { display:flex; flex-direction:column; min-height:0; }
        .fr-panel-nav {
          display:flex; background:#fff; border-bottom:2px solid #f0ede8;
          position:sticky; top:72px; z-index:10; overflow-x:auto;
        }
        .fr-panel-nav::-webkit-scrollbar { display:none; }
        .fr-panel-tab {
          flex:1; min-width:100px; padding:14px 10px 12px;
          border:none; background:none; cursor:pointer;
          display:flex; align-items:center; gap:8px;
          position:relative; transition:background .15s;
          border-bottom:3px solid transparent;
          margin-bottom:-2px;
        }
        .fr-panel-tab:hover { background:#faf9f7; }
        .fr-panel-tab.active { background:#fff8ee; border-bottom-color:#c9a96e; }
        .fr-tab-step {
          width:20px; height:20px; border-radius:50%; border:1.5px solid #ddd;
          display:flex; align-items:center; justify-content:center;
          font-size:10px; color:#aaa; flex-shrink:0; font-weight:600;
          transition:all .15s;
        }
        .fr-panel-tab.active .fr-tab-step {
          background:#c9a96e; border-color:#c9a96e; color:#fff;
        }
        .fr-tab-icon { font-size:18px; flex-shrink:0; }
        .fr-tab-text { display:flex; flex-direction:column; align-items:flex-start; min-width:0; }
        .fr-tab-label { font-size:12px; font-weight:600; color:#888; white-space:nowrap; }
        .fr-panel-tab.active .fr-tab-label { color:#1a1108; }
        .fr-tab-sub { font-size:10px; color:#bbb; white-space:nowrap; }
        .fr-panel-tab.active .fr-tab-sub { color:#c9a96e; }
        .fr-panel-badge {
          position:absolute; top:8px; right:6px;
          font-size:9px; background:#c9a96e; color:#fff;
          padding:1px 5px; border-radius:10px; font-weight:600;
        }
        .fr-tab-active-bar {
          position:absolute; bottom:-2px; left:0; right:0; height:3px;
          background:#c9a96e; border-radius:2px 2px 0 0;
        }
        .fr-panel-body { flex:1; overflow-y:auto; }

        /* ── Shared panel UI ───────────────────────────────────────────── */
        .fr-panel-content { padding:1.25rem; display:flex; flex-direction:column; gap:1rem; }
        .fr-panel-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:4rem 2rem; gap:12px; text-align:center; }
        .fr-empty-icon { font-size:2.5rem; }
        .fr-empty-title { font-size:16px; font-weight:500; color:#333; }
        .fr-empty-sub { font-size:13px; color:#999; line-height:1.6; max-width:320px; }
        .fr-tab-row { display:flex; border-bottom:1px solid #f0ede8; margin:-1.25rem -1.25rem 1rem; }
        .fr-tab { flex:1; padding:11px; font-size:12px; font-weight:500; border:none; background:none; cursor:pointer; color:#aaa; border-bottom:2px solid transparent; transition:all .15s; }
        .fr-tab.active { color:#1a1108; border-bottom-color:#c9a96e; }

        /* ── Scan panel ────────────────────────────────────────────────── */
        .fr-cam-area { position:relative; background:#111; border-radius:10px; overflow:hidden; aspect-ratio:4/3; max-height:320px; }
        .fr-cam-ph { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; }
        .fr-cam-hud { position:absolute; bottom:8px; left:8px; right:8px; background:rgba(0,0,0,.65); border-radius:8px; padding:7px 10px; display:flex; align-items:center; gap:7px; }
        .fr-hud-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; transition:background .3s; }
        .fr-hud-text { font-size:11px; color:rgba(255,255,255,.8); flex:1; }
        .fr-cam-badges { position:absolute; top:8px; left:8px; display:flex; gap:5px; flex-wrap:wrap; }
        .fr-cam-badge { font-size:10px; font-weight:500; padding:3px 8px; border-radius:12px; display:flex; align-items:center; gap:3px; }
        .fr-cam-badge--shape { background:rgba(26,17,8,.75); color:#fff; }
        .fr-cam-badge--tone  { background:rgba(26,17,8,.75); color:#fff; }
        .fr-scan-detects { display:flex; gap:8px; padding:8px 0 4px; flex-wrap:wrap; }
        .fr-detect-item { font-size:11px; color:#888; background:#f5f0e8; padding:3px 10px; border-radius:20px; }
        .fr-scan-body { display:flex; flex-direction:column; gap:.75rem; }
        .fr-scan-tip { font-size:12px; color:#666; line-height:1.5; padding:8px 10px; background:#f5f0e8; border-radius:7px; border-left:2px solid #c9a96e; }
        .fr-locked-header { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
        .fr-locked-detections { display:flex; gap:8px; flex-wrap:wrap; }
        .fr-tone-detected { display:flex; align-items:center; gap:6px; font-size:11px; color:#888; background:#f9f7f5; padding:3px 8px; border-radius:12px; }
        .fr-tone-dot { width:12px; height:12px; border-radius:50%; flex-shrink:0; }
        .fr-field-row { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .fr-field-row--half { grid-template-columns:1fr; max-width:50%; }
        .fr-field { display:flex; flex-direction:column; gap:3px; }
        .fr-field label { font-size:11px; color:#888; }
        .fr-field input { padding:7px 9px; border:1px solid #e0ddd8; border-radius:7px; font-size:13px; background:#fff; }
        .fr-field input:focus { outline:none; border-color:#c9a96e; box-shadow:0 0 0 2px rgba(201,169,110,.12); }
        .fr-field-err { font-size:10px; color:#A32D2D; }
        .fr-btn-row { display:flex; gap:7px; flex-wrap:wrap; }
        .fr-btn { padding:8px 14px; border-radius:7px; font-size:12px; font-weight:500; cursor:pointer; border:1px solid #ddd; background:#fff; color:#333; display:inline-flex; align-items:center; gap:5px; text-decoration:none; transition:background .15s; }
        .fr-btn:hover:not(:disabled) { background:#f5f5f5; }
        .fr-btn:disabled { opacity:.4; cursor:not-allowed; }
        .fr-btn--primary { background:#1a1108; border-color:#1a1108; color:#faf9f7; }
        .fr-btn--primary:hover:not(:disabled) { background:#3d2c14; }
        .fr-btn--ghost { background:transparent; border-color:#e0ddd8; color:#666; }
        .fr-btn--outline { border-color:#c9a96e; color:#7a5a1a; background:transparent; }
        .fr-badge { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:20px; font-size:10px; font-weight:500; }
        .fr-badge--ok { background:#eaf3de; color:#27500a; border:1px solid #97c459; }
        .fr-alert { font-size:12px; padding:9px 12px; border-radius:7px; line-height:1.4; }
        .fr-alert--err { background:#fcebeb; color:#501313; border:1px solid #f09595; }
        .fr-alert--warn { background:#faeeda; color:#633806; border:1px solid #fac775; }
        .fr-note { font-size:11px; color:#aaa; line-height:1.5; }
        .fr-spin { display:inline-block; width:11px; height:11px; border:2px solid rgba(255,255,255,.3); border-top-color:#fff; border-radius:50%; animation:spin .7s linear infinite; }
        @keyframes spin { to { transform:rotate(360deg); } }

        /* ── Size panel ────────────────────────────────────────────────── */
        .fr-size-hero { display:flex; justify-content:space-between; align-items:flex-end; padding:1.25rem; background:linear-gradient(135deg,#faf6ee,#fff7f0); border-radius:10px; margin:-1.25rem -1.25rem 0; }
        .fr-size-hero-label { font-size:10px; color:#aaa; text-transform:uppercase; letter-spacing:.15em; margin-bottom:4px; }
        .fr-size-hero-value { font-size:3.5rem; font-weight:300; color:#1a1108; line-height:1; font-family:'Georgia',serif; }
        .fr-size-hero-supplier { font-size:11px; color:#c9a96e; margin-top:2px; }
        .fr-size-conf-block .fr-size-hero-label { font-size:10px; color:#aaa; }
        .fr-size-conf-pct { font-size:1.4rem; font-weight:500; }
        .fr-conf-bar-wrap { margin-top:-.5rem; }
        .fr-conf-bar-track { height:3px; background:#f0ede8; border-radius:2px; overflow:hidden; }
        .fr-conf-bar-fill { height:100%; border-radius:2px; transition:width .5s; }
        .fr-size-section { }
        .fr-size-section-label { font-size:10px; text-transform:uppercase; letter-spacing:.2em; color:#aaa; margin-bottom:8px; }
        .fr-size-pills { display:flex; gap:6px; flex-wrap:wrap; }
        .fr-size-pill-lg { padding:6px 16px; border-radius:20px; font-size:13px; font-weight:500; border:1px solid #e0ddd8; color:#888; }
        .fr-size-pill-lg.match { background:#fff8ee; border-color:#c9a96e; color:#7a5a1a; }
        .fr-meas-grid-lg { display:grid; grid-template-columns:repeat(auto-fill,minmax(90px,1fr)); gap:7px; }
        .fr-meas-box { background:#f9f7f5; border-radius:8px; padding:9px 11px; }
        .fr-meas-box-label { font-size:10px; color:#aaa; display:block; margin-bottom:2px; }
        .fr-meas-box-val { font-size:14px; font-weight:500; color:#1a1108; }
        .fr-meas-box-unit { font-size:11px; font-weight:400; color:#aaa; }
        .fr-meas-box-src { font-size:10px; color:#c9a96e; display:block; margin-top:2px; }
        .fr-size-chart-ref { background:#faf6ee; border-radius:8px; padding:10px 14px; }
        .fr-chart-row { display:flex; gap:12px; flex-wrap:wrap; font-size:12px; color:#7a5a1a; }
        .fr-full-chart { border:1px solid #f0ede8; border-radius:8px; overflow:hidden; font-size:12px; }
        .fr-chart-header { display:grid; grid-template-columns:60px 1fr 1fr 1fr; padding:8px 12px; background:#f9f7f5; color:#aaa; font-size:10px; text-transform:uppercase; letter-spacing:.1em; }
        .fr-chart-row-item { display:grid; grid-template-columns:60px 1fr 1fr 1fr; padding:7px 12px; border-top:1px solid #f5f3ef; color:#666; }
        .fr-chart-row-item--match { background:#fff8ee; color:#7a5a1a; }
        .fr-chart-size-label { font-weight:500; color:#1a1108; }

        /* ── Style panel ───────────────────────────────────────────────── */
        .fr-style-section { }
        .fr-style-section-title { font-size:10px; text-transform:uppercase; letter-spacing:.2em; color:#aaa; margin-bottom:10px; }
        .fr-scan-detected-note { font-size:11px; color:#c9a96e; margin:-4px 0 10px; display:flex; align-items:center; gap:4px; }

        /* Body shape grid */
        .fr-shape-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
        .fr-shape-card { padding:10px 6px 8px; border:1.5px solid #e0ddd8; border-radius:10px; cursor:pointer; background:#fff; display:flex; flex-direction:column; align-items:center; gap:4px; transition:all .15s; }
        .fr-shape-card:hover { border-color:#c9a96e; background:#faf6ee; }
        .fr-shape-card.sel { background:#fff8ee; border-color:#c9a96e; box-shadow:0 0 0 2px rgba(201,169,110,.15); }
        .fr-shape-figure { height:52px; display:flex; align-items:center; justify-content:center; }
        .fr-shape-svg { width:28px; display:block; }
        .fr-shape-card-label { font-size:11px; font-weight:600; color:#333; text-align:center; }
        .fr-shape-card.sel .fr-shape-card-label { color:#7a5a1a; }
        .fr-shape-card-desc { font-size:9px; color:#aaa; text-align:center; line-height:1.3; }

        /* Skin tone grid */
        .fr-tone-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
        .fr-tone-card { padding:10px 6px 8px; border:1.5px solid #e0ddd8; border-radius:10px; cursor:pointer; background:#fff; display:flex; flex-direction:column; align-items:center; gap:5px; transition:all .15s; }
        .fr-tone-card:hover { border-color:#c9a96e; }
        .fr-tone-card.sel { background:#fff8ee; border-color:#c9a96e; box-shadow:0 0 0 2px rgba(201,169,110,.15); }
        .fr-tone-swatch-lg { width:36px; height:36px; border-radius:50%; border:2px solid rgba(0,0,0,.08); display:block; }
        .fr-tone-card-label { font-size:11px; font-weight:600; color:#333; }
        .fr-tone-card.sel .fr-tone-card-label { color:#7a5a1a; }
        .fr-tone-card-desc { font-size:9px; color:#aaa; text-align:center; line-height:1.3; }

        /* Undertone cards */
        .fr-undertone-cards { display:flex; gap:8px; }
        .fr-undertone-card { flex:1; padding:10px 12px; border:1.5px solid #e0ddd8; border-radius:10px; cursor:pointer; background:#fff; display:flex; align-items:center; gap:10px; transition:all .15s; }
        .fr-undertone-card:hover { border-color:#c9a96e; }
        .fr-undertone-card.sel { background:#fff8ee; border-color:#c9a96e; }
        .fr-undertone-swatch { width:22px; height:22px; border-radius:50%; border:1.5px solid rgba(0,0,0,.1); flex-shrink:0; }
        .fr-undertone-card-label { font-size:12px; font-weight:600; color:#333; display:block; }
        .fr-undertone-card.sel .fr-undertone-card-label { color:#7a5a1a; }
        .fr-undertone-card-desc { font-size:10px; color:#aaa; display:block; line-height:1.3; }

        .fr-occasion-row { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
        .fr-occasion-btn { padding:10px 8px; border:1.5px solid #e0ddd8; border-radius:8px; cursor:pointer; background:#fff; display:flex; flex-direction:column; align-items:center; gap:4px; font-size:11px; color:#666; transition:all .15s; }
        .fr-occasion-icon { font-size:20px; }
        .fr-occasion-btn:hover { border-color:#c9a96e; }
        .fr-occasion-btn.sel { background:#fff8ee; border-color:#c9a96e; color:#7a5a1a; font-weight:500; }
        .fr-refine-toggle { display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-top:1px solid #f0ede8; border-bottom:1px solid #f0ede8; cursor:pointer; font-size:12px; font-weight:500; color:#888; user-select:none; }
        .fr-refine-toggle:focus-visible { outline:2px solid #c9a96e; border-radius:4px; }
        .fr-refine-arrow { transition:transform .2s; display:inline-block; }
        .fr-refine-arrow.open { transform:rotate(180deg); }
        .fr-refine-content { display:flex; flex-direction:column; gap:.75rem; padding-top:.75rem; }
        .fr-color-row { display:flex; flex-wrap:wrap; gap:6px; }
        .fr-color-btn { display:flex; flex-direction:column; align-items:center; gap:3px; padding:6px 8px; border:1.5px solid #e0ddd8; border-radius:8px; cursor:pointer; background:#fff; font-size:10px; color:#888; transition:all .15s; }
        .fr-color-btn.sel { border-color:#c9a96e; background:#fff8ee; }
        .fr-color-swatch { width:28px; height:28px; border-radius:50%; border:1px solid rgba(0,0,0,.08); }
        .fr-fabric-row { display:flex; flex-wrap:wrap; gap:5px; }
        .fr-fabric-btn { padding:5px 11px; border:1px solid #e0ddd8; border-radius:20px; font-size:11px; cursor:pointer; color:#888; background:#fff; transition:all .15s; }
        .fr-fabric-btn.sel { background:#fff8ee; border-color:#c9a96e; color:#7a5a1a; }
        .fr-budget-row { display:flex; flex-direction:column; gap:5px; }
        .fr-budget-btn { padding:8px 12px; border:1px solid #e0ddd8; border-radius:7px; font-size:12px; cursor:pointer; color:#666; background:#fff; text-align:left; transition:all .15s; }
        .fr-budget-btn.sel { background:#fff8ee; border-color:#c9a96e; color:#7a5a1a; font-weight:500; }
        .fr-style-empty { padding:1.5rem; text-align:center; color:#bbb; font-size:13px; background:#f9f7f5; border-radius:8px; }
        .fr-style-results { }
        .fr-results-label { font-size:11px; color:#aaa; margin-bottom:10px; }
        .fr-gown-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:12px; }
        .fr-gown-card { border:1px solid #f0ede8; border-radius:10px; overflow:hidden; background:#fff; animation:fadeIn .3s ease both; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        .fr-gown-img { position:relative; aspect-ratio:3/4; overflow:hidden; background:#f5f3ef; }
        .fr-gown-img img { width:100%; height:100%; object-fit:cover; object-position:top; transition:transform .5s; }
        .fr-gown-card:hover .fr-gown-img img { transform:scale(1.04); }
        .fr-gown-badge { position:absolute; bottom:0; left:0; right:0; background:#c9a96e; color:#fff; font-size:9px; letter-spacing:.25em; text-transform:uppercase; text-align:center; padding:5px; }
        .fr-gown-rank { position:absolute; top:8px; left:8px; background:rgba(26,17,8,.75); color:#fff; width:22px; height:22px; border-radius:50%; font-size:10px; display:flex; align-items:center; justify-content:center; }
        .fr-gown-info { padding:10px; display:flex; flex-direction:column; gap:5px; }
        .fr-gown-name { font-size:13px; font-weight:500; color:#1a1108; }
        .fr-gown-price { font-size:12px; color:#7a5a1a; }
        .fr-gown-meta { font-size:10px; color:#aaa; }
        .fr-gown-reasons { display:flex; flex-direction:column; gap:3px; padding:6px 0; border-top:1px solid #f5f3ef; }
        .fr-gown-reason { display:flex; align-items:flex-start; gap:5px; font-size:10px; color:#aaa; line-height:1.4; }
        .fr-reason-dot { width:3px; height:3px; border-radius:50%; background:#c9a96e; margin-top:5px; flex-shrink:0; }
        .fr-score-row { display:flex; align-items:center; gap:6px; }
        .fr-score-bar { flex:1; height:2px; background:#f0ede8; border-radius:2px; overflow:hidden; }
        .fr-score-fill { height:100%; background:linear-gradient(to right,#e0c080,#c9a96e); }
        .fr-score-pct { font-size:10px; color:#aaa; }
        .fr-gown-actions { display:flex; gap:5px; margin-top:3px; }
        .fr-gown-btn { flex:1; padding:7px 8px; text-align:center; text-decoration:none; font-size:10px; border-radius:6px; font-weight:500; transition:background .15s; }
        .fr-gown-btn--ghost { border:1px solid #e0ddd8; color:#666; }
        .fr-gown-btn--ghost:hover { background:#f5f3ef; }
        .fr-gown-btn--primary { background:#1a1108; color:#faf9f7; border:1px solid #1a1108; }
        .fr-gown-btn--primary:hover { background:#3d2c14; }

        /* ── Try-on panel ──────────────────────────────────────────────── */
        .fr-tryon-layout { height:calc(100vh - 152px); min-height:600px; display:flex; flex-direction:column; }

        /* ── Mobile ────────────────────────────────────────────────────── */
        @media (max-width:860px) {
          .fr-layout { grid-template-columns:1fr; }
          .fr-sidebar { position:static; height:auto; flex-direction:row; flex-wrap:wrap; gap:8px; padding:10px 12px; border-right:none; border-bottom:1px solid #eee; overflow:visible; }
          .fr-sidebar-header { width:100%; padding-bottom:8px; border-bottom:none; }
          .fr-sidebar-section { padding:6px 0; border-bottom:none; min-width:130px; flex:1; }
          .fr-sidebar-manual { display:none; }
          /* Bottom tab bar */
          .fr-panel-nav { position:fixed; bottom:0; left:0; right:0; top:auto; z-index:100; border-top:1px solid #eee; border-bottom:none; box-shadow:0 -2px 12px rgba(0,0,0,.06); }
          .fr-panel-tab { flex-direction:column; gap:2px; padding:8px 4px 6px; align-items:center; }
          .fr-tab-step { display:none; }
          .fr-tab-text { align-items:center; }
          .fr-tab-sub { display:none; }
          .fr-tab-icon { font-size:20px; }
          .fr-tab-label { font-size:10px; }
          .fr-main { padding-bottom:64px; }
          .fr-tryon-layout { height:auto; }
          .fr-shape-grid { grid-template-columns:repeat(4,1fr); gap:5px; }
          .fr-tone-grid { grid-template-columns:repeat(4,1fr); gap:5px; }
          .fr-undertone-cards { flex-direction:column; }
        }
        @media (max-width:580px) {
          .fr-field-row { grid-template-columns:1fr; }
          .fr-field-row--half { max-width:100%; }
          .fr-occasion-row { grid-template-columns:repeat(2,1fr); }
          .fr-gown-grid { grid-template-columns:1fr 1fr; }
          .fr-shape-grid { grid-template-columns:repeat(3,1fr); }
          .fr-tone-grid { grid-template-columns:repeat(4,1fr); }
        }
      `}</style>
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export default function FittingRoomPage() {
  const [gowns,        setGowns       ] = useState([])
  const [sizes,        setSizes       ] = useState([])
  const [supplierName, setSupplierName] = useState('')
  const [ready,        setReady       ] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/gowns').then(r=>r.json()).then(d=>setGowns((d.gowns||[]).filter(g=>g.image))).catch(()=>{}),
      fetch('/api/size-chart').then(r=>r.json()).then(d=>{if(d.ok){setSizes(d.sizes);setSupplierName(d.supplierName||'')}}).catch(()=>{}),
    ]).finally(() => setReady(true))
  }, [])

  if (!ready) return <SkeletonLoader/>

  return (
    <FittingRoomProvider gowns={gowns} sizes={sizes} supplierName={supplierName}>
      <FittingRoomInner/>
    </FittingRoomProvider>
  )
}