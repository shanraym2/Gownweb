/**
 * constants/styleOptions.js — Shared style quiz data & scoring engine
 *
 * Single source of truth for all picker options and gown scoring used in:
 *   app/style-recommender/page.jsx
 *   app/fitting-room/page.jsx
 *
 * Import only what you need:
 *   import { BODY_SHAPES, SKIN_TONES, scoreGown, MAX_RAW_SCORE } from '@/constants/styleOptions'
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCORE NORMALISATION  (audit fix)
 * ─────────────────────────────────────────────────────────────────────────────
 * Raw scores can reach 132 points (35+25+20+15+15+10+12).
 * scoreGown() returns the raw value for sorting precision.
 * Use normaliseScore() before displaying a % label to the user.
 *
 *   import { scoreGown, normaliseScore } from '@/constants/styleOptions'
 *   const { score } = scoreGown(gown, profile)
 *   const pct = normaliseScore(score)    // 0–100 integer, safe to show as "%"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUDGET CONTRACT  (audit fix)
 * ─────────────────────────────────────────────────────────────────────────────
 * profile.budget is stored as an ID string (e.g. "under50k").
 * scoreGown() resolves it to a [min, max] range internally.
 * Never pass a raw [min, max] array as profile.budget — use the ID string.
 */

// ─────────────────────────────────────────────────────────────────────────────
// SCORE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum possible raw score (35+25+20+15+15+10+12). */
export const MAX_RAW_SCORE = 132

/**
 * normaliseScore(rawScore)
 * Converts a raw scoreGown() value to a 0–100 integer suitable for display.
 *
 * @param {number} rawScore
 * @returns {number} 0–100
 */
export function normaliseScore(rawScore) {
  return Math.round(Math.min(100, Math.max(0, (rawScore / MAX_RAW_SCORE) * 100)))
}

// ─────────────────────────────────────────────────────────────────────────────
// BODY SHAPES
// ─────────────────────────────────────────────────────────────────────────────

export const BODY_SHAPES = [
  { id: 'hourglass',        label: 'Hourglass',         desc: 'Balanced bust & hips, defined waist' },
  { id: 'pear',             label: 'Pear',              desc: 'Hips wider than shoulders' },
  { id: 'apple',            label: 'Apple',             desc: 'Fuller midsection, narrower hips' },
  { id: 'rectangle',        label: 'Rectangle',         desc: 'Similar bust, waist & hip width' },
  { id: 'invertedTriangle', label: 'Inverted triangle', desc: "Broader shoulders, narrower hips" },
  { id: 'petite',           label: 'Petite',            desc: "Under 5'3\" / 160 cm" },
  { id: 'tall',             label: 'Tall',              desc: "Over 5'8\" / 172 cm" },
]

// ─────────────────────────────────────────────────────────────────────────────
// SKIN TONES
// Must stay in sync with TONE_BUCKETS in utils/skinTone.js
// ─────────────────────────────────────────────────────────────────────────────

export const SKIN_TONES = [
  { id: 'fair',   label: 'Fair',   hex: '#F8E8D8' },
  { id: 'light',  label: 'Light',  hex: '#F0D0A8' },
  { id: 'medium', label: 'Medium', hex: '#D4956A' },
  { id: 'olive',  label: 'Olive',  hex: '#B8804A' },
  { id: 'tan',    label: 'Tan',    hex: '#9A6438' },
  { id: 'deep',   label: 'Deep',   hex: '#6B3E26' },
  { id: 'ebony',  label: 'Ebony',  hex: '#3D1F10' },
]

// ─────────────────────────────────────────────────────────────────────────────
// UNDERTONES
// ─────────────────────────────────────────────────────────────────────────────

export const UNDERTONES = [
  { id: 'warm',    label: 'Warm',    desc: 'Golden / peachy / yellow', hex: '#E8A855' },
  { id: 'cool',    label: 'Cool',    desc: 'Pink / red / bluish',      hex: '#C878B0' },
  { id: 'neutral', label: 'Neutral', desc: 'Mix of warm & cool',       hex: '#A89078' },
]

// ─────────────────────────────────────────────────────────────────────────────
// OCCASIONS
// ─────────────────────────────────────────────────────────────────────────────

