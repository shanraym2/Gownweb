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
export const ADV_DEFAULTS = { flare: 0.5, swing: 0.5, hemShadow: 0.38, edgePx: 0.8, bright: 1, warmth: 0, cover: 0, curveFit: 0, minFit: 0, silCut: 24 }
export const ADV_FIELDS = [
  { k: 'flare',     label: 'Flare length',  min: 0.15, max: 1.0, step: 0.01, hint: 'How far below the hip the skirt takes to reach full width. Lower = flares out sooner.' },
  { k: 'swing',     label: 'Skirt swing',   min: 0,    max: 1,   step: 0.05, hint: '0 = rigid skirt, 1 = very loose. Only visible in the live fitting room.' },
  { k: 'hemShadow', label: 'Hem shadow',    min: 0,    max: 0.8, step: 0.02, hint: 'Strength of the soft shadow under the hem. 0 = none.' },
  { k: 'edgePx',    label: 'Edge softness', min: 0,    max: 3,   step: 0.1,  hint: 'Softens the cut-out edge. Raise it if the outline looks harsh, lower it if the gown looks blurry.' },
  { k: 'bright',    label: 'Brightness',    min: 0.7,  max: 1.3, step: 0.02, hint: 'Brightens or darkens this gown on top of the automatic room lighting.' },
  { k: 'curveFit', label: 'Curves follow hips', min: 0, max: 1, step: 0.05, hint: '0 = curves are fixed widths. 1 = they scale with the wearer\'s hip-to-shoulder ratio. Raise it if the curved skirt looks narrower than the person live.' },
  { k: 'cover',     label: 'Cover legs', min: 0, max: 1.5, step: 0.05, hint: '0 = off. Forces the skirt to be at least as wide as the legs, growing from the hip to the hem. Raise it if the legs show or the skirt looks like trousers.' },
  { k: 'minFit',    label: 'Never narrower than hips', min: 0, max: 1.5, step: 0.05, hint: '0 = off. Keeps the skirt at least this fraction of the hip width of the person, easing off toward the hem. Use 1.1 to 1.3 for sheath and column gowns so the legs do not show at the sides.' },
  { k: 'warmth',    label: 'Warmth',        min: -1,   max: 1,   step: 0.05, hint: 'Shifts the colour cooler (-) or warmer (+), e.g. to keep ivory looking ivory.' },
    { k: 'silCut',    label: 'Ignore faint edges', min: 24, max: 220, step: 4, hint: '24 = off. Raise it to ignore sheer veil / lace when measuring the gown outline, which removes wobble in the skirt. Too high clips real lace edges.' },
]

const smooth3 = t => t * t * (3 - 2 * t)

// ── Geometry (multi-anchor, enhanced mode only) ──────────────────────────────
export const GEO_DEFAULTS = {
  waistAt: 0.65, imgTop: 0, imgHem: 1,
  bustAt: 0.28, bustEase: 1, waistWidth: 1,
  hipWidth: 1, skirtWidth: 1, flareCurve: 0.5, hemWidth: 1.1, legFollow: 0.5,
  waistCinch: 1, skirtFollow: 0,
  sleeveWidth: 1, sleeveReach: 0, sleeveFollow: 0, topWidth: 1,
}
export const GEO_GROUPS = [
  { id: 'boundaries', title: 'Garment boundaries', fields: [
    { k: 'waistAt', label: 'Skirt start / bodice length', min: 0.4, max: 0.9, step: 0.01, hint: 'Where the skirt begins on the body (also the bodice length). Drag the dashed line on the image, or use the slider.' },
    { k: 'imgTop',  label: 'Garment top in image', min: 0,   max: 0.6, step: 0.005, hint: 'Ignore this much of the top of the cut-out image.' },
    { k: 'imgHem',  label: 'Garment hem in image', min: 0.7, max: 1,   step: 0.005, hint: 'Ignore this much of the bottom of the cut-out image.' },
  ] },
  { id: 'bodice', title: 'Bodice (bodice only)', fields: [
    { k: 'topWidth', label: 'Top width (shoulders + bust + sleeves)', min: 0.5, max: 1.3, step: 0.01, hint: 'Overall width of everything above the waist. Lower it if the top looks too big. The waist and skirt are not affected.' },
    { k: 'bustAt',     label: 'Bust position', min: 0.1, max: 0.5, step: 0.01, hint: 'Where the bust line sits between shoulders and waist.' },
    { k: 'bustEase',   label: 'Bust width',    min: 0.8, max: 1.4, step: 0.01, hint: 'Bodice width at the bust. Uses the scanned bust/hip ratio when available.' },
    { k: 'waistWidth', label: 'Waist width',   min: 0.8, max: 1.4, step: 0.01, hint: 'Width at the waist seam. Shared by bodice and skirt, so they always meet.' },
    { k: 'waistCinch', label: 'Waist cinch',   min: 0,   max: 1,   step: 0.02, hint: '1 = pinch the gown to the body at the waist. 0 = keep the gown straight, with no pinch. Use low values for sheath, column and straight dresses.' },
  ] },
  { id: 'skirt', title: 'Skirt', fields: [
    { k: 'hipWidth',   label: 'Upper skirt (hip) width', min: 0.8, max: 1.4, step: 0.01, hint: 'Skirt width at the hips.' },
    { k: 'skirtWidth', label: 'Skirt width (whole skirt)', min: 0.6, max: 1.8, step: 0.01, hint: 'Scales the whole skirt from just below the hips to the hem. Hip fit stays on the body. 1 = unchanged.' },
    { k: 'flareCurve', label: 'Skirt flare', min: 0,   max: 1,   step: 0.02, hint: 'How soon the skirt widens below the hips. 0 = stays narrow then opens near the hem. 1 = opens right away.' },
    { k: 'hemWidth',   label: 'Hem width',   min: 0.7, max: 2.0, step: 0.02, hint: 'Width multiplier at the hem. The skirt widens progressively from the hips to this.' },
    { k: 'legFollow',  label: 'Follow legs', min: 0,   max: 1,   step: 0.05, hint: 'How much the hem centres on the detected ankles instead of the hips.' },
    { k: 'skirtFollow', label: 'Skirt follows gown shape', min: 0, max: 1, step: 0.05, hint: '0 = skirt is fitted to the hips, then flares. 1 = skirt keeps the gown own proportions (straight skirts stay straight). Hem width is ignored at 1.' },
  ] },
  { id: 'sleeves', title: 'Sleeves (position = Left / Right sleeve)', fields: [
    { k: 'sleeveWidth',  label: 'Sleeve width', min: 0.5,  max: 1.8, step: 0.02, hint: 'Horizontal scale of the sleeve parts outside the seams.' },
    { k: 'sleeveReach',  label: 'Sleeve reach', min: -0.3, max: 0.6, step: 0.01, hint: 'Pushes sleeve ends outward (+) or inward (-), in shoulder-widths.' },
    { k: 'sleeveFollow', label: 'Follow arms',  min: 0,    max: 1,   step: 0.05, hint: 'How much sleeves follow the detected arm position in the live fitting room.' },
  ] },
]
export const GEO_FIELDS = GEO_GROUPS.flatMap(g => g.fields)

