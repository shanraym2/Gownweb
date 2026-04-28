'use client'

// ── useSizeRecommender ────────────────────────────────────────────────────────
// Lightweight hook that fetches the user's saved measurements and returns
// a recommended size for a given gown/supplier.
//
// Usage (on a gown detail page):
//
//   const { recommendation, loading } = useSizeRecommender({
//     supplierId: gown.supplierId,
//     userId:     user?.id,
//   })
//
//   // recommendation: { size, score, adjacent, measurements } | null
//
// This keeps the gown page thin — no camera logic here.

import { useEffect, useState } from 'react'

function recommendSize(meas, sizes) {
  if (!sizes?.length || !meas) return null
  const { bust_cm: bust, waist_cm: waist, hips_cm: hips } = meas
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

  if (!best) return null
  const idx = sizes.findIndex(s => s.label === best.label)
  return {
    size:     best,
    score:    bestScore,
    adjacent: sizes.slice(Math.max(0, idx - 1), Math.min(sizes.length, idx + 2)),
  }
}

export function useSizeRecommender({ supplierId, userId } = {}) {
  const [recommendation, setRecommendation] = useState(null)
  const [measurements,   setMeasurements  ] = useState(null)
  const [loading,        setLoading       ] = useState(false)
  const [error,          setError         ] = useState(null)

  useEffect(() => {
    if (!userId) { setRecommendation(null); return }

    let cancelled = false
    setLoading(true); setError(null)

    Promise.all([
      fetch('/api/measurements',                                           { headers: { 'x-user-id': userId } }).then(r => r.json()),
      fetch(`/api/size-chart${supplierId ? `?supplierId=${supplierId}` : ''}`).then(r => r.json()),
    ])
      .then(([measData, chartData]) => {
        if (cancelled) return
        const meas  = measData.ok  ? measData.measurements  : null
        const sizes = chartData.ok ? chartData.sizes        : []
        setMeasurements(meas)
        if (meas) setRecommendation(recommendSize(meas, sizes))
        else      setRecommendation(null)
      })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [userId, supplierId])

  return { recommendation, measurements, loading, error }
}


// ── SizeRecommendBadge ────────────────────────────────────────────────────────
// Drop-in component for the gown detail page.
// Shows "Your size: M" with a link to the full recommender if no saved data.
//
// Usage:
//   <SizeRecommendBadge userId={user?.id} supplierId={gown.supplierId} />

export function SizeRecommendBadge({ userId, supplierId }) {
  const { recommendation, loading } = useSizeRecommender({ userId, supplierId })

  if (!userId) {
    return (
      <a href="/size-recommender" className="sr-badge-link">
        Find your size →
      </a>
    )
  }

  if (loading) {
    return <span className="sr-badge-loading">Checking your size…</span>
  }

  if (!recommendation) {
    return (
      <a href="/size-recommender" className="sr-badge-link">
        Get your size recommendation →
      </a>
    )
  }

  const conf = Math.min(Math.round(100 - recommendation.score * 3), 95)

  return (
    <div className="sr-badge-wrap">
      <div className="sr-badge-row">
        <span className="sr-badge-label">Your size</span>
        <span className="sr-badge-size">{recommendation.size.label}</span>
        <span className="sr-badge-conf">{conf}% match</span>
      </div>
      {recommendation.adjacent.length > 1 && (
        <div className="sr-badge-adjacent">
          {recommendation.adjacent.map(sz => (
            <span
              key={sz.label}
              className={`sr-badge-pill${sz.label === recommendation.size.label ? ' sr-badge-pill--match' : ''}`}
            >
              {sz.label}
            </span>
          ))}
        </div>
      )}
      <a href="/size-recommender" className="sr-badge-update">Update measurements →</a>
      <style>{`
        .sr-badge-wrap { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; background: #f5f0ff; border-radius: 10px; border: 0.5px solid #AFA9EC; }
        .sr-badge-row { display: flex; align-items: center; gap: 10px; }
        .sr-badge-label { font-size: 11px; color: #7F77DD; text-transform: uppercase; letter-spacing: .06em; }
        .sr-badge-size { font-size: 1.4rem; font-weight: 500; color: #3C3489; line-height: 1; }
        .sr-badge-conf { font-size: 11px; color: #7F77DD; margin-left: auto; }
        .sr-badge-adjacent { display: flex; gap: 5px; }
        .sr-badge-pill { padding: 3px 10px; border-radius: 20px; font-size: 12px; border: 0.5px solid #ddd; color: #888; }
        .sr-badge-pill--match { background: #EEEDFE; border-color: #AFA9EC; color: #3C3489; font-weight: 500; }
        .sr-badge-update { font-size: 11px; color: #7F77DD; text-decoration: none; }
        .sr-badge-update:hover { text-decoration: underline; }
        .sr-badge-link { font-size: 13px; color: #7F77DD; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
        .sr-badge-link:hover { text-decoration: underline; }
        .sr-badge-loading { font-size: 12px; color: #aaa; }
      `}</style>
    </div>
  )
}