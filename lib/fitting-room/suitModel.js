/**
 * lib/fitting-room/suitModel.js
 *
 * "Fitted" suit preview: a drawn jacket, sleeves, trousers, shirt, tie, pockets.
 * No DOM lookups, no React. Same function is meant to be used by the admin editor
 * (synthetic body) and the fitting room (detected landmarks).
 *
 * Saved shape (inside gown.tryonCalibration):
 *   suitMode: 'photo' | 'model'          // missing = photo
 *   suitModel: {
 *     color, swatch (url), swatchScale,
 *     vDepth, shirtColor, jacketLen, lapelW,
 *     tie: { type: 'none'|'necktie'|'bowtie', color },
 *     pockets: [{ u, v }]               // 0..1 across / down the jacket
 *   }
 *
 * Input points (logical px): ls rs lh rh lk rk la ra  (required)
 *                            le re lw rw              (optional; arms hang straight if missing)
 */

const clamp = (v, a, b) => Math.min(Math.max(v, a), b)
const lerp  = (a, b, t) => a + (b - a) * t
const num   = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

export const TIE_TYPES = [
  { id: 'none',     label: 'None' },
  { id: 'necktie',  label: 'Necktie' },
  { id: 'bowtie',   label: 'Bow tie' },
]
export const POCKET_MAX = 4

export const SUIT_DEFAULTS = {
  color: '#2b2f3a', swatch: '', swatchScale: 1,
  vDepth: 0.45, shirtColor: '#f4f1ea', jacketLen: 0.35, lapelW: 0.12,
  tie: { type: 'none', color: '#7a1f2b' },
  pockets: [],
}
export const SUIT_FIELDS = [
  { k: 'vDepth',      label: 'V depth',      min: 0,    max: 1,   step: 0.01, hint: 'How deep the jacket opens at the front. 0 = buttoned high, 1 = open to the belly.' },
  { k: 'jacketLen',   label: 'Jacket length', min: 0,   max: 0.8, step: 0.01, hint: 'Where the jacket hem ends, from the hips (0) toward the knees (0.8).' },
  { k: 'lapelW',      label: 'Lapel width',  min: 0.04, max: 0.3, step: 0.01, hint: 'Width of the lapels, relative to the shoulder span.' },
  { k: 'swatchScale', label: 'Pattern size', min: 0.3,  max: 3,   step: 0.05, hint: 'Size of the repeating fabric swatch. Only used when a swatch is set.' },
]

const isHex = s => typeof s === 'string' && /^#[0-9a-f]{3,8}$/i.test(s)

/** Clamp and fill in a saved suitModel so the drawing code never sees bad values. */
export function resolveSuitModel(raw) {
  const r = raw || {}
  const tie = r.tie || {}
  const pockets = (Array.isArray(r.pockets) ? r.pockets : [])
    .filter(p => p && Number.isFinite(p.u) && Number.isFinite(p.v))
    .slice(0, POCKET_MAX)
    .map(p => ({ u: clamp(p.u, 0, 1), v: clamp(p.v, 0, 1) }))
  return {
    color:       isHex(r.color) ? r.color : SUIT_DEFAULTS.color,
    swatch:      typeof r.swatch === 'string' ? r.swatch : '',
    swatchScale: clamp(num(r.swatchScale, 1), 0.3, 3),
    vDepth:      clamp(num(r.vDepth, SUIT_DEFAULTS.vDepth), 0, 1),
    shirtColor:  isHex(r.shirtColor) ? r.shirtColor : SUIT_DEFAULTS.shirtColor,
    jacketLen:   clamp(num(r.jacketLen, SUIT_DEFAULTS.jacketLen), 0, 0.8),
    lapelW:      clamp(num(r.lapelW, SUIT_DEFAULTS.lapelW), 0.04, 0.3),
    tie: {
      type:  TIE_TYPES.some(t => t.id === tie.type) ? tie.type : 'none',
      color: isHex(tie.color) ? tie.color : SUIT_DEFAULTS.tie.color,
    },
    pockets,
  }
}

/* ── drawing helpers ─────────────────────────────────────────────────────── */

function tracePoly(ctx, p) {
  ctx.beginPath()
  p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
  ctx.closePath()
}

function bbox(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const q of p) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y }
  return { x0, y0, x1, y1 }
}

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

