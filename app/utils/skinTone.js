'use client'

/**
 * utils/skinTone.js — Skin tone & undertone detection
 *
 * Used by:
 *   app/fitting-room/panels/ScanPanel.jsx  → detect loop
 *   (future) app/virtual-try-on/page.jsx
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COORDINATE CONTRACT  (critical — read before editing)
 * ─────────────────────────────────────────────────────────────────────────────
 * The detect loop draws the video mirrored (ctx.scale(-1,1)) and then flips
 * every keypoint x-coordinate:
 *
 *   kps = poses[0].keypoints.map(k => ({ ...k, x: vw - k.x }))
 *
 * After that flip, each keypoint's (x, y) is already in canvas-pixel space.
 * sampleFaceRegion() reads at the keypoint coordinates directly.
 * DO NOT apply an additional (vw - x) mirror here — that would double-mirror
 * and land the sample patch on the wrong side of the face.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CROSS-ORIGIN / TAINTED CANVAS
 * getImageData() throws a SecurityError if any cross-origin image lacking
 * CORS headers was drawn onto the canvas. This file only samples the video
 * frame (drawn before gown overlay), but we still wrap every read in
 * try/catch and return null so callers degrade gracefully.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXES APPLIED vs. original
 * ─────────────────────────────────────────────────────────────────────────────
 *  FIX 1 — sampleFaceRegion() now samples left + right CHEEKS instead of the
 *    nose bridge. The cheekbone is the most reliably lit, least shadowed face
 *    region. The nose bridge is concave, catches side-shadow, and produces
 *    consistently darker RGB readings — especially on tan/deep tones.
 *    Falls back to nose bridge when eye keypoints are absent or low-confidence.
 *
 *  FIX 2 — detectSkinToneFromPixels() applies +15 luma (WEBCAM_LUMA_BIAS)
 *    before bucket classification. Consumer webcams underexpose dark skin
 *    tones by ~10–20 luma units when the background is lighter than the
 *    subject (Imatest 2024). Without this correction, medium/olive tones
 *    are classified as tan/deep.
 *
 *  FIX 3 — Shadow rejection floor raised from 20 → 30 luma units.
 *    Pixels below luma 30 are shadow pixels that skew averages toward black.
 *
 *  INTERFACE FIX — KP is now imported from poseUtils rather than received
 *    as a function argument. sampleFaceRegion() and detectSkinProfile() no
 *    longer require a KP parameter — callers pass only (ctx, kps, vw, vh).
 */

import { KP } from '../../lib/fitting-room/poseUtils.js'

// ─────────────────────────────────────────────────────────────────────────────
// TONE BUCKETS
// Ordered lightest → darkest.
// Must stay in sync with SKIN_TONES in constants/styleOptions.js
// ─────────────────────────────────────────────────────────────────────────────

export const TONE_BUCKETS = [
  { id: 'fair',   label: 'Fair',   hex: '#F8E8D8', brightnessMin: 210 },
  { id: 'light',  label: 'Light',  hex: '#F0D0A8', brightnessMin: 185 },
  { id: 'medium', label: 'Medium', hex: '#D4956A', brightnessMin: 148 },
  { id: 'olive',  label: 'Olive',  hex: '#B8804A', brightnessMin: 120 },
  { id: 'tan',    label: 'Tan',    hex: '#9A6438', brightnessMin:  92 },
  { id: 'deep',   label: 'Deep',   hex: '#6B3E26', brightnessMin:  60 },
  { id: 'ebony',  label: 'Ebony',  hex: '#3D1F10', brightnessMin:   0 },
]

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2 — Webcam underexposure correction
// Applied to perceived brightness before bucket lookup.
// ─────────────────────────────────────────────────────────────────────────────
const WEBCAM_LUMA_BIAS = 15

// Half-width of the sample patch in pixels (yields a 24×24 px patch)
const PATCH_HALF = 12

