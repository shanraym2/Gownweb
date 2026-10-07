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
]
export const BREAST_TYPES = [
  { id: 'single', label: 'Single-breasted' },
  { id: 'double', label: 'Double-breasted' },
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
export const POCKET_MAX = 4

export const SUIT_DEFAULTS = {
  color: '#2b2f3a', swatch: '', swatchScale: 1,
  vDepth: 0.45, shirtColor: '#f4f1ea', jacketLen: 0.35, lapelW: 0.12,
  ease: 1.25, trouserEase: 1.3, legHang: 0.5,
  collar: 'point', collarSize: 1,
  lapel: 'notch', breast: 'single', buttons: 2,
  hem: 'rounded', hemShadow: 0.6, vent: 'center',
  waist: 0.25, shoulder: 0.5,
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
  { k: 'ease',        label: 'Jacket and sleeve ease', min: 0.8, max: 1.8, step: 0.01, hint: 'How loose the jacket and sleeves are. 0.8 = tight, 1.25 = comfortable, 1.8 = oversized.' },
  { k: 'waist',       label: 'Waist suppression', min: 0, max: 1, step: 0.05, hint: 'How much the jacket is taken in at the waist. 0 = boxy, 1 = very shaped.' },
  { k: 'shoulder',    label: 'Shoulder width',   min: 0, max: 1, step: 0.05, hint: 'How far the jacket shoulder sticks out past your own shoulder. 0 = natural, 1 = strong padded shoulder.' },
  { k: 'trouserEase', label: 'Trouser ease',  min: 0.8, max: 2,   step: 0.01, hint: 'How wide the trouser legs are.' },
  { k: 'legHang',     label: 'Trousers hang straight', min: 0, max: 1, step: 0.05, hint: '0 = trousers follow your leg angle exactly. 1 = they hang straight down from the hips.' },
  { k: 'vDepth',      label: 'V depth',      min: 0,    max: 1,   step: 0.01, hint: 'How deep the jacket opens at the front. 0 = buttoned high, 1 = open to the belly.' },
  { k: 'jacketLen',   label: 'Jacket length', min: 0,   max: 0.8, step: 0.01, hint: 'Where the jacket hem ends, from the hips (0) toward the knees (0.8).' },
  { k: 'hemShadow',   label: 'Hem shadow',   min: 0,    max: 1,   step: 0.05, hint: 'Shadow the jacket casts on the trousers under the hem. It is what separates the jacket from the trousers, so keep it above 0 unless the trousers are a very different colour.' },
  { k: 'lapelW',      label: 'Lapel width',  min: 0.04, max: 0.3, step: 0.01, hint: 'Width of the lapels, relative to the shoulder span.' },
  { k: 'collarSize',  label: 'Collar size',  min: 0.6,  max: 1.5, step: 0.05, hint: 'Height of the shirt collar and length of its points.' },
  { k: 'buttons',     label: 'Buttons',      min: 0,    max: 4,   step: 1,    hint: 'Single-breasted: number of buttons. Double-breasted: number of rows (two buttons per row).' },
  { k: 'swatchScale', label: 'Pattern size', min: 0.3,  max: 3,   step: 0.05, hint: 'Size of the repeating fabric swatch. Only used when a swatch is set.' },
]
// Dropdowns, toggles and colours, so the editor can render them from data
export const SUIT_OPTIONS = [
  { k: 'collar',      label: 'Shirt collar', options: COLLAR_STYLES },
  { k: 'lapel',       label: 'Lapel',        options: LAPEL_STYLES },
  { k: 'breast',      label: 'Front',        options: BREAST_TYPES },
  { k: 'hem',         label: 'Jacket hem',   options: HEM_STYLES },
  { k: 'vent',        label: 'Back vent',    options: VENT_STYLES },
  { k: 'pocketStyle', label: 'Pocket style', options: POCKET_STYLES },
]
export const SUIT_TOGGLES = [
  { k: 'cuffs', label: 'Show shirt cuffs at the wrists' },
]
export const SUIT_COLORS = [
  { k: 'liningColor', label: 'Lining (hem edge and vent)' },
  { k: 'buttonColor', label: 'Buttons' },
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
function tube(chain, widths) {
  const n = chain.length, A = [], B = []
  for (let i = 0; i < n; i++) {
    const a = chain[Math.max(i - 1, 0)], b = chain[Math.min(i + 1, n - 1)]
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1
    const nx = -dy / len, ny = dx / len, h = widths[i] / 2
    A.push({ x: chain[i].x + nx * h, y: chain[i].y + ny * h })
    B.push({ x: chain[i].x - nx * h, y: chain[i].y - ny * h })
  }
  return [...A, ...B.reverse()]
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

// Fill, cheap edge shading (one gradient, clipped), and an outline.
function paint(ctx, path, fill, { edge = 0.2, stroke = true } = {}) {
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
    const g = ctx.createLinearGradient(bb.x0, 0, bb.x1, 0)
    g.addColorStop(0,    `rgba(0,0,0,${edge})`)
    g.addColorStop(0.28, 'rgba(0,0,0,0)')
    g.addColorStop(0.72, 'rgba(0,0,0,0)')
    g.addColorStop(1,    `rgba(0,0,0,${edge})`)
    ctx.fillStyle = g
    ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0)
    ctx.restore()
  }
  if (stroke) {
    tracePoly(ctx, path)
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke()
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
  const collarHalf = sw * 0.14
  const collarY = sm.y - torsoH * 0.06
  const apexY = sm.y + torsoH * (0.18 + 0.55 * model.vDepth)
  const apex = { x: lerp(sm.x, hm.x, (apexY - sm.y) / torsoH), y: apexY }
  const E = model.ease
  const Ec = 1 + (E - 1) * 0.6                   // chest opens less than the waist and hem
  const hemHalf = Math.max(sw * 0.5, hipSpan * 0.75) * E
  return { sm, hm, sw, torsoH, hipSpan, kneeY, hemY, collarHalf, collarY, apex, E, Ec, hemHalf }
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
 */
function jacketShape(g, model, back) {
  const { sm, hm, sw, torsoH, hemY, collarHalf, collarY, apex, E, Ec, hemHalf } = g
  const pad = sw * (0.02 + 0.08 * model.shoulder)   // 0.5 -> the original 0.06
  const side = sg => [
    { x: sm.x + sg * (sw / 2 + pad), y: sm.y - torsoH * 0.01 },
    { x: sm.x + sg * sw * 0.5 * Ec,  y: sm.y + torsoH * 0.25 },
    { x: hm.x + sg * sw * 0.45 * E * (1 - model.waist * 0.14), y: sm.y + torsoH * 0.65 },
    { x: hm.x + sg * hemHalf,   y: hemY },
  ]
  const Lk = side(-1), Rk = side(1)
  const top = back
    ? [{ x: sm.x - collarHalf, y: collarY }, { x: sm.x + collarHalf, y: collarY }]
    : [{ x: sm.x - collarHalf, y: collarY }, apex, { x: sm.x + collarHalf, y: collarY }]

  // bottom edge, with the two outer corners rounded
  const yAt = hemFn(g, model, back)
  const r = sw * 0.05
  const x0 = Lk[3].x, x1 = Rk[3].x
  const cL = quad(toward(Lk[3], Lk[2], r), { x: x0, y: yAt(x0) }, { x: x0 + r, y: yAt(x0 + r) }, 4)
  const cR = quad({ x: x1 - r, y: yAt(x1 - r) }, { x: x1, y: yAt(x1) }, toward(Rk[3], Rk[2], r), 4)
  const mid = []
  const N = 44
  for (let i = 0; i <= N; i++) {
    const x = lerp(x0 + r, x1 - r, i / N)
    mid.push({ x, y: yAt(x) })
  }
  const hem = [...cL, ...mid, ...cR]                // left -> right
  const path = [Lk[0], ...top, Rk[0], Rk[1], Rk[2], ...hem.slice().reverse(), Lk[2], Lk[1]]
  return { path, hem, yAt, Lk, Rk }
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
export function drawSuitModel(ctx, pts, modelRaw, opts = {}) {
  if (!hasPts(pts)) return false
  const P = normalise(pts)
  const model = resolveSuitModel(modelRaw)
  const g = geometry(P, model)
  if (!g) return false
  const back = opts.view === 'back'
  const skel = opts.skeleton === true ? 'ghost' : (opts.skeleton || false)
  const opacity = num(opts.opacity, 1) * (skel === 'ghost' ? 0.55 : 1)
  const { sm, hm, sw, torsoH, hipSpan, hemY, collarHalf, collarY, apex, hemHalf } = g
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
  if (!back) {
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
  const collarFrame = mergeBox(bbox(bandPoly), ...(flaps.length ? flaps.map(bbox) : [bbox(bandPoly)]))
  const shirtFrame = { x0: sm.x - collarHalf * 1.4, x1: sm.x + collarHalf * 1.4, y0: bandTop, y1: apex.y + torsoH * 0.08 }
  const fillCollar = makeFill(ctx, model.parts.collar, imgs.collar, sw, collarFrame)
  const fillShirt  = makeFill(ctx, model.parts.shirt,  imgs.shirt,  sw, shirtFrame)
  // a cuff is too small to show a stretched photo, so a masked shirt falls back to its colour
  const fillCuff = model.parts.shirt.fit ? model.parts.shirt.color : makeFill(ctx, model.parts.shirt, imgs.shirt, sw, null)

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = 'source-over'
  ctx.lineJoin = 'round'

  /* 1. trousers */
  const legTop = hm.y - torsoH * 0.08
  const trouserPolys = []
  for (const s of ['l', 'r']) {
    const h = P[s + 'h'], k0 = P[s + 'k'], a0 = P[s + 'a']
    const T = model.trouserEase, hang = model.legHang
    const kn = { x: lerp(k0.x, h.x, hang * 0.6), y: k0.y }
    const an = { x: lerp(a0.x, h.x, hang * 0.6), y: a0.y }
    const chain  = [{ x: h.x, y: legTop }, h, kn, an]
    const widths = [hipSpan * 0.95 * T, hipSpan * 0.95 * T, hipSpan * 0.78 * T, hipSpan * 0.68 * T]
    const legPath = tube(chain, widths)
    trouserPolys.push(legPath)
    paint(ctx, legPath, makeFill(ctx, model.parts[s + 'Leg'], imgs[s + 'Leg'], sw, bbox(legPath)), { edge: 0.22 })
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
    castShadow(ctx, jacket.path, { a: 0.7 * model.hemShadow, blur: torsoH * 0.05, dy: torsoH * 0.03, k })
    ctx.restore()
  }

  /* 2. shirt (what shows in the V) + neck band */
  if (!back) {
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
  paint(ctx, bandPoly, fillCollar, { edge: 0.1 })
  if (!back && style === 'band') {                        // mandarin collar: a small opening at the front
    ctx.beginPath(); ctx.moveTo(sm.x, bandTop); ctx.lineTo(sm.x, collarY)
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.stroke()
  }

  /* 3. necktie (under the jacket, so the V edge covers its sides) */
  if (!back && model.tie.type === 'necktie') {
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
  for (const f of flaps) {
    castShadow(ctx, f, { a: 0.35, blur: sw * 0.02, dy: sw * 0.012, k })
    paint(ctx, f, fillCollar, { edge: 0.1 })
  }
  for (const d of buttonDots) {
    ctx.beginPath(); ctx.arc(d.x, d.y, Math.max(0.9, sw * 0.007), 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.7; ctx.stroke()
  }

  /* 4. jacket body (V notch left open in front view) */
  paint(ctx, jacket.path, fillTorso, { edge: 0.24 })
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
    const hem = jacket.hem
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

  /* 5. lapels (front) */
  if (!back) {
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
  if (!back) {
    const bot = jacket.yAt(hm.x)
    const dbl = model.breast === 'double'
    const edgeX = dbl ? -sw * 0.15 : 0
    // the front edge: straight down from the V, with a thin shadow so the two fronts read as separate layers
    const line = [{ x: apex.x + edgeX, y: apex.y }, { x: hm.x + edgeX, y: hm.y }, { x: hm.x + edgeX, y: bot }]
    if (dbl) line.splice(1, 0, { x: apex.x + edgeX, y: apex.y + torsoH * 0.05 })
    ctx.beginPath(); line.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
    ctx.strokeStyle = 'rgba(0,0,0,0.38)'; ctx.lineWidth = 1.2; ctx.stroke()
    ctx.beginPath(); line.forEach((q, i) => (i ? ctx.lineTo(q.x + 1.2, q.y) : ctx.moveTo(q.x + 1.2, q.y)))
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke()

    // buttons, counted up from the waist button
    const rb = Math.max(1.6, sw * 0.02)
    const yW = sm.y + torsoH * 0.64, step = torsoH * 0.13
    for (let i = 0; i < model.buttons; i++) {
      const y = yW - i * step
      if (y < apex.y + torsoH * 0.02 || y > hemY - torsoH * 0.05) continue
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

  /* 6. bow tie (on top, at the collar) */
  if (!back && model.tie.type === 'bowtie') {
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
    for (const p of model.pockets) {
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

  /* 8. sleeves along the arms (drawn last so arms sit over the jacket), with shirt cuffs */
  for (const s of ['l', 'r']) {
    const sh = P[s + 's']
    const el = P[s + 'e'] || { x: sh.x, y: sh.y + torsoH * 0.52 }
    const wrist = P[s + 'w'] || { x: sh.x, y: sh.y + torsoH * 0.96 }
    const chain = [{ x: sh.x, y: sh.y - torsoH * 0.01 }, sh, el, wrist]
    const armPath = tube(chain, [sw * 0.2 * E, sw * 0.2 * E, sw * 0.16 * E, sw * 0.13 * E])
    castShadow(ctx, armPath, { a: 0.22, blur: sw * 0.03, dx: 0, dy: sw * 0.012, k })    // soft contact shadow on the jacket
    paint(ctx, armPath, makeFill(ctx, model.parts[s + 'Arm'], imgs[s + 'Arm'], sw, bbox(armPath)), { edge: 0.22 })
    if (model.cuffs) {
      const dir = toward(el, wrist, 1)
      const dx = dir.x - el.x, dy = dir.y - el.y
      const cl = sw * 0.05, cw = sw * 0.13 * E * 0.86
      const end = { x: wrist.x + dx * cl, y: wrist.y + dy * cl }
      paint(ctx, tube([wrist, end], [cw, cw * 0.94]), fillCuff, { edge: 0.15 })
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
  const hemHalf = Math.max(sw * 0.5, hipSpan * 0.75) * model.ease
  return { x0: hmX - hemHalf, x1: hmX + hemHalf, y0: smY, y1: hemY }
}