/**
 * lib/fitting-room/suitWarp.js
 *
 * Renderer for suits / menswear (gown.segment === 'men').
 * Straight-cut garment: no waist cinch, no skirt flare, no cloth sway.
 * The image is scaled to the shoulders (width) and to shoulder-to-floor (height).
 *
 * Optional per-product calibration (gown.tryonCalibration):
 *   suitWidth  – garment width vs detected shoulder span   (default 1.22)
 *   suitTop    – how far the chest line sits below the shoulder line, in torso heights (default 0)
 */

const clamp = (v, a, b) => Math.min(Math.max(v, a), b)

export function drawSuit(ctx, img, layout, opacity) {
  const { sm, sw, torsoH, bottomY, cx, dy = 0, scaleX = 1, cal = {} } = layout
  if (!sm || !(sw > 0) || !(torsoH > 0)) return false

  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return false

  // Use the cut-out's own silhouette when the image has transparency
  const prof = layout.suitProfile
  const srcTop = prof?.srcTop ?? 0
  const srcH   = prof?.srcH ?? ih

  // Chest width and centre, measured over bands 3..9 (roughly 6%-19% down the garment)
  let imgW = iw, imgC = iw / 2
  if (prof?.left && prof?.right) {
    let wMax = 0, cSum = 0, n = 0
    for (let b = 3; b <= 9; b++) {
      wMax = Math.max(wMax, prof.right[b] - prof.left[b])
      cSum += (prof.right[b] + prof.left[b]) / 2; n++
    }
    if (wMax > iw * 0.15) { imgW = wMax; imgC = cSum / n }
  }

  const ANCHOR = 0.06                              // image row (fraction) that lands on the shoulder line
  const chestY = sm.y + dy + torsoH * (cal.suitTop ?? 0)
  const sy = (bottomY - chestY) / Math.max(srcH * (1 - ANCHOR), 1)
  let sx = (sw * (cal.suitWidth ?? 1.22) * scaleX) / imgW
  sx = clamp(sx, sy * 0.7, sy * 1.4)               // never stretch the suit out of proportion

  const topY = chestY - srcH * ANCHOR * sy
  const dw = iw * sx, dh = srcH * sy
  if (!(dw > 4) || !(dh > 4)) return false

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = 'source-over'
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (layout.brightness && Math.abs(layout.brightness - 1) > 0.02) {
    ctx.filter = `brightness(${layout.brightness.toFixed(2)})`
  }
  ctx.drawImage(img, 0, srcTop, iw, srcH, cx - imgC * sx, topY, dw, dh)
  ctx.restore()
  return true
}