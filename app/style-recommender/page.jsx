'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser } from '../utils/authClient'

// ── Scoring engine ────────────────────────────────────────────────────────────

function scoreGown(gown, profile) {
  let score = 0
  const reasons = []

  const { bodyShape, skinTone, undertone, occasion, height,
          budget, colors, fabrics } = profile

  // ── Body shape → silhouette compatibility ──
  const shapeRules = {
    hourglass:   { best: ['Mermaid','Fit-and-flare','Sheath'],      good: ['A-line','Ballgown'] },
    pear:        { best: ['A-line','Ballgown'],                      good: ['Fit-and-flare','Empire'] },
    apple:       { best: ['Empire','A-line'],                        good: ['Sheath','Ballgown'] },
    rectangle:   { best: ['Fit-and-flare','Mermaid','Ballgown'],     good: ['A-line','Sheath'] },
    invertedTriangle: { best: ['A-line','Ballgown','Empire'],        good: ['Sheath','Fit-and-flare'] },
    petite:      { best: ['A-line','Sheath','Empire'],               good: ['Fit-and-flare'] },
    tall:        { best: ['Mermaid','Ballgown','Fit-and-flare'],     good: ['A-line','Sheath'] },
  }

  if (bodyShape && shapeRules[bodyShape] && gown.silhouette) {
    const rule = shapeRules[bodyShape]
    const sil  = gown.silhouette
    if (rule.best.some(s => sil.toLowerCase().includes(s.toLowerCase()))) {
      score += 35
      reasons.push(`The ${sil} silhouette is ideal for a ${bodyShape.replace(/([A-Z])/g, ' $1').trim()} figure`)
    } else if (rule.good.some(s => sil.toLowerCase().includes(s.toLowerCase()))) {
      score += 18
      reasons.push(`${sil} works well for your body shape`)
    }
  }

  // ── Skin tone → color compatibility ──
  const toneRules = {
    fair:    { warm: ['Ivory','Blush','Champagne','Peach'],         cool: ['White','Silver','Lavender','Ice Blue'] },
    light:   { warm: ['Ivory','Champagne','Gold','Nude'],           cool: ['White','Blush','Rose','Lilac'] },
    medium:  { warm: ['Gold','Caramel','Terracotta','Warm Nude'],   cool: ['Jewel tones','Royal Blue','Emerald','Berry'] },
    olive:   { warm: ['Gold','Bronze','Warm White','Copper'],       cool: ['Navy','Plum','Forest Green'] },
    tan:     { warm: ['Gold','Bronze','Coral','Warm Ivory'],        cool: ['White','Royal Blue','Fuchsia'] },
    deep:    { warm: ['Gold','Rich Red','Bronze','Orange'],         cool: ['White','Royal Blue','Emerald','Fuchsia'] },
    ebony:   { warm: ['Gold','Coral','Rich Red','Warm Ivory'],      cool: ['White','Cobalt','Fuchsia','Royal Purple'] },
  }

  if (skinTone && gown.color) {
    const rule  = toneRules[skinTone]
    const col   = gown.color
    const isWarm = !undertone || undertone === 'warm'
    const palette = rule ? (isWarm ? [...(rule.warm||[]), ...(rule.cool||[])] : [...(rule.cool||[]), ...(rule.warm||[])]) : []
    if (palette.some(c => col.toLowerCase().includes(c.toLowerCase()))) {
      score += 25
      reasons.push(`${col} complements ${skinTone} skin beautifully`)
    }
  }

  // ── Preferred colors match ──
  if (colors?.length && gown.color) {
    if (colors.some(c => gown.color.toLowerCase().includes(c.toLowerCase()))) {
      score += 20
      reasons.push(`Matches your preferred color: ${gown.color}`)
    }
  }

  // ── Preferred fabrics ──
  if (fabrics?.length && gown.fabric) {
    if (fabrics.some(f => gown.fabric.toLowerCase().includes(f.toLowerCase()))) {
      score += 15
      reasons.push(`${gown.fabric} is one of your preferred fabrics`)
    }
  }

  // ── Occasion ──
  const occasionMap = {
    ceremony:    ['Ballgown','Mermaid','A-line','Cathedral'],
    reception:   ['Sheath','Fit-and-flare','Mini'],
    garden:      ['A-line','Floral','Empire','Boho'],
    beach:       ['Empire','Sheath','Chiffon','Simple'],
    civil:       ['Sheath','Mini','Suit','Simple'],
    'black-tie': ['Ballgown','Mermaid','Fit-and-flare'],
  }

  if (occasion && gown.silhouette) {
    const tags = occasionMap[occasion] || []
    if (tags.some(t => gown.silhouette?.toLowerCase().includes(t.toLowerCase()) ||
                       gown.description?.toLowerCase().includes(t.toLowerCase()))) {
      score += 15
      reasons.push(`Suits a ${occasion.replace('-',' ')} setting`)
    }
  }

  // ── Height adjustments ──
  if (height) {
    const h = Number(height)
    if (h < 160 && gown.silhouette) {
      const petiteGood = ['a-line','sheath','empire']
      if (petiteGood.some(s => gown.silhouette.toLowerCase().includes(s))) {
        score += 10
        reasons.push('Elongates petite frames')
      }
    }
    if (h >= 172 && gown.silhouette) {
      const tallGood = ['mermaid','ballgown','fit-and-flare']
      if (tallGood.some(s => gown.silhouette.toLowerCase().includes(s))) {
        score += 10
        reasons.push('Showcases your tall, elegant frame')
      }
    }
  }

  // ── Budget ──
  if (budget && gown.salePrice) {
    const [min, max] = budget
    if (gown.salePrice >= min && gown.salePrice <= max) {
      score += 12
      reasons.push(`Within your budget of ₱${min.toLocaleString()}–₱${max.toLocaleString()}`)
    } else if (gown.salePrice > max) {
      score -= 20  // penalise over-budget
    }
  }

  return { score, reasons }
}

