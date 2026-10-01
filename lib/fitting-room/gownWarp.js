/**
 * lib/fitting-room/gownWarp.js
 * Band-based gown warp + One Euro keypoint filter. No React.
 */

const BANDS = 48
const profiles = new WeakMap()
let scratchCanvas = null

const clamp  = (v, a, b) => Math.min(Math.max(v, a), b)
const lerp   = (a, b, t) => a + (b - a) * t
const smooth = t => t * t * (3 - 2 * t)

function scratch(w, h) {
  if (!scratchCanvas) scratchCanvas = document.createElement('canvas')
  if (scratchCanvas.width !== w || scratchCanvas.height !== h) {
    scratchCanvas.width = w; scratchCanvas.height = h
  } else {
    scratchCanvas.getContext('2d').clearRect(0, 0, w, h)
  }
  return scratchCanvas
}

// Measures the gown's own silhouette (left/right edge per band) from its alpha.
// Returns null when the image has no transparency or the canvas is tainted.
function getProfile(img) {
  if (profiles.has(img)) return profiles.get(img)
  let profile = null
  try {
    const iw = img.naturalWidth || img.width
    const ih = img.naturalHeight || img.height
    const sw = 200, sh = Math.max(BANDS, Math.round(200 * ih / iw))
    const c = document.createElement('canvas'); c.width = sw; c.height = sh
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(img, 0, 0, sw, sh)
    const { data } = g.getImageData(0, 0, sw, sh)
    const A = (x, y) => data[(y * sw + x) * 4 + 3]
    const hasAlpha = A(0, 0) < 24 && A(sw - 1, 0) < 24 && A(0, sh - 1) < 24 && A(sw - 1, sh - 1) < 24
    if (hasAlpha) {
      const left = [], right = []
      const rowsPer = sh / BANDS
      for (let b = 0; b < BANDS; b++) {
        const y0 = Math.floor(b * rowsPer)
        const y1 = Math.min(sh, Math.max(y0 + 1, Math.floor((b + 1) * rowsPer)))
        let lo = sw, hi = -1
        for (let y = y0; y < y1; y++) {
          for (let x = 0; x < sw; x++)      if (A(x, y) > 24) { if (x < lo) lo = x; break }
          for (let x = sw - 1; x >= 0; x--) if (A(x, y) > 24) { if (x > hi) hi = x; break }
        }
        left.push(hi < 0 ? null : lo * iw / sw)
        right.push(hi < 0 ? null : (hi + 1) * iw / sw)
      }
      // fill empty bands from neighbours
      for (let b = 1; b < BANDS; b++)         if (left[b] == null && left[b - 1] != null) { left[b] = left[b - 1]; right[b] = right[b - 1] }
      for (let b = BANDS - 2; b >= 0; b--)    if (left[b] == null && left[b + 1] != null) { left[b] = left[b + 1]; right[b] = right[b + 1] }
      if (left.every(v => v != null)) {
        // Narrowest band in the upper-middle of the image = waist
        let wb = Math.floor(BANDS * 0.08), best = Infinity
        for (let b = Math.floor(BANDS * 0.08); b <= Math.floor(BANDS * 0.6); b++) {
          const wd = right[b] - left[b]
          if (wd < best) { best = wd; wb = b }
        }
        profile = { iw, ih, left, right, waistFrac: (wb + 0.5) / BANDS }
      }
    }
  } catch { profile = null }
  profiles.set(img, profile)
  return profile
}

