'use client'

import { useCallback, useEffect, useRef, useState, createContext, useContext } from 'react'
import { scoreGown } from '../constants/styleOptions'
import { SEGMENTS } from '../constants/sizeConstants'

// ─────────────────────────────────────────────────────────────────────────────
// POSE SCRIPTS
// ─────────────────────────────────────────────────────────────────────────────

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
    s.onload = resolve
    s.onerror = () => reject(new Error('Failed: ' + src))
    document.head.appendChild(s)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

const FittingRoomCtx = createContext(null)

export function useFittingRoom() {
  return useContext(FittingRoomCtx)
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

export function FittingRoomProvider({ children, gowns, initialSizes, initialSupplierName }) {
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

  // ─────────────────────────────────────────────────────────────────────────
  // SIZE CHART — reload when segment changes
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const seg = profile.segment ?? 'women'
    fetch(`/api/size-chart?segment=${seg}`)
      .then(r => r.json())
      .then(d => { if (d.ok) { setSizes(d.sizes); setSupplierName(d.supplierName || '') } })
      .catch(() => {})
  }, [profile.segment])

  // ─────────────────────────────────────────────────────────────────────────
  // SIZE SCORING
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!profile.bust && !profile.waist && !profile.hips) return
    if (!sizes?.length) return

    const { bust, waist, hips, source } = profile
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

    const idx = sizes.findIndex(s => s.label === best.label)
    let finalIdx = idx

    if (source === 'camera' && idx < sizes.length - 1) {
      finalIdx = idx + 1
      best = sizes[finalIdx]
    } else if (source !== 'camera' && bestScore > 2.0 && bestScore < 8.0 && idx < sizes.length - 1) {
      finalIdx = idx + 1
      best = sizes[finalIdx]
    }

    const adjacent = sizes.slice(Math.max(0, finalIdx - 1), Math.min(sizes.length, finalIdx + 2))
    setSizeResult({ size: best, score: bestScore, adjacent })
  }, [profile.bust, profile.waist, profile.hips, profile.source, sizes])

  // ─────────────────────────────────────────────────────────────────────────
  // STYLE SCORING
  //
  // Segment filter: match on the gown's explicit `segment` field (from DB/API).
  //
  // The `segment` field is set in the DB (CHECK segment IN ('women','men',
  // 'children') DEFAULT 'women') and must be returned by /api/gowns in the
  // mapped response — see the route file for the required SQL SELECT and
  // rows.map() changes.
  //
  // Safe-mode fallback: when g.segment is absent (undefined/null), the gown
  // passes through so legacy JSON flat-file gowns without the field are never
  // silently hidden. The /api/gowns JSON branch also normalises this to
  // 'women' so in practice the fallback is rarely hit.
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!gowns?.length || !profile.bodyShape) return

    const seg = profile.segment ?? 'women'

    // ── Dev diagnostic — remove before shipping ───────────────────────────
    if (process.env.NODE_ENV === 'development') {
      const missing = gowns.filter(g => !g.segment).length
      if (missing > 0) {
        console.warn(
          `[FittingRoomProvider] ${missing}/${gowns.length} gowns have no segment field. ` +
          `Ensure /api/gowns returns segment in the mapped response. ` +
          `These gowns will pass the segment filter (safe-mode fallback).`
        )
      }
      console.log(
        `[FittingRoomProvider] Scoring for segment="${seg}". ` +
        `Gowns with matching segment: ${gowns.filter(g => g.segment === seg).length}/${gowns.length}.`
      )
    }
    // ── End dev diagnostic ────────────────────────────────────────────────

    // Segment filter: keep gown when g.segment matches the active segment,
    // or when g.segment is absent (safe-mode for JSON flat-file gowns that
    // predate the segment column).
    const segmentFiltered = gowns.filter(g => !g.segment || g.segment === seg)

    const scored = segmentFiltered
      .map(g => {
        const { score, reasons } = scoreGown(g, profile)
        return { ...g, _score: score, _reasons: reasons }
      })
      .filter(g => g._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 8)

    setStyleResults(scored)
  }, [
    profile.bodyShape, profile.skinTone, profile.undertone, profile.occasion,
    profile.colors, profile.fabrics, profile.budget, profile.height,
    profile.segment, gowns,
  ])

  // ─────────────────────────────────────────────────────────────────────────
  // MODEL LOADING
  // ─────────────────────────────────────────────────────────────────────────

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