// ── Step data ─────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 'bodyShape',   label: 'Body shape',   subtitle: 'Which silhouette best describes you?' },
  { id: 'skinTone',    label: 'Skin tone',    subtitle: 'Select the shade closest to yours' },
  { id: 'undertone',   label: 'Undertone',    subtitle: 'Your skin\'s underlying hue' },
  { id: 'occasion',    label: 'Occasion',     subtitle: 'Where will you wear this gown?' },
  { id: 'height',      label: 'Height',       subtitle: 'Helps us recommend the right length' },
  { id: 'colors',      label: 'Colors',       subtitle: 'Pick up to 4 colours you love (optional)' },
  { id: 'fabrics',     label: 'Fabrics',      subtitle: 'Select fabrics you prefer (optional)' },
  { id: 'budget',      label: 'Budget',       subtitle: 'Your approximate price range' },
]

const BODY_SHAPES = [
  { id: 'hourglass',        label: 'Hourglass',         desc: 'Balanced bust & hips, defined waist',
    svg: <svg viewBox="0 0 60 100" fill="none"><ellipse cx="30" cy="12" rx="16" ry="10" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="1.5"/><path d="M14 22 Q8 50 16 68 Q22 80 30 82 Q38 80 44 68 Q52 50 46 22" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="1.5"/><line x1="10" y1="50" x2="50" y2="50" stroke="currentColor" strokeWidth="1" opacity=".3"/></svg> },
  { id: 'pear',             label: 'Pear',              desc: 'Hips wider than shoulders',
    svg: <svg viewBox="0 0 60 100" fill="none"><ellipse cx="30" cy="12" rx="12" ry="9" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="1.5"/><path d="M18 21 Q14 42 12 62 Q14 80 30 84 Q46 80 48 62 Q46 42 42 21" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="1.5"/></svg> },
  { id: 'apple',            label: 'Apple',             desc: 'Fuller midsection, narrower hips',
    svg: <svg viewBox="0 0 60 100" fill="none"><ellipse cx="30" cy="12" rx="14" ry="9" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="1.5"/><path d="M16 21 Q10 44 16 64 Q22 82 30 84 Q38 82 44 64 Q50 44 44 21" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="1.5"/></svg> },
  { id: 'rectangle',       label: 'Rectangle',         desc: 'Similar bust, waist & hip width',
    svg: <svg viewBox="0 0 60 100" fill="none"><rect x="16" y="4" width="28" height="88" rx="6" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="1.5"/></svg> },
  { id: 'invertedTriangle', label: 'Inverted triangle', desc: 'Broader shoulders, narrower hips',
    svg: <svg viewBox="0 0 60 100" fill="none"><path d="M10 8 L50 8 L42 92 L18 92 Z" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="1.5"/></svg> },
  { id: 'petite',           label: 'Petite',            desc: 'Under 5\'3" / 160 cm',
    svg: <svg viewBox="0 0 60 80" fill="none"><ellipse cx="30" cy="10" rx="12" ry="8" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="1.5"/><path d="M18 18 Q14 40 18 58 Q22 70 30 72 Q38 70 42 58 Q46 40 42 18" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="1.5"/></svg> },
  { id: 'tall',             label: 'Tall',              desc: 'Over 5\'8" / 172 cm',
    svg: <svg viewBox="0 0 40 110" fill="none"><ellipse cx="20" cy="10" rx="11" ry="8" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="1.5"/><path d="M9 18 Q6 55 10 80 Q14 98 20 100 Q26 98 30 80 Q34 55 31 18" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="1.5"/></svg> },
]

const SKIN_TONES = [
  { id: 'fair',   label: 'Fair',   hex: '#F8E8D8' },
  { id: 'light',  label: 'Light',  hex: '#F0D0A8' },
  { id: 'medium', label: 'Medium', hex: '#D4956A' },
  { id: 'olive',  label: 'Olive',  hex: '#B8804A' },
  { id: 'tan',    label: 'Tan',    hex: '#9A6438' },
  { id: 'deep',   label: 'Deep',   hex: '#6B3E26' },
  { id: 'ebony',  label: 'Ebony',  hex: '#3D1F10' },
]

