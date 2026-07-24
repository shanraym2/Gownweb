/**
 * lib/fitting-room/silhouetteUtils.js
 *
 * Silhouette-edge depth measurement for the side-scan capture stage.
 * No React, no side-effects — safe to import anywhere.
 *
 * WHY THIS EXISTS
 * ────────────────
 * The front scan can only measure body WIDTH (shoulder-to-shoulder,
 * hip-to-hip) because that's what a frontal camera projects onto the image
 * plane. Front-to-back DEPTH has always been a guess — a per-body-shape
 * ratio applied to width (see BODY_DEPTH in measurementUtils.js). A side
 * scan lets us measure depth directly: from a profile view, the body's
 * front-to-back thickness IS the width the camera sees.
 *
 * Unlike front-scan measurement (which uses pose keypoint distances),
 * side-scan depth comes from finding where the person's silhouette starts
 * and ends against the background at a given image row — keypoints alone
 * don't give a depth measurement, only a position.
 *
 * Exports
 * ───────
 *   sampleBackgroundColor(ctx, vw, vh)             Averages a background color sample
 *   measureSilhouetteWidth(ctx, rowY, vw, bgColor) Finds the person's pixel width at one row
 */

// ─────────────────────────────────────────────────────────────────────────────
// sampleBackgroundColor(ctx, vw, vh)
//
// Samples the four corners of the frame and averages them. Assumes the
// background is visible and roughly uniform in the corners — reasonable for
// a person standing centered in frame during a side scan.
//
// @param {CanvasRenderingContext2D} ctx
// @param {number} vw
// @param {number} vh
// @returns {{ r:number, g:number, b:number } | null}
// ─────────────────────────────────────────────────────────────────────────────

export function sampleBackgroundColor(ctx, vw, vh) {
  const points = [
    [vw * 0.05, vh * 0.05], [vw * 0.95, vh * 0.05],
    [vw * 0.05, vh * 0.95], [vw * 0.95, vh * 0.95],
  ]
  const samples = []
  for (const [x, y] of points) {
    try {
      const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data
      samples.push({ r: d[0], g: d[1], b: d[2] })
    } catch {
      // Tainted canvas or out-of-bounds — skip this sample point
    }
  }
  if (!samples.length) return null
  const sum = samples.reduce((a, s) => ({ r: a.r + s.r, g: a.g + s.g, b: a.b + s.b }), { r: 0, g: 0, b: 0 })
  return { r: sum.r / samples.length, g: sum.g / samples.length, b: sum.b / samples.length }
}

// ─────────────────────────────────────────────────────────────────────────────
// measureSilhouetteWidth(ctx, rowY, vw, bgColor, threshold)
//
// Scans one horizontal row of pixels and finds the widest contiguous run of
// pixels that differ from the background color by more than `threshold`
// (Euclidean RGB distance). That run is treated as the person's silhouette
// at this row — its pixel width, converted via pxPerCm, is the body's depth
// (front-to-back thickness) at that height when the subject is in profile.
//
// LIMITATION: this is a simple color-contrast method, not real segmentation.
// It works well against a plain, reasonably uniform background and struggles
// with cluttered/patterned backgrounds or clothing that closely matches the
// background color — same class of constraint as checkLighting()'s luminance
// sampling elsewhere in this pipeline.
//
// @param {CanvasRenderingContext2D} ctx
// @param {number} rowY      Row to scan, in canvas pixel coordinates
// @param {number} vw        Canvas width in pixels
// @param {{r,g,b}} bgColor  Background color from sampleBackgroundColor()
// @param {number} threshold RGB distance above which a pixel counts as "person"
// @returns {{ widthPx:number, startX:number, endX:number } | null}
// ─────────────────────────────────────────────────────────────────────────────

export function measureSilhouetteWidth(ctx, rowY, vw, bgColor, threshold = 45) {
  if (!bgColor) return null
  let rowData
  try {
    rowData = ctx.getImageData(0, Math.round(rowY), vw, 1).data
  } catch {
    return null
  }

  let inBody = false, startX = null
  let bestStart = null, bestEnd = null, bestLen = 0

  for (let x = 0; x < vw; x++) {
    const i = x * 4
    const dr = rowData[i]     - bgColor.r
    const dg = rowData[i + 1] - bgColor.g
    const db = rowData[i + 2] - bgColor.b
    const isFg = Math.sqrt(dr * dr + dg * dg + db * db) > threshold

    if (isFg && !inBody) { inBody = true; startX = x }
    if (!isFg && inBody) {
      inBody = false
      const len = x - startX
      if (len > bestLen) { bestLen = len; bestStart = startX; bestEnd = x }
    }
  }
  if (inBody) {
    const len = vw - startX
    if (len > bestLen) { bestLen = len; bestStart = startX; bestEnd = vw }
  }

  if (bestLen === 0) return null
  return { widthPx: bestLen, startX: bestStart, endX: bestEnd }
}