  /**
   * lib/fitting-room/poseUtils.js
   *
   * Pure geometry + pose analysis utilities for the fitting room scan pipeline.
   * No React, no side-effects — safe to import anywhere and unit-test directly.
   *
   * Exports
   * ───────
   *   KP                      Keypoint index map (MoveNet SINGLEPOSE_THUNDER)
   *   CONF                    Minimum keypoint confidence threshold
   *   HIGH_SEVERITY_ISSUES    Set of pose issues that pause frame accumulation
   *   HIP_KP_CORRECTION       Flat anatomical correction for trochanteric breadth
   *   HIST_SIZE               History buffer capacity (frames)
   *   IQM_LO                  Lower trim fraction for interquartile mean
   *   IQM_HI                  Upper trim fraction for interquartile mean
   *
   *   dist(a, b)              Euclidean distance between two keypoints
   *   mid(a, b)               Midpoint between two keypoints
   *   lerpPt(a, b, t)         Linear interpolation between two keypoints
   *   smoothKpsDisplay(prev, curr, t)   Temporal smoothing for display keypoints
   *   iqm(arr)                Interquartile mean — used for robust pixel history
   *
   *   checkLighting(ctx, vw, vh)        Lighting quality gate for frame accumulation
   *   shouldAccumulateFrame(issues, lightingOk)  Single gate for history pushes
   *
   *   analyzePose(kps, vw, vh)          Full pose quality analysis
   *   detectBodyShapeFromPose(kps, vw)  Body shape classification
   *                                     NOTE: for style recommendations only —
   *                                     NOT used to select measurement multipliers
   */

  // ─────────────────────────────────────────────────────────────────────────────
  // CONSTANTS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * MoveNet SINGLEPOSE_THUNDER keypoint indices.
   * Reference: https://github.com/tensorflow/tfjs-models/tree/master/pose-detection
   */
  export const KP = {
    NOSE: 0,
    LS:   5,   // left shoulder
    RS:   6,   // right shoulder
    LE:   7,   // left elbow
    RE:   8,   // right elbow
    LH:  11,   // left hip
    RH:  12,   // right hip
    LK:  13,   // left knee
    RK:  14,   // right knee
    LA:  15,   // left ankle
    RA:  16,   // right ankle
  }

  /** Minimum keypoint confidence score to treat a point as valid. */
  export const CONF = 0.45

  /**
   * Pose issues that are severe enough to stop accumulating clean frames
   * and penalise the goodFrames counter. Minor issues (no_legs, head_cut)
   * let the scan continue accumulating at a reduced rate.
   *
   * too_dark and too_bright are included so the lighting gate integrates
   * cleanly with the same accumulation-pause logic used for pose issues.
   */
  export const HIGH_SEVERITY_ISSUES = new Set([
    'rotated',
    'tilted',
    'too_close',
    'too_dark',
    'too_bright',
  ])

  /**
   * MoveNet places hip keypoints at the iliac crest / hip joint, not at the
   * widest trochanteric breadth. For women this is typically 15–20% narrower
   * than true hip breadth. This flat correction is anatomically constant across
   * body shapes — it is NOT shape-specific.
   *
   * Applied in detectBodyShapeFromPose() for shape classification ratios, and
   * in ScanPanel's detect loop for the hip pixel span before applying the hip
   * circumference multiplier.
   */
  export const HIP_KP_CORRECTION = 1.18

  /**
   * History buffer capacity in frames.
   * Larger than the previous 60-frame cap to give IQM more data points,
   * which reduces scan-to-scan variance when the subject holds still.
   */
  export const HIST_SIZE = 90

  /**
   * Lower trim fraction for iqm(). Frames in the bottom IQM_LO quantile
   * are discarded before averaging.
   */
  export const IQM_LO = 0.25

  /**
   * Upper trim fraction for iqm(). Frames in the top (1 - IQM_HI) quantile
   * are discarded before averaging.
   */
  export const IQM_HI = 0.75

  // ─────────────────────────────────────────────────────────────────────────────
  // GEOMETRY HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Euclidean distance between two keypoints.
   * @param {{ x:number, y:number }} a
   * @param {{ x:number, y:number }} b
   * @returns {number}
   */
  export function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  /**
   * Midpoint between two keypoints.
   * @param {{ x:number, y:number }} a
   * @param {{ x:number, y:number }} b
   * @returns {{ x:number, y:number }}
   */
  export function mid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  /**
   * Linear interpolation between two keypoints.
   * score is taken from b (the target frame).
   * @param {{ x:number, y:number, score:number }} a  previous keypoint
   * @param {{ x:number, y:number, score:number }} b  current keypoint
   * @param {number} t  interpolation factor (0 = full previous, 1 = full current)
   * @returns {{ x:number, y:number, score:number }}
   */
  export function lerpPt(a, b, t) {
    return {
      x:     a.x + (b.x - a.x) * t,
      y:     a.y + (b.y - a.y) * t,
      score: b.score,
    }
  }

  /**
   * Temporally smooth keypoints for display to reduce jitter.
   * Uses lerpPt() per keypoint. Does not affect measurement history —
   * the raw (unsmoothed) keypoints are used for pixel accumulation.
   *
   * @param {Array|null} prev   Previous smoothed keypoint array, or null on first frame
   * @param {Array}      curr   Current raw keypoint array (x already flipped to canvas coords)
   * @param {number}     t      Interpolation factor (default 0.35 — biased toward previous)
   * @returns {Array}
   */
  export function smoothKpsDisplay(prev, curr, t = 0.35) {
    if (!prev) return curr
    return curr.map((k, i) => lerpPt(prev[i], k, t))
  }

  /**
   * Interquartile mean — trims the bottom IQM_LO fraction and top
   * (1 - IQM_HI) fraction of values before averaging. Used to build a
   * robust history of pixel spans that is not skewed by frames where the
   * subject moved or tilted.
   *
   * Falls back to the median when the trimmed slice is empty (small arrays).
   *
   * @param {number[]} arr
   * @returns {number}
   */
  export function iqm(arr) {
    if (!arr.length) return 0
    const s  = [...arr].sort((a, b) => a - b)
    const lo = Math.floor(s.length * IQM_LO)
    const hi = Math.ceil(s.length  * IQM_HI)
    const trimmed = s.slice(lo, hi)
    if (!trimmed.length) return s[Math.floor(s.length / 2)]
    return trimmed.reduce((a, b) => a + b, 0) / trimmed.length
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LIGHTING GATE
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * checkLighting(ctx, vw, vh)
   *
   * Evaluates whether the current frame has acceptable lighting for measurement
   * accumulation. Samples a 20×20 grid of pixels from the central 60% of the
   * canvas and computes mean luminance. Frames outside the acceptable luma range
   * are excluded from swHistRef / hipHistRef accumulation.
   *
   * Call this after ctx.drawImage(video) but before estimatePoses(), so the
   * canvas already contains the current mirrored frame.
   *
   * Luminance formula: Y = 0.299R + 0.587G + 0.114B
   * Thresholds:
   *   luma < 40  → too_dark  (deep shadow, night, no lighting)
   *   luma > 220 → too_bright (direct sun, overexposed backlight)
   *   40–220     → ok
   *
   * @param {CanvasRenderingContext2D} ctx  Canvas 2D context (frame already drawn)
   * @param {number}                   vw   Canvas width in pixels
   * @param {number}                   vh   Canvas height in pixels
   *
   * @returns {{
   *   ok:     boolean,
   *   luma:   number,
   *   reason: 'ok' | 'too_dark' | 'too_bright'
   * }}
   */
  export function checkLighting(ctx, vw, vh) {
    const GRID      = 20
    const X_START   = vw * 0.20
    const X_END     = vw * 0.80
    const Y_START   = vh * 0.20
    const Y_END     = vh * 0.80
    const X_STEP    = (X_END - X_START) / (GRID - 1)
    const Y_STEP    = (Y_END - Y_START) / (GRID - 1)

    let totalLuma = 0
    let samples   = 0

    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const px = Math.round(X_START + col * X_STEP)
        const py = Math.round(Y_START + row * Y_STEP)

        try {
          const pixel = ctx.getImageData(px, py, 1, 1).data
          const luma  = 0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2]
          totalLuma  += luma
          samples    += 1
        } catch {
          // getImageData throws on tainted canvas (cross-origin image drawn).
          // Skip the sample rather than crashing the detect loop.
        }
      }
    }

    if (samples === 0) {
      // Canvas is tainted or empty — allow scan to continue, don't block on lighting
      return { ok: true, luma: 128, reason: 'ok' }
    }

    const luma = totalLuma / samples

    if (luma < 40)  return { ok: false, luma, reason: 'too_dark'  }
    if (luma > 220) return { ok: false, luma, reason: 'too_bright' }
    return { ok: true, luma, reason: 'ok' }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FRAME ACCUMULATION GATE
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * shouldAccumulateFrame(issues, lightingOk)
   *
   * Single gating function that decides whether the current frame's pixel
   * measurements should be pushed into swHistRef / hipHistRef.
   *
   * Returns true only when ALL of the following hold:
   *   a. lightingOk === true  (frame passed checkLighting)
   *   b. issues contains no member of HIGH_SEVERITY_ISSUES
   *      (subject is not rotated, tilted, too close, too dark, or too bright)
   *
   * This replaces the previous inline guard scattered across ScanPanel so that
   * the accumulation policy is defined in one place and is straightforward to
   * unit-test.
   *
   * Note: scaleOk (px-per-cm consistency) is a separate numeric guard checked
   * in ScanPanel after this function — it is intentionally kept outside here
   * because it depends on runtime history state, not pose/lighting quality.
   *
   * @param {string[]} issues     Issue IDs returned by analyzePose()
   * @param {boolean}  lightingOk True when checkLighting() returned ok === true
   * @returns {boolean}
   */
  export function shouldAccumulateFrame(issues, lightingOk) {
    if (!lightingOk) return false
    return !issues.some(i => HIGH_SEVERITY_ISSUES.has(i))
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // POSE ANALYSIS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * analyzePose(kps, vw, vh)
   *
   * Evaluates pose quality and returns a structured result used by the scan
   * loop to decide whether to accumulate a frame, display guidance, and
   * whether to enable the Lock button.
   *
   * @param {Array|null} kps  Keypoint array (x already flipped to canvas coords), or null
   * @param {number}     vw   Canvas / video width in pixels
   * @param {number}     vh   Canvas / video height in pixels
   *
   * @returns {{
   *   ok:          boolean,    true when pose is valid and no issues detected
   *   issues:      string[],   ordered list of issue IDs (first = most critical)
   *   shouldersOk: boolean,
   *   hipsOk:      boolean,
   *   kneesOk:     boolean,
   *   anklesOk:    boolean,
   *   facingBack:  boolean,    true when subject appears to face away from camera
   * }}
   */
  export function analyzePose(kps, vw, vh) {
    if (!kps) return { ok: false, issues: ['no_pose'], facingBack: false }

    const ls   = kps[KP.LS],  rs   = kps[KP.RS]
    const lh   = kps[KP.LH],  rh   = kps[KP.RH]
    const lk   = kps[KP.LK],  rk   = kps[KP.RK]
    const la   = kps[KP.LA],  ra   = kps[KP.RA]
    const nose = kps[KP.NOSE]
    const issues = []

    const shouldersOk = ls?.score > CONF && rs?.score > CONF
    const hipsOk      = lh?.score > CONF && rh?.score > CONF
    const kneesOk     = lk?.score > CONF && rk?.score > CONF
    const anklesOk    = la?.score > CONF && ra?.score > CONF

    const margin        = vw * 0.08
    const tooCloseFrame = shouldersOk && (
      ls.x < margin ||
      rs.x > vw - margin ||
      (hipsOk && mid(lh, rh).y > vh * 0.72)
    )

    const faceVisible    = nose && nose.score > 0.30
    const bodyStable     = shouldersOk && hipsOk
    const shoulderSpan   = shouldersOk ? dist(ls, rs) : 0
    const bodyWideEnough = shoulderSpan > vw * 0.10
    const facingBack     = !faceVisible && bodyStable && bodyWideEnough && !tooCloseFrame

    // Early return — can't assess tilt/rotation without shoulders
    if (!shouldersOk) {
      issues.push('no_shoulders')
      return { ok: false, issues, shouldersOk, hipsOk, kneesOk, anklesOk, facingBack }
    }
    if (!hipsOk) {
      issues.push('no_hips')
      return { ok: false, issues, shouldersOk, hipsOk, kneesOk, anklesOk, facingBack }
    }

    // Tilt / rotation checks (require both shoulders and hips)
    const shoulderTilt = Math.abs(ls.y - rs.y)
    const hipTilt      = Math.abs(lh.y - rh.y)
    const torsoOffset  = Math.abs(mid(ls, rs).x - mid(lh, rh).x)

    if (shoulderTilt > vh * 0.035 || hipTilt > vh * 0.04) issues.push('tilted')
    if (torsoOffset  > vw * 0.06)                          issues.push('rotated')

    if (!kneesOk) issues.push('no_legs')
    if (tooCloseFrame) issues.push('too_close')
    if (nose?.score > 0.15 && nose.y < vh * 0.06) issues.push('head_cut')

    // If hips are very low in frame and knees aren't visible, subject is too close
    if (!kneesOk && hipsOk && mid(lh, rh).y > vh * 0.55 && !tooCloseFrame) {
      issues.unshift('too_close')
    }
    if (kneesOk && !anklesOk && mid(lk, rk).y < vh * 0.82) {
      issues.push('too_close')
    }

    const ok = shouldersOk && hipsOk && issues.length === 0
    return { ok, issues, shouldersOk, hipsOk, kneesOk, anklesOk, facingBack }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BODY SHAPE DETECTION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * detectBodyShapeFromPose(kps, vw)
   *
   * Classifies the subject's body shape using shoulder/hip keypoint geometry.
   *
   * ⚠️  FOR STYLE RECOMMENDATIONS ONLY.
   * This result is passed to the Style panel (scoreGown) and stored in
   * profile.bodyShape. It must NOT be used to select measurement multipliers —
   * that would create a circular bias where a narrow hip reading triggers a
   * shape with a lower hip multiplier, compounding the underestimate.
   * Measurement multipliers are segment-only (see measurementUtils.js).
   *
   * Thresholds:
   *   sToH > 1.28  → invertedTriangle  (raised from 1.18 to reduce false positives)
   *   sToH < 0.82  → pear
   *   wToH > 0.91 && sToH > 0.92  → rectangle
   *   wToH < 0.80  → hourglass         (widened from 0.78)
   *   wToH > 0.89 && sToH < 0.92  → apple
   *   heightFraction < 0.19  → petite
   *
   * @param {Array}  kps  Keypoint array (x flipped to canvas coords)
   * @param {number} vw   Canvas width in pixels (unused currently, reserved)
   * @returns {string|null}  Body shape ID, or null if confidence is too low
   */
  export function detectBodyShapeFromPose(kps, vw) {
    const ls = kps[KP.LS], rs = kps[KP.RS]
    const lh = kps[KP.LH], rh = kps[KP.RH]

    if (!ls || !rs || !lh || !rh) return null
    if (ls.score < CONF || rs.score < CONF || lh.score < CONF || rh.score < CONF) return null

    const shoulderW  = dist(ls, rs)
    // Apply trochanteric correction — MoveNet hip KPs are ~18% narrower than true hip breadth
    const hipW       = dist(lh, rh) * HIP_KP_CORRECTION
    const sm         = mid(ls, rs)
    const hm         = mid(lh, rh)
    const torsoH     = hm.y - sm.y

    // Waist proxy: conservative estimate from shoulder width.
    // Raised from 0.72 → 0.80 to avoid over-weighting inverted-triangle classification.
    const waistProxy = shoulderW * 0.80

    const sToH = shoulderW / hipW
    const wToH = waistProxy / hipW

    // Petite: torso is a small fraction of estimated full frame height
    const frameH = kps[KP.LA]?.score > CONF && kps[KP.RA]?.score > CONF
      ? Math.max(kps[KP.LA].y, kps[KP.RA].y) - sm.y
      : torsoH * 4.5
    const heightFraction = torsoH / Math.max(frameH, 1)
    const likelyPetite   = heightFraction < 0.19

    if (likelyPetite)                          return 'petite'
    if (sToH > 1.28)                           return 'invertedTriangle'
    if (sToH < 0.82)                           return 'pear'
    if (wToH > 0.91 && sToH > 0.92)           return 'rectangle'
    if (wToH < 0.80)                           return 'hourglass'
    if (wToH > 0.89 && sToH < 0.92)           return 'apple'
    return null
  }