/**
 * lib/fitting-room/suitModel.js
 *
 * "Fitted" suit preview: a drawn jacket, sleeves, trousers, shirt, collar, tie, pockets.
 * No DOM lookups, no React. Same function is meant to be used by the admin editor
 * (synthetic body) and the fitting room (detected landmarks).
 *
 * Saved shape (inside gown.tryonCalibration):
 *   suitMode: 'photo' | 'model'          // missing = photo
 *   suitModel: {
 *     color, swatch (url), swatchScale,
 *     vDepth, shirtColor, jacketLen, lapelW,
 *     ease, trouserEase, legHang,
 *     collar, collarSize,                 // shirt collar style + size
 *     lapel, breast, buttons,             // lapel style, single/double front, button count
 *     hem, hemShadow, vent,               // hem cut, shadow under the hem, back vent
 *     waist, shoulder,                    // waist suppression, shoulder width
 *     pocketStyle, pocketSquare: { on, color },
 *     cuffs, liningColor, buttonColor,
 *     tie: { type: 'none'|'necktie'|'bowtie', color },
 *     pockets: [{ u, v }],                // 0..1 across / down the jacket
 *     parts: { torso, lArm, rArm, lLeg, rLeg, collar, shirt }   // per-part { color, swatch, swatchScale, fit }
 *   }
 * Every new field is optional: models saved before they existed still load.
 *
 * Input points (logical px): ls rs lh rh lk rk la ra  (required)
 *                            le re lw rw              (optional; arms hang straight if missing)
 *                            hd                       (optional head centre, only used by the skeleton)
 */

const clamp = (v, a, b) => Math.min(Math.max(v, a), b)
const lerp  = (a, b, t) => a + (b - a) * t
const num   = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const pick  = (v, list, d) => (list.some(o => o.id === v) ? v : d)

export const TIE_TYPES = [
  { id: 'none',     label: 'None' },
  { id: 'necktie',  label: 'Necktie' },
  { id: 'bowtie',   label: 'Bow tie' },
]
export const COLLAR_STYLES = [
  { id: 'point',      label: 'Point' },
  { id: 'spread',     label: 'Spread' },
  { id: 'buttondown', label: 'Button-down' },
  { id: 'band',       label: 'Band / mandarin' },
  { id: 'wing',       label: 'Wing (tuxedo)' },
  { id: 'none',       label: 'None (neck band only)' },
]
export const LAPEL_STYLES = [
  { id: 'notch', label: 'Notch' },
  { id: 'peak',  label: 'Peak' },
  { id: 'shawl', label: 'Shawl' },
  { id: 'none',  label: 'No lapels' },
]
export const BREAST_TYPES = [
  { id: 'single', label: 'Single-breasted' },
  { id: 'double', label: 'Double-breasted' },
  { id: 'none',   label: 'None (no front line or buttons)' },
]
export const HEM_STYLES = [
  { id: 'straight', label: 'Straight' },
  { id: 'rounded',  label: 'Rounded front' },
  { id: 'cutaway',  label: 'Cutaway' },
]
export const POCKET_STYLES = [
  { id: 'flap',  label: 'Flap' },
  { id: 'welt',  label: 'Welt (slit)' },
  { id: 'patch', label: 'Patch' },
]
export const VENT_STYLES = [
  { id: 'center', label: 'Centre vent' },
  { id: 'side',   label: 'Side vents' },
  { id: 'none',   label: 'No vent' },
]
export const EMB_STYLES = [
  { id: 'none',    label: 'None' },
  { id: 'vine',    label: 'Vine and leaves' },
  { id: 'diamond', label: 'Diamonds' },
  { id: 'tucks',   label: 'Pin-tucks' },
]
export const NECK_STYLES = [
  { id: 'v',      label: 'Open V (jacket)' },
  { id: 'closed', label: 'Closed (no V, no shirt)' },
  { id: 'barong', label: 'Collared shirt (barong)' },
]
export const POCKET_MAX = 4
export const FABRIC_TYPES = [
  { id: 'standard', label: 'Standard' },
  { id: 'wool',     label: 'Wool (twill)' },
  { id: 'satin',    label: 'Satin' },
  { id: 'cotton',   label: 'Cotton (plain weave)' },
  { id: 'linen',    label: 'Linen' },
  { id: 'pina',     label: 'Piña (sheer fiber)' },
]
// sheen, grain and fold are multipliers on the sliders. weave is the texture drawn on the cloth.
const FABRIC_SPECS = {
  standard: { sheen: 1,   grain: 1,   fold: 1,   weave: 'none' },
  wool:     { sheen: 0.5, grain: 1.3, fold: 1,   weave: 'twill' },
  satin:    { sheen: 3,   grain: 0.3, fold: 0.7, weave: 'none' },
  cotton:   { sheen: 0.6, grain: 0.9, fold: 1.3, weave: 'plain' },
  linen:    { sheen: 0.4, grain: 1.2, fold: 1.8, weave: 'plain' },
  pina:     { sheen: 1.2, grain: 0.6, fold: 0.8, weave: 'fiber' },
}
export const SHOULDER_STYLES = [
  { id: 'natural', label: 'Natural' },
  { id: 'padded',  label: 'Padded (structured)' },
  { id: 'square',  label: 'Square / straight' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'drop',    label: 'Drop shoulder' },
]
// padExtra: extra shoulder width. tipDrop: tip height (+ lower). bow: how much the shoulder line arches.
// round: corner radius at the tip. cap: change to the sleeve cap roundness.
const SHOULDER_SPECS = {
  natural: { padExtra: 0,    tipDrop: 0,      bow: 0.012, round: 0.03, cap: 0 },
  padded:  { padExtra: 0.05, tipDrop: -0.012, bow: 0.026, round: 0.02, cap: -0.15 },
  square:  { padExtra: 0.03, tipDrop: 0,      bow: 0,     round: 0,    cap: -0.35 },
  rounded: { padExtra: 0,    tipDrop: 0.014,  bow: 0.02,  round: 0.08, cap: 0.3 },
  drop:    { padExtra: 0.07, tipDrop: 0.035,  bow: 0.004, round: 0.05, cap: 0.1 },
}

export const SUIT_DEFAULTS = {
  color: '#2b2f3a', swatch: '', swatchScale: 1,
  vDepth: 0.45, shirtColor: '#f4f1ea', jacketLen: 0.35, lapelW: 0.12,
  ease: 1.25, trouserEase: 1.3, legHang: 0.5,
  collar: 'point', collarSize: 1,
  lapel: 'notch', breast: 'single', buttons: 2,
  hem: 'rounded', hemShadow: 0.6, vent: 'center',
   waist: 0.25, shoulder: 0.5,
  fabric: 'standard', drape: 0.5, weave: 0.4, camSoft: 0.5,
  shoulderStyle: 'natural', maskOverrides: true, coverBody: true,
  neckline: 'v', raise: 0.12, neckW: 1, slope: 0.5, chest: 1, hemWidth: 1,
  sleeveWidth: 1, sleeveTaper: 0.8, sleeveLen: 1, sleeveHang: 0.35, sleeveCap: 0.6, sleeveBend: 0.5,
  shading: 0.6, lightDir: -0.4, sheen: 0.25, wrinkles: 0.5, outline: 0.4, matchLight: true,
  sheer: 0.3, embroidery: 'none', embW: 1, embSize: 1, placket: 1,

  pocketStyle: 'flap', pocketSquare: { on: false, color: '#ffffff' },
  cuffs: true, liningColor: '', buttonColor: '',
  tie: { type: 'none', color: '#7a1f2b' },
  pockets: [],
}

// collar / shirt come after the five body parts so older editors that loop SUIT_PARTS keep their order
export const SUIT_PARTS = [
  { id: 'torso',  label: 'Torso' },
  { id: 'lArm',   label: 'Left arm' },
  { id: 'rArm',   label: 'Right arm' },
  { id: 'lLeg',   label: 'Left leg' },
  { id: 'rLeg',   label: 'Right leg' },
  { id: 'collar', label: 'Collar' },
  { id: 'shirt',  label: 'Undershirt' },
]
const PART_IDS = SUIT_PARTS.map(p => p.id)

/** { partId: url } for every part that has a swatch / mask image. */
export function suitImageUrls(raw) {
  const m = resolveSuitModel(raw), out = {}
  for (const id of PART_IDS) if (m.parts[id].swatch) out[id] = m.parts[id].swatch
  return out
}