// ── Skirt curves (enhanced mode). Points: { y: 0 hip → 1 hem, x: offset from body centre line, in shoulder-widths }
export const CURVE_MIN = 4, CURVE_MAX = 10
export const CURVE_OVERRIDES = ['hipWidth', 'skirtWidth', 'flareCurve', 'hemWidth', 'skirtFollow']   // sliders the curves replace
function cleanCurve(arr, side) {
  if (!Array.isArray(arr)) return null
  const pts = arr
    .filter(p => p && Number.isFinite(p.y) && Number.isFinite(p.x))
    .map(p => ({ y: clamp(p.y, 0, 1), x: side < 0 ? clamp(p.x, -2.5, -0.05) : clamp(p.x, 0.05, 2.5) }))
    .sort((a, b) => a.y - b.y)
  if (pts.length < CURVE_MIN) return null
  pts[0].y = 0; pts[pts.length - 1].y = 1          // ends are locked in Y
  return pts
}

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
  if (gown?.type === 'Suit') { if (neckline === 'scoop') neckline = 'vneck'; if (sleeves === 'none') sleeves = 'long' }
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
  const straight = /sheath|column|straight|slip|pencil/.test(String(gown?.silhouette || '').toLowerCase())
    const isSuit = gown?.type === 'Suit' || /\b(suit|tuxedo|tux|trouser|pant)/.test(String(gown?.name || '').toLowerCase())
  const base = isSuit
    ? { ...GEO_DEFAULTS, waistAt: 0.88, waistCinch: 0, skirtFollow: 1, hemWidth: 1, legFollow: 1, sleeveFollow: 0.5 }
    : straight ? { ...GEO_DEFAULTS, waistCinch: 0.3, skirtFollow: 0.8, hemWidth: 1 } : GEO_DEFAULTS
  const geo = Object.fromEntries(GEO_FIELDS.map(f => [f.k, clamp(num(e[f.k], base[f.k]), f.min, f.max)]))
  if (geo.imgHem - geo.imgTop < 0.25) { geo.imgTop = GEO_DEFAULTS.imgTop; geo.imgHem = GEO_DEFAULTS.imgHem }
    const curveL = cleanCurve(e.curveL, -1), curveR = cleanCurve(e.curveR, 1)
  return {
    ...cal,
    necklineY:   -clamp(num(e.topAt, nd.topAt), -0.4, 0.4),
    shoulderPad: clamp(num(e.shoulderEase, nd.shoulderEase), 0.8, 2.0),
    enh: {
      neckline, sleeves,
      seamL: clamp(num(e.seamL, inset), 0, 0.4),
      seamR: clamp(num(e.seamR, inset), 0, 0.4),
      adv: Object.fromEntries(ADV_FIELDS.map(f => [f.k, clamp(num(e[f.k], ADV_DEFAULTS[f.k]), f.min, f.max)])),
      geo,
      curve: { on: e.curveOn === true && !!curveL && !!curveR, link: e.curveLink !== false, L: curveL, R: curveR },
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
export function coreRowMap({ cL, cR, gL, gR, tw, k, cLine, sMin, sMax, kOut = k, reachL = 0, reachR = 0 }) {
  const cl = Math.max(cL, gL), cr = Math.min(cR, gR)
  const cw = cr - cl
  if (!(cw > 1) || !(tw > 0)) return null
  const s = clamp(tw / cw, sMin, sMax)
  const half = (cw * s) / 2                 // actual rendered half-width, so the map stays continuous
  const mid = (cl + cr) / 2
  const wL = Math.max(cl - gL, 1), wR = Math.max(gR - cr, 1)   // reach ramps from 0 at the seam, so no gap opens
  return x => (x < cl ? cLine - half - (cl - x) * kOut - reachL * smooth3(clamp((cl - x) / wL, 0, 1))
             : x > cr ? cLine + half + (x - cr) * kOut + reachR * smooth3(clamp((x - cr) / wR, 0, 1))
             : cLine + (x - mid) * s)
}