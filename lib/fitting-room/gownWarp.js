/**
 * lib/fitting-room/gownWarp.js
 * Band-based gown warp + One Euro keypoint filter. No React.
 */

const BANDS = 48
const profiles = new WeakMap()
const sway = { off: 0, last: null }
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
export function getProfile(img) {
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
      let rTop = 0, rBot = sh - 1
      topScan: for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (A(x, y) > 24) { rTop = y; break topScan }
      botScan: for (let y = sh - 1; y >= 0; y--) for (let x = 0; x < sw; x++) if (A(x, y) > 24) { rBot = y; break botScan }
      const rowsPer = (rBot - rTop + 1) / BANDS
      for (let b = 0; b < BANDS; b++) {
        const y0 = rTop + Math.floor(b * rowsPer)
        const y1 = Math.min(rBot + 1, Math.max(y0 + 1, rTop + Math.floor((b + 1) * rowsPer)))
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
        let wb = Math.floor(BANDS * 0.18), best = Infinity
        for (let b = Math.floor(BANDS * 0.18); b <= Math.floor(BANDS * 0.6); b++) {
          const wd = right[b] - left[b]
          if (wd < best) { best = wd; wb = b }
        }
        profile = { iw, ih, left, right, waistFrac: (wb + 0.5) / BANDS, srcTop: rTop * ih / sh, srcH: (rBot - rTop + 1) * ih / sh }
      }
    }
  } catch { profile = null }
  profiles.set(img, profile)
  return profile
}

// Returns true when it drew the gown; false means "use the old drawing".
// ── High-quality warp: fine strips, interpolated profile, cached pre-scaled image ──
const works = new WeakMap()

function getWork(img, prof) {
  let w = works.get(img)
  if (w) return w
  const srcTop = prof.srcTop ?? 0
  const srcH   = prof.srcH   ?? prof.ih
  const k  = Math.min(1, 900 / srcH)
  const cw = Math.max(1, Math.round(prof.iw * k))
  const ch = Math.max(1, Math.round(srcH * k))
  const c  = document.createElement('canvas')
  c.width = cw; c.height = ch
  const g = c.getContext('2d')
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'
  g.drawImage(img, 0, srcTop, prof.iw, srcH, 0, 0, cw, ch)
  w = { c }
  works.set(img, w)
  return w
}