// ─────────────────────────────────────────────────────────────────────────────
// detectSkinToneFromPixels(r, g, b)
//
// Maps an averaged RGB patch to the nearest TONE_BUCKETS entry using
// BT.601 perceived brightness as the primary axis, with a webcam
// underexposure correction (+15 luma) applied before classification.
//
// The medium/olive split uses a redness-ratio secondary check:
//   medium → warm red-orange  (r / g > 1.15)
//   olive  → yellow-green     (r / g ≤ 1.15)
//
// @param {number} r  0–255 averaged red channel
// @param {number} g  0–255 averaged green channel
// @param {number} b  0–255 averaged blue channel
// @returns {string}  One of: fair | light | medium | olive | tan | deep | ebony
// ─────────────────────────────────────────────────────────────────────────────

export function detectSkinToneFromPixels(r, g, b) {
  // FIX 2: apply webcam underexposure correction before bucket lookup
  const brightness = (r * 0.299 + g * 0.587 + b * 0.114) + WEBCAM_LUMA_BIAS

  for (const bucket of TONE_BUCKETS) {
    if (brightness >= bucket.brightnessMin) {
      if (bucket.id === 'medium') {
        const rednessRatio = r / Math.max(g, 1)
        if (rednessRatio < 1.15) return 'olive'
      }
      return bucket.id
    }
  }

  return 'ebony'
}

// ─────────────────────────────────────────────────────────────────────────────
// detectUndertone(r, g, b)
//
// Determines warm / cool / neutral from the HSV hue of the sampled patch.
//
//   Warm   — hue  0°– 50° (orange-yellow) or 330°–360° (warm red)
//   Cool   — hue 270°–330° (pink/magenta) or 160°–220° (blue-green)
//   Neutral — anything else, or when chroma (delta) < 12
//
// @param {number} r  0–255
// @param {number} g  0–255
// @param {number} b  0–255
// @returns {'warm'|'cool'|'neutral'}
// ─────────────────────────────────────────────────────────────────────────────

export function detectUndertone(r, g, b) {
  const max   = Math.max(r, g, b)
  const min   = Math.min(r, g, b)
  const delta = max - min

  if (delta < 12) return 'neutral'

  let hue
  if      (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else                hue = (r - g) / delta + 4

  const h = ((hue * 60) + 360) % 360

  if (h < 50 || h >= 330)   return 'warm'
  if (h >= 270)              return 'cool'
  if (h >= 160 && h < 220)  return 'cool'
  return 'neutral'
}

// ─────────────────────────────────────────────────────────────────────────────
// sampleFaceRegion(ctx, kps, vw, vh)
//
// FIX 1: Samples left + right cheeks instead of the nose bridge.
// INTERFACE FIX: KP is imported at module level — no longer a parameter.
//
// Cheek sampling strategy:
//   cheekY  = 60% of the way from eye-line down to nose tip
//   lCheekX = nose.x − (eye-to-nose horizontal distance)
//   rCheekX = nose.x + (eye-to-nose horizontal distance)
//
// Both patches are averaged together. Pixels with luma < 30 (FIX 3, raised
// from 20) or > 240 are excluded to skip shadows and specular highlights.
//
// Falls back to nose bridge when eye keypoints are absent or low-confidence.
//
// Returns { r, g, b } averages, or null when:
//   • nose keypoint absent or confidence < 0.4
//   • fewer than 10 valid pixels in the patch (too much shadow/highlight)
//   • canvas read throws SecurityError (tainted canvas)
//
// @param {CanvasRenderingContext2D} ctx  Already-drawn canvas (mirrored video)
// @param {Array}  kps   Keypoint array — x already flipped to canvas coords
// @param {number} vw    Canvas display width  (pixels)
// @param {number} vh    Canvas display height (pixels)
// @returns {{ r:number, g:number, b:number } | null}
// ─────────────────────────────────────────────────────────────────────────────

export function sampleFaceRegion(ctx, kps, vw, vh) {
  const nose = kps[KP.NOSE]
  if (!nose || nose.score < 0.4) return null

  const lEye = kps[1]   // left eye (MoveNet index 1)
  const rEye = kps[2]   // right eye (MoveNet index 2)

  // ── Fallback: nose bridge (original behaviour) ───────────────────────────
  // Used when eye keypoints are absent or low-confidence.
  if (!lEye || !rEye || lEye.score < 0.3 || rEye.score < 0.3) {
    const cx = Math.round(nose.x)
    const cy = Math.round(nose.y)
    const px = Math.max(0, Math.min(cx - PATCH_HALF, vw - PATCH_HALF * 2))
    const py = Math.max(0, Math.min(cy - PATCH_HALF, vh - PATCH_HALF * 2))
    try {
      const { data } = ctx.getImageData(px, py, PATCH_HALF * 2, PATCH_HALF * 2)
      let rS = 0, gS = 0, bS = 0, n = 0
      for (let i = 0; i < data.length; i += 4) {
        // FIX 3: shadow floor raised 20 → 30
        const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
        if (luma < 30 || luma > 240) continue
        rS += data[i]; gS += data[i + 1]; bS += data[i + 2]; n++
      }
      return n < 10 ? null : { r: rS / n, g: gS / n, b: bS / n }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[skinTone] sampleFaceRegion (nose fallback):', err.name, err.message)
      }
      return null
    }
  }

  // ── Primary: cheek sampling ───────────────────────────────────────────────
  const eyeMidY    = (lEye.y + rEye.y) / 2
  // Cheek Y: 60% of the way from eye line to nose tip
  const cheekY     = eyeMidY + (nose.y - eyeMidY) * 0.60
  // Cheek X: laterally offset from nose by one eye-to-nose horizontal distance
  const eyeToNoseX = Math.abs(nose.x - (lEye.x + rEye.x) / 2)
  const lCheekX    = nose.x - eyeToNoseX * 1.0
  const rCheekX    = nose.x + eyeToNoseX * 1.0

  const patches = [
    { cx: Math.round(lCheekX), cy: Math.round(cheekY) },
    { cx: Math.round(rCheekX), cy: Math.round(cheekY) },
  ]

  let rSum = 0, gSum = 0, bSum = 0, n = 0

  for (const { cx, cy } of patches) {
    const px = Math.max(0, Math.min(cx - PATCH_HALF, vw - PATCH_HALF * 2))
    const py = Math.max(0, Math.min(cy - PATCH_HALF, vh - PATCH_HALF * 2))
    try {
      const { data } = ctx.getImageData(px, py, PATCH_HALF * 2, PATCH_HALF * 2)
      for (let i = 0; i < data.length; i += 4) {
        // FIX 3: shadow floor raised 20 → 30
        const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
        if (luma < 30 || luma > 240) continue
        rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2]; n++
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[skinTone] sampleFaceRegion (cheek):', err.name, err.message)
      }
      // Continue — try the other cheek patch
    }
  }

  return n < 10 ? null : { r: rSum / n, g: gSum / n, b: bSum / n }
}

