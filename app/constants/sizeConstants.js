// ─────────────────────────────────────────────────────────────────────────────
// sizeConstants.js
// Shared size-chart data for Women, Men, and Children (Girls / Boys).
// Import this in:
//   • constants/styleOptions.js  (scoreGown, fitting room)
//   • api/size-chart/route.js    (size-chart API)
//   • admin/gowns/page.js        (SizePicker preset pills)
// ─────────────────────────────────────────────────────────────────────────────

// ── Segment IDs ───────────────────────────────────────────────────────────────
export const SEGMENTS = [
  { id: 'women',    label: 'Women'    },
  { id: 'men',      label: 'Men'      },
  { id: 'children', label: 'Children' },
]

// ── Size charts (all measurements in cm) ─────────────────────────────────────
// Women — Philippine DTI/BPS standard, bridal-boutique range
export const SIZES_WOMEN = [
  { label: 'XS',  bust_min: 76,  bust_max: 81,  waist_min: 58,  waist_max: 63,  hip_min: 82,  hip_max: 87  },
  { label: 'S',   bust_min: 82,  bust_max: 87,  waist_min: 64,  waist_max: 69,  hip_min: 88,  hip_max: 93  },
  { label: 'M',   bust_min: 88,  bust_max: 93,  waist_min: 70,  waist_max: 75,  hip_min: 94,  hip_max: 99  },
  { label: 'L',   bust_min: 94,  bust_max: 99,  waist_min: 76,  waist_max: 81,  hip_min: 100, hip_max: 105 },
  { label: 'XL',  bust_min: 100, bust_max: 106, waist_min: 82,  waist_max: 88,  hip_min: 106, hip_max: 112 },
  { label: '2XL', bust_min: 107, bust_max: 113, waist_min: 89,  waist_max: 96,  hip_min: 113, hip_max: 119 },
  { label: '3XL', bust_min: 114, bust_max: 121, waist_min: 97,  waist_max: 105, hip_min: 120, hip_max: 127 },
  { label: '4XL', bust_min: 122, bust_max: 130, waist_min: 106, waist_max: 115, hip_min: 128, hip_max: 136 },
]

// Men — chest/waist/hips in cm; waist also used for trouser sizing
export const SIZES_MEN = [
  { label: 'XS',  bust_min: 78,  bust_max: 83,  waist_min: 68,  waist_max: 73,  hip_min: 76,  hip_max: 81  },
  { label: 'S',   bust_min: 84,  bust_max: 89,  waist_min: 74,  waist_max: 79,  hip_min: 82,  hip_max: 87  },
  { label: 'M',   bust_min: 90,  bust_max: 95,  waist_min: 80,  waist_max: 85,  hip_min: 88,  hip_max: 93  },
  { label: 'L',   bust_min: 96,  bust_max: 101, waist_min: 86,  waist_max: 91,  hip_min: 94,  hip_max: 99  },
  { label: 'XL',  bust_min: 102, bust_max: 107, waist_min: 92,  waist_max: 97,  hip_min: 100, hip_max: 105 },
  { label: '2XL', bust_min: 108, bust_max: 115, waist_min: 98,  waist_max: 105, hip_min: 106, hip_max: 112 },
  { label: '3XL', bust_min: 116, bust_max: 123, waist_min: 106, waist_max: 113, hip_min: 113, hip_max: 119 },
  { label: '4XL', bust_min: 124, bust_max: 132, waist_min: 114, waist_max: 122, hip_min: 120, hip_max: 128 },
]