// Sliders. step >= 1 means "whole numbers" (the editor can show them without decimals).
export const SUIT_FIELDS = [
  { group: 'Shoulders and neck', k: 'raise',    label: 'Raise the shoulders', min: 0, max: 0.3, step: 0.01, hint: 'Lifts the jacket shoulder line and neck. Raise it if the suit sits too low on your shoulders.' },
  { group: 'Shoulders and neck', k: 'shoulder', label: 'Shoulder width', min: 0, max: 1, step: 0.05, hint: 'How far the jacket shoulder sticks out past your own. 0 = natural, 1 = strong padded shoulder.' },
  { group: 'Shoulders and neck', k: 'slope',    label: 'Shoulder slope', min: 0, max: 1, step: 0.05, hint: 'How much the shoulders slope down from the neck. 0 = square, 1 = sloped.' },
  { group: 'Shoulders and neck', k: 'neckW',    label: 'Neck opening width', min: 0.6, max: 1.6, step: 0.05, hint: 'Width of the neck opening and collar.' },
  { group: 'Jacket shape', k: 'chest',    label: 'Chest fullness', min: 0.8, max: 1.3, step: 0.01, hint: 'Width of the jacket at the chest.' },
  { group: 'Jacket shape', k: 'waist',    label: 'Waist suppression', min: 0, max: 1, step: 0.05, hint: 'How much the jacket is taken in at the waist. 0 = boxy, 1 = very shaped.' },
  { group: 'Jacket shape', k: 'hemWidth', label: 'Hem width', min: 0.7, max: 1.3, step: 0.01, hint: 'Width of the jacket at the hem. Lower it for a slimmer, less boxy cut.' },
  { group: 'Jacket shape', k: 'ease',     label: 'Overall ease', min: 0.8, max: 1.8, step: 0.01, hint: 'How loose the jacket and sleeves are. 0.8 = tight, 1.25 = comfortable, 1.8 = oversized.' },
  { group: 'Jacket shape', k: 'jacketLen', label: 'Jacket length', min: 0, max: 0.8, step: 0.01, hint: 'Where the jacket hem ends, from the hips (0) toward the knees (0.8).' },
  { group: 'Jacket shape', k: 'vDepth',   label: 'V depth', min: 0, max: 1, step: 0.01, hint: 'How deep the jacket opens at the front. Only used with the Open V neckline.' },
  { group: 'Jacket shape', k: 'lapelW',   label: 'Lapel width', min: 0.04, max: 0.3, step: 0.01, hint: 'Width of the lapels, relative to the shoulder span.' },
  { group: 'Collar and buttons', k: 'collarSize', label: 'Collar size', min: 0.6, max: 1.5, step: 0.05, hint: 'Height of the shirt collar and length of its points.' },
  { group: 'Collar and buttons', k: 'buttons',    label: 'Buttons', min: 0, max: 4, step: 1, hint: 'Single-breasted: number of buttons. Double-breasted: rows of two. Barong shirt: extra buttons on top of 3.' },
  { group: 'Sleeves', k: 'sleeveWidth', label: 'Sleeve width', min: 0.6, max: 1.5, step: 0.02, hint: 'Width of the sleeve at the shoulder.' },
  { group: 'Sleeves', k: 'sleeveTaper', label: 'Sleeve taper', min: 0.5, max: 1.2, step: 0.02, hint: 'Wrist width compared with the top of the sleeve. Below 1 = tapered, above 1 = flared.' },
  { group: 'Sleeves', k: 'sleeveLen',   label: 'Sleeve length', min: 0.4, max: 1.1, step: 0.02, hint: '1 = to the wrist. Lower for short or 3/4 sleeves. Cuffs only show when the sleeve reaches the wrist.' },
  { group: 'Sleeves', k: 'sleeveHang',  label: 'Sleeve hang', min: 0, max: 1, step: 0.05, hint: '0 = sleeves follow your arms exactly. 1 = they hang naturally beside the body. Higher values hide arm-tracking wobble.' },
  { group: 'Sleeves', k: 'sleeveCap',   label: 'Shoulder cap roundness', min: 0, max: 1, step: 0.05, hint: 'How round the top of the sleeve is. 0 = flat cut, 1 = fully rounded.' },
  { group: 'Sleeves', k: 'sleeveBend',  label: 'Elbow creases', min: 0, max: 1, step: 0.05, hint: 'Strength of the fold lines at the elbow. Needs Folds above 0.' },
  { group: 'Barong shirt', k: 'sheer',    label: 'Sheerness', min: 0, max: 0.8, step: 0.05, hint: 'How see-through the shirt is. 0 = solid cloth. Higher shows the undershirt (and, in the live camera, a little of what you are wearing). Only used with the Collared shirt front.' },
  { group: 'Barong shirt', k: 'placket',  label: 'Placket width', min: 0.5, max: 1.8, step: 0.05, hint: 'Width of the centre button band.' },
  { group: 'Barong shirt', k: 'embW',     label: 'Embroidery panel width', min: 0.5, max: 1.8, step: 0.05, hint: 'Width of the embroidered panels on each side of the placket.' },
  { group: 'Barong shirt', k: 'embSize',  label: 'Embroidery pattern size', min: 0.5, max: 2, step: 0.05, hint: 'Size of the repeating embroidery pattern.' },
  { group: 'Trousers', k: 'trouserEase', label: 'Trouser ease', min: 0.8, max: 2, step: 0.01, hint: 'How wide the trouser legs are.' },
  { group: 'Trousers', k: 'legHang',     label: 'Trousers hang straight', min: 0, max: 1, step: 0.05, hint: '0 = trousers follow your leg angle. 1 = they hang straight down from the hips.' },
  { group: 'Trousers', k: 'hemShadow',   label: 'Hem shadow', min: 0, max: 1, step: 0.05, hint: 'Shadow the jacket casts on the trousers. It separates jacket from trousers.' },
  { group: 'Lighting and rendering', k: 'shading',  label: 'Shading', min: 0, max: 1, step: 0.05, hint: 'Overall depth: side light, darker bottom, underarm shadows, fabric grain. 0 = flat.' },
  { group: 'Lighting and rendering', k: 'lightDir', label: 'Light direction', min: -1, max: 1, step: 0.05, hint: '-1 = light from the left of the picture, 1 = from the right.' },
  { group: 'Lighting and rendering', k: 'sheen',    label: 'Sheen', min: 0, max: 1, step: 0.05, hint: 'Soft highlights on the shoulders and chest. Higher for satin, lower for wool.' },
  { group: 'Lighting and rendering', k: 'wrinkles', label: 'Folds', min: 0, max: 1, step: 0.05, hint: 'Fold lines at the elbows, waist and knees.' },
  { group: 'Lighting and rendering', k: 'outline',  label: 'Outline', min: 0, max: 1, step: 0.05, hint: 'Dark edge around each piece. Lower it to lose the cut-out look.' },
  { group: 'Lighting and rendering', k: 'drape', label: 'Soft drape', min: 0, max: 1, step: 0.05, hint: 'Long, low-contrast vertical folds in the cloth. Satin and piña show fewer folds, linen shows more.' },
  { group: 'Lighting and rendering', k: 'weave', label: 'Weave texture', min: 0, max: 1, step: 0.05, hint: 'Visible thread pattern. Only used by Wool, Cotton, Linen and Piña.' },
  { group: 'Lighting and rendering', k: 'camSoft', label: 'Match camera softness', min: 0, max: 1, step: 0.05, hint: 'Live camera only. Adds the same softness and grain as your webcam so the suit does not look sharper than the video.' },
  { k: 'swatchScale', label: 'Pattern size', min: 0.3, max: 3, step: 0.05, hint: 'Size of the repeating fabric swatch. Only used when a swatch is set.' },
]
export const SUIT_PRESETS = [
  { id: 'jacket', label: 'Suit jacket', patch: { shoulderStyle: 'padded', fabric: 'wool', neckline: 'v', lapel: 'notch', collar: 'point', hem: 'rounded', vent: 'center', jacketLen: 0.35, waist: 0.25, shoulder: 0.5, breast: 'single', buttons: 2, cuffs: true } },
    { id: 'barong', label: 'Barong Tagalog (sheer, embroidered)', patch: { shoulderStyle: 'natural', fabric: 'pina', neckline: 'barong', lapel: 'none', collar: 'spread', collarSize: 0.9, hem: 'straight', vent: 'none', jacketLen: 0.34, waist: 0, shoulder: 0.1, slope: 0.55, raise: 0.12, ease: 1.35, chest: 1, hemWidth: 1.05, hemShadow: 0.25, buttons: 0, cuffs: true, sleeveWidth: 1.1, sleeveTaper: 0.95, sleeveHang: 0.45, sheer: 0.35, embroidery: 'vine', embW: 1, embSize: 1, placket: 1, pockets: [], pocketSquare: { on: false, color: '#ffffff' }, tie: { type: 'none', color: '#7a1f2b' } } },
]
// Dropdowns, toggles and colours, so the editor can render them from data
export const SUIT_OPTIONS = [
  { k: 'collar',      label: 'Shirt collar', options: COLLAR_STYLES },
  { k: 'neckline',    label: 'Front / neckline', options: NECK_STYLES },
  { k: 'shoulderStyle', label: 'Shoulder shape', options: SHOULDER_STYLES },
  { k: 'fabric', label: 'Fabric type', options: FABRIC_TYPES },
  { k: 'embroidery', label: 'Embroidery (barong)', options: EMB_STYLES },
  { k: 'lapel',       label: 'Lapel',        options: LAPEL_STYLES },
  { k: 'breast',      label: 'Front',        options: BREAST_TYPES },
  { k: 'hem',         label: 'Jacket hem',   options: HEM_STYLES },
  { k: 'vent',        label: 'Back vent',    options: VENT_STYLES },
  { k: 'pocketStyle', label: 'Pocket style', options: POCKET_STYLES },
]
export const SUIT_TOGGLES = [
  { k: 'cuffs', label: 'Show shirt cuffs at the wrists' },
  { k: 'maskOverrides', label: 'Masked photo replaces drawn details (embroidery, placket, buttons, lapels, pockets)' },
  { k: 'coverBody', label: 'Always cover the body (never narrower than the person)' },
  { k: 'matchLight', label: 'Match the room lighting (live camera)' },
]
export const SUIT_COLORS = [
  { k: 'liningColor', label: 'Lining (hem edge and vent)' },
  { k: 'buttonColor', label: 'Buttons' },
  { k: 'embColor',   label: 'Embroidery thread' },
]

const isHex = s => typeof s === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)

/* ── colour helpers ──────────────────────────────────────────────────────── */
function hexRgb(h) {
  let s = h.slice(1)
  if (s.length === 3) s = s.split('').map(c => c + c).join('')
  const n = parseInt(s.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')
/** amt < 0 darkens toward black, amt > 0 lightens toward white. */
function shade(h, amt) {
  const [r, g, b] = hexRgb(h), t = amt < 0 ? 0 : 255, k = Math.abs(amt)
  return toHex(r + (t - r) * k, g + (t - g) * k, b + (t - b) * k)
}
const luma = h => { const [r, g, b] = hexRgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 }

/** Clamp and fill in a saved suitModel so the drawing code never sees bad values. */
export function resolveSuitModel(raw) {
  const r = raw || {}
  const tie = r.tie || {}
  const sq = r.pocketSquare || {}
  const color = isHex(r.color) ? r.color : SUIT_DEFAULTS.color
  const swatch = typeof r.swatch === 'string' ? r.swatch : ''
  const swatchScale = clamp(num(r.swatchScale, 1), 0.3, 3)
  const shirtColor = isHex(r.shirtColor) ? r.shirtColor : SUIT_DEFAULTS.shirtColor
  const base = { color, swatch, swatchScale }

  const own = {}                                   // per-part overrides, cleaned
  for (const k of PART_IDS) {
    const o = r.parts && r.parts[k]
    if (!o || typeof o !== 'object') continue
    const c = {}
    if (isHex(o.color)) c.color = o.color
    if (typeof o.swatch === 'string') c.swatch = o.swatch
    if (Number.isFinite(o.swatchScale)) c.swatchScale = clamp(o.swatchScale, 0.3, 3)
    if (typeof o.fit === 'boolean') c.fit = o.fit
    own[k] = c
  }
  // resolved: torso <- suit, arms <- torso, legs <- suit, shirt <- shirtColor, collar <- shirt
  const parts = {}
  parts.torso  = { ...base, fit: false, ...own.torso }
  parts.lArm   = { ...parts.torso, fit: false, ...own.lArm }
  parts.rArm   = { ...parts.torso, fit: false, ...own.rArm }
  parts.lLeg   = { ...base, fit: false, ...own.lLeg }
  parts.rLeg   = { ...base, fit: false, ...own.rLeg }
  parts.shirt  = { color: shirtColor, swatch: '', swatchScale: 1, fit: false, ...own.shirt }
  parts.collar = { ...parts.shirt, fit: false, ...own.collar }

  const pockets = (Array.isArray(r.pockets) ? r.pockets : [])
    .filter(p => p && Number.isFinite(p.u) && Number.isFinite(p.v))
    .slice(0, POCKET_MAX)
    .map(p => ({ u: clamp(p.u, 0, 1), v: clamp(p.v, 0, 1) }))
  return {
    color, swatch, swatchScale, shirtColor,
    vDepth:      clamp(num(r.vDepth, SUIT_DEFAULTS.vDepth), 0, 1),
    jacketLen:   clamp(num(r.jacketLen, SUIT_DEFAULTS.jacketLen), 0, 0.8),
    lapelW:      clamp(num(r.lapelW, SUIT_DEFAULTS.lapelW), 0.04, 0.3),
    tie: {
      type:  TIE_TYPES.some(t => t.id === tie.type) ? tie.type : 'none',
      color: isHex(tie.color) ? tie.color : SUIT_DEFAULTS.tie.color,
    },
    pockets,
    ease:        clamp(num(r.ease, SUIT_DEFAULTS.ease), 0.8, 1.8),
    trouserEase: clamp(num(r.trouserEase, SUIT_DEFAULTS.trouserEase), 0.8, 2),
    legHang:     clamp(num(r.legHang, SUIT_DEFAULTS.legHang), 0, 1),
    collar:      pick(r.collar, COLLAR_STYLES, SUIT_DEFAULTS.collar),
    collarSize:  clamp(num(r.collarSize, SUIT_DEFAULTS.collarSize), 0.6, 1.5),
    lapel:       pick(r.lapel, LAPEL_STYLES, SUIT_DEFAULTS.lapel),
    breast:      pick(r.breast, BREAST_TYPES, SUIT_DEFAULTS.breast),
    buttons:     Math.round(clamp(num(r.buttons, SUIT_DEFAULTS.buttons), 0, 4)),
    hem:         pick(r.hem, HEM_STYLES, SUIT_DEFAULTS.hem),
    hemShadow:   clamp(num(r.hemShadow, SUIT_DEFAULTS.hemShadow), 0, 1),
    vent:        pick(r.vent, VENT_STYLES, SUIT_DEFAULTS.vent),
    waist:       clamp(num(r.waist, SUIT_DEFAULTS.waist), 0, 1),
    shoulder:    clamp(num(r.shoulder, SUIT_DEFAULTS.shoulder), 0, 1),
    shoulderStyle: pick(r.shoulderStyle, SHOULDER_STYLES, SUIT_DEFAULTS.shoulderStyle),
    fabric:      pick(r.fabric, FABRIC_TYPES, SUIT_DEFAULTS.fabric),
    drape:       clamp(num(r.drape, SUIT_DEFAULTS.drape), 0, 1),
    weave:       clamp(num(r.weave, SUIT_DEFAULTS.weave), 0, 1),
    camSoft:     clamp(num(r.camSoft, SUIT_DEFAULTS.camSoft), 0, 1),
    maskOverrides: r.maskOverrides !== false,
    coverBody:     r.coverBody !== false,
    neckline:    pick(r.neckline, NECK_STYLES, SUIT_DEFAULTS.neckline),
    raise:       clamp(num(r.raise, SUIT_DEFAULTS.raise), 0, 0.3),
    neckW:       clamp(num(r.neckW, SUIT_DEFAULTS.neckW), 0.6, 1.6),
    slope:       clamp(num(r.slope, SUIT_DEFAULTS.slope), 0, 1),
    chest:       clamp(num(r.chest, SUIT_DEFAULTS.chest), 0.8, 1.3),
    hemWidth:    clamp(num(r.hemWidth, SUIT_DEFAULTS.hemWidth), 0.7, 1.3),
    sleeveWidth: clamp(num(r.sleeveWidth, SUIT_DEFAULTS.sleeveWidth), 0.6, 1.5),
    sleeveTaper: clamp(num(r.sleeveTaper, SUIT_DEFAULTS.sleeveTaper), 0.5, 1.2),
    sleeveLen:   clamp(num(r.sleeveLen, SUIT_DEFAULTS.sleeveLen), 0.4, 1.1),
    sleeveHang:  clamp(num(r.sleeveHang, SUIT_DEFAULTS.sleeveHang), 0, 1),
    sleeveCap:   clamp(num(r.sleeveCap, SUIT_DEFAULTS.sleeveCap), 0, 1),
    sleeveBend:  clamp(num(r.sleeveBend, SUIT_DEFAULTS.sleeveBend), 0, 1),
    shading:     clamp(num(r.shading, SUIT_DEFAULTS.shading), 0, 1),
    lightDir:    clamp(num(r.lightDir, SUIT_DEFAULTS.lightDir), -1, 1),
    sheen:       clamp(num(r.sheen, SUIT_DEFAULTS.sheen), 0, 1),
    wrinkles:    clamp(num(r.wrinkles, SUIT_DEFAULTS.wrinkles), 0, 1),
    outline:     clamp(num(r.outline, SUIT_DEFAULTS.outline), 0, 1),
    matchLight:  r.matchLight !== false,
    sheer:       clamp(num(r.sheer, SUIT_DEFAULTS.sheer), 0, 0.8),
    embroidery:  pick(r.embroidery, EMB_STYLES, 'none'),
    embW:        clamp(num(r.embW, 1), 0.5, 1.8),
    embSize:     clamp(num(r.embSize, 1), 0.5, 2),
    placket:     clamp(num(r.placket, 1), 0.5, 1.8),
    embColor:    isHex(r.embColor) ? r.embColor : (luma(parts.torso.color) > 0.55 ? shade(parts.torso.color, -0.2) : shade(parts.torso.color, 0.4)),   // auto: tone on tone
    pocketStyle: pick(r.pocketStyle, POCKET_STYLES, SUIT_DEFAULTS.pocketStyle),
    pocketSquare: { on: sq.on === true, color: isHex(sq.color) ? sq.color : SUIT_DEFAULTS.pocketSquare.color },
    cuffs:       r.cuffs !== false,
    liningColor: isHex(r.liningColor) ? r.liningColor : shade(color, -0.55),                    // auto: a lot darker than the cloth
    buttonColor: isHex(r.buttonColor) ? r.buttonColor : (luma(color) < 0.3 ? shade(color, 0.28) : shade(color, -0.5)),
    parts, own,
  }
}

/* ── drawing helpers ─────────────────────────────────────────────────────── */

function tracePoly(ctx, p) {
  ctx.beginPath()
  p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
  ctx.closePath()
}
function traceMulti(ctx, polys) {
  ctx.beginPath()
  for (const p of polys) { p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath() }
}

function bbox(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const q of p) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y }
  return { x0, y0, x1, y1 }
}
const mergeBox = (...bs) => ({ x0: Math.min(...bs.map(b => b.x0)), y0: Math.min(...bs.map(b => b.y0)), x1: Math.max(...bs.map(b => b.x1)), y1: Math.max(...bs.map(b => b.y1)) })

