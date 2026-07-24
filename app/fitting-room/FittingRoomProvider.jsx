'use client'
import { useCallback, useEffect, useRef, useState, createContext, useContext } from 'react'
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { scoreGown } from '../constants/styleOptions'
import { SEGMENTS } from '../constants/sizeConstants'

// ─────────────────────────────────────────────────────────────────────────────
// MEDIAPIPE POSE LANDMARKER CONFIG
//
// WASM_BASE / MODEL_PATH point at Google's CDN for now — matches the quick-
// start pattern in MediaPipe's own docs. Swap these to self-hosted paths
// under /public once the feature is stable (removes a CDN dependency and
// avoids the SRI gap that existed with the old TFJS script-tag loading).
// ─────────────────────────────────────────────────────────────────────────────

const WASM_BASE  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL_PATH = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task'

// Adapter: wraps PoseLandmarker so the rest of the codebase (ScanPanel's
// detect loop) can keep calling `detectorRef.current.estimatePoses(video)`
// exactly like it did with the old MoveNet detector. Landmarks come back
// normalised (0–1); we convert to pixel space here so downstream pixel-based
// geometry in poseUtils.js / measurementUtils.js needs no changes.
function wrapPoseLandmarker(landmarker) {
  return {
    landmarker,
    estimatePoses: (video) => {
      const vw = video.videoWidth || 640
      const vh = video.videoHeight || 480
      const result = landmarker.detectForVideo(video, performance.now())
      if (!result?.landmarks?.length) return Promise.resolve([])
      const keypoints = result.landmarks[0].map(lm => ({
        x: lm.x * vw,
        y: lm.y * vh,
        score: lm.visibility ?? 0,
      }))
      return Promise.resolve([{ keypoints }])
    },
  }
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
        `Gowns with matching segment: ${
          gowns.filter(
            g => g.segment &&
            String(g.segment).toLowerCase() === String(seg).toLowerCase()
          ).length
        }/${gowns.length}.`
      )
    }
    // ── End dev diagnostic ────────────────────────────────────────────────

    // Segment filter: keep gown when g.segment matches the active segment,
    // or when g.segment is absent (safe-mode for JSON flat-file gowns that
    // predate the segment column).
    const segmentFiltered = gowns.filter(g => {
      if (!g.segment) return true

      return String(g.segment).toLowerCase() === String(seg).toLowerCase()
    })

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

  const detectorLoadStarted = useRef(false)

  useEffect(() => {
    if (detectorLoadStarted.current) return
    detectorLoadStarted.current = true

    setModelState('loading')
    FilesetResolver.forVisionTasks(WASM_BASE)
      .then(vision => PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
      }))
      .then(landmarker => {
        detectorRef.current = wrapPoseLandmarker(landmarker)
        setModelState('ready')
      })
      .catch(() => {
        detectorLoadStarted.current = false // allow retry on genuine failure
        setModelState('error')
      })
  }, [])

  return (
    <FittingRoomCtx.Provider value={{
      profile, updateProfile, sizeResult, styleResults,
      sizes, supplierName, gowns, detectorRef, segmenterRef, modelState,
    }}>
      {children}
    </FittingRoomCtx.Provider>
  )
}