// Returns true when it drew the gown; false means "use the old drawing".
export function drawGownWarped(ctx, img, layout, opacity, size) {
    const { topY, bottomY, sm, hm, sw, hw, torsoH, cal = {}, dx = 0, dy: dyOff = 0, scaleX = 1 } = layout
  if (!sm || !hm) return false
  const prof = getProfile(img)
  if (!prof) return false

  const w = cal.warp || {}
  const shoulderEase = w.shoulderEase ?? cal.shoulderPad ?? 1.15
  const skirtMult    = (cal.skirtFlare ?? 1.10) / 1.10   // 1.10 = editor default, so unset gowns are unchanged
  const waistEase    = w.waistEase    ?? 1.05
  const hipEase      = w.hipEase      ?? 1.10
  const waistRatio   = w.waistRatio   ?? 0.72     // waist width / shoulder width
  const wf           = clamp(w.waistRow ?? prof.waistFrac, 0.1, 0.8)

  const waistY = sm.y + torsoH * 0.65 + dyOff
  const hipY   = hm.y + dyOff
  if (!(bottomY > hipY + 4 && waistY > topY + 4 && hipY > waistY)) return false

  const shoulderW = sw * shoulderEase
  const waistW    = sw * waistRatio * waistEase
  const hipW      = hw * hipEase

  // source fraction -> destination y (top -> waist -> hem)
  const dy = f => f <= wf
    ? lerp(topY, waistY, f / wf)
    : lerp(waistY, bottomY, (f - wf) / (1 - wf))

  const bandW = f => {
    const b = clamp(Math.floor(f * BANDS), 0, BANDS - 1)
    return prof.right[b] - prof.left[b]
  }
  const hf    = wf + ((hipY - waistY) / (bottomY - waistY)) * (1 - wf)
  const kV    = (bottomY - waistY) / (prof.ih * (1 - wf))        // uniform (height-driven) scale
  const kHip  = clamp(hipW / Math.max(bandW(hf), 1), kV * 0.5, kV * 2)

  const smY = sm.y + dyOff
  const bodyW = y => {
    if (y <= smY)     return shoulderW
    if (y <= waistY)  return lerp(shoulderW, waistW, smooth((y - smY) / (waistY - smY)))
    return lerp(waistW, hipW, smooth((y - waistY) / (hipY - waistY)))
  }
  // centre line follows the torso lean, then hangs straight below the hips
  const cLine = y => lerp(sm.x, hm.x, clamp((y - smY) / (hm.y - sm.y), 0, 1)) + dx

  const dpr = window.devicePixelRatio || 1
  const vw  = size?.w ?? ctx.canvas.width  / dpr
  const vh  = size?.h ?? ctx.canvas.height / dpr
  const oc  = scratch(vw, vh)
  const octx = oc.getContext('2d')

  for (let b = 0; b < BANDS; b++) {
    const f0 = b / BANDS, f1 = (b + 1) / BANDS
    const y0 = dy(f0), y1 = dy(f1)
    const gl = prof.left[b], gw = prof.right[b] - gl
    if (gw <= 0 || y1 <= y0) continue
    const cy = (y0 + y1) / 2

    let tw
    if (cy <= hipY) {
      tw = bodyW(cy)
    } else {
      const t = smooth(clamp((cy - hipY) / ((bottomY - hipY) * 0.5), 0, 1))
      tw = gw * lerp(kHip, kV, t)
    }

    tw *= scaleX
    if (cy > hipY) tw *= skirtMult
    const sy = f0 * prof.ih
    const sh = Math.min(prof.ih / BANDS + 1, prof.ih - sy)
    octx.drawImage(img, gl, sy, gw, sh, cLine(cy) - tw / 2, y0, tw, (y1 - y0) + 1)
  }

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(oc, 0, 0, vw, vh)
  ctx.restore()
  return true
}

// One Euro filter for keypoints. Units are pixels, so tune beta by eye.
export function createKpFilter({ minCutoff = 1.0, beta = 0.007, dCutoff = 1.0 } = {}) {
  let prev = null, tPrev = 0
  const alpha = (cutoff, dt) => 1 / (1 + (1 / (2 * Math.PI * cutoff)) / dt)
  return {
    reset() { prev = null; tPrev = 0 },
    apply(kps, tMs) {
      const dt = tPrev ? Math.max((tMs - tPrev) / 1000, 0.001) : 1 / 30
      tPrev = tMs
      const out = kps.map((k, i) => {
        const p = prev?.[i]
        if (!p) return { ...k, dx: 0, dy: 0 }
        const ad  = alpha(dCutoff, dt)
        const dx  = p.dx + ad * ((k.x - p.x) / dt - p.dx)
        const dyv = p.dy + ad * ((k.y - p.y) / dt - p.dy)
        const a   = alpha(minCutoff + beta * Math.hypot(dx, dyv), dt)
        return { ...k, x: p.x + a * (k.x - p.x), y: p.y + a * (k.y - p.y), dx, dy: dyv }
      })
      prev = out
      return out
    },
  }
}