// ─────────────────────────────────────────────────────────────────────────────
// detectSkinProfile(ctx, kps, vw, vh)
//
// One-call convenience wrapper: samples the face region then returns
// both skinTone and undertone.
// INTERFACE FIX: KP parameter removed — it is now imported at module level.
//
// @param {CanvasRenderingContext2D} ctx
// @param {Array}  kps  Keypoint array (x flipped to canvas coords)
// @param {number} vw   Canvas width
// @param {number} vh   Canvas height
// @returns {{ skinTone: string, undertone: 'warm'|'cool'|'neutral' } | null}
// ─────────────────────────────────────────────────────────────────────────────

export function detectSkinProfile(ctx, kps, vw, vh) {
  const sample = sampleFaceRegion(ctx, kps, vw, vh)
  if (!sample) return null

  const { r, g, b } = sample
  return {
    skinTone:  detectSkinToneFromPixels(r, g, b),
    undertone: detectUndertone(r, g, b),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// _detectSkinProfileFixed(ctx, kps, vw, vh)
//
// Alias of detectSkinProfile kept for backward compatibility with the
// ScanPanel call site. Both names call identical logic.
// INTERFACE FIX: 4-argument signature — KP is no longer accepted or needed.
//
// @param {CanvasRenderingContext2D} ctx
// @param {Array}  kps  Keypoint array (x flipped to canvas coords)
// @param {number} vw   Canvas width
// @param {number} vh   Canvas height
// @returns {{ skinTone: string, undertone: 'warm'|'cool'|'neutral' } | null}
// ─────────────────────────────────────────────────────────────────────────────

export function _detectSkinProfileFixed(ctx, kps, vw, vh) {
  return detectSkinProfile(ctx, kps, vw, vh)
}