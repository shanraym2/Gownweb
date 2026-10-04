/**
 * lib/fitting-room/calibration.js
 *
 * "Enhanced" calibration for the try-on. No DOM, no React.
 *
 * Saved shape (inside the existing gown.tryonCalibration JSON):
 *   {
 *     ...simple values (necklineY, shoulderPad, skirtFlare, waistRow, ...),   // untouched
 *     mode: 'simple' | 'enhanced',               // missing = simple
 *     enhanced: { neckline?, sleeves?, topAt?, shoulderEase?, seamL?, seamR? }
 *   }
 * Switching mode never deletes either set of values.
 *
 * All numbers below are starting points, not measurements. Staff are meant
 * to nudge them per gown.
 */

const clamp = (v, a, b) => Math.min(Math.max(v, a), b)
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

export const NECKLINES = [
  { id: 'strapless',   label: 'Strapless' },
  { id: 'sweetheart',  label: 'Sweetheart' },
  { id: 'scoop',       label: 'Scoop / round' },
  { id: 'vneck',       label: 'V-neck / plunge' },
  { id: 'boat',        label: 'Boat / bateau' },
  { id: 'halter',      label: 'Halter' },
  { id: 'high',        label: 'High / illusion' },
  { id: 'offshoulder', label: 'Off-shoulder' },
]

export const SLEEVES = [
  { id: 'none',         label: 'Sleeveless' },
  { id: 'straps',       label: 'Straps' },
  { id: 'cap',          label: 'Cap sleeve' },
  { id: 'short',        label: 'Short sleeve' },
  { id: 'threequarter', label: '3/4 sleeve' },
  { id: 'long',         label: 'Long sleeve' },
  { id: 'cape',         label: 'Cape / bell' },
]

// topAt: where the garment's top edge sits relative to the detected shoulder line,
//        as a fraction of torso height. Positive = below the shoulders, negative = above.
// shoulderEase: top width relative to the detected shoulder span.
const NECK = {
  strapless:   { topAt:  0.10, shoulderEase: 1.10 },
  sweetheart:  { topAt:  0.08, shoulderEase: 1.10 },
  scoop:       { topAt: -0.08, shoulderEase: 1.12 },
  vneck:       { topAt: -0.12, shoulderEase: 1.12 },
  boat:        { topAt: -0.05, shoulderEase: 1.25 },
  halter:      { topAt: -0.22, shoulderEase: 1.05 },
  high:        { topAt: -0.20, shoulderEase: 1.05 },
  offshoulder: { topAt:  0.02, shoulderEase: 1.45 },
}

// Share of the bodice-row silhouette width, per side, that is sleeve rather than bodice.
const SLEEVE_INSET = { none: 0, straps: 0, cap: 0.05, short: 0.09, threequarter: 0.14, long: 0.16, cape: 0.18 }

// Advanced per-gown controls (enhanced mode only). Defaults reproduce today's look.
// hemShadow / edgePx defaults mirror HEM_SHADOW / FEATHER_PX in glGownRenderer.js.
export const ADV_DEFAULTS = { flare: 0.5, swing: 0.5, hemShadow: 0.38, edgePx: 0.8, bright: 1, warmth: 0 }
export const ADV_FIELDS = [
  { k: 'flare',     label: 'Flare length',  min: 0.15, max: 1.0, step: 0.01, hint: 'How far below the hip the skirt takes to reach full width. Lower = flares out sooner.' },
  { k: 'swing',     label: 'Skirt swing',   min: 0,    max: 1,   step: 0.05, hint: '0 = rigid skirt, 1 = very loose. Only visible in the live fitting room.' },
  { k: 'hemShadow', label: 'Hem shadow',    min: 0,    max: 0.8, step: 0.02, hint: 'Strength of the soft shadow under the hem. 0 = none.' },
  { k: 'edgePx',    label: 'Edge softness', min: 0,    max: 3,   step: 0.1,  hint: 'Softens the cut-out edge. Raise it if the outline looks harsh, lower it if the gown looks blurry.' },
  { k: 'bright',    label: 'Brightness',    min: 0.7,  max: 1.3, step: 0.02, hint: 'Brightens or darkens this gown on top of the automatic room lighting.' },
  { k: 'warmth',    label: 'Warmth',        min: -1,   max: 1,   step: 0.05, hint: 'Shifts the colour cooler (-) or warmer (+), e.g. to keep ivory looking ivory.' },
]

