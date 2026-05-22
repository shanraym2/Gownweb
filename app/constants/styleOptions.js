/**
 * constants/styleOptions.js — Shared style quiz data & scoring engine
 *
 * Single source of truth for all picker options and gown scoring used in:
 *   app/style-recommender/page.jsx
 *   app/fitting-room/page.jsx
 */

// ─────────────────────────────────────────────────────────────────────────────
// SCORE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum possible raw score */
export const MAX_RAW_SCORE = 132

export function normaliseScore(rawScore) {
  return Math.round(
    Math.min(100, Math.max(0, (rawScore / MAX_RAW_SCORE) * 100))
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BODY SHAPES
// ─────────────────────────────────────────────────────────────────────────────

export const BODY_SHAPES = [
  { id: 'hourglass',        label: 'Hourglass',         desc: 'Balanced bust & hips, defined waist' },
  { id: 'pear',             label: 'Pear',              desc: 'Hips wider than shoulders' },
  { id: 'apple',            label: 'Apple',             desc: 'Fuller midsection, narrower hips' },
  { id: 'rectangle',        label: 'Rectangle',         desc: 'Similar bust, waist & hip width' },
  { id: 'invertedTriangle', label: 'Inverted triangle', desc: 'Broader shoulders, narrower hips' },
  { id: 'petite',           label: 'Petite',            desc: "Under 5'3\" / 160 cm" },
  { id: 'tall',             label: 'Tall',              desc: "Over 5'8\" / 172 cm" },
]

// ─────────────────────────────────────────────────────────────────────────────
// SKIN TONES
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
  { id: 'Floral',    hex: null },
]

// ─────────────────────────────────────────────────────────────────────────────
// FABRICS
// ─────────────────────────────────────────────────────────────────────────────

export const FABRIC_OPTIONS = [
  'Satin',
  'Lace',
  'Chiffon',
  'Tulle',
  'Crepe',
  'Velvet',
  'Organza',
  'Silk',
  'Mikado',
  'Charmeuse',
]

// ─────────────────────────────────────────────────────────────────────────────
// BUDGET RANGES
// ─────────────────────────────────────────────────────────────────────────────

export const BUDGET_RANGES = [
  { id: 'under50k',  label: 'Under ₱50,000',       range: [0, 50000] },
  { id: '50-100k',   label: '₱50,000 – ₱100,000',  range: [50000, 100000] },
  { id: '100-150k',  label: '₱100,000 – ₱150,000', range: [100000, 150000] },
  { id: 'over150k',  label: 'Over ₱150,000',       range: [150000, 9999999] },
  { id: 'any',       label: 'No preference',       range: [0, 9999999] },
]

const BUDGET_MAP = Object.fromEntries(
  BUDGET_RANGES.map(b => [b.id, b.range])
)

// ─────────────────────────────────────────────────────────────────────────────
// SHAPE RULES
// ─────────────────────────────────────────────────────────────────────────────

export const SHAPE_RULES = {
  hourglass: {
    best: ['Mermaid', 'Fit-and-flare', 'Sheath'],
    good: ['A-line', 'Ballgown'],
  },

  pear: {
    best: ['A-line', 'Ballgown'],
    good: ['Fit-and-flare', 'Empire'],
  },

  apple: {
    best: ['Empire', 'A-line'],
    good: ['Sheath', 'Ballgown'],
  },

  rectangle: {
    best: ['Fit-and-flare', 'Mermaid', 'Ballgown'],
    good: ['A-line', 'Sheath'],
  },

  invertedTriangle: {
    best: ['A-line', 'Ballgown', 'Empire'],
    good: ['Sheath', 'Fit-and-flare'],
  },

  petite: {
    best: ['A-line', 'Sheath', 'Empire'],
    good: ['Fit-and-flare'],
  },

  tall: {
    best: ['Mermaid', 'Ballgown', 'Fit-and-flare'],
    good: ['A-line', 'Sheath'],
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// SUIT DETECTION
// ─────────────────────────────────────────────────────────────────────────────

const SUIT_KEYWORDS = [
  'suit',
  'barong',
  'tuxedo',
  'blazer',
  'coat',
  'formal',
  'polo',
]

function isSuit(gown) {
  const type = (gown.type || '').toLowerCase()
  const name = (gown.name || '').toLowerCase()
  const desc = (gown.description || '').toLowerCase()

  return (
    SUIT_KEYWORDS.some(
      kw =>
        type.includes(kw) ||
        name.includes(kw) ||
        desc.includes(kw)
    ) ||
    gown.segment === 'men'
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TONE → COLOR RULES
// ─────────────────────────────────────────────────────────────────────────────

export const TONE_COLOR_RULES = {
  fair: {
    warm: ['Ivory', 'Blush', 'Champagne', 'Peach'],
    cool: ['White', 'Silver', 'Lavender', 'Ice Blue'],
  },

  light: {
    warm: ['Ivory', 'Champagne', 'Gold', 'Nude'],
    cool: ['White', 'Blush', 'Rose', 'Lilac'],
  },

  medium: {
    warm: ['Gold', 'Caramel', 'Terracotta', 'Warm Nude'],
    cool: ['Jewel tones', 'Royal Blue', 'Emerald', 'Berry'],
  },

  olive: {
    warm: ['Gold', 'Bronze', 'Warm White', 'Copper'],
    cool: ['Navy', 'Plum', 'Forest Green'],
  },

  tan: {
    warm: ['Gold', 'Bronze', 'Coral', 'Warm Ivory'],
    cool: ['White', 'Royal Blue', 'Fuchsia'],
  },

  deep: {
    warm: ['Gold', 'Rich Red', 'Bronze', 'Orange'],
    cool: ['White', 'Royal Blue', 'Emerald', 'Fuchsia'],
  },

  ebony: {
    warm: ['Gold', 'Coral', 'Rich Red', 'Warm Ivory'],
    cool: ['White', 'Cobalt', 'Fuchsia', 'Royal Purple'],
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// OCCASION TAGS
// ─────────────────────────────────────────────────────────────────────────────

export const OCCASION_TAGS = {
  ceremony: [
    'Ballgown',
    'Mermaid',
    'A-line',
    'Cathedral',
    'Suit',
    'Barong',
    'Tuxedo',
  ],

  reception: [
    'Sheath',
    'Fit-and-flare',
    'Mini',
    'Suit',
    'Blazer',
  ],

  garden: [
    'A-line',
    'Floral',
    'Empire',
    'Boho',
    'Suit',
  ],

  beach: [
    'Empire',
    'Sheath',
    'Chiffon',
    'Simple',
    'Linen',
  ],

  civil: [
    'Sheath',
    'Mini',
    'Suit',
    'Simple',
    'Barong',
  ],

  'black-tie': [
    'Ballgown',
    'Mermaid',
    'Fit-and-flare',
    'Tuxedo',
    'Suit',
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// HEIGHT CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PETITE_MAX_CM = 160
const TALL_MIN_CM = 172

const PETITE_SILHOUETTES = ['a-line', 'sheath', 'empire']
const TALL_SILHOUETTES = ['mermaid', 'ballgown', 'fit-and-flare']

// ─────────────────────────────────────────────────────────────────────────────
// SCORE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function scoreGown(gown, profile) {
  let score = 0
  const reasons = []

  const {
    bodyShape,
    skinTone,
    undertone,
    occasion,
    height,
    colors,
    fabrics,
    budget,
    segment,
  } = profile

  const budgetRange = budget
    ? (BUDGET_MAP[budget] ?? null)
    : null

  const suit = isSuit(gown)

  // ─────────────────────────────────────────────────────────────────────────
  // SUIT BRANCH
  // ─────────────────────────────────────────────────────────────────────────

  if (suit) {
    const activeSegment = segment ?? 'women'

    // Base score so suits aren't filtered out
    if (activeSegment === 'men') {
      score += 35
      reasons.push('Formal menswear for your occasion')
    } else {
      score += 5
    }

    // Skin tone
    if (skinTone && gown.color) {
      const rule = TONE_COLOR_RULES[skinTone]
      const colLL = gown.color.toLowerCase()

      const isWarm = !undertone || undertone === 'warm'

      const palette = rule
        ? (
            isWarm
              ? [...(rule.warm ?? []), ...(rule.cool ?? [])]
              : [...(rule.cool ?? []), ...(rule.warm ?? [])]
          )
        : []

      if (palette.some(c => colLL.includes(c.toLowerCase()))) {
        score += 20
        reasons.push(`${gown.color} suits your skin tone`)
      }
    }

    // Preferred colors
    if (colors?.length && gown.color) {
      const colLL = gown.color.toLowerCase()

      if (colors.some(c => colLL.includes(c.toLowerCase()))) {
        score += 15
        reasons.push(`Matches your preferred colour: ${gown.color}`)
      }
    }

    // Occasion
    if (occasion) {
      const tags = OCCASION_TAGS[occasion] ?? []

      const haystack = [
        gown.name ?? '',
        gown.description ?? '',
        gown.type ?? '',
      ]
        .join(' ')
        .toLowerCase()

      if (tags.some(t => haystack.includes(t.toLowerCase()))) {
        score += 15
        reasons.push(
          `Appropriate for a ${occasion.replace('-', ' ')} setting`
        )
      } else {
        score += 8
        reasons.push('Versatile formalwear')
      }
    }

    // Fabrics
    if (fabrics?.length && gown.fabric) {
      const fabLL = gown.fabric.toLowerCase()

      if (fabrics.some(f => fabLL.includes(f.toLowerCase()))) {
        score += 12
        reasons.push(
          `${gown.fabric} is one of your preferred fabrics`
        )
      }
    }

    // Budget
    if (budgetRange && gown.salePrice != null) {
      const [min, max] = budgetRange

      if (gown.salePrice >= min && gown.salePrice <= max) {
        score += 12
        reasons.push('Within your budget')
      } else if (gown.salePrice > max) {
        score -= 20
      }
    }

    return { score, reasons }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GOWN / DRESS BRANCH
  // ─────────────────────────────────────────────────────────────────────────

  // Body shape
  if (bodyShape && SHAPE_RULES[bodyShape] && gown.silhouette) {
    const rule = SHAPE_RULES[bodyShape]
    const siLL = gown.silhouette.toLowerCase()

    if (rule.best.some(s => siLL.includes(s.toLowerCase()))) {
      score += 35

      reasons.push(
        `${gown.silhouette} is ideal for a ${bodyShape
          .replace(/([A-Z])/g, ' $1')
          .trim()} figure`
      )
    } else if (
      rule.good.some(s => siLL.includes(s.toLowerCase()))
    ) {
      score += 18

      reasons.push(
        `${gown.silhouette} works well for your body shape`
      )
    }
  }

  // Skin tone
  if (skinTone && gown.color) {
    const rule = TONE_COLOR_RULES[skinTone]
    const colLL = gown.color.toLowerCase()

    const isWarm = !undertone || undertone === 'warm'

    const palette = rule
      ? (
          isWarm
            ? [...(rule.warm ?? []), ...(rule.cool ?? [])]
            : [...(rule.cool ?? []), ...(rule.warm ?? [])]
        )
      : []

    if (palette.some(c => colLL.includes(c.toLowerCase()))) {
      score += 25

      reasons.push(
        `${gown.color} complements ${skinTone} skin beautifully`
      )
    }
  }

  // Preferred colors
  if (colors?.length && gown.color) {
    const colLL = gown.color.toLowerCase()

    if (colors.some(c => colLL.includes(c.toLowerCase()))) {
      score += 20
      reasons.push(`Matches your preferred colour: ${gown.color}`)
    }
  }

  // Fabrics
  if (fabrics?.length && gown.fabric) {
    const fabLL = gown.fabric.toLowerCase()

    if (fabrics.some(f => fabLL.includes(f.toLowerCase()))) {
      score += 15

      reasons.push(
        `${gown.fabric} is one of your preferred fabrics`
      )
    }
  }

  // Occasion
  if (occasion && gown.silhouette) {
    const tags = OCCASION_TAGS[occasion] ?? []

    const haystack = [
      gown.silhouette ?? '',
      gown.description ?? '',
    ]
      .join(' ')
      .toLowerCase()

    if (tags.some(t => haystack.includes(t.toLowerCase()))) {
      score += 15

      reasons.push(
        `Suits a ${occasion.replace('-', ' ')} setting`
      )
    }
  }

  // Height
  if (height && gown.silhouette) {
    const h = Number(height)
    const siLL = gown.silhouette.toLowerCase()

    if (
      h < PETITE_MAX_CM &&
      PETITE_SILHOUETTES.some(s => siLL.includes(s))
    ) {
      score += 10
      reasons.push('Elongates petite frames')
    } else if (
      h >= TALL_MIN_CM &&
      TALL_SILHOUETTES.some(s => siLL.includes(s))
    ) {
      score += 10
      reasons.push('Showcases your tall, elegant frame')
    }
  }

  // Budget
  if (budgetRange && gown.salePrice != null) {
    const [min, max] = budgetRange

    if (gown.salePrice >= min && gown.salePrice <= max) {
      score += 12

      reasons.push(
        `Within your budget of ₱${min.toLocaleString()}–₱${max.toLocaleString()}`
      )
    } else if (gown.salePrice > max) {
      score -= 20
    }
  }

  return { score, reasons }
}

// ─────────────────────────────────────────────────────────────────────────────
// HEIGHT OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const HEIGHT_OPTIONS = [
  { label: "Under 5'0\" (152 cm)",      val: '150' },
  { label: "5'0\"–5'3\" (152–160 cm)",  val: '156' },
  { label: "5'3\"–5'6\" (160–168 cm)",  val: '164' },
  { label: "5'6\"–5'9\" (168–175 cm)",  val: '172' },
  { label: "Over 5'9\" (175 cm+)",      val: '178' },
  { label: 'Prefer not to say',         val: '' },
]