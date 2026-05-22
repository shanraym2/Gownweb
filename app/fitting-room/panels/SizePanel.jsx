'use client'

import { useState } from 'react'
import { useFittingRoom } from '../FittingRoomProvider'
import { SEGMENTS } from '../../constants/sizeConstants'

// ─────────────────────────────────────────────────────────────────────────────
// UNIT CONVERSION
// Internal storage is always cm. Conversion happens only at the display
// boundary — never inside scoring or size-chart logic.
// ─────────────────────────────────────────────────────────────────────────────

const CM_PER_INCH = 2.54
const cmToIn  = cm     => cm     != null ? Math.round((cm     / CM_PER_INCH) * 10) / 10 : null
const dispVal = (cm, unit) =>
  cm == null ? '—' : unit === 'in' ? `${cmToIn(cm)} in` : `${Math.round(cm)} cm`

// Toggle button — shared appearance spec
function UnitToggle({ unit, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{
        fontSize: '11px', padding: '2px 8px', borderRadius: '10px', cursor: 'pointer',
        border: '0.5px solid #e0ddd8',
        background: '#f5f3ef',
        color: '#888',
      }}
      aria-label={`Switch to ${unit === 'cm' ? 'inches' : 'centimetres'}`}
    >
      {unit === 'cm' ? 'cm' : 'in'}
    </button>
  )
}

export default function SizePanel() {
  const { profile, sizeResult, sizes, supplierName } = useFittingRoom()

  // Unit state — reads from localStorage so all panels stay in sync
  const [unit, setUnit] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('fr_unit') || 'cm') : 'cm'
  )
  const toggleUnit = () => setUnit(u => {
    const n = u === 'cm' ? 'in' : 'cm'
    localStorage.setItem('fr_unit', n)
    return n
  })

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

  // Helper: format a min–max range pair
  const fmtRange = (min, max) =>
    unit === 'in'
      ? `${cmToIn(min)}–${cmToIn(max)} in`
      : `${min}–${max} cm`

  return (
    <div className="fr-panel-content">

      {/* Unit toggle — right-aligned, above size hero */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
        <UnitToggle unit={unit} onToggle={toggleUnit}/>
      </div>

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
            <span key={sz.label} className={`fr-size-pill-lg${sz.label === sizeResult.size?.label ? ' match' : ''}`}>
              {sz.label}
            </span>
          ))}
        </div>
      </div>

      <div className="fr-size-section">
        <p className="fr-size-section-label">Your measurements</p>
        <div className="fr-meas-grid-lg">
          {[
            ['Bust',   profile.bust,   false],
            ['Waist',  profile.waist,  false],
            ['Hips',   profile.hips,   false],
            ['Height', profile.height, false],
            ['Weight', profile.weight, true ],   // true = kg, never convert
          ].filter(([, v]) => v).map(([l, v, isKg]) => (
            <div key={l} className="fr-meas-box">
              <span className="fr-meas-box-label">{l}</span>
              <span className="fr-meas-box-val">
                {isKg
                  ? <>{v} <span className="fr-meas-box-unit">kg</span></>
                  : <>{dispVal(v, unit)} <span className="fr-meas-box-unit">{unit}</span></>
                }
              </span>
              <span className="fr-meas-box-src">{profile.source}</span>
            </div>
          ))}
        </div>
      </div>

      {sizeResult.size && (
        <div className="fr-size-chart-ref">
          <p className="fr-size-section-label">
            {supplierName || 'Standard'} chart for {sizeResult.size.label}
            {unit === 'in' ? ' (in)' : ' (cm)'}
          </p>
          <div className="fr-chart-row">
            {sizeResult.size.bust_min  != null && <span>Bust {fmtRange(sizeResult.size.bust_min,  sizeResult.size.bust_max)}</span>}
            {sizeResult.size.waist_min != null && <span>Waist {fmtRange(sizeResult.size.waist_min, sizeResult.size.waist_max)}</span>}
            {sizeResult.size.hip_min   != null && <span>Hips {fmtRange(sizeResult.size.hip_min,   sizeResult.size.hip_max)}</span>}
          </div>
        </div>
      )}

      {sizeResult.score > 5 && (
        <div className="fr-alert fr-alert--warn">
          You're near a size boundary. For bridal gowns, size up when in doubt — it's easier to take in than let out.
        </div>
      )}

      {profile.source === 'camera' && (
        <p className="fr-note">
          Camera estimates carry ±2–6 cm variance depending on height input. Size has been adjusted up by one to account for camera underestimation — confirm with a tape measure for bridal orders.
        </p>
      )}

      <div className="fr-size-section">
        <p className="fr-size-section-label">Full size chart — {segLabel}</p>
        <div className="fr-full-chart">
          <div className="fr-chart-header">
            <span>Size</span>
            <span>Bust {unit === 'in' ? '(in)' : '(cm)'}</span>
            <span>Waist {unit === 'in' ? '(in)' : '(cm)'}</span>
            <span>Hips {unit === 'in' ? '(in)' : '(cm)'}</span>
          </div>
          {sizes.map(sz => (
            <div
              key={sz.label}
              className={`fr-chart-row-item${sz.label === sizeResult.size?.label ? ' fr-chart-row-item--match' : ''}`}
            >
              <span className="fr-chart-size-label">{sz.label}</span>
              <span>
                {unit === 'in'
                  ? `${cmToIn(sz.bust_min)}–${cmToIn(sz.bust_max)}`
                  : `${sz.bust_min}–${sz.bust_max}`}
              </span>
              <span>
                {unit === 'in'
                  ? `${cmToIn(sz.waist_min)}–${cmToIn(sz.waist_max)}`
                  : `${sz.waist_min}–${sz.waist_max}`}
              </span>
              <span>
                {unit === 'in'
                  ? `${cmToIn(sz.hip_min)}–${cmToIn(sz.hip_max)}`
                  : `${sz.hip_min}–${sz.hip_max}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}