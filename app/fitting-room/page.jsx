'use client'

import { useCallback, useEffect, useRef, useState, createContext, useContext } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser } from '../utils/authClient'

import {
  BODY_SHAPES, SKIN_TONES, UNDERTONES, OCCASIONS,
  COLOR_OPTIONS, FABRIC_OPTIONS, BUDGET_RANGES,
  scoreGown, normaliseScore, MAX_RAW_SCORE,
} from '../constants/styleOptions'

import {
  SEGMENTS,
} from '../constants/sizeConstants'

import {
  detectSkinProfile,
} from '../utils/skinTone'

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

const KP   = { NOSE:0, LS:5, RS:6, LE:7, RE:8, LH:11, RH:12, LK:13, RK:14, LA:15, RA:16 }
const CONF = 0.45

// ─────────────────────────────────────────────────────────────────────────────
// IMPROVED CAMERA MULTIPLIERS — per-segment, per-body-shape
// ─────────────────────────────────────────────────────────────────────────────

// torsoAnchorCm is now computed dynamically from height; these are fallbacks
const BASE_MULTS = {
  women: {
    default:          { bust: 2.28, waist: 1.85, hip: 2.80, torsoAnchorCm: 44 },
    hourglass:        { bust: 2.25, waist: 1.72, hip: 2.90, torsoAnchorCm: 44 },
    pear:             { bust: 2.18, waist: 1.78, hip: 3.00, torsoAnchorCm: 44 },
    apple:            { bust: 2.32, waist: 2.00, hip: 2.70, torsoAnchorCm: 44 },
    rectangle:        { bust: 2.23, waist: 1.90, hip: 2.75, torsoAnchorCm: 44 },
    invertedTriangle: { bust: 2.38, waist: 1.80, hip: 2.65, torsoAnchorCm: 44 },
    petite:           { bust: 2.20, waist: 1.76, hip: 2.78, torsoAnchorCm: 38 },
    tall:             { bust: 2.30, waist: 1.83, hip: 2.82, torsoAnchorCm: 50 },
  },
  men: {
    default:          { bust: 2.08, waist: 1.88, hip: 2.52, torsoAnchorCm: 48 },
  },
  children: {
    default:          { bust: 2.15, waist: 1.82, hip: 2.60, torsoAnchorCm: 30 },
  },
}

// Torso-to-height ratio (shoulder→hip / total height) — used when height is known
const TORSO_HEIGHT_RATIO = {
  women:    0.290,
  men:      0.300,
  children: 0.285,
}

function getMults(segment = 'women', bodyShape = null) {
  const segMults = BASE_MULTS[segment] ?? BASE_MULTS.women
  return (bodyShape && segMults[bodyShape]) ?? segMults.default
}

function getTorsoAnchor(segment = 'women', heightCm = null, bodyShape = null) {
  if (heightCm) {
    const ratio = TORSO_HEIGHT_RATIO[segment] ?? 0.29
    return heightCm * ratio
  }
  return getMults(segment, bodyShape).torsoAnchorCm
}

// Per-measurement variance estimates (cm) for display
const MEAS_VARIANCE = {
  bust:  { withHeight: 2.5, withoutHeight: 4.0 },
  waist: { withHeight: 4.5, withoutHeight: 6.5 },
  hip:   { withHeight: 3.5, withoutHeight: 5.5 },
}

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

// Display-only smoother (EMA α=0.35) — NOT used for measurement path
function smoothKpsDisplay(prev, curr, t = 0.35) {
  if (!prev) return curr
  return curr.map((k, i) => lerpPt(prev[i], k, t))
}

// Inter-quartile mean — more robust than median for noisy sensor data
function iqm(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const lo = Math.floor(s.length * 0.20)
  const hi = Math.ceil(s.length * 0.80)
  const trimmed = s.slice(lo, hi)
  if (!trimmed.length) return s[Math.floor(s.length / 2)]
  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length
}

// ─────────────────────────────────────────────────────────────────────────────
// BODY SHAPE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

