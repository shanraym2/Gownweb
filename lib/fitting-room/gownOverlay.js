/**
 * lib/fitting-room/gownOverlay.js
 *
 * Gown overlay layout and rendering for the fitting room try-on canvas.
 * No React, no side-effects — safe to import anywhere.
 *
 * FIX: drawGown previously created an off-screen canvas sized to
 * ctx.canvas.width / devicePixelRatio. On retina (DPR=2) screens the
 * off-screen canvas was half the physical pixel size of the main canvas,
 * causing the overlay to render at half resolution and appear blurry/small.
 * It now clips directly on the main context using ctx.save()/restore(),
 * which is both sharper and faster (no extra canvas allocation per frame).
 *
 * getGownLayout is unchanged.
 */

import { KP, CONF, dist, mid } from './poseUtils.js'

// ─────────────────────────────────────────────────────────────────────────────
// getGownLayout
// ─────────────────────────────────────────────────────────────────────────────

export function getGownLayout(kps, cal = {}, vw = 640, vh = 480) {
  const ls = kps[KP.LS], rs = kps[KP.RS]
  const lh = kps[KP.LH], rh = kps[KP.RH]
  const lk = kps[KP.LK], rk = kps[KP.RK]
  const la = kps[KP.LA], ra = kps[KP.RA]

  if ([ls, rs, lh, rh].some(k => !k || k.score < CONF)) return null

  const sm     = mid(ls, rs)
  const hm     = mid(lh, rh)
  const torsoH = hm.y - sm.y

  const rawSw = dist(ls, rs)
  const sw    = Math.min(Math.max(rawSw, vw * 0.28), vw * 0.80)

  const rawHw = dist(lh, rh)
  const hw    = Math.max(rawHw, sw * 0.90)

  const neckOff = cal.necklineY ?? 0.18
  const topY    = sm.y - torsoH * neckOff

  let bottomY
  if (la?.score > CONF && ra?.score > CONF) {
    bottomY = Math.max(la.y, ra.y) + torsoH * 0.15
  } else if (lk?.score > CONF && rk?.score > CONF) {
    const km   = mid(lk, rk)
    const legH = km.y - hm.y
    bottomY = km.y + legH * 1.1
  } else {
    bottomY = sm.y + torsoH * 4.8
  }

  if (cal.hemY != null) {
    const fullH = sm.y + torsoH * 4.8 - topY
    bottomY = topY + fullH * cal.hemY
  }

  const shoulderPad = cal.shoulderPad ?? 1.45
  const skirtFlare  = cal.skirtFlare  ?? 1.20
  const topW = sw * shoulderPad
  const botW = Math.max(hw * 1.55, topW) * skirtFlare

  const cx = (sm.x + hm.x) / 2

  return { topY, bottomY, cx, topW, botW, torsoH }
}

// ─────────────────────────────────────────────────────────────────────────────
// drawGown
//
// FIX: clips directly on the main context instead of an off-screen canvas.
// The off-screen approach divided canvas dimensions by devicePixelRatio, which
// produced a half-resolution overlay on retina screens — the gown appeared
// blurry and incorrectly sized. Using save()/clip()/restore() on the main
// context avoids the DPR math entirely and renders at full resolution.
// ─────────────────────────────────────────────────────────────────────────────

export function drawGown(ctx, img, layout, opacity) {
  const { topY, bottomY, cx, topW, botW } = layout
  const h = bottomY - topY
  if (h <= 0) return

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = 'source-over'

  ctx.beginPath()
  ctx.moveTo(cx - topW / 2, topY)
  ctx.lineTo(cx + topW / 2, topY)
  ctx.lineTo(cx + botW / 2, bottomY)
  ctx.lineTo(cx - botW / 2, bottomY)
  ctx.closePath()
  ctx.clip()

  ctx.drawImage(img, cx - botW / 2, topY, botW, h)

  ctx.restore()
}