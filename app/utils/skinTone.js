/**
 * utils/skinTone.js — Skin tone & undertone detection
 *
 * Used by:
 *   app/fitting-room/page.jsx  → ScanPanel detect loop
 *   (future) app/virtual-try-on/page.jsx
 *
 * ─────────────────────────────────────────────────────────────
 * COORDINATE CONTRACT  (critical — read before editing)
 * ─────────────────────────────────────────────────────────────
 * The detect loop draws the video mirrored (ctx.scale(-1,1)) and
 * then flips every keypoint x-coordinate:
 *
 *   kps = poses[0].keypoints.map(k => ({ ...k, x: vw - k.x }))
 *
 * After that flip, each keypoint's (x, y) is already in canvas-pixel
 * space. sampleFaceRegion() therefore reads at (nose.x, nose.y)
 * directly. DO NOT apply an additional (vw - x) mirror here — that
 * would double-mirror and land the sample patch on the wrong side
 * of the face.
 * ─────────────────────────────────────────────────────────────
 *
 * CROSS-ORIGIN / TAINTED CANVAS
 * getImageData() throws a SecurityError if any cross-origin image
 * lacking CORS headers was drawn onto the canvas. This file only
 * samples the video frame (drawn before gown overlay), but we still
 * wrap every read in try/catch and return null so callers degrade
 * gracefully rather than crashing the detect loop.
 */

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
// detectSkinToneFromPixels(r, g, b)
//
// Maps an averaged RGB patch to the nearest TONE_BUCKETS entry using
// BT.601 perceived brightness as the primary axis.
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
  const brightness = r * 0.299 + g * 0.587 + b * 0.114

  for (const bucket of TONE_BUCKETS) {
    if (brightness >= bucket.brightnessMin) {
      // Secondary redness check to split medium from olive at the boundary
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

  // Too achromatic — chroma too low to determine undertone reliably
  if (delta < 12) return 'neutral'

  let hue
  if      (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else                hue = (r - g) / delta + 4

  const h = ((hue * 60) + 360) % 360

  if (h < 50 || h >= 330)   return 'warm'    // orange-yellow or warm red
  if (h >= 270)              return 'cool'    // pink / magenta
  if (h >= 160 && h < 220)  return 'cool'    // blue-green shift
  return 'neutral'
}

// ─────────────────────────────────────────────────────────────────────────────
// sampleFaceRegion(ctx, kps, vw, vh, KP)
//
// Samples a 24×24 px patch centred on the nose keypoint.
//
// IMPORTANT — coordinate space:
//   kps must already be x-flipped (k.x = vw - rawK.x) by the detect loop.
//   We read at (nose.x, nose.y) directly — no additional mirroring.
//   See the coordinate contract at the top of this file.
//
// Pixels with luma < 20 (shadows, hair) or > 240 (specular highlights)
// are excluded so they don't skew the average toward black or white.
//
// Returns { r, g, b } averages, or null when:
//   • nose keypoint absent or confidence < 0.4
//   • fewer than 10 valid pixels in the patch (too much shadow/highlight)
//   • canvas read throws SecurityError (tainted canvas from cross-origin image)
//
// @param {CanvasRenderingContext2D} ctx  Already-drawn canvas (mirrored video)
// @param {Array}  kps   Keypoint array — x already flipped to canvas coords
// @param {number} vw    Canvas display width  (pixels)
// @param {number} vh    Canvas display height (pixels)
// @param {Object} KP    Keypoint index map, e.g. { NOSE: 0, LS: 5, … }
// @returns {{ r:number, g:number, b:number } | null}
// ─────────────────────────────────────────────────────────────────────────────

const PATCH_HALF = 12   // yields a 24×24 px patch

export function sampleFaceRegion(ctx, kps, vw, vh, KP) {
  const nose = kps[KP.NOSE]
  if (!nose || nose.score < 0.4) return null

  // nose.x / nose.y are in canvas pixel space — use directly, no extra mirror
  const cx = Math.round(nose.x)
  const cy = Math.round(nose.y)

  // Clamp so the patch rectangle never reads outside the canvas boundary
  const px = Math.max(0, Math.min(cx - PATCH_HALF, vw - PATCH_HALF * 2))
  const py = Math.max(0, Math.min(cy - PATCH_HALF, vh - PATCH_HALF * 2))

  try {
    const { data } = ctx.getImageData(px, py, PATCH_HALF * 2, PATCH_HALF * 2)
    let rSum = 0, gSum = 0, bSum = 0, n = 0

    for (let i = 0; i < data.length; i += 4) {
      const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      if (luma < 20 || luma > 240) continue   // skip shadow + specular pixels
      rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2]; n++
    }

    if (n < 10) return null   // patch mostly shadow/highlight — not enough skin pixels

    return { r: rSum / n, g: gSum / n, b: bSum / n }
  } catch (err) {
    // SecurityError  → tainted canvas (cross-origin image without CORS headers)
    // Any other error → corrupt frame, out-of-bounds read, etc.
    // Either way, degrade gracefully — don't crash the detect loop.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[skinTone] sampleFaceRegion:', err.name, err.message)
    }
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// detectSkinProfile(ctx, kps, vw, vh, KP)
//
// One-call convenience wrapper: samples the face region then returns
// both skinTone and undertone.
//
// @returns {{ skinTone: string, undertone: 'warm'|'cool'|'neutral' } | null}
// ─────────────────────────────────────────────────────────────────────────────

export function detectSkinProfile(ctx, kps, vw, vh, KP) {
  const sample = sampleFaceRegion(ctx, kps, vw, vh, KP)
  if (!sample) return null

  const { r, g, b } = sample
  return {
    skinTone:  detectSkinToneFromPixels(r, g, b),
    undertone: detectUndertone(r, g, b),
  }
}