// Closed polygon around a chain of points, with a width at each point.
function tube(chain, widths, cap = 0) {
  const n = chain.length, A = [], B = []
  for (let i = 0; i < n; i++) {
    const a = chain[Math.max(i - 1, 0)], b = chain[Math.min(i + 1, n - 1)]
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1
    const nx = -dy / len, ny = dx / len, h = widths[i] / 2
    A.push({ x: chain[i].x + nx * h, y: chain[i].y + ny * h })
    B.push({ x: chain[i].x - nx * h, y: chain[i].y - ny * h })
  }
  const poly = [...A, ...B.reverse()]
  if (cap > 0 && n > 1) {                          // rounded start, bulging back along the chain
    const l0 = Math.hypot(chain[1].x - chain[0].x, chain[1].y - chain[0].y) || 1
    const dx0 = (chain[1].x - chain[0].x) / l0, dy0 = (chain[1].y - chain[0].y) / l0
    const h0 = widths[0] / 2, m = 7
    for (let t = 1; t < m; t++) {
      const f = Math.PI * (1 - t / m)
      poly.push({ x: chain[0].x - dy0 * h0 * Math.cos(f) - dx0 * h0 * cap * Math.sin(f),
                  y: chain[0].y + dx0 * h0 * Math.cos(f) - dy0 * h0 * cap * Math.sin(f) })
    }
  }
  return poly
}

// Point on a quadratic curve, sampled n+1 times.
function quad(a, c, b, n = 6) {
  const o = []
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; o.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }) }
  return o
}
function toward(from, to, d) {
  const dx = to.x - from.x, dy = to.y - from.y, l = Math.hypot(dx, dy) || 1
  return { x: from.x + (dx / l) * d, y: from.y + (dy / l) * d }
}

// Smooth curve through points (Catmull-Rom), n samples per segment. Includes every control point.
function spline(p, n = 8) {
  const o = []
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(i - 1, 0)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(i + 2, p.length - 1)]
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t
      const c = (a, b, c2, d) => 0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3)
      o.push({ x: c(p0.x, p1.x, p2.x, p3.x), y: c(p0.y, p1.y, p2.y, p3.y) })
    }
  }
  o.push(p[p.length - 1])
  return o
}

// Barong embroidery: a repeating pattern along a vertical band. cx(y) is the band's centre line.
function embroider(ctx, style, col, cx, w, y0, y1, u) {
  if (style === 'none' || !(y1 > y0)) return
  const thread = fn => {                            // faint highlight offset underneath, so it reads as raised thread
    ctx.save(); ctx.translate(0.6, 0.7); ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.fillStyle = 'rgba(255,255,255,0.4)'; fn(); ctx.restore()
    ctx.strokeStyle = col; ctx.fillStyle = col; fn()
  }
  ctx.save()
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(0.8, u * 0.07); ctx.globalAlpha = 0.92
  thread(() => { for (const o of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx(y0) + o * w / 2, y0); ctx.lineTo(cx(y1) + o * w / 2, y1); ctx.stroke() } })
  if (style === 'tucks') {
    thread(() => { for (const o of [-0.32, -0.11, 0.11, 0.32]) { ctx.beginPath(); ctx.moveTo(cx(y0) + o * w, y0); ctx.lineTo(cx(y1) + o * w, y1); ctx.stroke() } })
  } else if (style === 'diamond') {
    thread(() => {
      const r = Math.min(w * 0.34, u * 0.6)
      for (let y = y0 + u * 0.7; y < y1 - u * 0.5; y += u * 1.4) {
        const x = cx(y)
        ctx.beginPath(); ctx.moveTo(x, y - r * 1.1); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.1); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke()
        ctx.beginPath(); ctx.arc(x, y, r * 0.2, 0, Math.PI * 2); ctx.fill()
      }
    })
  } else {
    thread(() => {
      const sx = y => cx(y) + Math.sin(((y - y0) / u) * Math.PI * 0.9) * w * 0.2
      ctx.beginPath()
      for (let y = y0, first = true; y <= y1; y += u * 0.12, first = false) { first ? ctx.moveTo(sx(y), y) : ctx.lineTo(sx(y), y) }
      ctx.stroke()
      let i = 0
      for (let y = y0 + u * 0.55; y < y1 - u * 0.3; y += u * 0.55, i++) {
        const s = i % 2 ? 1 : -1
        ctx.beginPath(); ctx.ellipse(sx(y) + s * w * 0.2, y - u * 0.1, w * 0.16, w * 0.06, s * -0.6, 0, Math.PI * 2); ctx.stroke()
      }
    })
  }
  ctx.restore()
}

// Fine black/white noise with zero average, used as cloth grain.
let _grain = null
function grainPattern(ctx) {
  if (!_grain) {
    const c = document.createElement('canvas'); c.width = c.height = 64
    const x = c.getContext('2d'), d = x.createImageData(64, 64)
    for (let i = 0; i < d.data.length; i += 4) {
      const r = Math.random() - 0.5
      d.data[i] = d.data[i + 1] = d.data[i + 2] = r > 0 ? 255 : 0
      d.data[i + 3] = Math.abs(r) * 2 * 255 * 0.7
    }
    x.putImageData(d, 0, 0); _grain = c
  }
  return ctx.createPattern(_grain, 'repeat')
}
let _outlineRGB = '0,0,0'
let _lightK = 0
const _weave = {}
function weavePattern(ctx, kind) {
  if (!_weave[kind]) {
    const S = kind === 'fiber' ? 64 : 16
    const c = document.createElement('canvas'); c.width = c.height = S
    const x = c.getContext('2d')
    if (kind === 'twill') {
      x.lineWidth = 1.4
      for (let i = -S; i <= S * 2; i += 4) {
        x.strokeStyle = 'rgba(0,0,0,0.5)'; x.beginPath(); x.moveTo(i, S); x.lineTo(i + S, 0); x.stroke()
        x.strokeStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.moveTo(i + 1.6, S); x.lineTo(i + 1.6 + S, 0); x.stroke()
      }
    } else if (kind === 'plain') {
      for (let i = 0; i < S; i += 2) {
        x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, i, S, 1)
        x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(i, 0, 1, S)
      }
    } else {                                           // fiber: short random threads
      for (let n = 0; n < 140; n++) {
        const px = Math.random() * S, py = Math.random() * S, len = 3 + Math.random() * 7
        const vert = Math.random() < 0.5
        x.strokeStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.35)'
        x.lineWidth = 0.7
        x.beginPath(); x.moveTo(px, py); x.lineTo(vert ? px : px + len, vert ? py + len : py); x.stroke()
      }
    }
    _weave[kind] = c
  }
  return ctx.createPattern(_weave[kind], 'repeat')
}
let _outline = 0.3                                  // set per draw from the model

// Gradient line across a tube (perpendicular to its axis, left to right), so limbs shade round.
function acrossTube(a, b, w) {
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1
  let nx = (-dy / l) * (w / 2), ny = (dx / l) * (w / 2)
  if (nx < 0) { nx = -nx; ny = -ny }
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
  return { x0: cx - nx, y0: cy - ny, x1: cx + nx, y1: cy + ny }
}

// Fill, cheap edge shading (one gradient, clipped), and an outline.
function paint(ctx, path, fill, { edge = 0.2, stroke = true, across = null } = {}) {
  const bb = bbox(path)
  tracePoly(ctx, path)
  if (fill && fill.img) {                      // masked photo: colour underneath, photo clipped on top
    ctx.fillStyle = fill.color
    ctx.fill()
    ctx.save()
    tracePoly(ctx, path); ctx.clip()
    const iw = fill.img.naturalWidth || fill.img.width, ih = fill.img.naturalHeight || fill.img.height
    const f = fill.frame, fw = f.x1 - f.x0, fh = f.y1 - f.y0
    const s = Math.max(fw / iw, fh / ih)       // cover: fills the frame, keeps the photo's proportions
    ctx.drawImage(fill.img, f.x0 + (fw - iw * s) / 2, f.y0 + (fh - ih * s) / 2, iw * s, ih * s)
    ctx.restore()
  } else {
    ctx.fillStyle = fill
    ctx.fill()
  }
  if (edge > 0 && bb.x1 - bb.x0 > 2) {
    ctx.save()
    tracePoly(ctx, path); ctx.clip()
    const g = across ? ctx.createLinearGradient(across.x0, across.y0, across.x1, across.y1) : ctx.createLinearGradient(bb.x0, 0, bb.x1, 0)
    g.addColorStop(0,    `rgba(0,0,0,${edge})`)
    g.addColorStop(0.28, 'rgba(0,0,0,0)')
    g.addColorStop(0.72, 'rgba(0,0,0,0)')
    g.addColorStop(1,    `rgba(0,0,0,${edge})`)
    ctx.fillStyle = g
    ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0)
    ctx.restore()
  }
  if (across && Math.abs(_lightK) > 0.01) {
    ctx.save()
    tracePoly(ctx, path); ctx.clip()
    const lg2 = ctx.createLinearGradient(across.x0, across.y0, across.x1, across.y1)
    const dk = 0.22 * Math.abs(_lightK), lt = 0.1 * Math.abs(_lightK)
    const litLeft = _lightK < 0
    lg2.addColorStop(0, litLeft ? `rgba(255,255,255,${lt})` : `rgba(0,0,0,${dk})`)
    lg2.addColorStop(0.5, 'rgba(0,0,0,0)')
    lg2.addColorStop(1, litLeft ? `rgba(0,0,0,${dk})` : `rgba(255,255,255,${lt})`)
    ctx.fillStyle = lg2
    ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0)
    ctx.restore()
  }
  if (stroke && _outline > 0.01) {
    tracePoly(ctx, path)
    ctx.strokeStyle = `rgba(${_outlineRGB},${_outline})`; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke()
  }
}

