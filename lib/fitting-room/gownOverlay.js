/**
 * lib/fitting-room/gownOverlay.js
 *
 * Gown overlay layout and rendering for the fitting room try-on canvas.
 * No React, no side-effects — safe to import anywhere.
 *
 * These functions operate directly on a CanvasRenderingContext2D and are
 * shared between:
 *   app/fitting-room/panels/ScanPanel.jsx  — skeleton overlay drawing
 *   app/fitting-room/panels/TryOnPanel.jsx — full gown overlay via TryOnCamera
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CROSS-ORIGIN / TAINTED CANVAS
 * ─────────────────────────────────────────────────────────────────────────────
 * Gown images must be loaded with img.crossOrigin = 'anonymous' AND the image
 * CDN must return Access-Control-Allow-Origin headers, otherwise drawImage()
 * will taint the canvas and any subsequent getImageData() call (e.g. in
 * skinTone detection) will throw a SecurityError.
 *
 * If your CDN does not support CORS, load the gown image without crossOrigin
 * but accept that skin tone detection will be disabled for that frame.
 *
 * Exports
 * ───────
 *   getGownLayout(kps, cal, vw, vh)   Computes gown overlay geometry from pose
 *   drawGown(ctx, img, layout, opacity)  Renders the gown onto the canvas
 */

import { KP, CONF, dist, mid } from './poseUtils.js'

// ─────────────────────────────────────────────────────────────────────────────
// getGownLayout(kps, cal, vw, vh)
//
// Computes the trapezoid geometry used to position and stretch the gown image
// over the detected pose. Returns null when the required keypoints are absent
// or below confidence threshold.
//
// Layout coordinates are in canvas pixel space (x already flipped by caller).
//
// Calibration object (cal) — all fields optional:
//   necklineY   {number}  Top offset as fraction of torso height (default 0.18)
//   hemY        {number}  Hem as fraction of full estimated height (0–1)
//                         Overrides ankle/knee-based bottomY when set
//   shoulderPad {number}  Top width multiplier (default 1.45)
//   skirtFlare  {number}  Bottom width flare multiplier (default 1.20)
//
// @param {Array}  kps  Keypoint array (x flipped to canvas coords)
// @param {Object} cal  Calibration overrides from gown.tryonCalibration
// @param {number} vw   Canvas width in pixels
// @param {number} vh   Canvas height in pixels
//
// @returns {{
//   topY:    number,   Top edge of gown in canvas px
//   bottomY: number,   Bottom edge of gown in canvas px
//   cx:      number,   Horizontal centre of gown in canvas px
//   topW:    number,   Width of gown at shoulder level
//   botW:    number,   Width of gown at hem
//   torsoH:  number,   Shoulder→hip distance in px (useful for proportional offsets)
// } | null}
// ─────────────────────────────────────────────────────────────────────────────

export function getGownLayout(kps, cal = {}, vw = 640, vh = 480) {
  const ls = kps[KP.LS], rs = kps[KP.RS]
  const lh = kps[KP.LH], rh = kps[KP.RH]
  const lk = kps[KP.LK], rk = kps[KP.RK]
  const la = kps[KP.LA], ra = kps[KP.RA]

  // Require shoulders and hips at minimum
  if ([ls, rs, lh, rh].some(k => !k || k.score < CONF)) return null

  const sm     = mid(ls, rs)
  const hm     = mid(lh, rh)
  const torsoH = hm.y - sm.y

  // Shoulder width: clamp to avoid extremes when subject is angled
  const rawSw = dist(ls, rs)
  const sw    = Math.min(Math.max(rawSw, vw * 0.28), vw * 0.80)

  // Hip width: ensure at least 90% of shoulder width (pose-detection floor)
  const rawHw = dist(lh, rh)
  const hw    = Math.max(rawHw, sw * 0.90)

  // Top edge — slightly above shoulders to cover neckline
  const neckOff = cal.necklineY ?? 0.18
  const topY    = sm.y - torsoH * neckOff

  // Bottom edge — prefer ankles > knees > estimated full-body length
  let bottomY
  if (la?.score > CONF && ra?.score > CONF) {
    // Ankles visible: add a small hem allowance below ankle level
    bottomY = Math.max(la.y, ra.y) + torsoH * 0.15
  } else if (lk?.score > CONF && rk?.score > CONF) {
    // Knees visible: extend proportionally below knees
    const km   = mid(lk, rk)
    const legH = km.y - hm.y
    bottomY = km.y + legH * 1.1
  } else {
    // Fallback: estimated full-body length from torso proportion
    bottomY = sm.y + torsoH * 4.8
  }

  // Calibration override: hemY as fraction of estimated full body height
  if (cal.hemY != null) {
    const fullH = sm.y + torsoH * 4.8 - topY
    bottomY = topY + fullH * cal.hemY
  }

  // Widths
  const shoulderPad = cal.shoulderPad ?? 1.45
  const skirtFlare  = cal.skirtFlare  ?? 1.20
  const topW = sw * shoulderPad
  const botW = Math.max(hw * 1.55, topW) * skirtFlare

  // Horizontal centre: average of shoulder and hip midpoints
  const cx = (sm.x + hm.x) / 2

  return { topY, bottomY, cx, topW, botW, torsoH }
}

// ─────────────────────────────────────────────────────────────────────────────
// drawGown(ctx, img, layout, opacity)
//
// Renders the gown image onto the canvas by clipping to a trapezoid defined
// by the layout geometry and stretching the image to fill it.
//
// Uses an off-screen canvas for clipping to avoid affecting the main canvas
// compositing state.
//
// @param {CanvasRenderingContext2D} ctx      Target canvas context
// @param {HTMLImageElement}         img      Gown image (must be loaded)
// @param {Object}                   layout   Output from getGownLayout()
// @param {number}                   opacity  0–1 overlay opacity
// ─────────────────────────────────────────────────────────────────────────────

export function drawGown(ctx, img, layout, opacity) {
  const { topY, bottomY, cx, topW, botW } = layout
  const h = bottomY - topY
  if (h <= 0) return

  // Off-screen canvas so we can clip without affecting the main context state
  const oc      = document.createElement('canvas')
  oc.width      = ctx.canvas.width  / (window.devicePixelRatio || 1)
  oc.height     = ctx.canvas.height / (window.devicePixelRatio || 1)
  const octx    = oc.getContext('2d')

  // Clip to trapezoid
  octx.beginPath()
  octx.moveTo(cx - topW / 2, topY)
  octx.lineTo(cx + topW / 2, topY)
  octx.lineTo(cx + botW / 2, bottomY)
  octx.lineTo(cx - botW / 2, bottomY)
  octx.closePath()
  octx.clip()

  // Draw gown image stretched to fill the trapezoid bounding box
  octx.drawImage(img, cx - botW / 2, topY, botW, h)

  // Composite onto main canvas with opacity
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(oc, 0, 0)
  ctx.restore()
}