export const OCCASIONS = [
  { id: 'ceremony',  label: 'Wedding ceremony',    icon: '⛪' },
  { id: 'reception', label: 'Reception / party',   icon: '🥂' },
  { id: 'garden',    label: 'Garden / outdoor',    icon: '🌿' },
  { id: 'beach',     label: 'Beach / destination', icon: '🌊' },
  { id: 'civil',     label: 'Civil / courthouse',  icon: '📋' },
  { id: 'black-tie', label: 'Black tie / gala',    icon: '✨' },
]

// ─────────────────────────────────────────────────────────────────────────────
// COLORS
// hex: null means a pattern (rendered as a conic-gradient swatch in UI)
// ─────────────────────────────────────────────────────────────────────────────

export const COLOR_OPTIONS = [
  { id: 'Ivory',     hex: '#FFFFF0' },
  { id: 'White',     hex: '#FFFFFF' },
  { id: 'Blush',     hex: '#FFB6C1' },
  { id: 'Champagne', hex: '#F7E7CE' },
  { id: 'Gold',      hex: '#FFD700' },
  { id: 'Nude',      hex: '#E8C9A0' },
  { id: 'Rose',      hex: '#FF8FAB' },
  { id: 'Blue',      hex: '#4A90D9' },
  { id: 'Lavender',  hex: '#C9A8E0' },
  { id: 'Sage',      hex: '#B2C9A0' },
  { id: 'Mint',      hex: '#98D8C8' },
  { id: 'Floral',    hex: null },      // pattern — no single hex
]

// ─────────────────────────────────────────────────────────────────────────────
// FABRICS
// ─────────────────────────────────────────────────────────────────────────────

export const FABRIC_OPTIONS = [
  'Satin', 'Lace', 'Chiffon', 'Tulle', 'Crepe',
  'Velvet', 'Organza', 'Silk', 'Mikado', 'Charmeuse',
]

// ─────────────────────────────────────────────────────────────────────────────
// BUDGET RANGES
//
// profile.budget stores the `id` string (e.g. "under50k").
// scoreGown() resolves it to `range` internally via BUDGET_MAP.
// ─────────────────────────────────────────────────────────────────────────────

export const BUDGET_RANGES = [
  { id: 'under50k',  label: 'Under ₱50,000',       range: [0,       50_000]  },
  { id: '50-100k',   label: '₱50,000 – ₱100,000',  range: [50_000,  100_000] },
  { id: '100-150k',  label: '₱100,000 – ₱150,000', range: [100_000, 150_000] },
  { id: 'over150k',  label: 'Over ₱150,000',        range: [150_000, 9_999_999] },
  { id: 'any',       label: 'No preference',         range: [0,       9_999_999] },
]

// Internal lookup — keyed by id for O(1) resolution in scoreGown()
const BUDGET_MAP = Object.fromEntries(BUDGET_RANGES.map(b => [b.id, b.range]))

// ─────────────────────────────────────────────────────────────────────────────
// SHAPE RULES
// Maps body shape id → best/good silhouette lists
// ─────────────────────────────────────────────────────────────────────────────

export const SHAPE_RULES = {
  hourglass:        { best: ['Mermaid', 'Fit-and-flare', 'Sheath'],   good: ['A-line', 'Ballgown'] },
  pear:             { best: ['A-line', 'Ballgown'],                    good: ['Fit-and-flare', 'Empire'] },
  apple:            { best: ['Empire', 'A-line'],                      good: ['Sheath', 'Ballgown'] },
  rectangle:        { best: ['Fit-and-flare', 'Mermaid', 'Ballgown'], good: ['A-line', 'Sheath'] },
  invertedTriangle: { best: ['A-line', 'Ballgown', 'Empire'],          good: ['Sheath', 'Fit-and-flare'] },
  petite:           { best: ['A-line', 'Sheath', 'Empire'],            good: ['Fit-and-flare'] },
  tall:             { best: ['Mermaid', 'Ballgown', 'Fit-and-flare'], good: ['A-line', 'Sheath'] },
}

// ─────────────────────────────────────────────────────────────────────────────
// TONE → COLOR PALETTE RULES
// warm/cool arrays ordered by strongest complement first
// ─────────────────────────────────────────────────────────────────────────────