// Draws only the SOFT SHADOW of a shape, not the shape itself: the shape is drawn far off the
// canvas and its shadow is offset back onto it. (Canvas shadow offsets ignore the transform,
// so they are scaled by k, the current canvas scale.)
function castShadow(ctx, path, { a = 0.3, blur = 6, dx = 0, dy = 2, k = 1 }) {
  const FAR = 6000
  ctx.save()
  ctx.shadowColor = `rgba(0,0,0,${clamp(a, 0, 1)})`
  ctx.shadowBlur = blur * k
  ctx.shadowOffsetX = (dx - FAR) * k
  ctx.shadowOffsetY = dy * k
  ctx.translate(FAR, 0)
  tracePoly(ctx, path)
  ctx.fillStyle = '#000'
  ctx.fill()
  ctx.restore()
}

// Fill for one part: masked photo, tiled swatch, or plain colour.
function makeFill(ctx, part, img, sw, frame) {
  if (img) {
    const iw = img.naturalWidth || img.width
    if (iw > 0) {
      if (part.fit && frame) return { img, frame, color: part.color }
      try {
        const pat = ctx.createPattern(img, 'repeat')
        if (pat) {
          const k = (sw * 0.28 * part.swatchScale) / iw
          if (pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix().scale(k))
          return pat
        }
      } catch { /* fall through to colour */ }
    }
  }
  return part.color
}

// Make sure "l" is the side with the smaller x, whatever the caller (mirrored camera) sends.
function normalise(pts) {
  const flip = pts.ls.x > pts.rs.x
  const g = k => pts[(flip ? { l:'r', r:'l' }[k[0]] : k[0]) + k.slice(1)]
  const o = {}
  for (const base of ['s', 'e', 'w', 'h', 'k', 'a']) { o['l' + base] = g('l' + base); o['r' + base] = g('r' + base) }
  if (pts.hd) o.hd = pts.hd
  return o
}
const hasPts = pts => !!(pts && pts.ls && pts.rs && pts.lh && pts.rh && pts.lk && pts.rk && pts.la && pts.ra)

// Shared measurements, used by the suit and by the skeleton so they always agree.
function geometry(P, model) {
  const sm = { x: (P.ls.x + P.rs.x) / 2, y: (P.ls.y + P.rs.y) / 2 }
  const hm = { x: (P.lh.x + P.rh.x) / 2, y: (P.lh.y + P.rh.y) / 2 }
  const sw = P.rs.x - P.ls.x
  const torsoH = hm.y - sm.y
  const hipSpan = P.rh.x - P.lh.x
  if (!(sw > 4) || !(torsoH > 4) || !(hipSpan > 2)) return null
  const kneeY = (P.lk.y + P.rk.y) / 2
  const hemY = hm.y + model.jacketLen * Math.max(kneeY - hm.y, 0)
  const top = sm.y - torsoH * model.raise                 // garment shoulder line, raised off the detected shoulders
  const collarHalf = sw * 0.14 * model.neckW
  const collarY = top - torsoH * 0.06
  const apexY = sm.y + torsoH * (0.18 + 0.55 * model.vDepth)
  const apex = { x: lerp(sm.x, hm.x, (apexY - sm.y) / torsoH), y: apexY }
  const E = model.ease
  const Ec = (1 + (E - 1) * 0.6) * model.chest                   // chest opens less than the waist and hem
  const hs = hipSpan / 2
  // smallest half-widths that still cover the body (estimate plus margin)
  const minHalf = model.coverBody
    ? { chest: sw * 0.53, waist: Math.max(sw * 0.38, hs * 1.05) * 1.1, hip: hs * 1.3 * 1.06 }
    : { chest: 0, waist: 0, hip: 0 }
  const hemHalf = Math.max(Math.max(sw * 0.5, hipSpan * 0.75) * E * model.hemWidth, minHalf.hip)
  const sp = SHOULDER_SPECS[model.shoulderStyle] || SHOULDER_SPECS.natural
  const tipY = top - torsoH * 0.01 + torsoH * 0.07 * model.slope + torsoH * sp.tipDrop
  return { sm, hm, sw, torsoH, hipSpan, kneeY, hemY, collarHalf, collarY, apex, E, Ec, hemHalf, top, minHalf, sp, tipY }
}

// Hem height at x. 'rounded' and 'cutaway' lift the two front corners away from the centre line.
function hemFn(g, model, back) {
  const { hm, hemY, hemHalf, torsoH } = g
  const style = back ? 'straight' : model.hem
  const cut = style === 'rounded' ? torsoH * 0.05 : style === 'cutaway' ? torsoH * 0.11 : 0
  const w   = style === 'cutaway' ? 0.62 : 0.30
  const sag = torsoH * 0.010                      // the hem hangs a little lower in the middle
  return x => {
    const u = (x - hm.x) / hemHalf
    let y = hemY + sag * (1 - u * u)
    if (cut > 0) {
      const a = 1 - Math.abs(u) / w
      if (a > 0) y -= style === 'cutaway' ? cut * Math.pow(a, 1.5) : cut * (1 - Math.sqrt(Math.max(0, 1 - a * a)))
    }
    return y
  }
}

/**
 * Jacket outline. Returns { path, hem } where hem is the bottom edge, left to right.
 */function jacketShape(g, model, back) {
  const { sm, hm, sw, torsoH, hemY, collarHalf, collarY, apex, E, Ec, hemHalf, top, minHalf, sp } = g
  const openV = !back && model.neckline === 'v'
  const pad = sw * (0.02 + 0.08 * model.shoulder + sp.padExtra)
  const tipY = g.tipY     // shoulder tip sits lower than the neck
  const waistY = sm.y + torsoH * 0.62
  const hipY = lerp(waistY, hemY, 0.6)
  const side = sg => [
    { x: sm.x + sg * (sw / 2 + pad),                          y: tipY },
    { x: sm.x + sg * Math.max(sw * 0.5 * Ec, minHalf.chest),                           y: sm.y + torsoH * 0.25 },
    { x: hm.x + sg * Math.max(sw * 0.45 * E * (1 - model.waist * 0.2), minHalf.waist), y: waistY },
    { x: hm.x + sg * Math.max(hemHalf * 0.97, minHalf.hip),                          y: hipY },
    { x: hm.x + sg * hemHalf,                                 y: hemY },
  ]
  const L = side(-1), R = side(1)
  const sL = spline(L, 8), sR = spline(R, 8)

  // bottom edge, with the two outer corners rounded
  const yAt = hemFn(g, model, back)
  const x0 = L[4].x, x1 = R[4].x
  const prevL = sL[sL.length - 2], prevR = sR[sR.length - 2]
  const r = Math.min(sw * 0.05, Math.hypot(prevL.x - x0, prevL.y - L[4].y) * 0.9)
  const cL = quad(toward(L[4], prevL, r), { x: x0, y: yAt(x0) }, { x: x0 + r, y: yAt(x0 + r) }, 4)
  const cR = quad({ x: x1 - r, y: yAt(x1 - r) }, { x: x1, y: yAt(x1) }, toward(R[4], prevR, r), 4)
  const mid = []
  const N = 44
  for (let i = 0; i <= N; i++) { const x = lerp(x0 + r, x1 - r, i / N); mid.push({ x, y: yAt(x) }) }
  const hem = [...cL, ...mid, ...cR]                // left -> right

  // shoulders and neckline
  const collL = { x: sm.x - collarHalf, y: collarY }, collR = { x: sm.x + collarHalf, y: collarY }
  const tr = sw * sp.round                                   // rounded tip radius
  const ctrlL = { x: (L[0].x + collL.x) / 2, y: (L[0].y + collL.y) / 2 - torsoH * sp.bow }
  const ctrlR = { x: (R[0].x + collR.x) / 2, y: (R[0].y + collR.y) / 2 - torsoH * sp.bow }
  const shL = tr > 0.5
    ? [...quad(toward(L[0], L[1], tr), L[0], toward(L[0], collL, tr), 4), ...quad(toward(L[0], collL, tr), ctrlL, collL, 5).slice(1)]
    : quad(L[0], ctrlL, collL, 5)
  const shR = tr > 0.5
    ? [...quad(collR, ctrlR, toward(R[0], collR, tr), 5), ...quad(toward(R[0], collR, tr), R[0], toward(R[0], R[1], tr), 4).slice(1)]
    : quad(collR, ctrlR, R[0], 5)
  const neck = back ? [] : openV ? [apex]
    : quad(collL, { x: sm.x, y: collarY + torsoH * (model.neckline === 'barong' ? 0.2 : 0.075) }, collR, 8).slice(1, -1)   // closed: round neck, deeper for the barong

  const clear = (p, T) => p.slice(1, -1).filter(q => Math.hypot(q.x - T.x, q.y - T.y) > tr * 1.1)   // skip samples inside the rounded tip
  const path = [...shL, ...neck, ...shR, ...clear(sR, R[0]), ...hem.slice().reverse(), ...clear(sL, L[0]).reverse()]
  return { path, hem, yAt, side: { L, R } }
}

/**
 * Draw the fitted suit.
 *   ctx      2D context (already transformed to logical px)
 *   pts      body points, see header
 *   modelRaw suitModel object (raw or resolved)
 *   opts     { view: 'front'|'back', opacity: 0..1, swatchImgs: { partId: Image|Canvas },
 *              skeleton: false | true | 'ghost' | 'over', skeletonLabels: boolean }
 *            skeleton 'over' draws the skeleton on the solid suit; true / 'ghost' also makes the suit
 *            see-through so you can see the body inside it.
 * Returns false when the points are unusable (caller keeps the photo).
 */
let _layer = null
export function drawSuitModel(ctx, pts, modelRaw, opts = {}) {
  const skel = opts.skeleton === true ? 'ghost' : (opts.skeleton || false)
  const alpha = num(opts.opacity, 1) * (skel === 'ghost' ? 0.55 : 1)
  const cv = ctx.canvas
  if (!cv || typeof document === 'undefined' || !ctx.getTransform) return renderSuit(ctx, pts, modelRaw, opts)
  if (!_layer) _layer = document.createElement('canvas')
  if (_layer.width !== cv.width || _layer.height !== cv.height) { _layer.width = cv.width; _layer.height = cv.height }
  const lx = _layer.getContext('2d')
  const tf = ctx.getTransform()
  lx.setTransform(1, 0, 0, 1, 0, 0)
  lx.clearRect(0, 0, _layer.width, _layer.height)
  lx.setTransform(tf)
  if (!renderSuit(lx, pts, modelRaw, { ...opts, opacity: 1, skeleton: false, layered: true })) return false
  const cam = opts.light ? resolveSuitModel(modelRaw).camSoft : 0
  if (cam > 0.02) {                                // live camera: add sensor grain so the suit matches the video
    const gp = grainPattern(lx)
    if (gp) {
      lx.save()
      lx.setTransform(1, 0, 0, 1, 0, 0)
      lx.globalCompositeOperation = 'source-atop'
      if (gp.setTransform && typeof DOMMatrix !== 'undefined') gp.setTransform(new DOMMatrix().translate(Math.random() * 64, Math.random() * 64))
      lx.globalAlpha = 0.08 * cam
      lx.fillStyle = gp
      lx.fillRect(0, 0, _layer.width, _layer.height)
      lx.restore()
    }
  }
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = alpha
  ctx.globalCompositeOperation = 'source-over'
  if (cam > 0.02) ctx.filter = `blur(${Math.min(1.2, 0.6 * cam * (tf.a || 1)).toFixed(2)}px)`
  ctx.drawImage(_layer, 0, 0)
  ctx.filter = 'none'
  ctx.restore()
  if (skel) drawSuitSkeleton(ctx, pts, modelRaw, { labels: opts.skeletonLabels !== false })
  return true
}