function detectBodyShapeFromPose(kps, vw) {
  const ls = kps[KP.LS], rs = kps[KP.RS]
  const lh = kps[KP.LH], rh = kps[KP.RH]
  const lk = kps[KP.LK], rk = kps[KP.RK]
  if (!ls || !rs || !lh || !rh) return null
  if (ls.score < CONF || rs.score < CONF || lh.score < CONF || rh.score < CONF) return null

  const shoulderW  = dist(ls, rs)
  const hipW       = dist(lh, rh)
  const sm         = mid(ls, rs), hm = mid(lh, rh)
  const torsoH     = hm.y - sm.y

  // Waist proxy: sample mid-torso horizontal span via a synthetic midpoint
  // Use 55% down from shoulder to hip — closer to actual anatomical waist
  const waistY     = sm.y + torsoH * 0.55
  const waistProxy = shoulderW * 0.72  // fallback ratio

  const sToH       = shoulderW / hipW
  const wToH       = waistProxy / hipW
  const frameH     = kps[KP.LA]?.score > CONF && kps[KP.RA]?.score > CONF
    ? Math.max(kps[KP.LA].y, kps[KP.RA].y) - sm.y
    : torsoH * 4.5
  const heightFraction = torsoH / Math.max(frameH, 1)
  const likelyPetite   = heightFraction < 0.19

  if (likelyPetite)                              return 'petite'
  if (sToH > 1.18)                               return 'invertedTriangle'
  if (sToH < 0.83)                               return 'pear'
  if (wToH > 0.90 && sToH > 0.93)               return 'rectangle'
  if (wToH < 0.78)                               return 'hourglass'
  if (wToH > 0.88 && sToH < 0.93)               return 'apple'
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// POSE ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

function analyzePose(kps, vw, vh) {
  if (!kps) return { ok: false, issues: ['no_pose'], facingBack: false }
  const ls=kps[KP.LS], rs=kps[KP.RS], lh=kps[KP.LH], rh=kps[KP.RH]
  const lk=kps[KP.LK], rk=kps[KP.RK], la=kps[KP.LA], ra=kps[KP.RA]
  const nose=kps[KP.NOSE]
  const issues=[]
  const shouldersOk = ls?.score>CONF && rs?.score>CONF
  const hipsOk      = lh?.score>CONF && rh?.score>CONF
  const kneesOk     = lk?.score>CONF && rk?.score>CONF
  const anklesOk    = la?.score>CONF && ra?.score>CONF
  const margin      = vw*0.08
  const tooCloseFrame = shouldersOk && (ls.x<margin || rs.x>vw-margin || (hipsOk && mid(lh,rh).y>vh*0.72))
  const faceVisible   = nose && nose.score>0.30
  const bodyStable    = shouldersOk && hipsOk
  const shoulderSpan  = shouldersOk ? dist(ls,rs) : 0
  const bodyWideEnough = shoulderSpan > vw*0.10
  const facingBack    = !faceVisible && bodyStable && bodyWideEnough && !tooCloseFrame
  const shoulderTilt = shouldersOk ? Math.abs(ls.y - rs.y) : 0
  const hipTilt      = hipsOk      ? Math.abs(lh.y - rh.y) : 0
  const torsoOffset  = (shouldersOk && hipsOk)
    ? Math.abs(mid(ls, rs).x - mid(lh, rh).x)
    : 0

  if (shoulderTilt > vh * 0.035 || hipTilt > vh * 0.04) issues.push('tilted')
  if (torsoOffset  > vw * 0.06)                          issues.push('rotated')

  if (!shouldersOk) { issues.push('no_shoulders'); return { ok:false, issues, shouldersOk, hipsOk, facingBack } }
  if (!hipsOk)      { issues.push('no_hips');      return { ok:false, issues, shouldersOk, hipsOk, facingBack } }
  if (!kneesOk)  issues.push('no_legs')
  if (tooCloseFrame) issues.push('too_close')
  if (nose?.score>0.15 && nose.y<vh*0.06) issues.push('head_cut')
  if (!kneesOk && hipsOk && mid(lh,rh).y>vh*0.55 && !tooCloseFrame) issues.unshift('too_close')
  if (kneesOk && !anklesOk && mid(lk,rk).y<vh*0.82) issues.push('too_close')

  const ok = shouldersOk && hipsOk && issues.length===0
  return { ok, issues, shouldersOk, hipsOk, kneesOk, anklesOk, facingBack }
}

// ─────────────────────────────────────────────────────────────────────────────
// GOWN OVERLAY HELPERS (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────

function getGownLayout(kps, cal={}, vw=640, vh=480) {
  const ls=kps[KP.LS], rs=kps[KP.RS], lh=kps[KP.LH], rh=kps[KP.RH]
  const lk=kps[KP.LK], rk=kps[KP.RK], la=kps[KP.LA], ra=kps[KP.RA]
  if ([ls,rs,lh,rh].some(k=>!k||k.score<CONF)) return null
  const sm=mid(ls,rs), hm=mid(lh,rh), torsoH=hm.y-sm.y
  const rawSw=dist(ls,rs), sw=Math.min(Math.max(rawSw,vw*0.28),vw*0.80)
  const rawHw=dist(lh,rh), hw=Math.max(rawHw,sw*0.90)
  const neckOff=cal.necklineY??0.18, topY=sm.y-torsoH*neckOff
  let bottomY
  if (la?.score>CONF && ra?.score>CONF) { bottomY=Math.max(la.y,ra.y)+torsoH*0.15 }
  else if (lk?.score>CONF && rk?.score>CONF) { const km=mid(lk,rk), legH=km.y-hm.y; bottomY=km.y+legH*1.1 }
  else { bottomY=sm.y+torsoH*4.8 }
  if (cal.hemY!=null) { const fullH=sm.y+torsoH*4.8-topY; bottomY=topY+fullH*cal.hemY }
  const shoulderPad=cal.shoulderPad??1.45, skirtFlare=cal.skirtFlare??1.20
  const topW=sw*shoulderPad, botW=Math.max(hw*1.55,topW)*skirtFlare
  const cx=(sm.x+hm.x)/2
  return { topY, bottomY, cx, topW, botW, torsoH }
}

function drawGown(ctx, img, layout, opacity) {
  const { topY, bottomY, cx, topW, botW } = layout
  const h = bottomY - topY
  if (h <= 0) return
  const oc   = document.createElement('canvas')
  oc.width   = ctx.canvas.width  / (window.devicePixelRatio || 1)
  oc.height  = ctx.canvas.height / (window.devicePixelRatio || 1)
  const octx = oc.getContext('2d')
  octx.beginPath()
  octx.moveTo(cx - topW / 2, topY)
  octx.lineTo(cx + topW / 2, topY)
  octx.lineTo(cx + botW / 2, bottomY)
  octx.lineTo(cx - botW / 2, bottomY)
  octx.closePath()
  octx.clip()
  octx.drawImage(img, cx - botW / 2, topY, botW, h)
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(oc, 0, 0)
  ctx.restore()
}

// ─────────────────────────────────────────────────────────────────────────────
// FITTING ROOM CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

const FittingRoomCtx = createContext(null)
function useFittingRoom() { return useContext(FittingRoomCtx) }

function FittingRoomProvider({ children, gowns, initialSizes, initialSupplierName }) {
  const [profile, setProfile] = useState({
    bust: null, waist: null, hips: null, height: null, weight: null,
    source: null, bodyShape: null, skinTone: null, undertone: null,
    occasion: null, colors: [], fabrics: [], budget: null,
    segment: 'women',
  })
  const [sizes,        setSizes       ] = useState(initialSizes || [])
  const [supplierName, setSupplierName] = useState(initialSupplierName || '')
  const [sizeResult,   setSizeResult  ] = useState(null)
  const [styleResults, setStyleResults] = useState(null)
  const detectorRef  = useRef(null)
  const segmenterRef = useRef(null)
  const [modelState, setModelState]    = useState('idle')

  const updateProfile = useCallback((patch) => {
    setProfile(p => ({ ...p, ...patch }))
  }, [])

  useEffect(() => {
    const seg = profile.segment ?? 'women'
    fetch(`/api/size-chart?segment=${seg}`)
      .then(r => r.json())
      .then(d => { if (d.ok) { setSizes(d.sizes); setSupplierName(d.supplierName || '') } })
      .catch(() => {})
  }, [profile.segment])

  useEffect(() => {
    if (!profile.bust && !profile.waist && !profile.hips) return
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
    if (!best) { setSizeResult(null); return }
    const idx      = sizes.findIndex(s => s.label === best.label)
    const adjacent = sizes.slice(Math.max(0, idx - 1), Math.min(sizes.length, idx + 2))
    setSizeResult({ size: best, score: bestScore, adjacent })
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

  useEffect(() => {
    if (detectorRef.current || modelState === 'loading' || modelState === 'ready') return
    setModelState('loading')
    Promise.all(POSE_SCRIPTS.map(loadScript))
      .then(() => window.tf.ready())
      .then(() => window.tf.setBackend('webgl').catch(() => window.tf.setBackend('cpu')))
      .then(() => {
        const pd = window.poseDetection
        return pd.createDetector(pd.SupportedModels.MoveNet, {
          modelType: pd.movenet.modelType.SINGLEPOSE_THUNDER,
        })
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
// SEGMENT GATE
// ─────────────────────────────────────────────────────────────────────────────

function SegmentGate({ children }) {
  const { profile, updateProfile } = useFittingRoom()
  return (
    <div className="sg-wrap">
      <div className="sg-picker">
        <p className="sg-label">Who is being measured?</p>
        <div className="sg-row">
          {SEGMENTS.map(s => (
            <button
              key={s.id}
              className={`sg-btn${profile.segment === s.id ? ' sg-btn--sel' : ''}`}
              onClick={() => updateProfile({ segment: s.id })}
              aria-pressed={profile.segment === s.id}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────

function ProfileSidebar({ user, onSave, saving, saveMsg, open, onToggle }) {
  const { profile, sizeResult, updateProfile, sizes, supplierName } = useFittingRoom()
  const scoreConf  = sizeResult ? Math.min(95, Math.max(10, Math.round(100 - sizeResult.score * 3))) : 0
  const scoreColor = scoreConf >= 75 ? '#1D9E75' : scoreConf >= 55 ? '#EF9F27' : '#E24B4A'
  const tone       = SKIN_TONES.find(t => t.id === profile.skinTone)
  const hasProfile = profile.bust || profile.waist || profile.hips
  const segLabel   = SEGMENTS.find(s => s.id === profile.segment)?.label || 'Women'

  return (
    <aside className="fr-sidebar">
      <div className="fr-sidebar-header">
        {open && <span className="fr-sidebar-eyebrow">Fitting Room</span>}
        {open && user && <span className="fr-sidebar-user">{user.name || user.email}</span>}
        <button
          className="fr-sidebar-collapse-btn"
          onClick={onToggle}
          aria-label={open ? 'Hide sidebar' : 'Show sidebar'}
          title={open ? 'Hide sidebar' : 'Show sidebar'}
        >
          {open ? '‹' : '›'}
        </button>
      </div>

      {open && (
        <>
          <div className="fr-sidebar-section">
            <p className="fr-sidebar-label">Segment</p>
            <div className="fr-sidebar-seg-row">
              {SEGMENTS.map(s => (
                <button
                  key={s.id}
                  className={`fr-seg-mini${profile.segment === s.id ? ' sel' : ''}`}
                  onClick={() => updateProfile({ segment: s.id })}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="fr-sidebar-section">
            <p className="fr-sidebar-label">Measurements</p>
            {hasProfile ? (
              <div className="fr-meas-grid">
                {[['Bust', profile.bust, 'cm'], ['Waist', profile.waist, 'cm'], ['Hips', profile.hips, 'cm'],
                  ['Height', profile.height, 'cm'], ['Weight', profile.weight, 'kg']].filter(([, v]) => v).map(([l, v, u]) => (
                  <div key={l} className="fr-meas-chip">
                    <span className="fr-meas-key">{l}</span>
                    <span className="fr-meas-val">{v} {u}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="fr-sidebar-empty">Use Scan to capture measurements</p>
            )}
          </div>

          {sizeResult?.size && (
            <div className="fr-sidebar-section fr-sidebar-size">
              <p className="fr-sidebar-label">{supplierName || segLabel} Size</p>
              <div className="fr-size-display">
                <span className="fr-size-label">{sizeResult.size.label}</span>
                <div className="fr-size-conf">
                  <div className="fr-conf-bar">
                    <div className="fr-conf-fill" style={{ width: `${scoreConf}%`, background: scoreColor }}/>
                  </div>
                  <span style={{ color: scoreColor, fontSize: '11px', fontWeight: 500 }}>{scoreConf}%</span>
                </div>
              </div>
              <div className="fr-size-range">
                {sizeResult.adjacent.map(sz => (
                  <span key={sz.label} className={`fr-size-pill${sz.label === sizeResult.size.label ? ' fr-size-pill--match' : ''}`}>
                    {sz.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(profile.bodyShape || profile.skinTone || profile.occasion) && (
            <div className="fr-sidebar-section">
              <p className="fr-sidebar-label">Style profile</p>
              <div className="fr-profile-chips">
                {profile.bodyShape && <span className="fr-chip">{profile.bodyShape}</span>}
                {profile.skinTone && (
                  <span className="fr-chip fr-chip--tone">
                    <span className="fr-chip-swatch" style={{ background: tone?.hex }}/>
                    {profile.skinTone}
                  </span>
                )}
                {profile.undertone  && <span className="fr-chip">{profile.undertone} tone</span>}
                {profile.occasion   && <span className="fr-chip">{profile.occasion}</span>}
              </div>
            </div>
          )}

          {user && hasProfile && (
            <div className="fr-sidebar-section">
              <button className="fr-save-btn" onClick={onSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save profile'}
              </button>
              {saveMsg && (
                <p className={`fr-save-msg${saveMsg.startsWith('✓') ? ' ok' : ' err'}`}>{saveMsg}</p>
              )}
            </div>
          )}

          <div className="fr-sidebar-section fr-sidebar-manual">
            <p className="fr-sidebar-label">Override measurements</p>
            <div className="fr-manual-grid">
              {[
                ['Bust',   'bust',   'cm'],
                ['Waist',  'waist',  'cm'],
                ['Hips',   'hips',   'cm'],
                ['Height', 'height', 'cm'],
              ].map(([l, k, u]) => (
                <label key={k} className="fr-manual-field">
                  <span>{l}</span>
                  <input
                    type="number"
                    value={profile[k] || ''}
                    placeholder="—"
                    onChange={e => updateProfile({ [k]: parseFloat(e.target.value) || null })}
                  />
                  <span className="fr-manual-unit">{u}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </aside>
  )
}

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
}

const MEASUREMENT_BOUNDS = {
  bust:   [50, 200], waist: [40, 180], hips: [50, 200],
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

// High-severity issues that should reset goodFrames and block measurement accumulation
const HIGH_SEVERITY_ISSUES = new Set(['rotated', 'tilted', 'too_close'])

// ─────────────────────────────────────────────────────────────────────────────
// SCAN PANEL
// ─────────────────────────────────────────────────────────────────────────────

function ScanPanel() {
  const { updateProfile, detectorRef, modelState, profile } = useFittingRoom()

  const videoRef           = useRef(null)
  const canvasRef          = useRef(null)
  const streamRef          = useRef(null)
  const animRef            = useRef(null)
  // Measurement-quality history buffers — only clean frames enter these
  const swHistRef          = useRef([])   // shoulder-width px readings
  const hipHistRef         = useRef([])   // hip-width px readings
  const pxPerCmHistRef     = useRef([])   // scale consistency tracker
  const torsoHRef          = useRef(null)
  // Display smoother — separate from measurement path
  const prevKpsDisplayRef  = useRef(null)
  // Raw keypoints for measurement (no smoothing)
  const liveKpsRef         = useRef(null)
  const skinDebounceRef    = useRef(null)
  const shapeVotesRef      = useRef({})
  const goodFrames         = useRef(0)
  const bestSnapshotRef    = useRef(null)
  const scanWrapRef        = useRef(null)

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

  // Height pre-scan prompt
  const [heightInput,   setHeightInput  ] = useState('')
  const [heightSet,     setHeightSet    ] = useState(false)

  const [adjBust,  setAdjBust ] = useState('')
  const [adjWaist, setAdjWaist] = useState('')
  const [adjHips,  setAdjHips ] = useState('')
  const [scanConf, setScanConf] = useState(0) // confidence at time of lock

  const [mBust,   setMBust  ] = useState('')
  const [mWaist,  setMWaist ] = useState('')
  const [mHips,   setMHips  ] = useState('')
  const [mHeight, setMHeight] = useState('')
  const [mWeight, setMWeight] = useState('')
  const [mErrors, setMErrors ] = useState({})

  // Sync height input with profile
  useEffect(() => {
    if (profile.height && !heightSet) {
      setHeightInput(String(profile.height))
      setHeightSet(true)
    }
  }, [profile.height, heightSet])

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
    // Commit height if user typed one
    if (heightInput) {
      const h = parseFloat(heightInput)
      if (h >= 100 && h <= 250) updateProfile({ height: h })
    }
    setCamError(''); setCamState('starting')
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('Camera not supported.'); setCamState('error'); return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user', frameRate: { ideal: 30 } },
        audio: false,
      })
      streamRef.current = stream; videoRef.current.srcObject = stream
      await new Promise((res, rej) => {
        videoRef.current.onloadedmetadata = res
        setTimeout(() => rej(new Error('timeout')), 10000)
      })
      await videoRef.current.play(); setCamState('on')
    } catch (err) {
      let msg = 'Could not start camera.'
      if (err.name === 'NotAllowedError')      msg = 'Camera permission denied.'
      else if (err.name === 'NotFoundError')   msg = 'No camera found.'
      else if (err.name === 'NotReadableError') msg = 'Camera in use by another app.'
      setCamError(msg); setCamState('error')
    }
  }, [heightInput, updateProfile])

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

    // Mirror the video
    ctx.save(); ctx.translate(vw, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, vw, vh); ctx.restore()

    try {
      const poses = await detectorRef.current.estimatePoses(video)
      if (poses?.length > 0) {
        // Raw keypoints mirrored — used for measurements (no smoothing lag)
        const rawKps = poses[0].keypoints.map(k => ({ ...k, x: vw - k.x }))

        // Display-only smoothed keypoints
        const dispKps = smoothKpsDisplay(prevKpsDisplayRef.current, rawKps)
        prevKpsDisplayRef.current = dispKps

        // Use raw for analysis and measurement; smoothed only for canvas overlay
        liveKpsRef.current = rawKps

        const analysis = analyzePose(rawKps, vw, vh)
        setPoseIssues(analysis.issues); setPoseFound(analysis.shouldersOk && analysis.hipsOk)

        const hasHighSeverityIssue = analysis.issues.some(i => HIGH_SEVERITY_ISSUES.has(i))

        if (analysis.shouldersOk && analysis.hipsOk) {
          // If high-severity issue, reset counter and skip measurement accumulation
          if (hasHighSeverityIssue) {
            goodFrames.current = Math.max(0, goodFrames.current - 4)
          } else {
            goodFrames.current = Math.min(goodFrames.current + 1, 60)
          }

          const ls = rawKps[KP.LS], rs = rawKps[KP.RS]
          const lh = rawKps[KP.LH], rh = rawKps[KP.RH]
          const nose = rawKps[KP.NOSE]
          const la   = rawKps[KP.LA]
          const ra   = rawKps[KP.RA]

          const hasFullHeight = profile.height && nose?.score > CONF && la?.score > CONF && ra?.score > CONF

          const pxPerCm = (() => {
            if (hasFullHeight) {
              const ankleMid     = mid(la, ra)
              const fullHeightPx = ankleMid.y - nose.y
              return fullHeightPx / profile.height
            }
            const torsoAnchor = getTorsoAnchor(profile.segment, profile.height, detectedShape)
            const torsoH      = mid(lh, rh).y - mid(ls, rs).y
            return torsoH / torsoAnchor
          })()

          const torsoH = mid(lh, rh).y - mid(ls, rs).y

          if (torsoH > 20 && pxPerCm > 0) {
            torsoHRef.current = torsoH

            // Scale consistency check — reject frames where camera distance changed >12%
            const prevMeanPxPerCm = pxPerCmHistRef.current.length
              ? pxPerCmHistRef.current.reduce((a, b) => a + b, 0) / pxPerCmHistRef.current.length
              : pxPerCm
            const scaleOk = Math.abs(pxPerCm - prevMeanPxPerCm) / prevMeanPxPerCm < 0.12
            pxPerCmHistRef.current.push(pxPerCm)
            if (pxPerCmHistRef.current.length > 30) pxPerCmHistRef.current.shift()

            const swPx = dist(ls, rs)
            const hwPx = dist(lh, rh)

            // Only accumulate clean, scale-consistent frames
            if (!hasHighSeverityIssue && scaleOk) {
              swHistRef.current.push(swPx)
              if (swHistRef.current.length > 60) swHistRef.current.shift()

              hipHistRef.current.push(hwPx)
              if (hipHistRef.current.length > 60) hipHistRef.current.shift()
            }

            // Use IQM over full buffer for live estimates
            const estSwPx  = iqm(swHistRef.current) || swPx
            const estHipPx = iqm(hipHistRef.current) || hwPx

            const mults = getMults(profile.segment, detectedShape)
            const estBust  = Math.round(estSwPx  / pxPerCm * mults.bust)
            const estWaist = Math.round(estSwPx  / pxPerCm * mults.waist)
            const estHips  = Math.round(estHipPx / pxPerCm * mults.hip)

            // Improved confidence formula
            let conf = 0
            conf += Math.min((goodFrames.current / 60) * 55, 55)   // 0–55 from frame stability
            conf += hasFullHeight ? 15 : 0                          // height anchor bonus
            conf += analysis.kneesOk  ? 8 : 0
            conf += analysis.anklesOk ? 7 : 0
            conf += !analysis.issues.length ? 10 : 0               // clean pose bonus
            conf += swHistRef.current.length >= 40 ? 5 : 0         // sufficient data depth
            conf = Math.min(Math.round(conf), 95)

            setConfidence(conf)
            setLiveEst({ bust: estBust, waist: estWaist, hips: estHips })

            // Best-snapshot: require 70%+ for snapshot capture (up from 55)
            if (conf > (bestSnapshotRef.current?.confidence ?? 0) && conf >= 70) {
              const snap = document.createElement('canvas')
              snap.width  = vw; snap.height = vh
              snap.getContext('2d').drawImage(canvas, 0, 0)
              bestSnapshotRef.current = {
                dataUrl:    snap.toDataURL('image/jpeg', 0.82),
                confidence: conf,
                est:        { bust: estBust, waist: estWaist, hips: estHips },
              }
            }

            // Draw skeleton overlay using display-smoothed keypoints
            const confColor = conf >= 70 ? 'rgba(29,158,117,' : conf >= 50 ? 'rgba(239,159,39,' : 'rgba(226,75,74,'
            ctx.strokeStyle = `${confColor}${conf > 60 ? '0.7)' : '0.35)'})`
            ctx.lineWidth   = 2
            const drawLine  = (a, b) => {
              if (a?.score > CONF && b?.score > CONF) {
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
              }
            }
            // Use display-smoothed points for visual overlay
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

            // Guide lines
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

            // Body shape detection — higher threshold (55% share, 20+ votes)
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

            // Skin tone detection
            if (nose?.score > 0.4 && conf >= 65) {
              clearTimeout(skinDebounceRef.current)
              skinDebounceRef.current = setTimeout(() => {
                const sp = detectSkinProfile(ctx, rawKps, vw, vh, KP)
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

  useEffect(() => {
    if (camState === 'on') detect()
    else if (animRef.current) cancelAnimationFrame(animRef.current)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [camState, detect])

  useEffect(() => () => stopCamera(), [stopCamera])

  const lockMeasurement = useCallback(() => {
    if (!swHistRef.current.length) return
    const kps     = liveKpsRef.current
    const nose    = kps?.[KP.NOSE]
    const la      = kps?.[KP.LA]
    const ra      = kps?.[KP.RA]
    const ls      = kps?.[KP.LS]
    const rs      = kps?.[KP.RS]
    const lh      = kps?.[KP.LH]
    const rh      = kps?.[KP.RH]

    const hasFullHeight = profile.height && kps &&
      nose?.score > CONF && la?.score > CONF && ra?.score > CONF

    const pxPerCm = (() => {
      if (hasFullHeight) {
        const ankleMid     = mid(la, ra)
        const fullHeightPx = ankleMid.y - nose.y
        return fullHeightPx / profile.height
      }
      const torsoH      = torsoHRef.current ?? 0
      const torsoAnchor = getTorsoAnchor(profile.segment, profile.height, detectedShape)
      return torsoH > 0 ? torsoH / torsoAnchor : 1
    })()

    const estSwPx  = iqm(swHistRef.current)
    const estHipPx = iqm(hipHistRef.current) || estSwPx * 1.05

    const mults = getMults(profile.segment, detectedShape)
    const estBust  = Math.round(estSwPx  / pxPerCm * mults.bust)
    const estWaist = Math.round(estSwPx  / pxPerCm * mults.waist)
    const estHips  = Math.round(estHipPx / pxPerCm * mults.hip)

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
    const fields = { bust: mBust, waist: mWaist, hips: mHips, height: mHeight, weight: mWeight }
    const errors = {}
    for (const [k, v] of Object.entries(fields)) {
      const err = validateField(k, v); if (err) errors[k] = err
    }
    if (!mBust && !mWaist && !mHips) { setMErrors({ _form: 'Enter at least one of bust, waist, or hips.' }); return }
    if (Object.keys(errors).length)  { setMErrors(errors); return }
    setMErrors({})
    updateProfile({
      bust: parseFloat(mBust) || null, waist: parseFloat(mWaist) || null,
      hips: parseFloat(mHips) || null, height: parseFloat(mHeight) || null,
      weight: parseFloat(mWeight) || null, source: 'manual',
    })
  }, [mBust, mWaist, mHips, mHeight, mWeight, updateProfile])

  const confColor = confidence >= 70 ? '#1D9E75' : confidence >= 50 ? '#EF9F27' : '#E24B4A'
  const issue     = poseFound ? null : (poseIssues[0] ? GUIDANCE_MAP[poseIssues[0]] : null)
  const canScan   = modelState === 'ready'
  // Lock requires 65% minimum
  const canLock   = confidence >= 65
  const toneHex   = detectedTone ? SKIN_TONES.find(t => t.id === detectedTone.skinTone)?.hex : null
  const segLabel  = SEGMENTS.find(s => s.id === (profile.segment ?? 'women'))?.label || 'Women'
  const hasHeight = !!profile.height

  // Per-measurement variance display
  const variantKey = hasHeight ? 'withHeight' : 'withoutHeight'
  const measVariance = {
    bust:  MEAS_VARIANCE.bust[variantKey],
    waist: MEAS_VARIANCE.waist[variantKey],
    hip:   MEAS_VARIANCE.hip[variantKey],
  }

  return (
    <SegmentGate>
      <div className="fr-panel-content">
        <div className="fr-tab-row">
          <button className={`fr-tab${activeTab === 'camera' ? ' active' : ''}`} onClick={() => setActiveTab('camera')}>Camera scan</button>
          <button className={`fr-tab${activeTab === 'manual' ? ' active' : ''}`} onClick={() => setActiveTab('manual')}>Manual entry</button>
        </div>

        {activeTab === 'camera' && (
          <div className="scan-layout">
            {/* Camera area */}
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

                {camState === 'on' && (
                  <div className="fr-cam-hud">
                    <span className="fr-hud-dot" style={{ background: confColor }}/>
                    <span className="fr-hud-text">
                      {issue ? issue
                        : poseIssues.some(i => HIGH_SEVERITY_ISSUES.has(i)) ? GUIDANCE_MAP[poseIssues.find(i => HIGH_SEVERITY_ISSUES.has(i))]
                        : confidence > 0 ? (confidence < 65 ? 'Hold still — building confidence…' : 'Good — ready to lock') : 'Detecting pose…'}
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

              {/* Controls below camera */}
              {!locked ? (
                <div className="scan-controls">
                  {camError && <div className="fr-alert fr-alert--err">{camError}</div>}
                  {modelState === 'error' && <div className="fr-alert fr-alert--err">AI model failed to load. Try refreshing.</div>}

                  {camState !== 'on' ? (
                    <>
                      {/* Height pre-scan prompt */}
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
                            placeholder="e.g. 162"
                            onChange={e => setHeightInput(e.target.value)}
                          />
                          <span className="scan-height-unit">cm</span>
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
                        disabled={!canLock}
                        title={!canLock ? `Build more confidence (${confidence}% / 65% needed)` : ''}
                      >
                        {canLock
                          ? `Lock measurements (${confidence}%)`
                          : `Need ${65 - confidence}% more…`}
                      </button>
                      <button className="fr-btn fr-btn--ghost" onClick={stopCamera}>Stop</button>
                    </div>
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
                      {detectedShape && getMults(profile.segment, detectedShape) !== getMults(profile.segment, null) && (
                        <span className="scan-detection-tag scan-detection-tag--mults">shape-tuned</span>
                      )}
                    </div>
                  </div>

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

                  <div className="fr-field-row">
                    {[
                      ['Bust (cm)', adjBust, setAdjBust, measVariance.bust],
                      ['Waist (cm)', adjWaist, setAdjWaist, measVariance.waist],
                      ['Hips (cm)', adjHips, setAdjHips, measVariance.hip],
                    ].map(([l, v, s, variance]) => (
                      <div key={l} className="fr-field">
                        <label>
                          {l}
                          <span className="fr-field-variance">±{variance} cm</span>
                        </label>
                        <input type="number" value={v} onChange={e => s(e.target.value)}/>
                      </div>
                    ))}
                  </div>

                  {/* Variance explanation */}
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
                    }}>Retake</button>
                    <button className="fr-btn fr-btn--primary" onClick={confirmMeasurements}>Apply</button>
                  </div>
                </div>
              )}
            </div>

            {/* Right column */}
            <div className="scan-info-col">
              <div className="scan-tip-card">
                <p className="scan-tip-heading">Scanning for {segLabel}</p>
                <p className="scan-tip-body">Stand 1.5–2 m away, arms slightly out, full body visible.</p>
                {!hasHeight && camState === 'off' && (
                  <p className="scan-tip-height-hint">↑ Enter height above before scanning for best results.</p>
                )}
                {detectedShape && (
                  <p className="scan-tip-body" style={{ marginTop:'6px', color:'#7a5a1a' }}>
                    Using {detectedShape} shape-tuned multipliers.
                  </p>
                )}
              </div>

              {liveEst && camState === 'on' && !locked && (
                <div className="scan-live-est">
                  <p className="scan-live-heading">Live estimate</p>
                  <div className="scan-live-grid">
                    <div className="scan-live-item"><span className="scan-live-label">Bust</span><span className="scan-live-val">{liveEst.bust} cm</span></div>
                    <div className="scan-live-item"><span className="scan-live-label">Waist</span><span className="scan-live-val">{liveEst.waist} cm</span></div>
                    <div className="scan-live-item"><span className="scan-live-label">Hips</span><span className="scan-live-val">{liveEst.hips} cm</span></div>
                  </div>
                  <div className="scan-conf-bar-wrap">
                    <div className="scan-conf-track">
                      <div className="scan-conf-fill" style={{ width: `${confidence}%`, background: confColor }}/>
                      {/* Lock threshold marker */}
                      <div className="scan-conf-threshold" style={{ left: '65%' }} title="Lock threshold"/>
                    </div>
                    <span className="scan-conf-label" style={{ color: confColor }}>{confidence}%</span>
                  </div>
                  <p className="scan-conf-hint">Lock available at 65%</p>
                </div>
              )}

              <div className="scan-detects-list">
                <p className="scan-detects-heading">This scan detects</p>
                {[
                  'Measurements (bust · waist · hips)',
                  'Body shape — tunes multipliers',
                  'Skin tone & undertone',
                ].map(item => (
                  <div key={item} className="scan-detect-row">
                    <span className="scan-detect-dot"/>
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              {/* Buffer status indicator (only during scan) */}
              {camState === 'on' && (
                <div className="scan-buffer-status">
                  <p className="scan-detects-heading">Clean frames</p>
                  <div className="scan-buffer-bar-wrap">
                    <div className="scan-buffer-track">
                      <div
                        className="scan-buffer-fill"
                        style={{
                          width: `${Math.min((swHistRef.current.length / 40) * 100, 100)}%`,
                          background: swHistRef.current.length >= 40 ? '#1D9E75' : '#EF9F27',
                        }}
                      />
                    </div>
                    <span className="scan-conf-label">{swHistRef.current.length}/40</span>
                  </div>
                  {swHistRef.current.length < 40 && (
                    <p className="scan-conf-hint">Tilted/rotated frames are excluded</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'manual' && (
          <div className="fr-scan-body">
            <div className="scan-tip-card" style={{ marginBottom: '1rem' }}>
              <p className="scan-tip-heading">Manual entry for {segLabel}</p>
              <p className="scan-tip-body">Enter your measurements in centimetres. At least one of bust, waist, or hips is required.</p>
            </div>
            {mErrors._form && <div className="fr-alert fr-alert--err">{mErrors._form}</div>}
            <div className="fr-field-row">
              <div className="fr-field">
                <label>Bust (cm)</label>
                <input type="number" value={mBust}
                  onChange={e => { setMBust(e.target.value); setMErrors(p => ({ ...p, bust: undefined, _form: undefined })) }}
                  placeholder="e.g. 88"/>
                {mErrors.bust && <span className="fr-field-err">{mErrors.bust}</span>}
              </div>
              <div className="fr-field">
                <label>Waist (cm)</label>
                <input type="number" value={mWaist}
                  onChange={e => { setMWaist(e.target.value); setMErrors(p => ({ ...p, waist: undefined, _form: undefined })) }}
                  placeholder="e.g. 70"/>
                {mErrors.waist && <span className="fr-field-err">{mErrors.waist}</span>}
              </div>
            </div>
            <div className="fr-field-row">
              <div className="fr-field">
                <label>Hips (cm)</label>
                <input type="number" value={mHips}
                  onChange={e => { setMHips(e.target.value); setMErrors(p => ({ ...p, hips: undefined, _form: undefined })) }}
                  placeholder="e.g. 95"/>
                {mErrors.hips && <span className="fr-field-err">{mErrors.hips}</span>}
              </div>
              <div className="fr-field">
                <label>Height (cm)</label>
                <input type="number" value={mHeight}
                  onChange={e => { setMHeight(e.target.value); setMErrors(p => ({ ...p, height: undefined })) }}
                  placeholder="e.g. 162"/>
                {mErrors.height && <span className="fr-field-err">{mErrors.height}</span>}
              </div>
            </div>
            <div className="fr-field-row fr-field-row--half">
              <div className="fr-field">
                <label>Weight (kg)</label>
                <input type="number" value={mWeight}
                  onChange={e => { setMWeight(e.target.value); setMErrors(p => ({ ...p, weight: undefined })) }}
                  placeholder="e.g. 58"/>
                {mErrors.weight && <span className="fr-field-err">{mErrors.weight}</span>}
              </div>
            </div>
            <button className="fr-btn fr-btn--primary" onClick={confirmManual}>Apply measurements</button>
          </div>
        )}
      </div>

      {/* Snapshot modal */}
      {showSnapshot && snapshot && (
        <div className="scan-snap-overlay" onClick={() => setShowSnapshot(false)}>
          <div className="scan-snap-modal" onClick={e => e.stopPropagation()}>
            <div className="scan-snap-header">
              <span className="scan-snap-title">Best scan — {snapshot.confidence}% confidence</span>
              <button className="scan-snap-close" onClick={() => setShowSnapshot(false)}>✕</button>
            </div>
            <img src={snapshot.dataUrl} className="scan-snap-img" alt="Best scan capture"/>
            <div className="scan-snap-est">
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
    </SegmentGate>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SIZE PANEL
// ─────────────────────────────────────────────────────────────────────────────

function SizePanel() {
  const { profile, sizeResult, sizes, supplierName } = useFittingRoom()
  const scoreConf  = sizeResult ? Math.min(95, Math.max(10, Math.round(100 - sizeResult.score * 3))) : 0
  const scoreColor = scoreConf >= 75 ? '#1D9E75' : scoreConf >= 55 ? '#EF9F27' : '#E24B4A'
  const segLabel   = SEGMENTS.find(s => s.id === (profile.segment ?? 'women'))?.label || 'Women'

  if (!profile.bust && !profile.waist && !profile.hips) {
    return (
      <div className="fr-panel-empty">
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
          <p className="fr-size-hero-label">Recommended size · {segLabel}</p>
          <p className="fr-size-hero-value">{sizeResult.size?.label ?? '—'}</p>
          <p className="fr-size-hero-supplier">{supplierName || 'Philippine Standard'} size chart</p>
        </div>
        <div className="fr-size-conf-block">
          <p className="fr-size-hero-label">Match confidence</p>
          <p className="fr-size-conf-pct" style={{ color: scoreColor }}>{scoreConf}%</p>
        </div>
      </div>
      <div className="fr-conf-bar-wrap">
        <div className="fr-conf-bar-track">
          <div className="fr-conf-bar-fill" style={{ width: `${scoreConf}%`, background: scoreColor }}/>
        </div>
      </div>

      <div className="fr-size-section">
        <p className="fr-size-section-label">Size range</p>
        <div className="fr-size-pills">
          {sizeResult.adjacent.map(sz => (
            <span key={sz.label} className={`fr-size-pill-lg${sz.label === sizeResult.size?.label ? ' match' : ''}`}>{sz.label}</span>
          ))}
        </div>
      </div>

      <div className="fr-size-section">
        <p className="fr-size-section-label">Your measurements</p>
        <div className="fr-meas-grid-lg">
          {[['Bust', profile.bust, 'cm'], ['Waist', profile.waist, 'cm'], ['Hips', profile.hips, 'cm'],
            ['Height', profile.height, 'cm'], ['Weight', profile.weight, 'kg']].filter(([, v]) => v).map(([l, v, u]) => (
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
          <p className="fr-size-section-label">{supplierName || 'Standard'} chart for {sizeResult.size.label}</p>
          <div className="fr-chart-row">
            {sizeResult.size.bust_min  != null && <span>Bust {sizeResult.size.bust_min}–{sizeResult.size.bust_max} cm</span>}
            {sizeResult.size.waist_min != null && <span>Waist {sizeResult.size.waist_min}–{sizeResult.size.waist_max} cm</span>}
            {sizeResult.size.hip_min   != null && <span>Hips {sizeResult.size.hip_min}–{sizeResult.size.hip_max} cm</span>}
          </div>
        </div>
      )}

      {sizeResult.score > 5 && (
        <div className="fr-alert fr-alert--warn">
          You're near a size boundary. For bridal gowns, size up when in doubt — it's easier to take in than let out.
        </div>
      )}
      {profile.source === 'camera' && (
        <p className="fr-note">Camera estimates carry ±2–6 cm variance depending on height input and body shape. Confirm with a tape measure for bridal orders.</p>
      )}

      <div className="fr-size-section">
        <p className="fr-size-section-label">Full size chart — {segLabel}</p>
        <div className="fr-full-chart">
          <div className="fr-chart-header"><span>Size</span><span>Bust</span><span>Waist</span><span>Hips</span></div>
          {sizes.map(sz => (
            <div key={sz.label} className={`fr-chart-row-item${sz.label === sizeResult.size?.label ? ' fr-chart-row-item--match' : ''}`}>
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
// BODY SHAPE PICKER
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
          className={`fr-shape-card${selected === s.id ? ' sel' : ''}`}
          onClick={() => onChange(s.id)}
          aria-pressed={selected === s.id}
          title={s.desc}
        >
          <div className="fr-shape-figure" style={{ color: selected === s.id ? '#c9a96e' : '#bbb' }}>
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
// SKIN TONE PICKER
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
  neutral: 'Mix of warm and cool',
}

function SkinTonePicker({ selectedTone, selectedUndertone, onToneChange, onUndertoneChange }) {
  return (
    <div>
      <div className="fr-tone-grid">
        {SKIN_TONES.map(t => (
          <button
            key={t.id}
            className={`fr-tone-card${selectedTone === t.id ? ' sel' : ''}`}
            onClick={() => onToneChange(t.id)}
            aria-pressed={selectedTone === t.id}
            title={TONE_DESCRIPTIONS[t.id]}
          >
            <span className="fr-tone-swatch-lg" style={{ background: t.hex }}/>
            <span className="fr-tone-card-label">{t.label}</span>
            <span className="fr-tone-card-desc">{TONE_DESCRIPTIONS[t.id]}</span>
          </button>
        ))}
      </div>
      <p className="fr-style-section-title" style={{ marginTop: '14px', marginBottom: '8px' }}>Undertone</p>
      <div className="fr-undertone-cards">
        {UNDERTONES.map(u => (
          <button
            key={u.id}
            className={`fr-undertone-card${selectedUndertone === u.id ? ' sel' : ''}`}
            onClick={() => onUndertoneChange(u.id)}
            aria-pressed={selectedUndertone === u.id}
          >
            <span className="fr-undertone-swatch" style={{ background: u.hex }}/>
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
  function toggleMulti(key, val, max = 4) {
    const arr = profile[key] || []
    if (arr.includes(val)) updateProfile({ [key]: arr.filter(v => v !== val) })
    else if (arr.length < max) updateProfile({ [key]: [...arr, val] })
  }

  return (
    <SegmentGate>
      <div className="fr-panel-content">
        <div className="fr-style-section">
          <p className="fr-style-section-title">Body shape</p>
          {profile.bodyShape && <p className="fr-scan-detected-note">Auto-detected from camera scan — adjust if needed</p>}
          <BodyShapePicker selected={profile.bodyShape} onChange={v => set('bodyShape', v)}/>
        </div>

        <div className="fr-style-section">
          <p className="fr-style-section-title">Skin tone &amp; undertone</p>
          {(profile.skinTone || profile.undertone) && <p className="fr-scan-detected-note">Auto-detected from camera scan — adjust if needed</p>}
          <SkinTonePicker
            selectedTone={profile.skinTone}
            selectedUndertone={profile.undertone}
            onToneChange={v => set('skinTone', v)}
            onUndertoneChange={v => set('undertone', v)}
          />
        </div>

        <div className="fr-style-section">
          <p className="fr-style-section-title">Occasion</p>
          <div className="fr-occasion-row">
            {OCCASIONS.map(o => (
              <button
                key={o.id}
                className={`fr-occasion-btn${profile.occasion === o.id ? ' sel' : ''}`}
                onClick={() => set('occasion', o.id)}
                aria-pressed={profile.occasion === o.id}
              >{o.label}</button>
            ))}
          </div>
        </div>

        <div
          className="fr-refine-toggle"
          onClick={() => setRefineOpen(v => !v)}
          role="button" tabIndex={0}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setRefineOpen(v => !v)}
        >
          <span>Refine preferences</span>
          <span className={`fr-refine-arrow${refineOpen ? ' open' : ''}`}>▾</span>
        </div>

        {refineOpen && (
          <div className="fr-refine-content">
            <div className="fr-style-section">
              <p className="fr-style-section-title">Preferred colors</p>
              <div className="fr-color-row">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c.id}
                    className={`fr-color-btn${(profile.colors || []).includes(c.id) ? ' sel' : ''}`}
                    onClick={() => toggleMulti('colors', c.id, 4)}
                    aria-label={c.id} aria-pressed={(profile.colors || []).includes(c.id)}
                    title={c.id}
                  >
                    <span className="fr-color-swatch" style={{ background: c.hex }}/>
                    <span>{c.id}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="fr-style-section">
              <p className="fr-style-section-title">Preferred fabrics</p>
              <div className="fr-fabric-row">
                {FABRIC_OPTIONS.map(f => (
                  <button
                    key={f}
                    className={`fr-fabric-btn${(profile.fabrics || []).includes(f) ? ' sel' : ''}`}
                    onClick={() => toggleMulti('fabrics', f, 6)}
                    aria-pressed={(profile.fabrics || []).includes(f)}
                  >{f}</button>
                ))}
              </div>
            </div>
            <div className="fr-style-section">
              <p className="fr-style-section-title">Budget</p>
              <div className="fr-budget-row">
                {BUDGET_RANGES.map(b => (
                  <button
                    key={b.id}
                    className={`fr-budget-btn${profile.budget === b.id ? ' sel' : ''}`}
                    onClick={() => set('budget', b.id)}
                    aria-pressed={profile.budget === b.id}
                  >{b.label}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {!profile.bodyShape && (
          <div className="fr-style-empty"><p>Select your body shape above to see gown recommendations.</p></div>
        )}
        {profile.bodyShape && !styleResults?.length && (
          <div className="fr-style-empty"><p>No matches found. Try relaxing your budget or occasion filter.</p></div>
        )}
        {styleResults?.length > 0 && (
          <div className="fr-style-results">
            <p className="fr-results-label">{styleResults.length} matches · updates as you refine</p>
            <div className="fr-gown-grid">
              {styleResults.map((g, i) => {
                const displayScore = normaliseScore(g._score)
                return (
                  <div key={g.id} className="fr-gown-card" style={{ animationDelay: `${i * 0.05}s` }}>
                    <div className="fr-gown-img">
                      <img src={g.image} alt={g.alt || g.name}/>
                      {i === 0 && <span className="fr-gown-badge">Best match</span>}
                      <span className="fr-gown-rank">#{i + 1}</span>
                    </div>
                    <div className="fr-gown-info">
                      <p className="fr-gown-name">{g.name}</p>
                      <p className="fr-gown-price">{g.price}</p>
                      {g.silhouette && <p className="fr-gown-meta">{g.silhouette}{g.color ? ` · ${g.color}` : ''}</p>}
                      <div className="fr-gown-reasons">
                        {g._reasons.slice(0, 2).map((r, j) => (
                          <div key={j} className="fr-gown-reason">
                            <span className="fr-reason-dot"/>
                            {r}
                          </div>
                        ))}
                      </div>
                      <div className="fr-score-row">
                        <div className="fr-score-bar">
                          <div className="fr-score-fill" style={{ width: `${displayScore}%` }}/>
                        </div>
                        <span className="fr-score-pct">{displayScore}%</span>
                      </div>
                      <div className="fr-gown-actions">
                        <Link href={`/gowns/${g.id}`} className="fr-gown-btn fr-gown-btn--ghost">Details</Link>
                        <Link href={`/fitting-room?gown=${g.id}`} className="fr-gown-btn fr-gown-btn--primary">Try on</Link>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </SegmentGate>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TRY-ON PANEL
// ─────────────────────────────────────────────────────────────────────────────

function TryOnPanel({ initialGownId }) {
  const { gowns, detectorRef, segmenterRef, modelState } = useFittingRoom()
  const [selectedGown, setSelectedGown] = useState(null)
  const [saving,       setSaving      ] = useState(false)
  const [saveMsg,      setSaveMsg     ] = useState('')

  useEffect(() => {
    if (!gowns.length) return
    const chosen = (initialGownId ? gowns.find(g => String(g.id) === String(initialGownId)) : null) || gowns[0]
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
        <p className={`fr-save-msg${saveMsg.startsWith('✓') ? ' ok' : ' err'}`}
          style={{ padding: '4px 12px', fontSize: '12px' }}>{saveMsg}</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SKELETON LOADER
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonLoader() {
  return (
    <main style={{ minHeight: '100vh', background: '#faf9f7' }}>
      <div style={{ height: '72px', background: '#1a1108' }}/>
      <div style={{ background: '#1a1108', padding: '2.5rem 1.5rem 2rem' }}>
        <div className="sk-line" style={{ width: '80px', height: '10px', marginBottom: '12px' }}/>
        <div className="sk-line" style={{ width: '340px', height: '36px', marginBottom: '12px' }}/>
        <div className="sk-line" style={{ width: '420px', height: '13px' }}/>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', maxWidth: '1160px', margin: '0 auto' }}>
        <div style={{ padding: '1.25rem', borderRight: '1px solid #eee', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="sk-line" style={{ height: '14px', width: '80px' }}/>
          <div className="sk-line" style={{ height: '80px' }}/>
          <div className="sk-line" style={{ height: '60px' }}/>
        </div>
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[1,2,3,4].map(i => <div key={i} className="sk-line" style={{ flex: 1, height: '72px', borderRadius: '8px' }}/>)}
          </div>
          <div className="sk-line" style={{ height: '320px', borderRadius: '10px' }}/>
        </div>
      </div>
      <style>{`
        .sk-line { background: linear-gradient(90deg, #e8e3db 25%, #f5f0e8 50%, #e8e3db 75%);
          background-size: 200% 100%; animation: sk-shimmer 1.4s ease-in-out infinite; border-radius: 6px; }
        @keyframes sk-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

const PANELS = [
  { id: 'scan',  label: 'Scan',   sub: 'Measure & detect' },
  { id: 'size',  label: 'Size',   sub: 'Find your fit'    },
  { id: 'style', label: 'Style',  sub: 'Gown matches'     },
  { id: 'tryon', label: 'Try On', sub: 'See it on you'    },
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
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const user = mounted ? getCurrentUser() : null

  const [cmsContent, setCmsContent] = useState({
    heading:    'My Fitting Room',
    subheading: 'Find your size, match your style, try on virtually.',
  })

  useEffect(() => {
    fetch('/api/cms/content?section=fitting-room')
      .then(r => r.json())
      .then(d => { if (d.ok && d.fields) setCmsContent(prev => ({ ...prev, ...d.fields })) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setMounted(true)
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
          updateProfile({ bodyShape: p.bodyType || null, skinTone: p.skinTone || null, occasion: p.styleTags?.[0] || null, colors: p.preferredColors || [] })
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
          body: JSON.stringify({
            bust_cm: profile.bust ?? null, waist_cm: profile.waist ?? null,
            hips_cm: profile.hips ?? null, height_cm: profile.height ?? null,
            weight_kg: profile.weight ?? null, source: profile.source ?? 'manual',
          }),
        }).then(r => r.json()),
        fetch('/api/auth/save-style-prefs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
          body: JSON.stringify({
            bodyType: profile.bodyShape || null, skinTone: profile.skinTone || null,
            styleTags: profile.occasion ? [profile.occasion] : [],
            preferredSilhouettes: [], preferredColors: profile.colors || [],
          }),
        }).then(r => r.json()),
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
          <h1 className="fr-h1">{cmsContent.heading}</h1>
          <p className="fr-hero-sub">{cmsContent.subheading}</p>
        </div>
      </section>

      <div className={`fr-layout${sidebarOpen ? '' : ' fr-layout--collapsed'}`}>
        <ProfileSidebar
          user={user}
          onSave={saveProfile}
          saving={saving}
          saveMsg={saveMsg}
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(v => !v)}
        />

        <div className="fr-main">
          <nav className="fr-panel-nav" aria-label="Fitting room sections">
            {PANELS.map((p, i) => {
              const isActive = activePanel === p.id
              const hasBadge = (p.id === 'size' && sizeResult?.size) || (p.id === 'scan' && profile.bust)
              return (
                <button
                  key={p.id}
                  className={`fr-panel-tab${isActive ? ' active' : ''}`}
                  onClick={() => setActivePanel(p.id)}
                  aria-selected={isActive}
                  role="tab"
                >
                  <span className="fr-tab-step">{i + 1}</span>
                  <div className="fr-tab-text">
                    <span className="fr-tab-label">{p.label}</span>
                    <span className="fr-tab-sub">{p.sub}</span>
                  </div>
                  {hasBadge && (
                    <span className="fr-panel-badge">
                      {p.id === 'size' ? sizeResult.size.label : 'Done'}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>

          <div className="fr-panel-body" role="tabpanel">
            {activePanel === 'scan'  && <ScanPanel/>}
            {activePanel === 'size'  && <SizePanel/>}
            {activePanel === 'style' && <StylePanel/>}
            {activePanel === 'tryon' && <TryOnPanel initialGownId={gownId}/>}
          </div>
        </div>
      </div>

      <Footer/>

      <style suppressHydrationWarning>{`
        /* ── Page shell ── */
        .fr-page { min-height:100vh; display:flex; flex-direction:column; background:#faf9f7; }
        .fr-spacer { height:72px; }
        .fr-hero { background:#2c1a0e; padding:2rem 2.5rem; }
        .fr-hero-inner { max-width:680px; margin:0 auto; }
        .fr-eyebrow { font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:#c9a96e; display:block; margin-bottom:8px; font-weight:500; }
        .fr-h1 { font-size:clamp(1.8rem,3.5vw,2.4rem); font-weight:400; color:#faf9f7; margin:0 0 8px; line-height:1.12; font-family:'Georgia',serif; }
        .fr-hero-sub { font-size:13px; color:rgba(250,249,247,.55); line-height:1.65; max-width:520px; }

        /* ── Layout grid ── */
        .fr-layout { display:grid; grid-template-columns:220px 1fr; max-width:1160px; margin:0 auto; width:100%; min-height:calc(100vh - 200px); transition:grid-template-columns .2s ease; }
        .fr-layout--collapsed { grid-template-columns:36px 1fr; }

        /* ── Sidebar ── */
        .fr-sidebar { background:#fff; border-right:1px solid #eee; padding:1.25rem; display:flex; flex-direction:column; gap:0; position:sticky; top:72px; height:calc(100vh - 72px); overflow-y:auto; overflow-x:hidden; transition:padding .2s ease; }
        .fr-layout--collapsed .fr-sidebar { padding:8px 4px; align-items:center; }
        .fr-sidebar-header { padding-bottom:.875rem; border-bottom:1px solid #f0ede8; display:flex; flex-direction:column; gap:2px; position:relative; }
        .fr-layout--collapsed .fr-sidebar-header { border-bottom:none; padding-bottom:0; align-items:center; }
        .fr-sidebar-eyebrow { font-size:10px; letter-spacing:.35em; text-transform:uppercase; color:#c9a96e; display:block; }
        .fr-sidebar-user { font-size:12px; color:#888; display:block; margin-top:2px; }
        .fr-sidebar-section { padding:.875rem 0; border-bottom:1px solid #f0ede8; }
        .fr-sidebar-section:last-child { border-bottom:none; }
        .fr-sidebar-label { font-size:10px; letter-spacing:.2em; text-transform:uppercase; color:#aaa; margin-bottom:7px; }
        .fr-sidebar-empty { font-size:12px; color:#bbb; line-height:1.5; }
        .fr-sidebar-manual { background:#faf9f7; border-radius:8px; padding:10px; }
        .fr-sidebar-seg-row { display:flex; gap:4px; }
        .fr-seg-mini { flex:1; padding:5px 4px; border:1px solid #e0ddd8; border-radius:6px; font-size:10px; font-weight:500; color:#888; background:#fff; cursor:pointer; transition:all .13s; }
        .fr-seg-mini.sel { background:#fff8ee; border-color:#c9a96e; color:#7a5a1a; }
        .fr-seg-mini:hover:not(.sel) { border-color:#c9a96e; }
        .fr-meas-grid { display:flex; flex-direction:column; gap:4px; }
        .fr-meas-chip { display:flex; justify-content:space-between; font-size:12px; padding:3px 0; }
        .fr-meas-key { color:#999; }
        .fr-meas-val { font-weight:500; color:#333; }
        .fr-sidebar-size { background:linear-gradient(135deg,#faf6ee,#fff); border-radius:10px; padding:10px; margin:0 -4px; border:1px solid #f0e8d0; }
        .fr-size-display { display:flex; align-items:flex-end; justify-content:space-between; margin-bottom:7px; }
        .fr-size-label { font-size:2rem; font-weight:300; color:#1a1108; font-family:'Georgia',serif; line-height:1; }
        .fr-size-conf { display:flex; align-items:center; gap:5px; }
        .fr-conf-bar { flex:1; height:3px; background:#eee; border-radius:2px; overflow:hidden; min-width:50px; }
        .fr-conf-fill { height:100%; border-radius:2px; transition:width .4s; }
        .fr-size-range { display:flex; gap:4px; flex-wrap:wrap; }
        .fr-size-pill { padding:2px 8px; border-radius:20px; font-size:10px; border:1px solid #ddd; color:#888; }
        .fr-size-pill--match { background:#fff8ee; border-color:#c9a96e; color:#7a5a1a; }
        .fr-profile-chips { display:flex; flex-wrap:wrap; gap:4px; }
        .fr-chip { font-size:10px; padding:3px 8px; border-radius:20px; background:#f0ede8; color:#666; display:flex; align-items:center; gap:4px; }
        .fr-chip-swatch { width:10px; height:10px; border-radius:50%; }
        .fr-save-btn { width:100%; padding:8px; background:#1a1108; color:#faf9f7; border:none; border-radius:7px; font-size:12px; font-weight:500; cursor:pointer; transition:background .2s; }
        .fr-save-btn:hover:not(:disabled) { background:#3d2c14; }
        .fr-save-btn:disabled { opacity:.5; cursor:not-allowed; }
        .fr-save-msg { font-size:11px; margin-top:4px; }
        .fr-save-msg.ok { color:#1D9E75; }
        .fr-save-msg.err { color:#A32D2D; }
        .fr-manual-grid { display:flex; flex-direction:column; gap:6px; }
        .fr-manual-field { display:flex; align-items:center; gap:6px; font-size:11px; color:#888; }
        .fr-manual-field span:first-child { width:36px; flex-shrink:0; }
        .fr-manual-field input { flex:1; padding:4px 7px; border:1px solid #e0ddd8; border-radius:5px; font-size:12px; background:#fff; min-width:0; }
        .fr-manual-field input:focus { outline:none; border-color:#c9a96e; }
        .fr-manual-unit { color:#bbb; font-size:10px; }
        .fr-sidebar-collapse-btn { margin-top:8px; background:none; border:1px solid #e0ddd8; border-radius:6px; width:24px; height:24px; cursor:pointer; font-size:15px; color:#aaa; display:flex; align-items:center; justify-content:center; line-height:1; transition:all .15s; flex-shrink:0; align-self:flex-start; }
        .fr-sidebar-collapse-btn:hover { border-color:#c9a96e; color:#c9a96e; }
        .fr-layout--collapsed .fr-sidebar-collapse-btn { width:28px; height:28px; margin-top:4px; align-self:center; font-size:16px; }

        /* ── Segment gate ── */
        .sg-wrap { display:flex; flex-direction:column; }
        .sg-picker { padding:1rem 1.25rem; border-bottom:1px solid #f0ede8; background:#fff; }
        .sg-label { font-size:11px; font-weight:600; color:#aaa; text-transform:uppercase; letter-spacing:.12em; margin-bottom:8px; }
        .sg-row { display:flex; gap:6px; }
        .sg-btn { flex:1; padding:10px 8px; border:1.5px solid #e0ddd8; border-radius:8px; font-size:13px; font-weight:500; color:#888; background:#fff; cursor:pointer; font-family:inherit; transition:all .13s; }
        .sg-btn:hover { border-color:#c9a96e; }
        .sg-btn--sel { background:#fff8ee; border-color:#c9a96e; color:#7a5a1a; }

        /* ── Panel nav ── */
        .fr-main { display:flex; flex-direction:column; min-height:0; }
        .fr-panel-nav { display:flex; background:#fff; border-bottom:2px solid #f0ede8; position:sticky; top:72px; z-index:10; overflow-x:auto; scrollbar-width:none; }
        .fr-panel-nav::-webkit-scrollbar { display:none; }
        .fr-panel-tab { flex:1; min-width:90px; padding:12px 10px 11px; border:none; background:none; cursor:pointer; display:flex; align-items:center; gap:8px; position:relative; transition:background .15s; border-bottom:3px solid transparent; margin-bottom:-2px; }
        .fr-panel-tab:hover { background:#faf9f7; }
        .fr-panel-tab.active { background:#fff8ee; border-bottom-color:#c9a96e; }
        .fr-tab-step { width:20px; height:20px; border-radius:50%; border:1.5px solid #ddd; display:flex; align-items:center; justify-content:center; font-size:10px; color:#aaa; flex-shrink:0; font-weight:600; transition:all .15s; }
        .fr-panel-tab.active .fr-tab-step { background:#c9a96e; border-color:#c9a96e; color:#fff; }
        .fr-tab-text { display:flex; flex-direction:column; align-items:flex-start; min-width:0; }
        .fr-tab-label { font-size:12px; font-weight:600; color:#888; white-space:nowrap; }
        .fr-panel-tab.active .fr-tab-label { color:#1a1108; }
        .fr-tab-sub { font-size:10px; color:#bbb; white-space:nowrap; }
        .fr-panel-tab.active .fr-tab-sub { color:#c9a96e; }
        .fr-panel-badge { margin-left:auto; font-size:9px; background:#c9a96e; color:#fff; padding:2px 6px; border-radius:10px; font-weight:600; white-space:nowrap; }
        .fr-panel-body { flex:1; overflow-y:auto; }
        .fr-panel-content { padding:1.25rem; display:flex; flex-direction:column; gap:1rem; }
        .fr-panel-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:4rem 2rem; gap:10px; text-align:center; }
        .fr-empty-title { font-size:16px; font-weight:500; color:#333; }
        .fr-empty-sub { font-size:13px; color:#999; line-height:1.6; max-width:320px; }

        /* ── Tab row inside panel ── */
        .fr-tab-row { display:flex; border-bottom:1px solid #f0ede8; margin:-1.25rem -1.25rem 1rem; }
        .fr-tab { flex:1; padding:11px; font-size:12px; font-weight:500; border:none; background:none; cursor:pointer; color:#aaa; border-bottom:2px solid transparent; transition:all .15s; font-family:inherit; }
        .fr-tab.active { color:#1a1108; border-bottom-color:#c9a96e; }

        /* ── Height pre-scan prompt ── */
        .scan-height-prompt { background:#fff8ee; border:1px solid #f0e0b0; border-radius:10px; padding:14px; margin-bottom:10px; }
        .scan-height-label { display:flex; align-items:center; justify-content:space-between; font-size:12px; font-weight:600; color:#7a5a1a; margin-bottom:8px; }
        .scan-height-badge { font-size:10px; background:#c9a96e; color:#fff; padding:2px 7px; border-radius:10px; font-weight:500; }
        .scan-height-row { display:flex; align-items:center; gap:8px; }
        .scan-height-input { flex:1; padding:8px 10px; border:1px solid #e0c070; border-radius:7px; font-size:14px; background:#fff; font-family:inherit; }
        .scan-height-input:focus { outline:none; border-color:#c9a96e; box-shadow:0 0 0 2px rgba(201,169,110,.12); }
        .scan-height-unit { font-size:13px; color:#9a7030; font-weight:500; }
        .scan-height-hint { font-size:11px; color:#c9a96e; margin-top:7px; line-height:1.4; }

        /* ── Scanner layout ── */
        .scan-layout { display:grid; grid-template-columns:1fr 280px; gap:1.25rem; align-items:start; }
        .scan-cam-wrap { display:flex; flex-direction:column; gap:.75rem; }
        .fr-cam-area { position:relative; background:#111; border-radius:12px; overflow:hidden; aspect-ratio:4/3; }
        .fr-cam-ph { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; }
        .cam-ph-icon { color:rgba(255,255,255,.25); }
        .cam-ph-text { color:rgba(255,255,255,.35); font-size:12px; }
        .cam-ph-bar { width:120px; height:2px; background:rgba(255,255,255,.1); border-radius:2px; overflow:hidden; }
        .cam-ph-bar-fill { height:100%; background:#c9a96e; border-radius:2px; animation:cam-load 2s ease-in-out infinite; }
        @keyframes cam-load { 0%{width:0;opacity:1} 80%{width:100%;opacity:1} 100%{width:100%;opacity:0} }
        .cam-fs-btn { position:absolute; top:10px; left:10px; width:30px; height:30px; background:rgba(0,0,0,.55); border:1px solid rgba(255,255,255,.15); border-radius:6px; color:rgba(255,255,255,.75); cursor:pointer; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px); transition:background .15s; z-index:10; }
        .cam-fs-btn:hover { background:rgba(0,0,0,.85); color:#fff; }
        .scan-cam-wrap--fs { position:fixed !important; inset:0 !important; z-index:9999 !important; background:#000; display:flex; flex-direction:column; border-radius:0 !important; gap:0 !important; }
        .scan-cam-wrap--fs .fr-cam-area { flex:1; border-radius:0; aspect-ratio:unset; }
        .scan-cam-wrap--fs .scan-controls { padding:12px 16px; background:#111; }
        .scan-cam-wrap--fs .scan-locked { background:#1a1a1a; border-color:#333; padding:16px; border-radius:0; }
        .scan-cam-wrap--fs .fr-field label { color:#aaa; }
        .scan-cam-wrap--fs .fr-field input { background:#222; border-color:#444; color:#eee; }
        .scan-cam-wrap--fs .fr-btn--ghost { border-color:#555; color:#aaa; background:transparent; }
        .scan-cam-wrap--fs .fr-note { color:#777; }
        .scan-cam-wrap:fullscreen { width:100vw; height:100vh; background:#000; display:flex; flex-direction:column; gap:0; }
        .scan-cam-wrap:fullscreen .fr-cam-area { flex:1; border-radius:0; aspect-ratio:unset; }
        .scan-cam-wrap:fullscreen .scan-controls { padding:12px 16px; background:#111; }
        .scan-cam-wrap:fullscreen .scan-locked { background:#1a1a1a; color:#eee; border-color:#333; padding:16px; border-radius:0; }
        .cam-conf-ring-wrap { position:absolute; top:10px; right:10px; }
        .fr-cam-hud { position:absolute; bottom:8px; left:8px; right:8px; background:rgba(0,0,0,.65); border-radius:8px; padding:7px 10px; display:flex; align-items:center; gap:7px; backdrop-filter:blur(4px); }
        .fr-hud-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; transition:background .3s; }
        .fr-hud-text { font-size:11px; color:rgba(255,255,255,.8); flex:1; line-height:1.3; }
        .fr-cam-badges { position:absolute; top:10px; left:48px; display:flex; gap:4px; flex-wrap:wrap; }
        .fr-cam-badge { font-size:10px; font-weight:500; padding:3px 8px; border-radius:12px; background:rgba(26,17,8,.8); color:#fff; display:flex; align-items:center; gap:3px; backdrop-filter:blur(4px); }
        .scan-controls { display:flex; flex-direction:column; gap:8px; }
        .scan-btn-full { width:100%; justify-content:center; }
        .scan-btn-pair { display:flex; gap:7px; }
        .scan-btn-pair .fr-btn { flex:1; justify-content:center; }
        .scan-locked { background:#faf9f7; border:1px solid #f0ede8; border-radius:10px; padding:14px; display:flex; flex-direction:column; gap:10px; }
        .scan-locked-header { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
        .scan-locked-detections { display:flex; gap:6px; flex-wrap:wrap; }
        .scan-detection-tag { display:flex; align-items:center; gap:5px; font-size:11px; color:#888; background:#f0ede8; padding:3px 8px; border-radius:12px; }
        .scan-detection-tag--mults { background:#fff8ee; color:#7a5a1a; border:1px solid #f0e0b0; }
        .scan-snapshot-btn { width:100%; justify-content:center; gap:6px; font-size:11px; padding:7px 12px; border-style:dashed; color:#c9a96e; border-color:#e8d9b8; }
        .scan-snapshot-btn:hover { background:#fff8ee !important; }

        /* Per-field variance label */
        .fr-field-variance { font-size:10px; color:#c9a96e; font-weight:400; margin-left:5px; }

        /* Variance explanation row */
        .scan-variance-row { display:flex; align-items:flex-start; gap:6px; font-size:11px; color:#aaa; line-height:1.5; background:#f9f7f5; border-radius:7px; padding:8px 10px; }

        /* Buffer status */
        .scan-buffer-status { background:#fff; border:1px solid #f0ede8; border-radius:10px; padding:14px; }
        .scan-buffer-bar-wrap { display:flex; align-items:center; gap:8px; margin-top:6px; }
        .scan-buffer-track { flex:1; height:4px; background:#f0ede8; border-radius:2px; overflow:hidden; }
        .scan-buffer-fill { height:100%; border-radius:2px; transition:width .4s, background .4s; }

        /* Confidence threshold marker on bar */
        .scan-conf-track { position:relative; flex:1; height:4px; background:#f0ede8; border-radius:2px; overflow:hidden; }
        .scan-conf-threshold { position:absolute; top:0; bottom:0; width:2px; background:rgba(26,17,8,.25); }
        .scan-conf-hint { font-size:10px; color:#bbb; margin-top:4px; }

        /* Snapshot modal */
        .scan-snap-overlay { position:fixed; inset:0; background:rgba(0,0,0,.72); z-index:10000; display:flex; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(4px); animation:fadeIn .18s ease; }
        .scan-snap-modal { background:#fff; border-radius:14px; overflow:hidden; width:100%; max-width:420px; display:flex; flex-direction:column; box-shadow:0 24px 60px rgba(0,0,0,.35); animation:slideUp .2s ease; }
        @keyframes slideUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:none} }
        .scan-snap-header { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid #f0ede8; }
        .scan-snap-title { font-size:13px; font-weight:600; color:#1a1108; }
        .scan-snap-close { background:none; border:none; cursor:pointer; font-size:14px; color:#aaa; width:28px; height:28px; border-radius:6px; display:flex; align-items:center; justify-content:center; transition:background .15s; }
        .scan-snap-close:hover { background:#f5f3ef; color:#333; }
        .scan-snap-img { width:100%; display:block; max-height:380px; object-fit:contain; background:#111; }
        .scan-snap-est { display:grid; grid-template-columns:repeat(3,1fr); border-top:1px solid #f0ede8; }
        .scan-snap-stat { display:flex; flex-direction:column; align-items:center; padding:12px 8px; gap:3px; border-right:1px solid #f0ede8; }
        .scan-snap-stat:last-child { border-right:none; }
        .scan-snap-stat span { font-size:10px; color:#aaa; text-transform:uppercase; letter-spacing:.1em; }
        .scan-snap-stat strong { font-size:17px; font-weight:500; color:#1a1108; font-family:'Georgia',serif; }
        .scan-snap-actions { padding:12px 16px 16px; }
        .scan-snap-actions .fr-btn { width:100%; justify-content:center; }

        /* Scanner info column */
        .scan-info-col { display:flex; flex-direction:column; gap:.75rem; }
        .scan-tip-card { background:#fff8ee; border:1px solid #f0e0b0; border-radius:10px; padding:14px; }
        .scan-tip-heading { font-size:12px; font-weight:600; color:#7a5a1a; margin-bottom:5px; }
        .scan-tip-body { font-size:12px; color:#9a7030; line-height:1.5; }
        .scan-tip-height-hint { font-size:11px; color:#c9a96e; margin-top:6px; font-weight:500; line-height:1.4; }
        .scan-live-est { background:#fff; border:1px solid #f0ede8; border-radius:10px; padding:14px; }
        .scan-live-heading { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.12em; color:#aaa; margin-bottom:10px; }
        .scan-live-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:10px; }
        .scan-live-item { text-align:center; }
        .scan-live-label { display:block; font-size:10px; color:#aaa; margin-bottom:3px; }
        .scan-live-val { display:block; font-size:16px; font-weight:500; color:#1a1108; font-family:'Georgia',serif; }
        .scan-conf-bar-wrap { display:flex; align-items:center; gap:8px; }
        .scan-conf-fill { height:100%; border-radius:2px; transition:width .4s, background .4s; }
        .scan-conf-label { font-size:11px; font-weight:600; min-width:30px; text-align:right; }
        .scan-detects-list { background:#fff; border:1px solid #f0ede8; border-radius:10px; padding:14px; }
        .scan-detects-heading { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.12em; color:#aaa; margin-bottom:10px; }
        .scan-detect-row { display:flex; align-items:center; gap:8px; font-size:12px; color:#666; padding:4px 0; }
        .scan-detect-dot { width:4px; height:4px; border-radius:50%; background:#c9a96e; flex-shrink:0; }

        /* ── Shared form elements ── */
        .fr-scan-body { display:flex; flex-direction:column; gap:.75rem; }
        .fr-field-row { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .fr-field-row--half { grid-template-columns:1fr; max-width:50%; }
        .fr-field { display:flex; flex-direction:column; gap:4px; }
        .fr-field label { font-size:11px; color:#888; font-weight:500; display:flex; align-items:center; gap:0; }
        .fr-field input { padding:8px 10px; border:1px solid #e0ddd8; border-radius:7px; font-size:13px; background:#fff; font-family:inherit; }
        .fr-field input:focus { outline:none; border-color:#c9a96e; box-shadow:0 0 0 2px rgba(201,169,110,.12); }
        .fr-field-err { font-size:10px; color:#A32D2D; }
        .fr-btn-row { display:flex; gap:7px; flex-wrap:wrap; }
        .fr-btn { padding:8px 14px; border-radius:7px; font-size:12px; font-weight:500; cursor:pointer; border:1px solid #ddd; background:#fff; color:#333; display:inline-flex; align-items:center; gap:5px; text-decoration:none; transition:background .15s; font-family:inherit; }
        .fr-btn:hover:not(:disabled) { background:#f5f5f5; }
        .fr-btn:disabled { opacity:.4; cursor:not-allowed; }
        .fr-btn--primary { background:#1a1108; border-color:#1a1108; color:#faf9f7; }
        .fr-btn--primary:hover:not(:disabled) { background:#3d2c14; }
        .fr-btn--ghost { background:transparent; border-color:#e0ddd8; color:#666; }
        .fr-badge { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:20px; font-size:10px; font-weight:500; }
        .fr-badge--ok { background:#eaf3de; color:#27500a; border:1px solid #97c459; }
        .fr-badge--warn { background:#faeeda; color:#633806; border:1px solid #fac775; }
        .fr-alert { font-size:12px; padding:9px 12px; border-radius:7px; line-height:1.4; }
        .fr-alert--err { background:#fcebeb; color:#501313; border:1px solid #f09595; }
        .fr-alert--warn { background:#faeeda; color:#633806; border:1px solid #fac775; }
        .fr-note { font-size:11px; color:#aaa; line-height:1.5; }
        .fr-spin { display:inline-block; width:11px; height:11px; border:2px solid rgba(255,255,255,.3); border-top-color:#fff; border-radius:50%; animation:spin .7s linear infinite; }
        @keyframes spin { to { transform:rotate(360deg); } }

        /* ── Size panel ── */
        .fr-size-hero { display:flex; justify-content:space-between; align-items:flex-end; padding:1.25rem; background:linear-gradient(135deg,#faf6ee,#fff7f0); border-radius:10px; margin:-1.25rem -1.25rem 0; }
        .fr-size-hero-label { font-size:10px; color:#aaa; text-transform:uppercase; letter-spacing:.15em; margin-bottom:4px; }
        .fr-size-hero-value { font-size:3.5rem; font-weight:300; color:#1a1108; line-height:1; font-family:'Georgia',serif; }
        .fr-size-hero-supplier { font-size:11px; color:#c9a96e; margin-top:2px; }
        .fr-size-conf-pct { font-size:1.4rem; font-weight:500; }
        .fr-conf-bar-wrap { margin-top:-.5rem; }
        .fr-conf-bar-track { height:3px; background:#f0ede8; border-radius:2px; overflow:hidden; }
        .fr-conf-bar-fill { height:100%; border-radius:2px; transition:width .5s; }
        .fr-size-section { display:flex; flex-direction:column; gap:8px; }
        .fr-size-section-label { font-size:10px; text-transform:uppercase; letter-spacing:.2em; color:#aaa; }
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
        .fr-chart-header { display:grid; grid-template-columns:70px 1fr 1fr 1fr; padding:8px 12px; background:#f9f7f5; color:#aaa; font-size:10px; text-transform:uppercase; letter-spacing:.1em; }
        .fr-chart-row-item { display:grid; grid-template-columns:70px 1fr 1fr 1fr; padding:7px 12px; border-top:1px solid #f5f3ef; color:#666; }
        .fr-chart-row-item--match { background:#fff8ee; color:#7a5a1a; }
        .fr-chart-size-label { font-weight:500; color:#1a1108; }

        /* ── Style panel ── */
        .fr-style-section { display:flex; flex-direction:column; gap:8px; }
        .fr-style-section-title { font-size:10px; text-transform:uppercase; letter-spacing:.2em; color:#aaa; }
        .fr-scan-detected-note { font-size:11px; color:#c9a96e; }
        .fr-shape-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
        .fr-shape-card { padding:10px 6px 8px; border:1.5px solid #e0ddd8; border-radius:10px; cursor:pointer; background:#fff; display:flex; flex-direction:column; align-items:center; gap:4px; transition:all .15s; font-family:inherit; }
        .fr-shape-card:hover { border-color:#c9a96e; background:#faf6ee; }
        .fr-shape-card.sel { background:#fff8ee; border-color:#c9a96e; box-shadow:0 0 0 2px rgba(201,169,110,.15); }
        .fr-shape-figure { height:52px; display:flex; align-items:center; justify-content:center; }
        .fr-shape-svg { width:28px; display:block; }
        .fr-shape-card-label { font-size:11px; font-weight:600; color:#333; text-align:center; }
        .fr-shape-card.sel .fr-shape-card-label { color:#7a5a1a; }
        .fr-shape-card-desc { font-size:9px; color:#aaa; text-align:center; line-height:1.3; }
        .fr-tone-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
        .fr-tone-card { padding:10px 6px 8px; border:1.5px solid #e0ddd8; border-radius:10px; cursor:pointer; background:#fff; display:flex; flex-direction:column; align-items:center; gap:5px; transition:all .15s; font-family:inherit; }
        .fr-tone-card:hover { border-color:#c9a96e; }
        .fr-tone-card.sel { background:#fff8ee; border-color:#c9a96e; box-shadow:0 0 0 2px rgba(201,169,110,.15); }
        .fr-tone-swatch-lg { width:36px; height:36px; border-radius:50%; border:2px solid rgba(0,0,0,.08); display:block; }
        .fr-tone-card-label { font-size:11px; font-weight:600; color:#333; }
        .fr-tone-card.sel .fr-tone-card-label { color:#7a5a1a; }
        .fr-tone-card-desc { font-size:9px; color:#aaa; text-align:center; line-height:1.3; }
        .fr-undertone-cards { display:flex; gap:8px; }
        .fr-undertone-card { flex:1; padding:10px 12px; border:1.5px solid #e0ddd8; border-radius:10px; cursor:pointer; background:#fff; display:flex; align-items:center; gap:10px; transition:all .15s; font-family:inherit; }
        .fr-undertone-card:hover { border-color:#c9a96e; }
        .fr-undertone-card.sel { background:#fff8ee; border-color:#c9a96e; }
        .fr-undertone-swatch { width:22px; height:22px; border-radius:50%; border:1.5px solid rgba(0,0,0,.1); flex-shrink:0; }
        .fr-undertone-card-label { font-size:12px; font-weight:600; color:#333; display:block; }
        .fr-undertone-card.sel .fr-undertone-card-label { color:#7a5a1a; }
        .fr-undertone-card-desc { font-size:10px; color:#aaa; display:block; line-height:1.3; }
        .fr-occasion-row { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
        .fr-occasion-btn { padding:10px 8px; border:1.5px solid #e0ddd8; border-radius:8px; cursor:pointer; background:#fff; display:flex; flex-direction:column; align-items:center; gap:4px; font-size:11px; color:#666; transition:all .15s; font-family:inherit; }
        .fr-occasion-btn:hover { border-color:#c9a96e; }
        .fr-occasion-btn.sel { background:#fff8ee; border-color:#c9a96e; color:#7a5a1a; font-weight:500; }
        .fr-refine-toggle { display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-top:1px solid #f0ede8; border-bottom:1px solid #f0ede8; cursor:pointer; font-size:12px; font-weight:500; color:#888; user-select:none; }
        .fr-refine-toggle:focus-visible { outline:2px solid #c9a96e; border-radius:4px; }
        .fr-refine-arrow { transition:transform .2s; display:inline-block; }
        .fr-refine-arrow.open { transform:rotate(180deg); }
        .fr-refine-content { display:flex; flex-direction:column; gap:.75rem; padding-top:.75rem; }
        .fr-color-row { display:flex; flex-wrap:wrap; gap:6px; }
        .fr-color-btn { display:flex; flex-direction:column; align-items:center; gap:3px; padding:6px 8px; border:1.5px solid #e0ddd8; border-radius:8px; cursor:pointer; background:#fff; font-size:10px; color:#888; transition:all .15s; font-family:inherit; }
        .fr-color-btn.sel { border-color:#c9a96e; background:#fff8ee; }
        .fr-color-swatch { width:28px; height:28px; border-radius:50%; border:1px solid rgba(0,0,0,.08); }
        .fr-fabric-row { display:flex; flex-wrap:wrap; gap:5px; }
        .fr-fabric-btn { padding:5px 11px; border:1px solid #e0ddd8; border-radius:20px; font-size:11px; cursor:pointer; color:#888; background:#fff; transition:all .15s; font-family:inherit; }
        .fr-fabric-btn.sel { background:#fff8ee; border-color:#c9a96e; color:#7a5a1a; }
        .fr-budget-row { display:flex; flex-direction:column; gap:5px; }
        .fr-budget-btn { padding:8px 12px; border:1px solid #e0ddd8; border-radius:7px; font-size:12px; cursor:pointer; color:#666; background:#fff; text-align:left; transition:all .15s; font-family:inherit; }
        .fr-budget-btn.sel { background:#fff8ee; border-color:#c9a96e; color:#7a5a1a; font-weight:500; }
        .fr-style-empty { padding:1.5rem; text-align:center; color:#bbb; font-size:13px; background:#f9f7f5; border-radius:8px; }
        .fr-style-results { display:flex; flex-direction:column; gap:.75rem; }
        .fr-results-label { font-size:11px; color:#aaa; }
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

        /* ── Try-on ── */
        .fr-tryon-layout { height:calc(100vh - 152px); min-height:600px; display:flex; flex-direction:column; }

        /* ── Responsive ── */
        @media (max-width:1024px) {
          .fr-layout { grid-template-columns:190px 1fr; }
          .fr-layout--collapsed { grid-template-columns:36px 1fr; }
          .scan-layout { grid-template-columns:1fr 220px; }
        }
        @media (max-width:860px) {
          .fr-layout { grid-template-columns:1fr; }
          .fr-layout--collapsed { grid-template-columns:1fr; }
          .fr-sidebar { position:static; height:auto; display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:0; padding:10px 12px; border-right:none; border-bottom:1px solid #eee; overflow:visible; }
          .fr-layout--collapsed .fr-sidebar { display:flex; flex-direction:row; align-items:center; justify-content:flex-end; padding:6px 12px; }
          .fr-sidebar-header { grid-column:1/-1; padding-bottom:6px; border-bottom:1px solid #f0ede8; margin-bottom:4px; flex-direction:row; align-items:center; justify-content:space-between; }
          .fr-sidebar-collapse-btn { margin-top:0; }
          .fr-sidebar-section { padding:6px 8px; border-bottom:none; border-right:1px solid #f0ede8; }
          .fr-sidebar-section:last-child { border-right:none; }
          .fr-sidebar-manual { display:none; }
          .fr-panel-nav { position:fixed; bottom:0; left:0; right:0; top:auto; z-index:100; border-top:1px solid #eee; border-bottom:none; box-shadow:0 -2px 12px rgba(0,0,0,.06); }
          .fr-panel-tab { flex-direction:column; gap:2px; padding:8px 4px 6px; align-items:center; min-width:0; }
          .fr-tab-step { display:none; }
          .fr-tab-text { align-items:center; }
          .fr-tab-sub { display:none; }
          .fr-tab-label { font-size:10px; }
          .fr-panel-badge { position:absolute; top:6px; right:6px; margin-left:0; font-size:8px; padding:1px 4px; }
          .fr-main { padding-bottom:60px; }
          .scan-layout { grid-template-columns:1fr; }
          .scan-info-col { display:grid; grid-template-columns:1fr 1fr; gap:.75rem; }
          .fr-tryon-layout { height:auto; min-height:400px; }
          .sg-btn { padding:12px 8px; }
          .fr-shape-grid { grid-template-columns:repeat(4,1fr); gap:6px; }
          .fr-tone-grid  { grid-template-columns:repeat(4,1fr); gap:6px; }
        }
        @media (max-width:640px) {
          .fr-hero { padding:1.5rem 1rem; }
          .fr-panel-content { padding:.875rem; }
          .fr-sidebar { grid-template-columns:1fr; padding:8px 12px; }
          .fr-sidebar-section { border-right:none; border-bottom:1px solid #f0ede8; }
          .fr-sidebar-section:last-child { border-bottom:none; }
          .sg-picker { padding:.875rem; }
          .sg-btn { padding:11px 6px; font-size:12px; }
          .scan-info-col { grid-template-columns:1fr; }
          .scan-live-grid { grid-template-columns:repeat(3,1fr); }
          .fr-field-row { grid-template-columns:1fr; }
          .fr-field-row--half { max-width:100%; }
          .fr-occasion-row { grid-template-columns:repeat(2,1fr); }
          .fr-gown-grid { grid-template-columns:1fr 1fr; }
          .fr-shape-grid { grid-template-columns:repeat(3,1fr); }
          .fr-tone-grid  { grid-template-columns:repeat(4,1fr); }
          .fr-undertone-cards { flex-direction:column; }
          .fr-size-hero { flex-direction:column; align-items:flex-start; gap:12px; padding:1rem; }
          .fr-size-hero-value { font-size:2.5rem; }
          .scan-snap-modal { max-width:100%; border-radius:12px 12px 0 0; }
          .scan-snap-overlay { align-items:flex-end; padding:0; }
        }
        @media (max-width:400px) {
          .fr-shape-grid { grid-template-columns:repeat(2,1fr); }
          .fr-tone-grid  { grid-template-columns:repeat(3,1fr); }
          .fr-gown-grid  { grid-template-columns:1fr; }
          .scan-btn-pair { flex-direction:column; }
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
      fetch('/api/gowns')
        .then(r => r.json())
        .then(d => setGowns((d.gowns || []).filter(g => g.image)))
        .catch(() => {}),
      fetch('/api/size-chart?segment=women')
        .then(r => r.json())
        .then(d => { if (d.ok) { setSizes(d.sizes); setSupplierName(d.supplierName || '') } })
        .catch(() => {}),
    ]).finally(() => setReady(true))
  }, [])

  if (!ready) return <SkeletonLoader/>

  return (
    <FittingRoomProvider gowns={gowns} initialSizes={sizes} initialSupplierName={supplierName}>
      <FittingRoomInner/>
    </FittingRoomProvider>
  )
}