const UNDERTONES = [
  { id: 'warm',    label: 'Warm',    desc: 'Golden / peachy / yellow',   hex: '#E8A855' },
  { id: 'cool',    label: 'Cool',    desc: 'Pink / red / bluish',         hex: '#C878B0' },
  { id: 'neutral', label: 'Neutral', desc: 'Mix of warm & cool',          hex: '#A89078' },
]

const OCCASIONS = [
  { id: 'ceremony',    label: 'Wedding ceremony',  icon: '⛪' },
  { id: 'reception',   label: 'Reception / party', icon: '🥂' },
  { id: 'garden',      label: 'Garden / outdoor',  icon: '🌿' },
  { id: 'beach',       label: 'Beach / destination',icon: '🌊' },
  { id: 'civil',       label: 'Civil / courthouse', icon: '📋' },
  { id: 'black-tie',   label: 'Black tie / gala',   icon: '✨' },
]

const COLOR_OPTIONS = [
  { id: 'Ivory',       hex: '#FFFFF0' },
  { id: 'White',       hex: '#FFFFFF' },
  { id: 'Blush',       hex: '#FFB6C1' },
  { id: 'Champagne',   hex: '#F7E7CE' },
  { id: 'Gold',        hex: '#FFD700' },
  { id: 'Nude',        hex: '#E8C9A0' },
  { id: 'Rose',        hex: '#FF8FAB' },
  { id: 'Blue',        hex: '#4A90D9' },
  { id: 'Lavender',    hex: '#C9A8E0' },
  { id: 'Sage',        hex: '#B2C9A0' },
  { id: 'Mint',        hex: '#98D8C8' },
  { id: 'Floral',      hex: null },  // pattern, no single hex
]

const FABRIC_OPTIONS = [
  'Satin', 'Lace', 'Chiffon', 'Tulle', 'Crepe',
  'Velvet', 'Organza', 'Silk', 'Mikado', 'Charmeuse',
]

const BUDGET_RANGES = [
  { id: 'under50k',  label: 'Under ₱50,000',       range: [0,      50000] },
  { id: '50-100k',   label: '₱50,000 – ₱100,000',  range: [50000,  100000] },
  { id: '100-150k',  label: '₱100,000 – ₱150,000', range: [100000, 150000] },
  { id: 'over150k',  label: 'Over ₱150,000',        range: [150000, 9999999] },
  { id: 'any',       label: 'No preference',         range: [0,      9999999] },
]

// ── Main component ────────────────────────────────────────────────────────────