export function drawGownWarped(ctx, img, layout, opacity, size) {
  const { topY, bottomY, sm, hm, sw, hw, torsoH, cal = {}, dx = 0, dy: dyOff = 0, scaleX = 1 } = layout
  if (!sm || !hm) return false
  const prof = getProfile(img)
  if (!prof) return false

  const w = { ...(cal.warp || {}) }
  if (cal.waistRow  != null) w.waistRow  = cal.waistRow
  if (cal.waistEase != null) w.waistEase = cal.waistEase
  if (cal.hipEase   != null) w.hipEase   = cal.hipEase
  const shoulderEase = w.shoulderEase ?? cal.shoulderPad ?? 1.15
  const skirtMult    = (cal.skirtFlare ?? 1.10) / 1.10
  const geo          = cal.enh?.geo || null          // null = simple mode: old behaviour
  const waistEase    = (w.waistEase ?? 1.05) * (geo?.waistWidth ?? 1)
  const hipEase      = (w.hipEase   ?? 1.10) * (geo?.hipWidth   ?? 1)
  const waistRatio   = w.waistRatio ?? 0.72
  const wf           = clamp(w.waistRow ?? prof.waistFrac, 0.1, 0.8)

  const waistY = sm.y + torsoH * (geo?.waistAt ?? 0.65) + dyOff
  const hipY   = hm.y + dyOff
  if (!(bottomY > hipY + 4 && waistY > topY + 4 && hipY > waistY)) return false

  const shoulderW = sw * shoulderEase
  let waistW = sw * waistRatio * waistEase
  const m = layout.meas
  if (m?.waist > 0 && m?.hips > 0) {
    const hipRef = layout.rawHw ?? hw
    waistW = clamp(hipRef * (m.waist / m.hips) * waistEase, sw * 0.5, sw * 1.0)
  }
  const hipW = hw * hipEase
  const smY  = sm.y + dyOff

  // smoothed width / centre profile of the gown image, cached on the profile
  if (!prof.widS) {
    const blur7 = arr => arr.map((_, i) => {
      let s = 0
      for (let j = -3; j <= 3; j++) s += arr[clamp(i + j, 0, BANDS - 1)]
      return s / 7
    })
    prof.widS = blur7(prof.right.map((r, i) => r - prof.left[i]))
    prof.ctrS = blur7(prof.right.map((r, i) => (r + prof.left[i]) / 2))
  }
  const at = (arr, f) => {
    const p = clamp(f * BANDS - 0.5, 0, BANDS - 1)
    const i = Math.floor(p)
    return lerp(arr[i], arr[Math.min(i + 1, BANDS - 1)], p - i)
  }

  const srcH = prof.srcH ?? prof.ih
  const hf   = wf + ((hipY - waistY) / (bottomY - waistY)) * (1 - wf)
  const kV   = (bottomY - waistY) / (srcH * (1 - wf))
  const kHip = clamp(hipW / Math.max(at(prof.widS, hf), 1), kV * 0.5, kV * 2)

  const bodyW = y => {
    if (y <= smY)    return shoulderW
    if (y <= waistY) return lerp(shoulderW, waistW, smooth((y - smY) / (waistY - smY)))
    return lerp(waistW, hipW, smooth((y - waistY) / (hipY - waistY)))
  }

  // skirt sway: the hem lags slightly behind sideways hip movement
  let hipMove = sway.last == null ? 0 : hm.x - sway.last
  if (Math.abs(hipMove) > torsoH * 0.5) hipMove = 0
  sway.last = hm.x
  sway.off += (-hipMove * 2.2 - sway.off) * 0.18
  sway.off = clamp(sway.off, -torsoH * 0.18, torsoH * 0.18)
  const cLine = y => lerp(sm.x, hm.x, clamp((y - smY) / (hm.y - sm.y), 0, 1)) + dx + (y > hipY ? sway.off * smooth(clamp((y - hipY) / Math.max(bottomY - hipY, 1), 0, 1)) : 0)

  // scratch canvas at device resolution
  const dprMain = window.devicePixelRatio || 1
  const dprS    = Math.min(2, dprMain)
  const vw = size?.w ?? ctx.canvas.width  / dprMain
  const vh = size?.h ?? ctx.canvas.height / dprMain
  const oc   = scratch(Math.round(vw * dprS), Math.round(vh * dprS))
  const octx = oc.getContext('2d')
  octx.setTransform(1, 0, 0, 1, 0, 0)
  octx.clearRect(0, 0, oc.width, oc.height)
  octx.setTransform(dprS, 0, 0, dprS, 0, 0)
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'

  const { c: work } = getWork(img, prof)
  const snap  = v => Math.round(v * dprS) / dprS      // keep strip edges on whole device pixels
  const STRIP = 2                                       // screen px per strip; raise to 3 if it gets choppy
  const n     = Math.ceil((bottomY - topY) / STRIP)
  const upper = wf / (waistY - topY)
  const lower = (1 - wf) / (bottomY - waistY)
  const flareSpan = Math.max((bottomY - hipY) * 0.5, 1)
  const skirtSpan = Math.max((bottomY - hipY) * 0.15, 1)
  // Above the waist, follow the gown's own shape instead of squeezing each strip to body width
  const sWaist = (waistW * scaleX) / Math.max(at(prof.widS, wf), 1)
  const UPPER_FOLLOW = 0.2   // 0 = keep gown shape fully, 1 = old behaviour

  for (let i = 0; i < n; i++) {
    const yA = snap(topY + i * STRIP)
    const yB = snap(Math.min(bottomY, topY + (i + 1) * STRIP))
    if (yB <= yA) continue
    const yC    = (yA + yB) / 2
    const above = yC <= waistY
    const f  = above ? upper * (yC - topY) : wf + lower * (yC - waistY)
    const df = (above ? upper : lower) * (yB - yA)
    const gw = at(prof.widS, f)
    if (!(gw > 0)) continue

    let tw = yC <= hipY
      ? bodyW(yC)
      : gw * lerp(kHip, kV, smooth(clamp((yC - hipY) / flareSpan, 0, 1)))
    tw *= scaleX * (geo
      ? 1 + (geo.hemWidth - 1) * Math.pow(clamp((yC - hipY) / Math.max(bottomY - hipY, 1), 0, 1), lerp(3, 0.6, geo.flareCurve))
      : lerp(1, skirtMult, smooth(clamp((yC - hipY) / skirtSpan, 0, 1))))

    const sRow = tw / gw
    const s  = yC <= waistY ? lerp(sWaist, sRow, UPPER_FOLLOW) : sRow
    const cc = at(prof.ctrS, f)
    const hh = (df * work.height) / 2
    const sy = clamp(f * work.height - hh, 0, work.height - 1)
    const sh = clamp(hh * 2, 1, work.height - sy)
    octx.drawImage(work, 0, sy, work.width, sh, cLine(yC) - cc * s, yA, prof.iw * s, yB - yA)
  }

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = 'source-over'
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (layout.brightness && Math.abs(layout.brightness - 1) > 0.02) ctx.filter = `brightness(${layout.brightness.toFixed(2)})`
  ctx.drawImage(oc, 0, 0, vw, vh)
  ctx.restore()
  return true
}