function renderSuit(ctx, pts, modelRaw, opts = {}) {
  if (!hasPts(pts)) return false
  const P = normalise(pts)
  const model = resolveSuitModel(modelRaw)
  const g = geometry(P, model)
  if (!g) return false
  const back = opts.view === 'back'
  _outline = 0.7 * model.outline
  _outlineRGB = hexRgb(shade(model.parts.torso.color, -0.7)).join(',')
  _lightK = clamp(model.lightDir, -1, 1) * model.shading
  const openV = !back && model.neckline === 'v'
  const barong = !back && model.neckline === 'barong'
  const masked = model.maskOverrides && !!(model.parts.torso.fit && opts.swatchImgs && opts.swatchImgs.torso)   // photo mask replaces drawn details
  const sheerA = barong && !masked ? 1 - model.sheer * 0.62 : 1             // cloth opacity
  const embC = model.embColor
  const skel = opts.skeleton === true ? 'ghost' : (opts.skeleton || false)
  const opacity = num(opts.opacity, 1) * (skel === 'ghost' ? 0.55 : 1)
  const { sm, hm, sw, torsoH, hipSpan, hemY, collarHalf, collarY, apex, hemHalf, top } = g
  const E = g.E
  const imgs = opts.swatchImgs || {}
  const tf = ctx.getTransform ? ctx.getTransform() : null
  const k = tf ? (Math.hypot(tf.a, tf.b) || 1) : 1       // canvas scale, for shadows
  const cxAt = y => lerp(sm.x, hm.x, clamp((y - sm.y) / torsoH, 0, 1))

  const jacket = jacketShape(g, model, back)
  const torsoFrame = { x0: hm.x - hemHalf, x1: hm.x + hemHalf, y0: collarY, y1: hemY }
  const fillTorso = makeFill(ctx, model.parts.torso, imgs.torso, sw, torsoFrame)

  // shirt + collar geometry (front view). The collar flaps tuck under the lapels, so their tips
  // are placed from how wide the V is at that depth.
  const bandH = torsoH * 0.05 * model.collarSize
  const style = model.collar
  const bandTop = collarY - bandH * (style === 'band' ? 1.35 : style === 'wing' ? 1.5 : 1)
  const vh = d => collarHalf * clamp(1 - d / Math.max(apex.y - collarY, 1), 0, 1)
  const gap = model.tie.type === 'necktie' ? sw * 0.03 : model.tie.type === 'bowtie' ? sw * 0.016 : sw * 0.008
  const bandPoly = [
    { x: sm.x - collarHalf, y: collarY }, { x: sm.x + collarHalf, y: collarY },
    { x: sm.x + collarHalf * 0.85, y: bandTop }, { x: sm.x - collarHalf * 0.85, y: bandTop },
  ]
  const flaps = []                                // polygons, drawn over the tie, under the jacket
  const buttonDots = []
  if (openV) {
    if (style === 'point' || style === 'spread' || style === 'buttondown') {
      const lenBase = { point: 0.15, spread: 0.125, buttondown: 0.135 }[style] * torsoH * model.collarSize
      const len = Math.min(lenBase, 0.75 * (apex.y - collarY))
      const w = vh(len)
      const tipX = style === 'spread' ? Math.min(w * 1.25 + collarHalf * 0.1, collarHalf * 1.5) : Math.max(gap * 1.6, w * 0.98)
      for (const sg of [-1, 1]) {
        const I = { x: sm.x + sg * gap, y: bandTop }
        const O = { x: sm.x + sg * collarHalf * 0.9, y: bandTop }
        const T = { x: sm.x + sg * tipX, y: collarY + len }
        flaps.push([I, O, T, { x: sm.x + sg * gap, y: bandTop + len * 0.1 }])
        if (style === 'buttondown') buttonDots.push({ x: T.x - sg * sw * 0.012, y: T.y - sw * 0.012 })
      }
    } else if (style === 'wing') {
      for (const sg of [-1, 1]) {
        flaps.push([
          { x: sm.x + sg * gap,               y: bandTop },
          { x: sm.x + sg * collarHalf * 0.62, y: bandTop - bandH * 0.1 },
          { x: sm.x + sg * collarHalf * 1.02, y: collarY - bandH * 0.62 },
          { x: sm.x + sg * collarHalf * 0.5,  y: collarY - bandH * 0.42 },
          { x: sm.x + sg * gap,               y: collarY - bandH * 0.55 },
        ])
      }
    }
  }
    if (barong && style !== 'none' && style !== 'band') {          // barong: a small flat collar along the neck opening
    const len = torsoH * (style === 'spread' ? 0.1 : 0.13) * model.collarSize
    const out = style === 'spread' ? 1.55 : 1.2
    for (const sg of [-1, 1]) {
      const T = { x: sm.x + sg * collarHalf * out, y: collarY + len }
      flaps.push([
        { x: sm.x + sg * collarHalf * 0.95, y: bandTop },
        { x: sm.x + sg * collarHalf * 1.08, y: bandTop + bandH * 0.3 },
        T,
        { x: sm.x + sg * collarHalf * 0.14, y: collarY + torsoH * 0.095 },
      ])
      if (style === 'buttondown') buttonDots.push({ x: T.x - sg * sw * 0.012, y: T.y - sw * 0.012 })
    }
  }
  const collarFrame = mergeBox(bbox(bandPoly), ...(flaps.length ? flaps.map(bbox) : [bbox(bandPoly)]))
  const shirtFrame = { x0: sm.x - collarHalf * 1.4, x1: sm.x + collarHalf * 1.4, y0: bandTop, y1: apex.y + torsoH * 0.08 }
   const torsoLike = barong && !model.own.collar                   // barong collar matches the shirt body unless set
  const cPart = torsoLike ? model.parts.torso : model.parts.collar
  const cImg  = torsoLike ? (cPart.fit ? null : imgs.torso) : imgs.collar
  const fillCollar = makeFill(ctx, cPart, cImg, sw, collarFrame)
  const fillShirt  = makeFill(ctx, model.parts.shirt,  imgs.shirt,  sw, shirtFrame)
  // a cuff is too small to show a stretched photo, so a masked shirt falls back to its colour
  const fillCuff = barong && !model.own.shirt ? model.parts.torso.color : (model.parts.shirt.fit ? model.parts.shirt.color : makeFill(ctx, model.parts.shirt, imgs.shirt, sw, null))

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = 'source-over'
  ctx.lineJoin = 'round'

  /* 1. trousers */
  const legTop = hm.y - torsoH * 0.08
  const trouserPolys = [], legs = []
  for (const s of ['l', 'r']) {
    const h = P[s + 'h'], k0 = P[s + 'k'], a0 = P[s + 'a']
    const T = model.trouserEase, hang = model.legHang
    const kn = { x: lerp(k0.x, h.x, hang * 0.6), y: k0.y }
    const an = { x: lerp(a0.x, h.x, hang * 0.6), y: a0.y }
    const chain  = [{ x: h.x, y: legTop }, h, kn, an]
    const widths = [hipSpan * 0.95 * T, hipSpan * 0.95 * T, hipSpan * 0.78 * T, hipSpan * 0.68 * T]
    const legPath = tube(chain, widths)
    trouserPolys.push(legPath)
    legs.push({ kn, an, wk: widths[2], wa: widths[3] })
    paint(ctx, legPath, makeFill(ctx, model.parts[s + 'Leg'], imgs[s + 'Leg'], sw, bbox(legPath)), { edge: 0.22, across: acrossTube(h, an, widths[2]) })
    ctx.beginPath(); ctx.moveTo(h.x, hm.y); ctx.lineTo(kn.x, kn.y); ctx.lineTo(an.x, an.y)   // crease
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1; ctx.stroke()
  }
  const wl = P.lh.x, wr = P.rh.x
  const waistRect = [{ x: wl, y: legTop }, { x: wr, y: legTop }, { x: wr, y: hm.y + torsoH * 0.18 }, { x: wl, y: hm.y + torsoH * 0.18 }]
  trouserPolys.push(waistRect)
  paint(ctx, waistRect, makeFill(ctx, model.parts.lLeg, imgs.lLeg, sw, { x0: wl, x1: wr, y0: legTop, y1: hm.y + torsoH * 0.18 }), { edge: 0.1, stroke: false })

  /* 1b. the jacket's shadow on the trousers: this is what gives the hem its depth */
  if (model.hemShadow > 0) {
    ctx.save()
    traceMulti(ctx, trouserPolys); ctx.clip()
    castShadow(ctx, jacket.path, { a: 0.7 * model.hemShadow, blur: torsoH * 0.05, dx: -model.lightDir * torsoH * 0.025, dy: torsoH * 0.03, k })
    ctx.restore()
  }

  /* 2. shirt (what shows in the V) + neck band */
  if (openV) {
    paint(ctx, [
      { x: sm.x - collarHalf * 1.15, y: collarY - torsoH * 0.02 },
      { x: sm.x + collarHalf * 1.15, y: collarY - torsoH * 0.02 },
      { x: apex.x + collarHalf * 0.18, y: apex.y + torsoH * 0.02 },
      { x: apex.x - collarHalf * 0.18, y: apex.y + torsoH * 0.02 },
    ], fillShirt, { edge: 0.08, stroke: false })
    // button placket
    const py0 = collarY + torsoH * 0.03, py1 = apex.y + torsoH * 0.05
    ctx.beginPath(); ctx.moveTo(cxAt(py0), py0); ctx.lineTo(cxAt(py1), py1)
    ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 1; ctx.stroke()
    if (model.tie.type !== 'necktie') {
      const rb = Math.max(0.9, sw * 0.0065)
      for (let y = collarY + torsoH * (model.tie.type === 'bowtie' ? 0.1 : 0.075); y < py1; y += torsoH * 0.075) {
        ctx.beginPath(); ctx.arc(cxAt(y), y, rb, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.7; ctx.stroke()
      }
    }
  }
  if (style !== 'none') paint(ctx, bandPoly, fillCollar, { edge: 0.1 })
  if (!back && style === 'band') {                        // mandarin collar: a small opening at the front
    ctx.beginPath(); ctx.moveTo(sm.x, bandTop); ctx.lineTo(sm.x, collarY)
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.stroke()
  }

  /* 3. necktie (under the jacket, so the V edge covers its sides) */
   if (openV && model.tie.type === 'necktie') {
    const ky = collarY + torsoH * 0.06, kw = sw * 0.07, kh = torsoH * 0.05
    const endY = apex.y + torsoH * 0.3
    paint(ctx, [
      { x: cxAt(ky) - kw * 0.45, y: ky + kh }, { x: cxAt(ky) + kw * 0.45, y: ky + kh },
      { x: cxAt(ky + (endY - ky) * 0.35) + sw * 0.045, y: ky + (endY - ky) * 0.35 },
      { x: cxAt(endY), y: endY },
      { x: cxAt(ky + (endY - ky) * 0.35) - sw * 0.045, y: ky + (endY - ky) * 0.35 },
    ], model.tie.color, { edge: 0.18 })
    paint(ctx, [
      { x: cxAt(ky) - kw / 2, y: ky }, { x: cxAt(ky) + kw / 2, y: ky },
      { x: cxAt(ky) + kw * 0.4, y: ky + kh }, { x: cxAt(ky) - kw * 0.4, y: ky + kh },
    ], model.tie.color, { edge: 0.25 })
  }

  /* 3b. shirt collar flaps: over the tie, under the jacket and lapels */
  const drawFlaps = () => {
    for (const f of flaps) {
      castShadow(ctx, f, { a: 0.35, blur: sw * 0.02, dy: sw * 0.012, k })
      paint(ctx, f, fillCollar, { edge: 0.1 })
    }
    for (const d of buttonDots) {
      ctx.beginPath(); ctx.arc(d.x, d.y, Math.max(0.9, sw * 0.007), 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.7; ctx.stroke()
    }
  }
    const flapsOver = barong || masked        // collar sits on top of the masked photo / barong body
  if (!flapsOver) drawFlaps()

   /* 3b2. opaque backing under the sheer cloth */
  if (barong && sheerA < 1) paint(ctx, jacket.path, shade(model.parts.shirt.color, -0.05), { edge: 0, stroke: false })

  /* 3c. barong: the undershirt (crew neck) that shows through the sheer cloth */
  if (barong) {
    const uw = sw * 0.44, uy = hm.y + torsoH * 0.12
    const nkL = { x: sm.x - collarHalf * 0.85, y: collarY }, nkR = { x: sm.x + collarHalf * 0.85, y: collarY }
    const crew = quad(nkL, { x: sm.x, y: collarY + torsoH * 0.16 }, nkR, 8)
    paint(ctx, [{ x: sm.x - uw, y: top + torsoH * 0.02 }, ...crew, { x: sm.x + uw, y: top + torsoH * 0.02 },
                { x: hm.x + uw * 0.95, y: uy }, { x: hm.x - uw * 0.95, y: uy }], fillShirt, { edge: 0.14, stroke: false })
    ctx.beginPath(); crew.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = Math.max(1.5, sw * 0.022); ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = Math.max(0.8, sw * 0.008); ctx.stroke()
  }

  /* 4. jacket body (V notch left open in front view) */
  ctx.globalAlpha = sheerA
  paint(ctx, jacket.path, fillTorso, { edge: 0.24 })
  ctx.globalAlpha = 1
  {
    // cloth gets darker toward the hem, so the jacket reads as a form with its own weight
    ctx.save()
    tracePoly(ctx, jacket.path); ctx.clip()
    const y0 = sm.y + torsoH * 0.4, y1 = hemY + torsoH * 0.02
    const gr = ctx.createLinearGradient(0, y0, 0, y1)
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.17)')
    ctx.fillStyle = gr
    ctx.fillRect(hm.x - hemHalf - 2, y0, hemHalf * 2 + 4, y1 - y0 + torsoH * 0.1)
    ctx.restore()
  }
  // hem: stitched band inside the edge + a thin dark lining line under the edge (the cloth has thickness)
  {
    const hem = masked ? [] : jacket.hem
    const bw = Math.max(1.4, torsoH * 0.009)
    ctx.save()
    tracePoly(ctx, jacket.path); ctx.clip()
    ctx.beginPath(); hem.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y - torsoH * 0.022) : ctx.moveTo(q.x, q.y - torsoH * 0.022)))
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 0.8; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([])
    ctx.beginPath(); hem.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y - bw / 2) : ctx.moveTo(q.x, q.y - bw / 2)))
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = bw; ctx.stroke()
    ctx.restore()
    ctx.beginPath(); hem.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y + bw * 0.35) : ctx.moveTo(q.x, q.y + bw * 0.35)))
    ctx.strokeStyle = model.liningColor; ctx.lineWidth = bw * 0.9; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt'
  }
  if (back) {
    ctx.beginPath(); ctx.moveTo(sm.x, collarY); ctx.lineTo(hm.x, jacket.yAt(hm.x))                 // centre-back seam
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke()
    // jacket collar sits over the shirt band
    paint(ctx, [
      { x: sm.x - collarHalf, y: collarY + 1 }, { x: sm.x + collarHalf, y: collarY + 1 },
      { x: sm.x + collarHalf * 0.9, y: collarY - torsoH * 0.03 }, { x: sm.x - collarHalf * 0.9, y: collarY - torsoH * 0.03 },
    ], fillTorso, { edge: 0.12 })
    // vents
    if (model.vent !== 'none') {
      const vTop = lerp(sm.y + torsoH * 0.65, hemY, 0.35), vw = Math.max(1.5, sw * 0.016)
      const xs = model.vent === 'side' ? [hm.x - hemHalf * 0.6, hm.x + hemHalf * 0.6] : [hm.x]
      for (const x of xs) {
        const yb = jacket.yAt(x)
        ctx.beginPath(); ctx.moveTo(x, vTop); ctx.lineTo(x - vw, yb); ctx.lineTo(x + vw, yb); ctx.closePath()
        ctx.fillStyle = model.liningColor; ctx.fill()
        ctx.beginPath(); ctx.moveTo(x + vw * 0.2, vTop); ctx.lineTo(x + vw, yb)
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke()
      }
    }
  }

  /* 4b. shoulder seams */
  if (!masked) {
    for (const sg of [-1, 1]) {
      const T = jacket.side[sg < 0 ? 'L' : 'R'][0]
      const a0 = { x: sm.x + sg * collarHalf * 1.03, y: collarY + 1 }
      const mx = (a0.x + T.x) / 2, my = (a0.y + T.y) / 2 - torsoH * 0.004
      const seam = dy => { ctx.beginPath(); ctx.moveTo(a0.x, a0.y + dy); ctx.quadraticCurveTo(mx, my + dy, T.x - sg * sw * 0.02, T.y + dy); ctx.stroke() }
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.setLineDash([]); seam(0)
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.setLineDash([2, 2.5]); seam(1.2); ctx.setLineDash([])
    }
  }

  /* 5. lapels (front) */
    if (!back && !barong && !masked && model.breast !== 'none') {
    const lw = model.lapelW * sw
    for (const sg of [-1, 1]) {
      const N = { x: sm.x + sg * collarHalf, y: collarY }
      const M = { x: apex.x + sg * lw * 1.6, y: lerp(collarY, apex.y, 0.58) }
      const o = (dx, dy) => ({ x: N.x + sg * lw * dx, y: collarY + torsoH * dy })
      let poly
      if (model.lapel === 'peak')       poly = [N, o(0.8, 0.015), o(0.7, 0.042), o(1.5, 0.004), M, apex]
      else if (model.lapel === 'shawl') poly = [N, ...quad(N, o(1.5, 0.02), M, 7).slice(1), apex]
      else                              poly = [N, o(0.95, 0.02), o(0.62, 0.045), o(1.12, 0.052), M, apex]
      paint(ctx, poly, fillTorso, { edge: 0.06 })
      tracePoly(ctx, poly)
      ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fill()                                    // lapels read slightly darker
      // roll line: a soft highlight along the inner edge
      ctx.beginPath(); ctx.moveTo(N.x, N.y); ctx.lineTo(apex.x, apex.y)
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.stroke()
    }
  }

  /* 5b. front closure and buttons */
    if (!back && !barong && !masked && model.breast !== 'none') {
    const fa = openV ? apex : { x: sm.x, y: collarY + torsoH * 0.07 }
    const bot = jacket.yAt(hm.x)
    const dbl = model.breast === 'double'
    const edgeX = dbl ? -sw * 0.15 : 0
    // the front edge: straight down from the V, with a thin shadow so the two fronts read as separate layers
    const line = [{ x: fa.x + edgeX, y: fa.y }, { x: hm.x + edgeX, y: hm.y }, { x: hm.x + edgeX, y: bot }]
    if (dbl) line.splice(1, 0, { x: fa.x + edgeX, y: fa.y + torsoH * 0.05 })
    ctx.beginPath(); line.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
    ctx.strokeStyle = 'rgba(0,0,0,0.38)'; ctx.lineWidth = 1.2; ctx.stroke()
    ctx.beginPath(); line.forEach((q, i) => (i ? ctx.lineTo(q.x + 1.2, q.y) : ctx.moveTo(q.x + 1.2, q.y)))
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke()

    // buttons, counted up from the waist button
    const rb = Math.max(1.6, sw * 0.02)
    const yW = sm.y + torsoH * 0.64, step = torsoH * 0.13
    for (let i = 0; i < model.buttons; i++) {
      const y = yW - i * step
      if (y < fa.y + torsoH * 0.02 || y > hemY - torsoH * 0.05) continue
      const xs = dbl ? [cxAt(y) - sw * 0.085, cxAt(y) + sw * 0.085] : [cxAt(y)]
      for (const x of xs) {
        ctx.beginPath(); ctx.arc(x, y, rb, 0, Math.PI * 2)
        ctx.fillStyle = model.buttonColor; ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.8; ctx.stroke()
        ctx.beginPath(); ctx.arc(x, y, rb * 0.62, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 0.7; ctx.stroke()
      }
    }
  }

    /* 5c. barong: placket, embroidered front panels, side slits, buttons, collar */
  if (barong && !masked) {
    const bot = jacket.yAt(hm.x)
    const yTop = collarY + torsoH * 0.09, yBot = bot - torsoH * 0.045
    const pk = sw * 0.045 * model.placket
    const xc = (y, o) => cxAt(y) + o
    ctx.save()
    tracePoly(ctx, jacket.path); ctx.clip()
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
    for (const o of [-pk, pk]) {                                       // stitched placket edges
      ctx.beginPath(); ctx.moveTo(xc(yTop, o), yTop); ctx.lineTo(xc(yBot, o), yBot)
      ctx.strokeStyle = 'rgba(0,0,0,0.26)'; ctx.stroke()
      ctx.beginPath(); ctx.moveTo(xc(yTop, o * 0.8), yTop); ctx.lineTo(xc(yBot, o * 0.8), yBot)
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([])
    }
    if (model.embroidery !== 'none') {
      const pw = sw * 0.17 * model.embW, u = sw * 0.07 * model.embSize
      for (const sg of [-1, 1]) {
        const off = sg * (pk + sw * 0.015 + pw / 2)
        embroider(ctx, model.embroidery, embC, y => xc(y, off), pw, yTop + torsoH * 0.02, yBot - torsoH * 0.02, u)
      }
      ctx.beginPath(); jacket.hem.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y - torsoH * 0.04) : ctx.moveTo(q.x, q.y - torsoH * 0.04)))   // hem band
      ctx.strokeStyle = embC; ctx.globalAlpha = 0.8; ctx.lineWidth = Math.max(0.8, u * 0.07); ctx.stroke(); ctx.globalAlpha = 1
    }
    for (const sg of [-1, 1]) {                                        // side slits
      const x = hm.x + sg * hemHalf * 0.965, yb = jacket.yAt(x)
      ctx.beginPath(); ctx.moveTo(x, yb - torsoH * 0.08); ctx.lineTo(x + sg * 0.5, yb)
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.stroke()
    }
    const rb = Math.max(1.2, sw * 0.014)
    for (let i = 0; i < 3 + model.buttons; i++) {
      const y = collarY + torsoH * (0.12 + i * 0.11)
      if (y > yBot) break
      ctx.beginPath(); ctx.arc(cxAt(y), y, rb, 0, Math.PI * 2)
      ctx.fillStyle = model.buttonColor; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.8; ctx.stroke()
    }
    ctx.restore()
    
  }

    if (flapsOver) drawFlaps()                 // collar options now work with a masked photo
  /* 6. bow tie (on top, at the collar) */
   if (openV && model.tie.type === 'bowtie') {
    const cy = collarY + torsoH * 0.035, ww = sw * 0.12, hh = torsoH * 0.032, kw = sw * 0.03
    for (const sg of [-1, 1]) {
      paint(ctx, [{ x: sm.x + sg * kw * 0.5, y: cy }, { x: sm.x + sg * ww, y: cy - hh }, { x: sm.x + sg * ww, y: cy + hh }], model.tie.color, { edge: 0.15 })
    }
    paint(ctx, [{ x: sm.x - kw / 2, y: cy - hh * 0.7 }, { x: sm.x + kw / 2, y: cy - hh * 0.7 }, { x: sm.x + kw / 2, y: cy + hh * 0.7 }, { x: sm.x - kw / 2, y: cy + hh * 0.7 }], model.tie.color, { edge: 0.25 })
  }

  /* 7. pockets (front only; u/v are positions across and down the jacket) */
  if (!back) {
    const x0 = hm.x - hemHalf, x1 = hm.x + hemHalf
    const pw = sw * 0.2, ph = torsoH * 0.045
    for (const p of (masked ? [] : model.pockets)) {
      const px = lerp(x0, x1, p.u), py = lerp(sm.y, hemY, p.v)
      if (model.pocketStyle === 'welt') {
        paint(ctx, [{ x: px - pw / 2, y: py - ph * 0.2 }, { x: px + pw / 2, y: py - ph * 0.2 }, { x: px + pw / 2, y: py + ph * 0.2 }, { x: px - pw / 2, y: py + ph * 0.2 }], model.liningColor, { edge: 0, stroke: false })
        ctx.beginPath(); ctx.moveTo(px - pw / 2, py + ph * 0.2 + 1); ctx.lineTo(px + pw / 2, py + ph * 0.2 + 1)
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1; ctx.stroke()
      } else if (model.pocketStyle === 'patch') {
        const hp = ph * 1.8
        paint(ctx, [{ x: px - pw / 2, y: py - hp / 2 }, { x: px + pw / 2, y: py - hp / 2 }, { x: px + pw / 2, y: py + hp / 2 }, { x: px - pw / 2, y: py + hp / 2 }], fillTorso, { edge: 0.1 })
        ctx.beginPath(); ctx.rect(px - pw / 2 + 2, py - hp / 2 + 2, pw - 4, hp - 4)
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 0.8; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([])
      } else {
        paint(ctx, [{ x: px - pw / 2, y: py - ph / 2 }, { x: px + pw / 2, y: py - ph / 2 }, { x: px + pw / 2, y: py + ph / 2 }, { x: px - pw / 2, y: py + ph / 2 }], fillTorso, { edge: 0.1 })
        ctx.beginPath(); ctx.moveTo(px - pw / 2, py + ph / 2 + 1); ctx.lineTo(px + pw / 2, py + ph / 2 + 1)
        ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1.5; ctx.stroke()           // flap shadow
      }
    }
    // breast pocket + pocket square, on the wearer's left (the right of the picture)
    if (model.pocketSquare.on) {
      const py = sm.y + torsoH * 0.31, px = cxAt(py) + sw * 0.27, bw = sw * 0.15
      const tilt = bw * 0.1
      const sqC = model.pocketSquare.color
      paint(ctx, [{ x: px - bw / 2, y: py - tilt }, { x: px - bw * 0.15, y: py - torsoH * 0.05 }, { x: px + bw * 0.05, y: py - torsoH * 0.028 },
                  { x: px + bw * 0.28, y: py - torsoH * 0.052 }, { x: px + bw / 2, y: py }, { x: px - bw / 2, y: py }], sqC, { edge: 0.1 })
      paint(ctx, [{ x: px - bw / 2, y: py - tilt }, { x: px + bw / 2, y: py - tilt * 0.2 }, { x: px + bw / 2, y: py + tilt * 0.8 }, { x: px - bw / 2, y: py + tilt * 0.6 }], fillTorso, { edge: 0.08 })
    }
  }

   /* 8. sleeves: smooth tapered tube from a rounded shoulder cap, optional shirt cuff */
  const along = (a, b, c, t) => {
    const L1 = Math.hypot(b.x - a.x, b.y - a.y) || 1, L2 = Math.hypot(c.x - b.x, c.y - b.y) || 1
    const d = t * (L1 + L2)
    return d <= L1 ? { x: lerp(a.x, b.x, d / L1), y: lerp(a.y, b.y, d / L1) }
                   : { x: lerp(b.x, c.x, (d - L1) / L2), y: lerp(b.y, c.y, (d - L1) / L2) }
  }
  const tipY = g.tipY
  const armInfo = []
  const armSpines = []
  for (const s of ['l', 'r']) {
    const sg = s === 'l' ? -1 : 1
    const sh = P[s + 's']
    const elA = P[s + 'e'] || { x: sh.x, y: sh.y + torsoH * 0.52 }
    const wrA = P[s + 'w'] || { x: sh.x, y: sh.y + torsoH * 0.96 }
    const hg = model.sleeveHang
    const el = { x: lerp(elA.x, sh.x + sg * sw * 0.1, hg),  y: lerp(elA.y, sh.y + torsoH * 0.52, hg) }
    const wr = { x: lerp(wrA.x, sh.x + sg * sw * 0.13, hg), y: lerp(wrA.y, sh.y + torsoH * 0.96, hg) }
    const jt = jacket.side[sg < 0 ? 'L' : 'R'][0]              // the jacket's own shoulder tip
    const S0 = { x: jt.x - sg * sw * 0.05, y: jt.y + torsoH * 0.03 }   // sleeve starts under it, so the two overlap
    const L1 = Math.hypot(el.x - S0.x, el.y - S0.y) || 1, L2 = Math.hypot(wr.x - el.x, wr.y - el.y) || 1
    const end = along(S0, el, wr, model.sleeveLen)
    const bent = model.sleeveLen * (L1 + L2) > L1 * 1.05
    const sp = spline(bent ? [S0, el, end] : [S0, end], 6)
    const cum = [0]
    for (let i = 1; i < sp.length; i++) cum.push(cum[i - 1] + Math.hypot(sp[i].x - sp[i - 1].x, sp[i].y - sp[i - 1].y))
    const wSh = sw * 0.21 * E * model.sleeveWidth, wWr = wSh * model.sleeveTaper
    const widths = cum.map(c => lerp(wSh, wWr, clamp(c / (L1 + L2), 0, 1.15)))
    const armPath = tube(sp, widths, clamp(model.sleeveCap + g.sp.cap, 0, 1.2))
        armSpines.push({ sp, widths })
    // armhole filler: closes the wedge between the sleeve's inner edge and the jacket side
    if (el.y > S0.y + torsoH * 0.15) {
      const n = sp.length
      const inn = i => (sg < 0 ? armPath[2 * n - 1 - i] : armPath[i])
      const cs = jacket.side[sg < 0 ? 'L' : 'R']
      let ic = 0
      for (let i = 1; i < n; i++) if (Math.abs(inn(i).y - cs[1].y) < Math.abs(inn(ic).y - cs[1].y)) ic = i
      const fp = [cs[0]]
      for (let i = 0; i <= ic; i++) fp.push(inn(i))
      fp.push(cs[1])
      if (sheerA < 1) paint(ctx, fp, shade(model.parts.shirt.color, -0.05), { edge: 0, stroke: false })
      ctx.globalAlpha = sheerA
      paint(ctx, fp, fillTorso, { edge: 0, stroke: false })
      ctx.globalAlpha = 1
    }
    castShadow(ctx, armPath, { a: 0.22, blur: sw * 0.03, dx: -model.lightDir * sw * 0.02, dy: sw * 0.012, k })    // soft contact shadow on the jacket
    ctx.globalAlpha = sheerA
    paint(ctx, armPath, makeFill(ctx, model.parts[s + 'Arm'], imgs[s + 'Arm'], sw, bbox(armPath)), { edge: 0.22, across: acrossTube(S0, end, (wSh + wWr) / 2) })
    if (barong && !masked && model.embroidery !== 'none') {                                       // embroidered band near the cuff
      const n = sp.length, ww = widths[n - 3]
      ctx.globalAlpha = 0.6
      paint(ctx, tube([sp[n - 4], sp[n - 2]], [ww, ww]), embC, { edge: 0, stroke: false })
    }
    ctx.globalAlpha = 1
        {                                                // armhole seam where the sleeve joins the jacket
      const cs = jacket.side[sg < 0 ? 'L' : 'R']
      const p0 = { x: jt.x - sg * sw * 0.03, y: jt.y + torsoH * 0.02 }, p1 = cs[1]
      const cc = { x: lerp(p0.x, p1.x, 0.5) + sg * sw * 0.05, y: lerp(p0.y, p1.y, 0.5) }
      const seam = dy => { ctx.beginPath(); ctx.moveTo(p0.x, p0.y + dy); ctx.quadraticCurveTo(cc.x, cc.y + dy, p1.x, p1.y + dy); ctx.stroke() }
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.setLineDash([]); seam(0)
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.setLineDash([2, 2.5]); seam(1.2); ctx.setLineDash([])
    }
    const last = sp[sp.length - 1], prev = sp[sp.length - 2]
    const dir = toward(prev, last, 1), ux = dir.x - prev.x, uy = dir.y - prev.y
    if (model.cuffs && model.sleeveLen > 0.85) {
      const cl = sw * 0.05, cw = widths[widths.length - 1] * 0.86
      paint(ctx, tube([last, { x: last.x + ux * cl, y: last.y + uy * cl }], [cw, cw * 0.94]), fillCuff, { edge: 0.15 })
    } else {                                                                          // dark sleeve opening
      const hw = widths[widths.length - 1] / 2
      ctx.beginPath(); ctx.moveTo(last.x - uy * hw, last.y + ux * hw); ctx.lineTo(last.x + uy * hw, last.y - ux * hw)
      ctx.strokeStyle = model.liningColor; ctx.lineWidth = Math.max(1.2, sw * 0.012); ctx.stroke()
    }
    if (bent) {
      const ee = sp[6], ex = sp[7].x - sp[5].x, ey = sp[7].y - sp[5].y, el_ = Math.hypot(ex, ey) || 1
      const ax = (el.x - S0.x) / L1, ay = (el.y - S0.y) / L1
      armInfo.push({ el: ee, dirF: { x: ex / el_, y: ey / el_ }, wEl: widths[6], bend: clamp(1 - (ax * ex / el_ + ay * ey / el_), 0, 1) })
    }
  }

  /* 9. lighting. The suit is drawn on its own layer, so 'source-atop' only touches suit pixels. */
  if (opts.layered) {
    const RX = sm.x - sw * 3, RW = sw * 6
    const RY = top - torsoH * 0.5, RH = Math.max(P.la.y, P.ra.y) - RY + torsoH * 0.4
    const wash = f => { ctx.fillStyle = f; ctx.fillRect(RX, RY, RW, RH) }
    const spot = (x, y, r, rgb, a) => {
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r)
      gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`); wash(gr)
    }
    ctx.globalCompositeOperation = 'source-atop'
    const sd = model.shading, c = model.lightDir, lit = c < 0 ? -1 : 1
    const fb = FABRIC_SPECS[model.fabric] || FABRIC_SPECS.standard

    if (sd > 0.01) {
      // sideways key light
      const gx = ctx.createLinearGradient(sm.x - sw * 0.75, 0, sm.x + sw * 0.75, 0)
      gx.addColorStop(0, `rgba(0,0,0,${clamp(0.14 + 0.2 * c, 0, 0.5) * sd})`)
      gx.addColorStop(clamp(0.5 + 0.18 * c, 0.2, 0.8), `rgba(255,255,255,${0.06 * sd})`)
      gx.addColorStop(1, `rgba(0,0,0,${clamp(0.14 - 0.2 * c, 0, 0.5) * sd})`)
      wash(gx)
      // darker toward the ankles, lighter at the shoulders
      const y0 = top, y1 = Math.max(P.la.y, P.ra.y)
      const gy = ctx.createLinearGradient(0, y0, 0, y1)
      gy.addColorStop(0, `rgba(255,255,255,${0.07 * sd})`); gy.addColorStop(0.45, 'rgba(0,0,0,0)'); gy.addColorStop(1, `rgba(0,0,0,${0.2 * sd})`)
      wash(gy)
      // underarm shadows
      for (const sg of [-1, 1]) spot(sm.x + sg * sw * 0.4, sm.y + torsoH * 0.2, sw * 0.17, '0,0,0', 0.4 * sd)
      spot(sm.x, collarY + torsoH * 0.1, sw * 0.16, '0,0,0', 0.22 * sd)
      for (const sg of [-1, 1]) spot(hm.x + sg * hemHalf * 0.85, hemY - torsoH * 0.05, sw * 0.2, '0,0,0', 0.16 * sd)
    }
    if (model.sheen > 0.01) {
      for (const sg of [-1, 1]) spot(sm.x + sg * sw * 0.38, tipY + torsoH * 0.06, sw * 0.28, '255,255,255', 0.22 * model.sheen * fb.sheen * (sg === lit ? 1 : 0.5))
      spot(sm.x + lit * sw * 0.18, sm.y + torsoH * 0.3, sw * 0.4, '255,255,255', 0.14 * model.sheen * fb.sheen)
    }

    // folds
    const wk = model.wrinkles
    if (wk > 0.02) {
      const fw = Math.max(1.2, sw * 0.014)
      const fold = (a, b, bow, al) => {
        const nx = -(b.y - a.y), ny = b.x - a.x, nl = Math.hypot(nx, ny) || 1
        const cc = { x: (a.x + b.x) / 2 + (nx / nl) * bow, y: (a.y + b.y) / 2 + (ny / nl) * bow }
        ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cc.x, cc.y, b.x, b.y)
        for (const [m, q] of [[3.2, 0.22], [1.9, 0.4], [1, 0.7]]) { ctx.strokeStyle = `rgba(0,0,0,${al * fb.fold * q})`; ctx.lineWidth = fw * m; ctx.stroke() }
        ctx.beginPath(); ctx.moveTo(a.x, a.y + fw); ctx.quadraticCurveTo(cc.x, cc.y + fw, b.x, b.y + fw)
        for (const [m, q] of [[2.6, 0.2], [1.4, 0.45]]) { ctx.strokeStyle = `rgba(255,255,255,${al * 0.45 * fb.fold * q})`; ctx.lineWidth = fw * m * 0.8; ctx.stroke() }
      }
      for (const a of armInfo) {
        const nx = -a.dirF.y, ny = a.dirF.x, st = wk * model.sleeveBend * (0.45 + a.bend)
        for (const o of [-0.35, 0, 0.35]) {
          const cx_ = a.el.x + a.dirF.x * a.wEl * o * 0.6, cy_ = a.el.y + a.dirF.y * a.wEl * o * 0.6
          fold({ x: cx_ - nx * a.wEl * 0.42, y: cy_ - ny * a.wEl * 0.42 }, { x: cx_ + nx * a.wEl * 0.42, y: cy_ + ny * a.wEl * 0.42 }, a.wEl * 0.08, 0.3 * st)
        }
      }
      if (!back) {
        const yW = sm.y + torsoH * 0.64, bx = cxAt(yW)
        for (const sg of [-1, 1]) {
          fold({ x: bx + sg * sw * 0.03, y: yW }, { x: bx + sg * hemHalf * 0.6, y: yW + torsoH * 0.09 }, sg * torsoH * 0.015, 0.2 * wk)
          fold({ x: bx + sg * sw * 0.03, y: yW + torsoH * 0.04 }, { x: bx + sg * hemHalf * 0.5, y: yW + torsoH * 0.14 }, sg * torsoH * 0.012, 0.13 * wk)
        }
      }
      for (const lg of legs) {
        for (const dy of [-0.025, 0.02]) fold({ x: lg.kn.x - lg.wk * 0.4, y: lg.kn.y + torsoH * dy }, { x: lg.kn.x + lg.wk * 0.4, y: lg.kn.y + torsoH * dy }, torsoH * 0.01, 0.22 * wk)
        fold({ x: lg.an.x - lg.wa * 0.42, y: lg.an.y - torsoH * 0.07 }, { x: lg.an.x + lg.wa * 0.42, y: lg.an.y - torsoH * 0.07 }, torsoH * 0.012, 0.2 * wk)   // trouser break
      }
            // pull creases fanning from each armpit across the chest
      if (!back) for (const sg of [-1, 1]) {
        const ax = sm.x + sg * sw * 0.44, ay = sm.y + torsoH * 0.2
        for (let i = 0; i < 3; i++)
          fold({ x: ax, y: ay + torsoH * 0.02 * i },
               { x: lerp(ax, cxAt(ay) + sg * sw * 0.08, 0.55 + 0.05 * i), y: ay + torsoH * (0.09 + 0.05 * i) },
               sg * torsoH * 0.01, 0.11 * wk)
      }
      // stress creases around the waist button
      if (!back && (model.breast !== 'none' || barong)) {
        const yb = sm.y + torsoH * 0.64, bx2 = cxAt(yb)
        for (const sg of [-1, 1]) for (const d of [-1, 1])
          fold({ x: bx2 + sg * sw * 0.02, y: yb }, { x: bx2 + sg * sw * 0.2, y: yb + d * torsoH * 0.035 }, 0, 0.14 * wk)
      }
      // shoulder-blade and waist creases on the back
      if (back) for (const sg of [-1, 1]) {
        fold({ x: sm.x + sg * sw * 0.42, y: sm.y + torsoH * 0.18 }, { x: sm.x + sg * sw * 0.08, y: sm.y + torsoH * 0.34 }, sg * torsoH * 0.012, 0.12 * wk)
        fold({ x: sm.x + sg * sw * 0.4,  y: sm.y + torsoH * 0.5 },  { x: sm.x + sg * sw * 0.06, y: sm.y + torsoH * 0.56 }, torsoH * 0.01, 0.1 * wk)
      }
      // long creases down each sleeve, plus bunching at the wrist
      for (const s of armSpines) {
        const n = s.sp.length
        const at = (f, o) => {
          const i = clamp(Math.round(f * (n - 1)), 1, n - 2)
          const a = s.sp[i - 1], b = s.sp[i + 1], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1
          return { x: s.sp[i].x + (-dy / l) * o * s.widths[i], y: s.sp[i].y + (dx / l) * o * s.widths[i] }
        }
        for (const o of [-0.28, 0.12, 0.3]) fold(at(0.12, o), at(0.5, o * 0.8), s.widths[2] * 0.05, 0.1 * wk)
        for (const o of [-0.3, 0.2])        fold(at(0.55, o), at(0.9, o * 0.9), s.widths[2] * 0.04, 0.09 * wk)
        for (const f of [0.8, 0.88])        fold(at(f, -0.42), at(f, 0.42), s.widths[2] * 0.05, 0.14 * wk)
      }
      // thigh pull creases from the crotch, below the jacket hem
      if (!back) ['l', 'r'].forEach((s, i) => {
        const sg = s === 'l' ? -1 : 1, h = P[s + 'h'], lg = legs[i]
        const yb = Math.max(hm.y + torsoH * 0.14, hemY + torsoH * 0.05)
        for (let j = 0; j < 3; j++)
          fold({ x: hm.x + sg * hipSpan * 0.06, y: yb + torsoH * 0.05 * j },
               { x: lerp(h.x, lg.kn.x, 0.35) + sg * lg.wk * 0.3, y: yb + torsoH * (0.1 + 0.08 * j) },
               sg * torsoH * 0.01, 0.1 * wk)
      })
    }

    // soft drape: long, low-contrast vertical folds that follow the torso
    const dr = model.drape * fb.fold
    if (dr > 0.02) {
      const y0 = sm.y + torsoH * 0.38, y1 = hemY - torsoH * 0.03, ym = (y0 + y1) / 2
      const rnd = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v) }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      for (let i = 0; i < 7; i++) {
        const u = ((i + 0.5) / 7) * 2 - 1 + (rnd(i) - 0.5) * 0.18
        const w = sw * (0.035 + rnd(i + 9) * 0.03)
        const dark = i % 2 === 0
        const rgb = dark ? '0,0,0' : '255,255,255'
        const a = (0.03 + rnd(i + 3) * 0.04) * dr * (dark ? 1 : 0.7)
        const px = y => cxAt(y) + u * hemHalf * 0.8 * (0.85 + 0.15 * (y - y0) / (y1 - y0))
        const gr = ctx.createLinearGradient(0, y0, 0, y1)
        gr.addColorStop(0, `rgba(${rgb},0)`); gr.addColorStop(0.3, `rgba(${rgb},${a})`)
        gr.addColorStop(0.8, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`)
        ctx.strokeStyle = gr
        ctx.beginPath(); ctx.moveTo(px(y0), y0); ctx.lineTo(px(ym), ym); ctx.lineTo(px(y1), y1)
        for (const m of [2.4, 1.4, 0.7]) { ctx.lineWidth = w * m; ctx.stroke() }
      }
    }

    // fabric weave
    if (fb.weave !== 'none' && model.weave > 0.02) {
      const wp = weavePattern(ctx, fb.weave)
      if (wp) {
        if (wp.setTransform && typeof DOMMatrix !== 'undefined') wp.setTransform(new DOMMatrix().scale(clamp(sw * 0.005, 0.35, 1.6)))
        ctx.globalAlpha = 0.6 * model.weave; wash(wp); ctx.globalAlpha = 1
      }
    }

    // cloth grain
    if (sd > 0.01) {
      const pat = grainPattern(ctx)
      if (pat) {
        if (pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix().scale(clamp(sw * 0.006, 0.3, 2)))
        ctx.globalAlpha = clamp(0.22 * sd * fb.grain, 0, 0.5); wash(pat); ctx.globalAlpha = 1
      }
    }

    // the room (live camera): brightness, colour cast and side light
    const lt = opts.light
    if (model.matchLight && lt) {
      const b = typeof lt.brightness === 'number' ? lt.brightness : 1
      if (b < 1) wash(`rgba(0,0,0,${clamp((1 - b) * 0.9, 0, 0.4)})`)
      else if (b > 1) wash(`rgba(255,255,255,${clamp((b - 1) * 0.8, 0, 0.2)})`)
      if (Array.isArray(lt.tint)) {
        const warm = lt.tint[0] - lt.tint[2], a = Math.min(0.14, Math.abs(warm) * 0.8)
        if (a > 0.01) wash(warm > 0 ? `rgba(255,170,90,${a})` : `rgba(90,150,255,${a})`)
      }
      const sl = typeof lt.slope === 'number' ? lt.slope : 0
      if (Math.abs(sl) > 0.005) {
        const gs = ctx.createLinearGradient(sm.x - sw * 0.9, 0, sm.x + sw * 0.9, 0)
        gs.addColorStop(0, `rgba(0,0,0,${sl > 0 ? sl * 1.6 : 0})`); gs.addColorStop(1, `rgba(0,0,0,${sl < 0 ? -sl * 1.6 : 0})`)
        wash(gs)
      }
    }
  }

  ctx.restore()

  if (skel) drawSuitSkeleton(ctx, pts, modelRaw, { labels: opts.skeletonLabels !== false })
  return true
}