export default function StyleRecommenderPage() {
  const [step,      setStep     ] = useState(0)
  const [profile,   setProfile  ] = useState({
    bodyShape: null, skinTone: null, undertone: null, occasion: null,
    height: '', colors: [], fabrics: [], budget: null,
  })
  const [gowns,     setGowns    ] = useState([])
  const [results,   setResults  ] = useState(null)
  const [animating, setAnimating] = useState(false)
  const topRef = useRef(null)
  const user   = typeof window !== 'undefined' ? getCurrentUser() : null

  // Load gowns once
  useEffect(() => {
    fetch('/api/gowns')
      .then(r => r.json())
      .then(d => setGowns(d.gowns || []))
      .catch(() => {})
  }, [])

  const totalSteps = STEPS.length

  function set(key, val) {
    setProfile(p => ({ ...p, [key]: val }))
  }

  function toggleMulti(key, val, max = 4) {
    setProfile(p => {
      const arr = p[key] || []
      if (arr.includes(val)) return { ...p, [key]: arr.filter(v => v !== val) }
      if (arr.length >= max) return p
      return { ...p, [key]: [...arr, val] }
    })
  }

  const goNext = useCallback(() => {
    if (step < totalSteps - 1) {
      setAnimating(true)
      setTimeout(() => { setStep(s => s + 1); setAnimating(false) }, 180)
    } else {
      computeResults()
    }
  }, [step, totalSteps, profile, gowns])

  const goPrev = useCallback(() => {
    if (step > 0) {
      setAnimating(true)
      setTimeout(() => { setStep(s => s - 1); setAnimating(false) }, 180)
    }
  }, [step])

  function computeResults() {
    const budget = profile.budget ? BUDGET_RANGES.find(b => b.id === profile.budget)?.range : null
    const p = { ...profile, budget }

    const scored = gowns
      .map(g => {
        const { score, reasons } = scoreGown(g, p)
        return { ...g, _score: score, _reasons: reasons }
      })
      .filter(g => g._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 6)

    setResults(scored)

    // Save preferences to DB if logged in
    if (user) {
      fetch('/api/auth/save-style-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({
          bodyType:             profile.bodyShape,
          skinTone:             profile.skinTone,
          styleTags:            profile.occasion ? [profile.occasion] : [],
          preferredSilhouettes: [],
          preferredColors:      profile.colors || [],
        }),
      }).catch(() => {})
    }

    setTimeout(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  function reset() {
    setResults(null)
    setStep(0)
    setProfile({ bodyShape: null, skinTone: null, undertone: null, occasion: null,
                 height: '', colors: [], fabrics: [], budget: null })
  }

  const current = STEPS[step]
  const canProceed = (() => {
    if (current.id === 'bodyShape') return !!profile.bodyShape
    if (current.id === 'skinTone')  return !!profile.skinTone
    if (current.id === 'undertone') return !!profile.undertone
    if (current.id === 'occasion')  return !!profile.occasion
    if (current.id === 'budget')    return !!profile.budget
    return true  // optional steps
  })()

  // ── Results view ─────────────────────────────────────────────────────────────

  if (results !== null) {
    return (
      <main className="sr-page">
        <style suppressHydrationWarning>{CSS}</style>
        <Header solid />
        <div className="sr-spacer" ref={topRef} />

        <section className="sr-results-hero">
          <span className="sr-eyebrow">Your Style Profile</span>
          <h1 className="sr-results-h1">
            {results.length > 0 ? 'Your top gown matches' : 'No matches yet'}
          </h1>
          <p className="sr-results-sub">
            {results.length > 0
              ? `Based on your ${profile.bodyShape} figure, ${profile.skinTone} skin tone and preferences — here are your best matches.`
              : 'Try adjusting your preferences for more results.'}
          </p>
          <div className="sr-profile-chips">
            {profile.bodyShape && <span className="sr-chip">{profile.bodyShape}</span>}
            {profile.skinTone  && <span className="sr-chip">{profile.skinTone} skin</span>}
            {profile.occasion  && <span className="sr-chip">{profile.occasion.replace('-',' ')}</span>}
            {profile.colors?.map(c => <span key={c} className="sr-chip">{c}</span>)}
          </div>
        </section>

        {results.length === 0 ? (
          <div className="sr-no-results">
            <p>No gowns currently match your preferences. Try relaxing some filters.</p>
            <button onClick={reset} className="sr-btn">← Start over</button>
          </div>
        ) : (
          <div className="sr-results-grid">
            {results.map((g, i) => (
              <div key={g.id} className="sr-result-card" style={{ animationDelay: `${i * 0.07}s` }}>
                <div className="sr-result-rank">#{i + 1}</div>
                <div className="sr-result-img">
                  <img src={g.image} alt={g.alt || g.name} />
                  {i === 0 && <span className="sr-result-badge">Best match</span>}
                </div>
                <div className="sr-result-body">
                  <p className="sr-result-name">{g.name}</p>
                  <p className="sr-result-price">{g.price}</p>
                  {g.silhouette && <p className="sr-result-meta">{g.silhouette}{g.color ? ` · ${g.color}` : ''}{g.fabric ? ` · ${g.fabric}` : ''}</p>}

                  <div className="sr-result-reasons">
                    {g._reasons.slice(0, 3).map((r, j) => (
                      <div key={j} className="sr-result-reason">
                        <span className="sr-reason-dot" />
                        {r}
                      </div>
                    ))}
                  </div>

                  <div className="sr-result-score">
                    <div className="sr-score-bar">
                      <div className="sr-score-fill" style={{ width: `${Math.min(100, g._score)}%` }} />
                    </div>
                    <span className="sr-score-label">{Math.min(100, g._score)}% match</span>
                  </div>

                  <div className="sr-result-actions">
                    <Link href={`/gowns/${g.id}`} className="sr-result-btn sr-result-btn--outline">View details</Link>
                    <Link href={`/virtual-try-on?gown=${g.id}`} className="sr-result-btn sr-result-btn--primary">Try on →</Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="sr-results-footer">
          <button onClick={reset} className="sr-btn sr-btn--ghost">← Redo quiz</button>
          <Link href="/gowns" className="sr-btn sr-btn--outline">Browse all gowns</Link>
        </div>

        <Footer />
      </main>
    )
  }

  // ── Quiz view ─────────────────────────────────────────────────────────────────

  return (
    <main className="sr-page">
      <style suppressHydrationWarning>{CSS}</style>
      <Header solid />
      <div className="sr-spacer" />

      <section className="sr-hero">
        <span className="sr-eyebrow">FitMatcher · Style Recommender</span>
        <h1 className="sr-h1">Find your <em>perfect</em> gown</h1>
        <p className="sr-sub">Answer a few questions about yourself and we'll match you with gowns that genuinely flatter your figure, skin tone and occasion.</p>
      </section>

      <div className="sr-quiz-wrap">

        {/* Progress */}
        <div className="sr-progress">
          <div className="sr-progress-track">
            <div className="sr-progress-fill" style={{ width: `${((step + 1) / totalSteps) * 100}%` }} />
          </div>
          <span className="sr-progress-label">{step + 1} / {totalSteps}</span>
        </div>

        {/* Step */}
        <div className={`sr-step${animating ? ' sr-step--exit' : ' sr-step--enter'}`}>
          <div className="sr-step-header">
            <p className="sr-step-label">{current.label}</p>
            <h2 className="sr-step-title">{current.subtitle}</h2>
          </div>

          {/* ── Body shape ── */}
          {current.id === 'bodyShape' && (
            <div className="sr-grid sr-grid--body">
              {BODY_SHAPES.map(s => (
                <button
                  key={s.id}
                  className={`sr-shape-card${profile.bodyShape === s.id ? ' sel' : ''}`}
                  onClick={() => set('bodyShape', s.id)}
                >
                  <div className="sr-shape-svg">{s.svg}</div>
                  <p className="sr-shape-label">{s.label}</p>
                  <p className="sr-shape-desc">{s.desc}</p>
                </button>
              ))}
            </div>
          )}

          {/* ── Skin tone ── */}
          {current.id === 'skinTone' && (
            <div className="sr-grid sr-grid--tones">
              {SKIN_TONES.map(t => (
                <button
                  key={t.id}
                  className={`sr-tone-card${profile.skinTone === t.id ? ' sel' : ''}`}
                  onClick={() => set('skinTone', t.id)}
                >
                  <div className="sr-tone-swatch" style={{ background: t.hex }} />
                  <p className="sr-tone-label">{t.label}</p>
                </button>
              ))}
            </div>
          )}

          {/* ── Undertone ── */}
          {current.id === 'undertone' && (
            <div className="sr-grid sr-grid--undertone">
              {UNDERTONES.map(u => (
                <button
                  key={u.id}
                  className={`sr-undertone-card${profile.undertone === u.id ? ' sel' : ''}`}
                  onClick={() => set('undertone', u.id)}
                >
                  <div className="sr-undertone-orb" style={{ background: u.hex }} />
                  <p className="sr-undertone-label">{u.label}</p>
                  <p className="sr-undertone-desc">{u.desc}</p>
                </button>
              ))}
            </div>
          )}

          {/* ── Occasion ── */}
          {current.id === 'occasion' && (
            <div className="sr-grid sr-grid--occasion">
              {OCCASIONS.map(o => (
                <button
                  key={o.id}
                  className={`sr-occasion-card${profile.occasion === o.id ? ' sel' : ''}`}
                  onClick={() => set('occasion', o.id)}
                >
                  <span className="sr-occasion-icon">{o.icon}</span>
                  <p className="sr-occasion-label">{o.label}</p>
                </button>
              ))}
            </div>
          )}

          {/* ── Height ── */}
          {current.id === 'height' && (
            <div className="sr-height-wrap">
              <div className="sr-height-options">
                {[
                  { label: 'Under 5\'0" (152 cm)', val: '150' },
                  { label: '5\'0"–5\'3" (152–160 cm)', val: '156' },
                  { label: '5\'3"–5\'6" (160–168 cm)', val: '164' },
                  { label: '5\'6"–5\'9" (168–175 cm)', val: '172' },
                  { label: 'Over 5\'9" (175 cm+)', val: '178' },
                  { label: 'Prefer not to say', val: '' },
                ].map(h => (
                  <button
                    key={h.val}
                    className={`sr-height-btn${profile.height === h.val ? ' sel' : ''}`}
                    onClick={() => set('height', h.val)}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Colors ── */}
          {current.id === 'colors' && (
            <div className="sr-colors-wrap">
              <p className="sr-optional-hint">Optional — select up to 4</p>
              <div className="sr-grid sr-grid--colors">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c.id}
                    className={`sr-color-card${(profile.colors||[]).includes(c.id) ? ' sel' : ''}`}
                    onClick={() => toggleMulti('colors', c.id, 4)}
                  >
                    <div className="sr-color-swatch"
                      style={{ background: c.hex || 'conic-gradient(#ffd6e0,#ffe0b2,#e8f5e9,#e3f2fd,#f3e5f5)' }} />
                    <p className="sr-color-label">{c.id}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Fabrics ── */}
          {current.id === 'fabrics' && (
            <div className="sr-fabrics-wrap">
              <p className="sr-optional-hint">Optional — select any you prefer</p>
              <div className="sr-grid sr-grid--fabrics">
                {FABRIC_OPTIONS.map(f => (
                  <button
                    key={f}
                    className={`sr-fabric-btn${(profile.fabrics||[]).includes(f) ? ' sel' : ''}`}
                    onClick={() => toggleMulti('fabrics', f, 6)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Budget ── */}
          {current.id === 'budget' && (
            <div className="sr-budget-wrap">
              {BUDGET_RANGES.map(b => (
                <button
                  key={b.id}
                  className={`sr-budget-btn${profile.budget === b.id ? ' sel' : ''}`}
                  onClick={() => set('budget', b.id)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}

        </div>{/* end sr-step */}

        {/* Navigation */}
        <div className="sr-nav">
          <button className="sr-nav-back" onClick={goPrev} disabled={step === 0}>
            ← Back
          </button>
          <button
            className={`sr-nav-next${canProceed ? '' : ' disabled'}`}
            onClick={canProceed ? goNext : undefined}
            disabled={!canProceed}
          >
            {step === totalSteps - 1 ? 'See my matches →' : 'Next →'}
          </button>
        </div>

      </div>{/* end sr-quiz-wrap */}

      <Footer />
    </main>
  )
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,700;1,400;1,500&family=DM+Sans:wght@300;400;500&display=swap');

.sr-page{--iv:#faf7f4;--ch:#f0e6d3;--es:#2c1a10;--wb:#6b3f2a;--mu:#9b8880;--go:#c9a96e;--bl:#d4a5a0;--acc:#b87c4c;background:var(--iv);font-family:'DM Sans',sans-serif;color:var(--es);min-height:100vh;}
.sr-spacer{height:80px;}

/* Hero */
.sr-hero{background:var(--es);padding:60px clamp(2rem,7vw,6rem) 52px;position:relative;overflow:hidden;}
.sr-hero::after{content:'';position:absolute;right:-80px;top:-80px;width:360px;height:360px;border-radius:50%;border:1px solid rgba(201,169,110,.12);pointer-events:none;}
.sr-eyebrow{font-size:9px;letter-spacing:.5em;text-transform:uppercase;color:var(--go);display:block;margin-bottom:16px;}
.sr-h1{font-family:'Playfair Display',serif;font-size:clamp(2.6rem,5.5vw,4rem);font-weight:400;color:var(--iv);margin:0 0 16px;line-height:1.05;}
.sr-h1 em{font-style:italic;color:var(--go);}
.sr-sub{font-size:14px;font-weight:300;color:rgba(250,247,244,.5);margin:0;line-height:1.8;max-width:520px;}

/* Quiz wrap */
.sr-quiz-wrap{max-width:820px;margin:0 auto;padding:48px 24px 80px;}

/* Progress */
.sr-progress{display:flex;align-items:center;gap:14px;margin-bottom:40px;}
.sr-progress-track{flex:1;height:2px;background:var(--ch);border-radius:2px;overflow:hidden;}
.sr-progress-fill{height:100%;background:var(--go);transition:width .4s cubic-bezier(.4,0,.2,1);}
.sr-progress-label{font-size:11px;color:var(--mu);letter-spacing:.1em;white-space:nowrap;}

/* Step animation */
.sr-step--enter{animation:stepIn .22s ease both;}
.sr-step--exit{animation:stepOut .18s ease both;}
@keyframes stepIn{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}
@keyframes stepOut{from{opacity:1}to{opacity:0;transform:translateX(-12px)}}

.sr-step-header{margin-bottom:32px;}
.sr-step-label{font-size:9px;letter-spacing:.45em;text-transform:uppercase;color:var(--go);margin:0 0 8px;}
.sr-step-title{font-family:'Playfair Display',serif;font-size:clamp(1.5rem,3vw,2.1rem);font-weight:400;margin:0;line-height:1.2;}

/* Grids */
.sr-grid{display:grid;gap:12px;}
.sr-grid--body{grid-template-columns:repeat(auto-fill,minmax(110px,1fr));}
.sr-grid--tones{grid-template-columns:repeat(auto-fill,minmax(90px,1fr));}
.sr-grid--undertone{grid-template-columns:repeat(3,1fr);}
.sr-grid--occasion{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));}
.sr-grid--colors{grid-template-columns:repeat(auto-fill,minmax(80px,1fr));}
.sr-grid--fabrics{grid-template-columns:repeat(auto-fill,minmax(110px,1fr));}

/* Body shape cards */
.sr-shape-card{padding:16px 10px 12px;border:1.5px solid var(--ch);background:var(--iv);cursor:pointer;transition:border-color .2s,background .2s,transform .2s;display:flex;flex-direction:column;align-items:center;gap:8px;}
.sr-shape-card:hover{border-color:var(--bl);transform:translateY(-2px);}
.sr-shape-card.sel{border-color:var(--acc);background:rgba(184,124,76,.06);}
.sr-shape-svg{height:64px;display:flex;align-items:center;justify-content:center;color:var(--wb);}
.sr-shape-svg svg{height:100%;width:auto;}
.sr-shape-card.sel .sr-shape-svg{color:var(--acc);}
.sr-shape-label{font-size:12px;font-weight:500;text-align:center;color:var(--es);}
.sr-shape-desc{font-size:10px;color:var(--mu);text-align:center;line-height:1.4;}

/* Skin tone */
.sr-tone-card{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 8px;border:1.5px solid var(--ch);background:var(--iv);cursor:pointer;transition:border-color .2s,transform .2s;}
.sr-tone-card:hover{border-color:var(--bl);transform:translateY(-2px);}
.sr-tone-card.sel{border-color:var(--acc);}
.sr-tone-swatch{width:44px;height:44px;border-radius:50%;border:2px solid rgba(44,26,16,.08);}
.sr-tone-card.sel .sr-tone-swatch{outline:3px solid var(--acc);outline-offset:2px;}
.sr-tone-label{font-size:11px;font-weight:500;color:var(--es);}

/* Undertone */
.sr-undertone-card{padding:20px 16px;border:1.5px solid var(--ch);background:var(--iv);cursor:pointer;transition:border-color .2s,background .2s;display:flex;flex-direction:column;align-items:center;gap:10px;}
.sr-undertone-card:hover{border-color:var(--bl);}
.sr-undertone-card.sel{border-color:var(--acc);background:rgba(184,124,76,.05);}
.sr-undertone-orb{width:52px;height:52px;border-radius:50%;box-shadow:0 4px 16px rgba(0,0,0,.12);}
.sr-undertone-label{font-size:14px;font-weight:500;}
.sr-undertone-desc{font-size:11px;color:var(--mu);text-align:center;}

/* Occasion */
.sr-occasion-card{padding:18px 12px;border:1.5px solid var(--ch);background:var(--iv);cursor:pointer;transition:border-color .2s,background .2s,transform .2s;display:flex;flex-direction:column;align-items:center;gap:8px;}
.sr-occasion-card:hover{border-color:var(--bl);transform:translateY(-2px);}
.sr-occasion-card.sel{border-color:var(--acc);background:rgba(184,124,76,.06);}
.sr-occasion-icon{font-size:24px;line-height:1;}
.sr-occasion-label{font-size:12px;font-weight:500;text-align:center;color:var(--es);}

/* Height */
.sr-height-wrap{max-width:420px;}
.sr-height-options{display:flex;flex-direction:column;gap:8px;}
.sr-height-btn{padding:14px 20px;border:1.5px solid var(--ch);background:var(--iv);text-align:left;font-family:'DM Sans',sans-serif;font-size:14px;cursor:pointer;transition:border-color .2s,background .2s;color:var(--es);}
.sr-height-btn:hover{border-color:var(--bl);}
.sr-height-btn.sel{border-color:var(--acc);background:rgba(184,124,76,.06);font-weight:500;}

/* Colors */
.sr-optional-hint{font-size:11px;color:var(--mu);margin:0 0 16px;letter-spacing:.05em;}
.sr-color-card{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px;border:1.5px solid var(--ch);background:var(--iv);cursor:pointer;transition:border-color .2s,transform .2s;}
.sr-color-card:hover{border-color:var(--bl);transform:translateY(-2px);}
.sr-color-card.sel{border-color:var(--acc);}
.sr-color-swatch{width:40px;height:40px;border-radius:50%;border:1.5px solid rgba(44,26,16,.1);}
.sr-color-card.sel .sr-color-swatch{outline:3px solid var(--acc);outline-offset:2px;}
.sr-color-label{font-size:10px;font-weight:500;text-align:center;color:var(--es);}

/* Fabrics */
.sr-fabric-btn{padding:11px 14px;border:1.5px solid var(--ch);background:var(--iv);font-family:'DM Sans',sans-serif;font-size:13px;cursor:pointer;transition:border-color .2s,background .2s;color:var(--es);}
.sr-fabric-btn:hover{border-color:var(--bl);}
.sr-fabric-btn.sel{border-color:var(--acc);background:rgba(184,124,76,.06);font-weight:500;}

/* Budget */
.sr-budget-wrap{display:flex;flex-direction:column;gap:8px;max-width:380px;}
.sr-budget-btn{padding:15px 20px;border:1.5px solid var(--ch);background:var(--iv);text-align:left;font-family:'DM Sans',sans-serif;font-size:14px;cursor:pointer;transition:border-color .2s,background .2s;color:var(--es);}
.sr-budget-btn:hover{border-color:var(--bl);}
.sr-budget-btn.sel{border-color:var(--acc);background:rgba(184,124,76,.06);font-weight:500;}

/* Nav */
.sr-nav{display:flex;align-items:center;justify-content:space-between;margin-top:40px;padding-top:24px;border-top:1px solid var(--ch);}
.sr-nav-back{background:none;border:none;font-family:'DM Sans',sans-serif;font-size:13px;color:var(--mu);cursor:pointer;padding:10px 0;letter-spacing:.06em;}
.sr-nav-back:disabled{opacity:.3;cursor:default;}
.sr-nav-back:not(:disabled):hover{color:var(--es);}
.sr-nav-next{padding:13px 32px;background:var(--es);color:var(--iv);border:none;font-family:'DM Sans',sans-serif;font-size:12px;letter-spacing:.25em;text-transform:uppercase;cursor:pointer;transition:background .2s,transform .15s;}
.sr-nav-next:not(.disabled):hover{background:var(--wb);transform:translateY(-1px);}
.sr-nav-next.disabled{background:var(--ch);color:var(--mu);cursor:not-allowed;}

/* Results */
.sr-results-hero{background:var(--es);padding:52px clamp(2rem,6vw,5rem) 44px;}
.sr-results-h1{font-family:'Playfair Display',serif;font-size:clamp(2rem,4vw,3rem);font-weight:400;color:var(--iv);margin:8px 0 12px;line-height:1.05;}
.sr-results-sub{font-size:13px;font-weight:300;color:rgba(250,247,244,.5);margin:0 0 18px;max-width:540px;line-height:1.7;}
.sr-profile-chips{display:flex;flex-wrap:wrap;gap:8px;}
.sr-chip{font-size:10px;letter-spacing:.2em;text-transform:uppercase;background:rgba(201,169,110,.18);color:var(--go);padding:4px 12px;border:1px solid rgba(201,169,110,.3);}

.sr-results-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:2px;max-width:1200px;margin:0 auto;padding:2px;}

.sr-result-card{background:var(--iv);border:1px solid var(--ch);position:relative;animation:fadeUp .4s ease both;display:flex;flex-direction:column;}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}

.sr-result-rank{position:absolute;top:12px;left:12px;z-index:2;width:28px;height:28px;background:var(--es);color:var(--iv);font-size:11px;font-weight:500;display:flex;align-items:center;justify-content:center;letter-spacing:.05em;}
.sr-result-img{aspect-ratio:3/4;overflow:hidden;position:relative;background:var(--ch);flex-shrink:0;}
.sr-result-img img{width:100%;height:100%;object-fit:cover;object-position:top;transition:transform .6s ease;}
.sr-result-card:hover .sr-result-img img{transform:scale(1.04);}
.sr-result-badge{position:absolute;bottom:0;left:0;right:0;background:var(--go);color:var(--es);font-size:9px;letter-spacing:.3em;text-transform:uppercase;text-align:center;padding:6px;}

.sr-result-body{padding:20px;display:flex;flex-direction:column;gap:8px;flex:1;}
.sr-result-name{font-family:'Playfair Display',serif;font-size:18px;font-weight:400;margin:0;color:var(--es);}
.sr-result-price{font-family:'Playfair Display',serif;font-size:16px;color:var(--wb);margin:0;}
.sr-result-meta{font-size:11px;color:var(--mu);letter-spacing:.06em;margin:0;}

.sr-result-reasons{display:flex;flex-direction:column;gap:5px;padding:10px 0;border-top:1px solid var(--ch);border-bottom:1px solid var(--ch);}
.sr-result-reason{display:flex;align-items:flex-start;gap:8px;font-size:11px;color:var(--mu);line-height:1.5;}
.sr-reason-dot{width:4px;height:4px;border-radius:50%;background:var(--go);flex-shrink:0;margin-top:5px;}

.sr-result-score{display:flex;align-items:center;gap:10px;}
.sr-score-bar{flex:1;height:3px;background:var(--ch);border-radius:2px;overflow:hidden;}
.sr-score-fill{height:100%;background:linear-gradient(to right,var(--bl),var(--go));transition:width .8s cubic-bezier(.4,0,.2,1);}
.sr-score-label{font-size:11px;color:var(--mu);white-space:nowrap;letter-spacing:.05em;}

.sr-result-actions{display:flex;gap:8px;margin-top:4px;}
.sr-result-btn{flex:1;padding:10px 12px;text-align:center;text-decoration:none;font-family:'DM Sans',sans-serif;font-size:10px;letter-spacing:.2em;text-transform:uppercase;transition:background .2s,color .2s;}
.sr-result-btn--outline{border:1px solid var(--ch);color:var(--es);}
.sr-result-btn--outline:hover{border-color:var(--bl);}
.sr-result-btn--primary{background:var(--es);color:var(--iv);border:1px solid var(--es);}
.sr-result-btn--primary:hover{background:var(--wb);}

.sr-results-footer{display:flex;gap:12px;justify-content:center;padding:48px 24px;}
.sr-btn{padding:12px 28px;font-family:'DM Sans',sans-serif;font-size:11px;letter-spacing:.25em;text-transform:uppercase;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;transition:background .2s,color .2s;}
.sr-btn--ghost{background:none;border:none;color:var(--mu);}
.sr-btn--ghost:hover{color:var(--es);}
.sr-btn--outline{border:1px solid var(--es);color:var(--es);background:transparent;}
.sr-btn--outline:hover{background:var(--es);color:var(--iv);}

.sr-no-results{text-align:center;padding:60px 24px;display:flex;flex-direction:column;align-items:center;gap:16px;}

@media(max-width:640px){
  .sr-grid--body{grid-template-columns:repeat(2,1fr);}
  .sr-grid--undertone{grid-template-columns:1fr;}
  .sr-grid--occasion{grid-template-columns:repeat(2,1fr);}
  .sr-results-grid{grid-template-columns:1fr;}
}
`