// Previous renderer, no longer used. Safe to delete once the new one is confirmed.
function drawGownWarpedLegacy(ctx, img, layout, opacity, size) {
    const { topY, bottomY, sm, hm, sw, hw, torsoH, cal = {}, dx = 0, dy: dyOff = 0, scaleX = 1 } = layout
  if (!sm || !hm) return false
  const prof = getProfile(img)
  if (!prof) return false

  const w = { ...(cal.warp || {}) }
  if (cal.waistRow  != null) w.waistRow  = cal.waistRow
  if (cal.waistEase != null) w.waistEase = cal.waistEase
  if (cal.hipEase   != null) w.hipEase   = cal.hipEase
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
  let waistW = sw * waistRatio * waistEase
  const m = layout.meas
  if (m?.waist > 0 && m?.hips > 0) {
    // scan waist/hip ratio applied to the raw hip-joint span, kept within a sane range
    const hipRef = layout.rawHw ?? hw
    waistW = clamp(hipRef * (m.waist / m.hips) * waistEase, sw * 0.5, sw * 1.0)
  }
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
  const kV    = (bottomY - waistY) / (prof.srcH * (1 - wf))        // uniform (height-driven) scale
  const kHip  = clamp(hipW / Math.max(bandW(hf), 1), kV * 0.5, kV * 2)

  const smY = sm.y + dyOff
  const bodyW = y => {
    if (y <= smY)     return shoulderW
    if (y <= waistY)  return lerp(shoulderW, waistW, smooth((y - smY) / (waistY - smY)))
    return lerp(waistW, hipW, smooth((y - waistY) / (hipY - waistY)))
  }
  // centre line follows the torso lean, then hangs straight below the hips
  let hipMove = sway.last == null ? 0 : hm.x - sway.last
  if (Math.abs(hipMove) > torsoH * 0.5) hipMove = 0      // ignore tracking jumps
  sway.last = hm.x
  sway.off += (-hipMove * 2.2 - sway.off) * 0.18
  sway.off = clamp(sway.off, -torsoH * 0.18, torsoH * 0.18)
  const cLine = y => lerp(sm.x, hm.x, clamp((y - smY) / (hm.y - sm.y), 0, 1)) + dx
    + (y > hipY ? sway.off * smooth(clamp((y - hipY) / Math.max(bottomY - hipY, 1), 0, 1)) : 0)

  const dpr = window.devicePixelRatio || 1
  const vw  = size?.w ?? ctx.canvas.width  / dpr
  const vh  = size?.h ?? ctx.canvas.height / dpr
  // 5-tap moving average so neighbouring bands never differ sharply
  const smoothBand = arr => arr.map((_, i) => {
    let s = 0
    for (let k = -2; k <= 2; k++) s += arr[clamp(i + k, 0, BANDS - 1)]
    return s / 5
  })
  const gwS = smoothBand(prof.right.map((r, i) => r - prof.left[i]))
  const cS  = smoothBand(prof.right.map((r, i) => (r + prof.left[i]) / 2))

  const oc  = scratch(vw, vh)
  const octx = oc.getContext('2d')

  for (let b = 0; b < BANDS; b++) {
    const f0 = b / BANDS, f1 = (b + 1) / BANDS
    const y0 = dy(f0), y1 = dy(f1)
        const gw = gwS[b]
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
    const sy = prof.srcTop + f0 * prof.srcH
    const sh = Math.min(prof.srcH / BANDS + 1, prof.srcTop + prof.srcH - sy)
    const s = tw / Math.max(gw, 1)
    octx.drawImage(img, 0, sy, prof.iw, sh, cLine(cy) - cS[b] * s, y0, prof.iw * s, (y1 - y0) + 1)
  }

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = 'source-over'
  if (layout.brightness) ctx.filter = `brightness(${layout.brightness.toFixed(2)}) blur(0.5px)`
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

// Starting values from the gown's own attributes, so most gowns need little tuning.
// These are rough guesses, not measured, and any saved calibration overrides them.
export function autoCalibration(gown) {
  const neck = String(gown?.neckline   || '').toLowerCase()
  const sil  = String(gown?.silhouette || '').toLowerCase()
  const cal  = {}
  if (/strapless|sweetheart|bandeau/.test(neck))   cal.necklineY = 0.02
  else if (/halter|high|mock|turtle/.test(neck))   cal.necklineY = 0.26
  if (/mermaid|trumpet|fit.?and.?flare/.test(sil)) { cal.skirtFlare = 0.9; cal.hipEase = 1.0 }
  else if (/sheath|column/.test(sil))              { cal.skirtFlare = 0.8; cal.hipEase = 1.0 }
  else if (/ball|princess|tutu|puff/.test(sil))    { cal.skirtFlare = 1.2 }
  return cal
}