// Prefill for the editor's dropdowns, from the gown's own text fields.
export function guessTags(gown) {
  const t = [gown?.neckline, gown?.silhouette, gown?.name, gown?.description].map(s => String(s || '').toLowerCase()).join(' ')
  let neckline = 'scoop'
  if (/off.?the.?shoulder|off.?shoulder|bardot/.test(t))      neckline = 'offshoulder'
  else if (/strapless|bandeau/.test(t))                       neckline = 'strapless'
  else if (/sweetheart/.test(t))                              neckline = 'sweetheart'
  else if (/halter/.test(t))                                  neckline = 'halter'
  else if (/v.?neck|plunge/.test(t))                          neckline = 'vneck'
  else if (/boat|bateau/.test(t))                             neckline = 'boat'
  else if (/high|mock|turtle|illusion/.test(t))               neckline = 'high'
  let sleeves = 'none'
  if (/long.?sleeve/.test(t))                                 sleeves = 'long'
  else if (/(3\/4|three.?quarter).{0,3}sleeve/.test(t))       sleeves = 'threequarter'
  else if (/short.?sleeve/.test(t))                           sleeves = 'short'
  else if (/cap.?sleeve/.test(t))                             sleeves = 'cap'
  else if (/cape|bell.?sleeve/.test(t))                       sleeves = 'cape'
  return { neckline, sleeves }
}

/**
 * Bake the enhanced values into the fields the layout code already reads
 * (necklineY, shoulderPad), and expose `enh` for the renderer.
 * In simple mode the object is returned untouched.
 */
export function resolveCal(cal, gown) {
  if (!cal || cal.mode !== 'enhanced') return cal
  const e = cal.enhanced || {}
  const guess = guessTags(gown)
  const neckline = NECK[e.neckline] ? e.neckline : guess.neckline
  const sleeves  = e.sleeves in SLEEVE_INSET ? e.sleeves : guess.sleeves
  const nd = NECK[neckline]
  const inset = SLEEVE_INSET[sleeves]
  return {
    ...cal,
    necklineY:   -clamp(num(e.topAt, nd.topAt), -0.4, 0.4),
    shoulderPad: clamp(num(e.shoulderEase, nd.shoulderEase), 0.8, 2.0),
    enh: {
      neckline, sleeves,
      seamL: clamp(num(e.seamL, inset), 0, 0.4),
      seamR: clamp(num(e.seamR, inset), 0, 0.4),
      adv: Object.fromEntries(ADV_FIELDS.map(f => [f.k, clamp(num(e[f.k], ADV_DEFAULTS[f.k]), f.min, f.max)])),
    },
  }
}

/**
 * Horizontal extent of the bodice rows (top of the gown down to the waist), in gown-image px.
 * L / R are the per-band silhouette edges (prof.glL / prof.glR).
 */
export function bodiceExtent(L, R, wf) {
  const B = L.length
  const n = Math.max(2, Math.min(B, Math.ceil(B * wf)))
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < n; i++) { if (L[i] < lo) lo = L[i]; if (R[i] > hi) hi = R[i] }
  return hi > lo ? { lo, hi, W: hi - lo } : null
}

/**
 * The two vertical "side seams" of the bodice, in gown-image pixels.
 * Everything outside them (sleeves, cape, off-shoulder cuffs) keeps its own
 * proportions instead of being squashed to the body width.
 * Returns null when the seams would be unusable (caller falls back to row-fit).
 */
export function seamsFor(L, R, wf, enh) {
  const ex = bodiceExtent(L, R, wf)
  if (!ex) return null
  const cL = ex.lo + enh.seamL * ex.W, cR = ex.hi - enh.seamR * ex.W
  return cR - cL > ex.W * 0.25 ? { cL, cR } : null
}

/**
 * Snap two grid columns onto the seams so the kink sits exactly on a mesh edge.
 * xs is the column x-positions in gown-image px (mutated).
 */
export function snapColumns(xs, iw, positions) {
  const last = xs.length - 1
  const used = new Set()
  for (const p of positions) {
    let c = clamp(Math.round((p / iw) * last), 1, last - 1)
    while (used.has(c) && c < last - 1) c++
    while (used.has(c) && c > 1) c--
    used.add(c)
    xs[c] = p
  }
}

/**
 * Sleeve-aware horizontal map for ONE mesh row above the hip.
 *   core  = the part between the seams (clipped to the silhouette): fitted to the body
 *   outer = beyond the seams: scaled uniformly by k (the vertical scale), so sleeves keep their shape
 * Returns x => screen X, or null when the row can't use it.
 */
export function coreRowMap({ cL, cR, gL, gR, tw, k, cLine, sMin, sMax }) {
  const cl = Math.max(cL, gL), cr = Math.min(cR, gR)
  const cw = cr - cl
  if (!(cw > 1) || !(tw > 0)) return null
  const s = clamp(tw / cw, sMin, sMax)
  const half = (cw * s) / 2                 // actual rendered half-width, so the map stays continuous
  const mid = (cl + cr) / 2
  return x => (x < cl ? cLine - half - (cl - x) * k
             : x > cr ? cLine + half + (x - cr) * k
             : cLine + (x - mid) * s)
}