export const TONE_COLOR_RULES = {
  fair:   { warm: ['Ivory', 'Blush', 'Champagne', 'Peach'],         cool: ['White', 'Silver', 'Lavender', 'Ice Blue'] },
  light:  { warm: ['Ivory', 'Champagne', 'Gold', 'Nude'],           cool: ['White', 'Blush', 'Rose', 'Lilac'] },
  medium: { warm: ['Gold', 'Caramel', 'Terracotta', 'Warm Nude'],   cool: ['Jewel tones', 'Royal Blue', 'Emerald', 'Berry'] },
  olive:  { warm: ['Gold', 'Bronze', 'Warm White', 'Copper'],       cool: ['Navy', 'Plum', 'Forest Green'] },
  tan:    { warm: ['Gold', 'Bronze', 'Coral', 'Warm Ivory'],        cool: ['White', 'Royal Blue', 'Fuchsia'] },
  deep:   { warm: ['Gold', 'Rich Red', 'Bronze', 'Orange'],         cool: ['White', 'Royal Blue', 'Emerald', 'Fuchsia'] },
  ebony:  { warm: ['Gold', 'Coral', 'Rich Red', 'Warm Ivory'],      cool: ['White', 'Cobalt', 'Fuchsia', 'Royal Purple'] },
}

// ─────────────────────────────────────────────────────────────────────────────
// OCCASION → GOWN TAG COMPATIBILITY
// ─────────────────────────────────────────────────────────────────────────────

export const OCCASION_TAGS = {
  ceremony:    ['Ballgown', 'Mermaid', 'A-line', 'Cathedral'],
  reception:   ['Sheath', 'Fit-and-flare', 'Mini'],
  garden:      ['A-line', 'Floral', 'Empire', 'Boho'],
  beach:       ['Empire', 'Sheath', 'Chiffon', 'Simple'],
  civil:       ['Sheath', 'Mini', 'Suit', 'Simple'],
  'black-tie': ['Ballgown', 'Mermaid', 'Fit-and-flare'],
}

// ─────────────────────────────────────────────────────────────────────────────
// HEIGHT RANGE CONSTANTS
// Used internally by scoreGown() for petite / tall adjustments
// ─────────────────────────────────────────────────────────────────────────────

const PETITE_MAX_CM = 160
const TALL_MIN_CM   = 172

const PETITE_SILHOUETTES = ['a-line', 'sheath', 'empire']
const TALL_SILHOUETTES   = ['mermaid', 'ballgown', 'fit-and-flare']

// ─────────────────────────────────────────────────────────────────────────────
// scoreGown(gown, profile) → { score: number, reasons: string[] }
//
// Scores a single gown against a user profile. Returns a raw score suitable
// for sorting. Use normaliseScore() before showing a % to the user.
//
// profile shape:
//   {
//     bodyShape:  string | null,       // id from BODY_SHAPES
//     skinTone:   string | null,       // id from SKIN_TONES
//     undertone:  string | null,       // 'warm' | 'cool' | 'neutral'
//     occasion:   string | null,       // id from OCCASIONS
//     height:     string | number | null,  // cm — used for petite/tall boost
//     colors:     string[],            // ids from COLOR_OPTIONS
//     fabrics:    string[],            // labels from FABRIC_OPTIONS
//     budget:     string | null,       // id from BUDGET_RANGES  ← must be ID, not [min,max]
//   }
//
// gown shape (from /api/gowns):
//   { id, name, silhouette, color, fabric, description, salePrice, … }
//
// ─────────────────────────────────────────────────────────────────────────────