// Fill, cheap edge shading (one gradient, clipped), and an outline.
function paint(ctx, path, fill, { edge = 0.2, stroke = true } = {}) {
  const bb = bbox(path)
  tracePoly(ctx, path)
  ctx.fillStyle = fill
  ctx.fill()
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

// Swatch pattern when an image is supplied, otherwise the plain colour.
function makeFill(ctx, model, swatchImg, sw) {
  if (swatchImg) {
    try {
      const pat = ctx.createPattern(swatchImg, 'repeat')
      const iw = swatchImg.naturalWidth || swatchImg.width
      if (pat && iw > 0) {
        const k = (sw * 0.28 * model.swatchScale) / iw
        if (pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix().scale(k))
        return pat
      }
    } catch { /* fall through to colour */ }
  }
  return model.color
}

// Make sure "l" is the side with the smaller x, whatever the caller (mirrored camera) sends.
function normalise(pts) {
  const flip = pts.ls.x > pts.rs.x
  const g = k => pts[(flip ? { l:'r', r:'l' }[k[0]] : k[0]) + k.slice(1)]
  const o = {}
  for (const base of ['s', 'e', 'w', 'h', 'k', 'a']) { o['l' + base] = g('l' + base); o['r' + base] = g('r' + base) }
  return o
}

/**
 * Draw the fitted suit.
 *   ctx      2D context (already transformed to logical px)
 *   pts      body points, see header
 *   modelRaw suitModel object (raw or resolved)
 *   opts     { view: 'front'|'back', opacity: 0..1, swatchImg: Image|Canvas|null }
 * Returns false when the points are unusable (caller keeps the photo).
 */
export function drawSuitModel(ctx, pts, modelRaw, opts = {}) {
  if (!pts || !pts.ls || !pts.rs || !pts.lh || !pts.rh || !pts.lk || !pts.rk || !pts.la || !pts.ra) return false
  const P = normalise(pts)
  const model = resolveSuitModel(modelRaw)
  const back = opts.view === 'back'
  const opacity = num(opts.opacity, 1)

  const sm = { x: (P.ls.x + P.rs.x) / 2, y: (P.ls.y + P.rs.y) / 2 }
  const hm = { x: (P.lh.x + P.rh.x) / 2, y: (P.lh.y + P.rh.y) / 2 }
  const sw = P.rs.x - P.ls.x
  const torsoH = hm.y - sm.y
  const hipSpan = P.rh.x - P.lh.x
  if (!(sw > 4) || !(torsoH > 4) || !(hipSpan > 2)) return false

  const fill = makeFill(ctx, model, opts.swatchImg, sw)
  const kneeY = (P.lk.y + P.rk.y) / 2
  const hemY = hm.y + model.jacketLen * Math.max(kneeY - hm.y, 0)
  const collarHalf = sw * 0.14
  const collarY = sm.y - torsoH * 0.06
  const apexY = sm.y + torsoH * (0.18 + 0.55 * model.vDepth)
  const apex = { x: lerp(sm.x, hm.x, (apexY - sm.y) / torsoH), y: apexY }
  const hemHalf = Math.max(sw * 0.5, hipSpan * 0.75)

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = 'source-over'
  ctx.lineJoin = 'round'

  /* 1. trousers */
  const legTop = hm.y - torsoH * 0.08
  for (const s of ['l', 'r']) {
    const h = P[s + 'h'], k = P[s + 'k'], a = P[s + 'a']
    const chain  = [{ x: h.x, y: legTop }, h, k, a]
    const widths = [hipSpan * 0.95, hipSpan * 0.95, hipSpan * 0.72, hipSpan * 0.6]
    paint(ctx, tube(chain, widths), fill, { edge: 0.22 })
    ctx.beginPath(); ctx.moveTo(h.x, hm.y); ctx.lineTo(k.x, k.y); ctx.lineTo(a.x, a.y)   // crease
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1; ctx.stroke()
  }
  const wl = P.lh.x - hipSpan * 0.475, wr = P.rh.x + hipSpan * 0.475
  paint(ctx, [{ x: wl, y: legTop }, { x: wr, y: legTop }, { x: wr, y: hm.y + torsoH * 0.18 }, { x: wl, y: hm.y + torsoH * 0.18 }],
        fill, { edge: 0.1, stroke: false })

  /* 2. shirt (what shows in the V) + collar band */
  if (!back) {
    paint(ctx, [
      { x: sm.x - collarHalf * 1.15, y: collarY - torsoH * 0.02 },
      { x: sm.x + collarHalf * 1.15, y: collarY - torsoH * 0.02 },
      { x: apex.x + collarHalf * 0.9, y: apex.y + torsoH * 0.06 },
      { x: apex.x - collarHalf * 0.9, y: apex.y + torsoH * 0.06 },
    ], model.shirtColor, { edge: 0.08, stroke: false })
  }
  paint(ctx, [
    { x: sm.x - collarHalf, y: collarY }, { x: sm.x + collarHalf, y: collarY },
    { x: sm.x + collarHalf * 0.85, y: collarY - torsoH * 0.05 }, { x: sm.x - collarHalf * 0.85, y: collarY - torsoH * 0.05 },
  ], back ? fill : model.shirtColor, { edge: 0.1 })

  /* 3. necktie (under the jacket, so the V edge covers its sides) */
  if (!back && model.tie.type === 'necktie') {
    const ky = collarY + torsoH * 0.06, kw = sw * 0.07, kh = torsoH * 0.05
    const cxAt = y => lerp(sm.x, hm.x, clamp((y - sm.y) / torsoH, 0, 1))
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

  /* 4. jacket body (V notch left open in front view) */
  const side = sg => [
    { x: sm.x + sg * (sw / 2 + sw * 0.06), y: sm.y - torsoH * 0.01 },
    { x: sm.x + sg * sw * 0.5,  y: sm.y + torsoH * 0.25 },
    { x: hm.x + sg * sw * 0.45, y: sm.y + torsoH * 0.65 },
    { x: hm.x + sg * hemHalf,   y: hemY },
  ]
  const Lk = side(-1), Rk = side(1)
  const top = back
    ? [{ x: sm.x - collarHalf, y: collarY }, { x: sm.x + collarHalf, y: collarY }]
    : [{ x: sm.x - collarHalf, y: collarY }, apex, { x: sm.x + collarHalf, y: collarY }]
  paint(ctx, [Lk[0], ...top, Rk[0], Rk[1], Rk[2], Rk[3], Lk[3], Lk[2], Lk[1]], fill, { edge: 0.24 })
  if (back) {
    ctx.beginPath(); ctx.moveTo(sm.x, collarY); ctx.lineTo(hm.x, hemY)                 // centre-back seam
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke()
  }

  /* 5. lapels */
  if (!back) {
    const lw = model.lapelW * sw
    for (const sg of [-1, 1]) {
      const neck = { x: sm.x + sg * collarHalf, y: collarY }
      const mid  = { x: apex.x + sg * lw * 1.6, y: lerp(collarY, apex.y, 0.55) }
      paint(ctx, [neck, { x: neck.x + sg * lw, y: collarY + torsoH * 0.03 }, mid, apex], fill, { edge: 0.06 })
      tracePoly(ctx, [neck, { x: neck.x + sg * lw, y: collarY + torsoH * 0.03 }, mid, apex])
      ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fill()                                    // lapels read slightly darker
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
      paint(ctx, [{ x: px - pw / 2, y: py - ph / 2 }, { x: px + pw / 2, y: py - ph / 2 }, { x: px + pw / 2, y: py + ph / 2 }, { x: px - pw / 2, y: py + ph / 2 }], fill, { edge: 0.1 })
      ctx.beginPath(); ctx.moveTo(px - pw / 2, py + ph / 2 + 1); ctx.lineTo(px + pw / 2, py + ph / 2 + 1)
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1.5; ctx.stroke()           // flap shadow
    }
  }

  /* 8. sleeves along the arms (drawn last so arms sit over the jacket) */
  for (const s of ['l', 'r']) {
    const sh = P[s + 's']
    const el = P[s + 'e'] || { x: sh.x, y: sh.y + torsoH * 0.52 }
    const wr = P[s + 'w'] || { x: sh.x, y: sh.y + torsoH * 0.96 }
    const chain = [{ x: sh.x, y: sh.y - torsoH * 0.01 }, sh, el, wr]
    paint(ctx, tube(chain, [sw * 0.2, sw * 0.2, sw * 0.16, sw * 0.13]), fill, { edge: 0.22 })
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
  const hemHalf = Math.max(sw * 0.5, hipSpan * 0.75)
  return { x0: hmX - hemHalf, x1: hmX + hemHalf, y0: smY, y1: hemY }
}