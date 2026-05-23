'use client'

import { useState } from 'react'
import { useFittingRoom } from '../FittingRoomProvider'
import { SKIN_TONES } from '../../constants/styleOptions'
import { SEGMENTS } from '../../constants/sizeConstants'

// ─────────────────────────────────────────────────────────────────────────────
// UNIT CONVERSION
// Internal storage is always cm. Conversion only at display and input
// boundaries — never inside scoring or size-chart logic.
// ─────────────────────────────────────────────────────────────────────────────

const CM_PER_INCH = 2.54
const cmToIn  = cm     => cm     != null ? Math.round((cm     / CM_PER_INCH) * 10) / 10 : null
const inToCm  = inches => inches != null ? Math.round(inches  * CM_PER_INCH  * 10) / 10 : null
const dispVal = (cm, unit) =>
  cm == null ? '—' : unit === 'in' ? `${cmToIn(cm)} in` : `${Math.round(cm)} cm`

export default function ProfileSidebar({ user, onSave, saving, saveMsg, open, onToggle }) {
  const { profile, sizeResult, updateProfile, sizes, supplierName } = useFittingRoom()

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
                {[
                  ['Bust',   profile.bust,   false],
                  ['Waist',  profile.waist,  false],
                  ['Hips',   profile.hips,   false],
                  ['Height', profile.height, false],
                  ['Weight', profile.weight, true ],   // true = kg, never convert
                ].filter(([, v]) => v).map(([l, v, isKg]) => (
                  <div key={l} className="fr-meas-chip">
                    <span className="fr-meas-key">{l}</span>
                    <span className="fr-meas-val">
                      {isKg ? `${v} kg` : dispVal(v, unit)}
                    </span>
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
                  <span
                    key={sz.label}
                    className={`fr-size-pill${sz.label === sizeResult.size.label ? ' fr-size-pill--match' : ''}`}
                  >
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
                {profile.undertone && <span className="fr-chip">{profile.undertone} tone</span>}
                {profile.occasion  && <span className="fr-chip">{profile.occasion}</span>}
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

          {/* Override measurements — input boundary conversion */}
          <div className="fr-sidebar-section fr-sidebar-manual">
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
              <p className="fr-sidebar-label" style={{ margin: 0 }}>Override measurements</p>
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
            </div>
            <div className="fr-manual-grid">
              {[
                ['Bust',   'bust'  ],
                ['Waist',  'waist' ],
                ['Hips',   'hips'  ],
                ['Height', 'height'],
              ].map(([l, k]) => {
                const storedCm   = profile[k]
                const inputValue = unit === 'in' && storedCm != null
                  ? (cmToIn(storedCm) ?? '')
                  : (storedCm || '')
                return (
                  <label key={k} className="fr-manual-field">
                    <span>{l} ({unit})</span>
                    <input
                      type="number"
                      value={inputValue}
                      placeholder="—"
                      onChange={e => {
                        const raw     = parseFloat(e.target.value)
                        const valueCm = unit === 'in' ? inToCm(raw) : raw
                        updateProfile({ [k]: Number.isFinite(valueCm) ? valueCm : null })
                      }}
                    />
                    <span className="fr-manual-unit">{unit}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </>
      )}
    </aside>
  )
}