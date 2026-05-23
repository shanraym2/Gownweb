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
// SEGMENT KEYWORD FILTER TABLE
// Defined at module level — no re-allocation on every render.
// ─────────────────────────────────────────────────────────────────────────────

const SEGMENT_KEYWORDS = {
  women:    ['women', 'woman', 'ladies', 'bridal', 'gown', 'dress'],
  men:      ['men', 'man', 'male', 'suit', 'barong'],
  children: ['kids', 'children', 'junior', 'child'],
}

// ─────────────────────────────────────────────────────────────────────────────
// ADDITIVE SCORING LAYERS
//
// Pure functions — no side effects, no external state access, no mutation.
// Every function returns 0 when required inputs are missing so the pipeline
// degrades gracefully on incomplete gown data or partial profile state.
//
// Pattern:
//   finalScore = scoreGown(gown, profile).score
//              + silhouetteBonus(gown, profile)
//              + colorHarmonyBonus(gown, profile)
// ─────────────────────────────────────────────────────────────────────────────

// Silhouette × body-shape affinity weights.
// Values > 1.0 are a boost; values < 1.0 are a mild penalty.
// Missing combinations return 0 (neutral — no effect on ranking).
const SILHOUETTE_AFFINITY = {
  hourglass:        { mermaid: 1.2, a_line: 1.0, sheath: 0.8 },
  pear:             { a_line: 1.2, ballgown: 1.1, mermaid: 0.7 },
  apple:            { empire: 1.2, a_line: 1.0 },
  rectangle:        { sheath: 1.1, a_line: 1.0 },
  invertedTriangle: { ballgown: 1.2, a_line: 1.0 },
}

/**
 * silhouetteBonus(gown, profile)
 * Returns the affinity weight for a gown silhouette given the detected body
 * shape, or 0 if either field is absent or the combination is not in the table.
 *
 * @param {{ silhouette?: string }} gown
 * @param {{ bodyShape?: string }}  profile
 * @returns {number}
 */
function silhouetteBonus(gown, profile) {
  if (!gown?.silhouette || !profile?.bodyShape) return 0
  return SILHOUETTE_AFFINITY?.[profile.bodyShape]?.[gown.silhouette] ?? 0
}

// Skin-tone undertone → flattering gown color families.
// Keys match profile.undertone values ('warm', 'cool', 'neutral').
// Falls back on profile.skinTone when undertone is absent (see function below).
const COLOR_HARMONY_MAP = {
  warm:    ['gold', 'red', 'orange', 'coral', 'ivory', 'champagne'],
  cool:    ['blue', 'silver', 'emerald', 'lavender', 'sage', 'white'],
  neutral: ['black', 'white', 'beige', 'blush', 'navy', 'dusty rose'],
}

/**
 * colorHarmonyBonus(gown, profile)
 * Returns 0.8 when gown.dominantColor is in the harmony list for the
 * profile's undertone (preferred) or skinTone (fallback), or 0 otherwise.
 *
 * Undertone is checked first because it is a more reliable aesthetic signal
 * than raw skin tone brightness. Falls back to skinTone so that profiles
 * where undertone has not yet been detected still receive color bonuses.
 *
 * @param {{ dominantColor?: string }} gown
 * @param {{ undertone?: string, skinTone?: string }} profile
 * @returns {number}
 */
function colorHarmonyBonus(gown, profile) {
  if (!gown?.dominantColor) return 0
  const toneKey = profile?.undertone || profile?.skinTone
  if (!toneKey) return 0
  const colors = COLOR_HARMONY_MAP?.[toneKey]
  if (!colors) return 0
  return colors.includes(String(gown.dominantColor).toLowerCase()) ? 0.8 : 0
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

  // Reload sizes when segment changes
  useEffect(() => {
    const seg = profile.segment ?? 'women'
    fetch(`/api/size-chart?segment=${seg}`)
      .then(r => r.json())
      .then(d => { if (d.ok) { setSizes(d.sizes); setSupplierName(d.supplierName || '') } })
      .catch(() => {})
  }, [profile.segment])

  // Size scoring
  useEffect(() => {
    if (!profile.bust && !profile.waist && !profile.hips) return
    if (!sizes?.length) return

    const { bust, waist, hips, source } = profile
    let best = null, bestScore = Infinity

    // ── WAIST-ANCHORED SCORING ─────────────────────────────────────────────
    // Waist is the most accurate camera measurement (closest to tape) because
    // it is computed as a conservative proxy from shoulder width rather than
    // directly from hip KPs, which carry more correction uncertainty.
    // Bust is the least reliable (shoulder span overestimates chest width).
    //
    // Weights: waist 3× · hips 2× · bust 1×
    // This means waist agreement dominates size selection. Bust still
    // participates but cannot override a strong waist+hip match.
    // ──────────────────────────────────────────────────────────────────────
    const W = { bust: 1, waist: 3, hips: 2 }

    for (const sz of sizes) {
      let score = 0, totalW = 0
      if (bust  && sz.bust_min  != null) { score += W.bust  * Math.abs(bust  - (sz.bust_min  + sz.bust_max)  / 2); totalW += W.bust  }
      if (waist && sz.waist_min != null) { score += W.waist * Math.abs(waist - (sz.waist_min + sz.waist_max) / 2); totalW += W.waist }
      if (hips  && sz.hip_min   != null) { score += W.hips  * Math.abs(hips  - (sz.hip_min   + sz.hip_max)   / 2); totalW += W.hips  }
      if (totalW === 0) continue
      score /= totalW
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

  // Style scoring
  useEffect(() => {
    if (!gowns?.length || !profile.bodyShape) return

    const seg      = profile.segment ?? 'women'
    const keywords = SEGMENT_KEYWORDS[seg] ?? SEGMENT_KEYWORDS.women

    // Pre-filter: keep gown when any searchable field contains a segment keyword.
    // Falls through (keeps item) when no category or tags are present at all.
    const segmentFiltered = gowns.filter(g => {
      const hasMeta = g.category || g.tags?.length
      if (!hasMeta) return true  // safe-mode: no metadata → keep

      const fields = [
        g.category ?? '',
        g.name     ?? '',
        ...(Array.isArray(g.tags) ? g.tags : [g.tags ?? '']),
      ].map(f => String(f).toLowerCase())

      return keywords.some(kw => fields.some(f => f.includes(kw)))
    })

    const scored = segmentFiltered
      .map(g => {
        const { score, reasons } = scoreGown(g, profile)
        const finalScore = score
                         + silhouetteBonus(g, profile)
                         + colorHarmonyBonus(g, profile)
        return { ...g, _score: finalScore, _reasons: reasons }
      })
      .filter(g => g._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 8)
    setStyleResults(scored)
  }, [profile.bodyShape, profile.skinTone, profile.undertone, profile.occasion,
      profile.colors, profile.fabrics, profile.budget, profile.height,
      profile.segment, gowns])

  // Model loading
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