// Children — unisex sizing by age group (2–16 y).
// bust_min/max = chest; hip_min/max = hips.
// Waist range is the same for boys and girls at each age in PH standard.
export const SIZES_CHILDREN = [
  { label: '2–3y',   bust_min: 50, bust_max: 55, waist_min: 48, waist_max: 53, hip_min: 51, hip_max: 56 },
  { label: '4–5y',   bust_min: 56, bust_max: 61, waist_min: 54, waist_max: 59, hip_min: 57, hip_max: 62 },
  { label: '6–7y',   bust_min: 62, bust_max: 66, waist_min: 55, waist_max: 59, hip_min: 63, hip_max: 68 },
  { label: '8–9y',   bust_min: 67, bust_max: 72, waist_min: 60, waist_max: 64, hip_min: 69, hip_max: 74 },
  { label: '10–11y', bust_min: 73, bust_max: 78, waist_min: 65, waist_max: 69, hip_min: 75, hip_max: 80 },
  { label: '12–13y', bust_min: 79, bust_max: 84, waist_min: 70, waist_max: 73, hip_min: 81, hip_max: 86 },
  { label: '14–16y', bust_min: 85, bust_max: 90, waist_min: 74, waist_max: 78, hip_min: 87, hip_max: 92 },
]

// ── Lookup by segment ID ──────────────────────────────────────────────────────
export const SIZES_BY_SEGMENT = {
  women:    SIZES_WOMEN,
  men:      SIZES_MEN,
  children: SIZES_CHILDREN,
}

// ── Preset pills per segment (used by SizePicker in admin) ───────────────────
export const PRESET_SIZES_BY_SEGMENT = {
  women:    ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
  men:      ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
  children: ['2–3y', '4–5y', '6–7y', '8–9y', '10–11y', '12–13y', '14–16y'],
}

// ── Camera measurement multipliers per segment ────────────────────────────────
// Used in ScanPanel detect() to convert pixel measurements → centimetres.
// bust/waist/hip: shoulder-width pixel ratio → circumference estimate
// torsoAnchorCm: assumed torso height (shoulder → hip) for pxPerCm calibration
//   when user height is not available. When height IS known, prefer:
//   torsoAnchorCm = userHeight / torsoHeightDivisor
export const CAMERA_MULTS = {
  bust:          2.30,   // was 1.85 — shoulder span → bust circumference
  waist:         1.85,   // was 1.55 — narrowed torso → waist circumference  
  hip:           2.80,   // was 1.95 — hip landmark span → hip circumference
  torsoAnchorCm: 50,     // was 42 — adult shoulder→hip torso height fallback
}

// ── Column header labels per segment (for size chart display) ────────────────
export const SIZE_CHART_COLS = {
  women:    ['Size', 'Bust (cm)', 'Waist (cm)', 'Hips (cm)'],
  men:      ['Size', 'Chest (cm)', 'Waist (cm)', 'Hips (cm)'],
  children: ['Age / Size', 'Chest (cm)', 'Waist (cm)', 'Hips (cm)'],
}

// ── formatSizeRow — coerce numeric strings → numbers (same helper used in API)
export function formatSizeRow(row) {
  return {
    label:     row.label,
    bust_min:  row.bust_min  != null ? Number(row.bust_min)  : null,
    bust_max:  row.bust_max  != null ? Number(row.bust_max)  : null,
    waist_min: row.waist_min != null ? Number(row.waist_min) : null,
    waist_max: row.waist_max != null ? Number(row.waist_max) : null,
    hip_min:   row.hip_min   != null ? Number(row.hip_min)   : null,
    hip_max:   row.hip_max   != null ? Number(row.hip_max)   : null,
  }
}

// ── recommendSize — pick best-matching label from a segment's chart ───────────
// Returns { size, score, adjacent } or null.
// score = average cm deviation from midpoint across available measurements.
export function recommendSize(segment = 'women', { bust, waist, hips } = {}) {
  const sizes = SIZES_BY_SEGMENT[segment] ?? SIZES_WOMEN
  if (!bust && !waist && !hips) return null

  let best = null
  let bestScore = Infinity

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

  const idx      = sizes.findIndex(s => s.label === best.label)
  const adjacent = sizes.slice(Math.max(0, idx - 1), Math.min(sizes.length, idx + 2))
  return { size: best, score: bestScore, adjacent }
}