export function scoreGown(gown, profile) {
  let score = 0
  const reasons = []

  const {
    bodyShape, skinTone, undertone, occasion,
    height, colors, fabrics, budget,
  } = profile

  // ── Budget: resolve ID string → [min, max] range ───────────────────────
  // FIX (audit): budget is stored as an ID string; do NOT expect a [min,max]
  // array here — resolve it internally so scoreGown() is safe to call from
  // anywhere without the caller needing to pre-resolve the budget.
  const budgetRange = budget ? (BUDGET_MAP[budget] ?? null) : null

  // ── Body shape → silhouette compatibility (max +35) ────────────────────
  if (bodyShape && SHAPE_RULES[bodyShape] && gown.silhouette) {
    const rule = SHAPE_RULES[bodyShape]
    const sil  = gown.silhouette
    const siLL = sil.toLowerCase()
    if (rule.best.some(s => siLL.includes(s.toLowerCase()))) {
      score += 35
      reasons.push(`${sil} is ideal for a ${bodyShape.replace(/([A-Z])/g, ' $1').trim()} figure`)
    } else if (rule.good.some(s => siLL.includes(s.toLowerCase()))) {
      score += 18
      reasons.push(`${sil} works well for your body shape`)
    }
  }

  // ── Skin tone → gown colour compatibility (max +25) ────────────────────
  if (skinTone && gown.color) {
    const rule   = TONE_COLOR_RULES[skinTone]
    const colLL  = gown.color.toLowerCase()
    const isWarm = !undertone || undertone === 'warm'
    const palette = rule
      ? (isWarm
          ? [...(rule.warm ?? []), ...(rule.cool ?? [])]
          : [...(rule.cool ?? []), ...(rule.warm ?? [])])
      : []
    if (palette.some(c => colLL.includes(c.toLowerCase()))) {
      score += 25
      reasons.push(`${gown.color} complements ${skinTone} skin beautifully`)
    }
  }

  // ── Preferred colours (max +20) ────────────────────────────────────────
  if (colors?.length && gown.color) {
    const colLL = gown.color.toLowerCase()
    if (colors.some(c => colLL.includes(c.toLowerCase()))) {
      score += 20
      reasons.push(`Matches your preferred colour: ${gown.color}`)
    }
  }

  // ── Preferred fabrics (max +15) ────────────────────────────────────────
  if (fabrics?.length && gown.fabric) {
    const fabLL = gown.fabric.toLowerCase()
    if (fabrics.some(f => fabLL.includes(f.toLowerCase()))) {
      score += 15
      reasons.push(`${gown.fabric} is one of your preferred fabrics`)
    }
  }

  // ── Occasion compatibility (max +15) ──────────────────────────────────
  if (occasion && gown.silhouette) {
    const tags  = OCCASION_TAGS[occasion] ?? []
    const haystack = [
      gown.silhouette ?? '',
      gown.description ?? '',
    ].join(' ').toLowerCase()
    if (tags.some(t => haystack.includes(t.toLowerCase()))) {
      score += 15
      reasons.push(`Suits a ${occasion.replace('-', ' ')} setting`)
    }
  }

  // ── Height adjustment (max +10) ────────────────────────────────────────
  if (height && gown.silhouette) {
    const h    = Number(height)
    const siLL = gown.silhouette.toLowerCase()
    if (h < PETITE_MAX_CM && PETITE_SILHOUETTES.some(s => siLL.includes(s))) {
      score += 10
      reasons.push('Elongates petite frames')
    } else if (h >= TALL_MIN_CM && TALL_SILHOUETTES.some(s => siLL.includes(s))) {
      score += 10
      reasons.push('Showcases your tall, elegant frame')
    }
  }

  // ── Budget fit (max +12, penalty -20 if over budget) ──────────────────
  if (budgetRange && gown.salePrice != null) {
    const [min, max] = budgetRange
    if (gown.salePrice >= min && gown.salePrice <= max) {
      score += 12
      reasons.push(`Within your budget of ₱${min.toLocaleString()}–₱${max.toLocaleString()}`)
    } else if (gown.salePrice > max) {
      score -= 20   // penalise over-budget gowns
    }
  }

  return { score, reasons }
}

// ─────────────────────────────────────────────────────────────────────────────
// HEIGHT OPTIONS  (for the quiz step in StyleRecommenderPage)
// ─────────────────────────────────────────────────────────────────────────────

export const HEIGHT_OPTIONS = [
  { label: "Under 5'0\" (152 cm)",       val: '150' },
  { label: "5'0\"–5'3\" (152–160 cm)",   val: '156' },
  { label: "5'3\"–5'6\" (160–168 cm)",   val: '164' },
  { label: "5'6\"–5'9\" (168–175 cm)",   val: '172' },
  { label: "Over 5'9\" (175 cm+)",        val: '178' },
  { label: 'Prefer not to say',           val: '' },
]