'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useFittingRoom } from '../FittingRoomProvider'
import SegmentGate from '../components/SegmentGate'
import {
  BODY_SHAPES, SKIN_TONES, UNDERTONES, OCCASIONS,
  COLOR_OPTIONS, FABRIC_OPTIONS, BUDGET_RANGES,
  normaliseScore,
} from '../../constants/styleOptions'

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

export default function StylePanel() {
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
          {profile.bodyShape && (
            <p className="fr-scan-detected-note">Auto-detected from camera scan — adjust if needed</p>
          )}
          <BodyShapePicker selected={profile.bodyShape} onChange={v => set('bodyShape', v)}/>
        </div>

        <div className="fr-style-section">
          <p className="fr-style-section-title">Skin tone &amp; undertone</p>
          {(profile.skinTone || profile.undertone) && (
            <p className="fr-scan-detected-note">Auto-detected from camera scan — adjust if needed</p>
          )}
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
              >
                {o.label}
              </button>
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
                  >
                    {f}
                  </button>
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
                  >
                    {b.label}
                  </button>
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
            {profile.segment && profile.segment !== 'women' ? (
              <p>No matching gowns found for your selected segment. Try switching segment or adjusting filters.</p>
            ) : (
              <p>No matches found. Try relaxing your budget or occasion filter.</p>
            )}
          </div>
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