/**
 * Fit skeleton: bones and joints from the body points, level guides (shoulder, chest, waist, hip,
 * hem, knee) and a dashed estimate of the body outline, so you can see where the suit sits on
 * the body and how much room it leaves. Safe to call on its own, or through drawSuitModel's
 * `skeleton` option.
 */
export function drawSuitSkeleton(ctx, pts, modelRaw, opts = {}) {
  if (!hasPts(pts)) return false
  const P = normalise(pts)
  const model = resolveSuitModel(modelRaw)
  const g = geometry(P, model)
  if (!g) return false
  const { sm, hm, sw, torsoH, hemY, kneeY, hemHalf } = g
  const labels = opts.labels !== false
  const lw = clamp(sw * 0.013, 1.2, 3.5)
  const BONE = '#f2cf7e', GUIDE = 'rgba(255,255,255,0.85)', HEM = '#ff8a6b'
  const under = (path, w) => { path(); ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = w + 1.6; ctx.stroke() }

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.setLineDash([])

  // 1. level guides
  const x0 = Math.min(P.ls.x - sw * 0.35, hm.x - hemHalf - sw * 0.12), x1 = Math.max(P.rs.x + sw * 0.35, hm.x + hemHalf + sw * 0.12)
  const levels = [['shoulder', sm.y, GUIDE], ['chest', sm.y + torsoH * 0.25, GUIDE], ['waist', sm.y + torsoH * 0.62, GUIDE],
                  ['hip', hm.y, GUIDE], ['hem', hemY, HEM], ['knee', kneeY, GUIDE]]
  const fs = clamp(sw * 0.075, 8, 13)
  ctx.font = `600 ${fs}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.textBaseline = 'middle'
  for (const [name, y, col] of levels) {
    const line = () => { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y) }
    ctx.setLineDash([lw * 2.5, lw * 2.5])
    under(line, 1)
    line(); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke()
    ctx.setLineDash([])
    if (labels) {
      ctx.textAlign = 'right'
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(name, x1 - 2, y - fs * 0.7)
      ctx.fillStyle = col; ctx.fillText(name, x1 - 2, y - fs * 0.7)
    }
  }

  // 2. estimated body outline (shoulders, chest, waist, hips) - dashed
  const half = (w, t) => ({ l: { x: sm.x - w, y: sm.y + torsoH * t }, r: { x: sm.x + w, y: sm.y + torsoH * t } })
  const hs = (P.rh.x - P.lh.x) / 2
  const ring = [half(sw * 0.5, 0), half(sw * 0.46, 0.22), half(Math.max(sw * 0.38, hs * 1.05), 0.64), half(hs * 1.3, 1)]
  const body = [...ring.map(r => r.l), ...ring.slice().reverse().map(r => r.r)]
  const outline = () => tracePoly(ctx, body)
  ctx.setLineDash([lw * 2, lw * 2])
  under(outline, 1)
  outline(); ctx.strokeStyle = 'rgba(160,220,255,0.95)'; ctx.lineWidth = 1.2; ctx.stroke()
  ctx.setLineDash([])

  // 3. bones
  const hd = P.hd || { x: sm.x, y: sm.y - torsoH * 0.45 }
  const headR = sw * 0.19
  const chains = [
    [P.ls, P.rs], [P.ls, P.lh], [P.rs, P.rh], [P.lh, P.rh],
    [P.ls, P.le || null, P.lw || null], [P.rs, P.re || null, P.rw || null],
    [P.lh, P.lk, P.la], [P.rh, P.rk, P.ra],
    [sm, { x: hd.x, y: hd.y + headR }],
  ].map(c => c.filter(Boolean))
  for (const c of chains) {
    if (c.length < 2) continue
    const path = () => { ctx.beginPath(); c.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))) }
    under(path, lw)
    path(); ctx.strokeStyle = BONE; ctx.lineWidth = lw; ctx.stroke()
  }
  const headPath = () => { ctx.beginPath(); ctx.arc(hd.x, hd.y, headR, 0, Math.PI * 2) }
  under(headPath, lw); headPath(); ctx.strokeStyle = BONE; ctx.lineWidth = lw; ctx.stroke()

  // 4. joints
  const jr = clamp(sw * 0.026, 2.2, 5)
  for (const q of [P.ls, P.rs, P.le, P.re, P.lw, P.rw, P.lh, P.rh, P.lk, P.rk, P.la, P.ra]) {
    if (!q) continue
    ctx.beginPath(); ctx.arc(q.x, q.y, jr, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 1.2; ctx.stroke()
  }

  // 5. labels for the body outline
  if (labels) {
    ctx.textAlign = 'left'
    const tx = x0 + 2, ty = sm.y + torsoH * 0.4
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.strokeText('body', tx, ty)
    ctx.fillStyle = 'rgba(160,220,255,0.95)'; ctx.fillText('body', tx, ty)
  }
  ctx.restore()
  return true
}

/** Jacket rectangle used to place pockets: { x0, x1, y0, y1 }, same units as pts. */
export function jacketFrame(pts, modelRaw) {
  if (!pts || !pts.ls || !pts.rs || !pts.lh || !pts.rh || !pts.lk || !pts.rk) return null
  const P = normalise(pts)
  const model = resolveSuitModel(modelRaw)
  const sw = P.rs.x - P.ls.x, hipSpan = P.rh.x - P.lh.x
  const smY = (P.ls.y + P.rs.y) / 2, hmY = (P.lh.y + P.rh.y) / 2, hmX = (P.lh.x + P.rh.x) / 2
  const kneeY = (P.lk.y + P.rk.y) / 2
  const hemY = hmY + model.jacketLen * Math.max(kneeY - hmY, 0)
  const hemHalf = Math.max(Math.max(sw * 0.5, hipSpan * 0.75) * model.ease * model.hemWidth, model.coverBody ? hipSpan * 0.69 : 0)
  return { x0: hmX - hemHalf, x1: hmX + hemHalf, y0: smY, y1: hemY }
}