/**
 * lib/fitting-room/matte.js
 *
 * Gown cut-out for the try-on: product photo -> transparent WebP/PNG.
 * The renderer (glGownRenderer.js) only takes the GL path when the image has
 * transparent corners, so this is what moves a gown off the legacy
 * "raw rectangle" draw.
 *
 * Pipeline (all in the staff member's browser, nothing is uploaded):
 *   1. BiRefNet_lite (MIT) -> subject alpha
 *   2. MediaPipe multiclass selfie segmenter (Apache-2.0) -> remove hair / skin /
 *      face of a human model, so only the garment is left
 *   3. keep the main blob(s), clean the edge, crop, force transparent corners
 *
 * Steps 1-2 need the browser; everything in the "pure helpers" section is
 * DOM-free so it can be unit-tested in Node.
 */

export const MATTE_MAX = 2048                       // matches MAX_TEX in glGownRenderer.js
const BIREF_ID  = 'onnx-community/BiRefNet_lite'    // same id as the model card's example
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'
const PERSON_CLASSES = [1, 2, 3]                    // 1 hair, 2 body-skin, 3 face-skin (4 clothes and 5 others are kept)

// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const LUT = (() => {
  const t = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) {
    const x = Math.min(Math.max((i / 255 - 0.15) / 0.7, 0), 1)
    t[i] = Math.round(255 * x * x * (3 - 2 * x))
  }
  return t
})()

// Push the model's soft probabilities toward 0/1 (keeps a thin soft edge).
export function hardenAlpha(a) {
  for (let i = 0; i < a.length; i++) a[i] = LUT[a[i]]
}

// Separable binary dilation (max filter), radius r.
export function dilate(src, w, h, r) {
  if (r <= 0) return src
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let m = 0
      const a = Math.max(0, x - r), b = Math.min(w - 1, x + r)
      for (let k = a; k <= b; k++) if (src[row + k]) { m = 1; break }
      tmp[row + x] = m
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0
      const a = Math.max(0, y - r), b = Math.min(h - 1, y + r)
      for (let k = a; k <= b; k++) if (tmp[k * w + x]) { m = 1; break }
      out[y * w + x] = m
    }
  }
  return out
}

// Multiply alpha by (1 - classMask), where the class map (cw x ch) is
// dilated by `grow` px and bilinearly upsampled so the cut gets a soft edge.
// Returns the fraction of the class map that was removed (0..1).
export function removeClassesFromAlpha(alpha, w, h, cat, cw, ch, { classes = PERSON_CLASSES, grow = 2 } = {}) {
  const set = new Set(classes)
  const mask = new Uint8Array(cw * ch)
  let cnt = 0
  for (let i = 0; i < mask.length; i++) if (set.has(cat[i])) { mask[i] = 1; cnt++ }
  if (!cnt) return 0
  const d = dilate(mask, cw, ch, grow)

  const x0 = new Int32Array(w), x1 = new Int32Array(w), tx = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    const fx = Math.min(Math.max((x + 0.5) * cw / w - 0.5, 0), cw - 1)
    x0[x] = Math.floor(fx); x1[x] = Math.min(x0[x] + 1, cw - 1); tx[x] = fx - x0[x]
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.min(Math.max((y + 0.5) * ch / h - 0.5, 0), ch - 1)
    const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, ch - 1), ty = fy - y0
    const r0 = y0 * cw, r1 = y1 * cw
    for (let x = 0; x < w; x++) {
      const a = d[r0 + x0[x]] * (1 - tx[x]) + d[r0 + x1[x]] * tx[x]
      const b = d[r1 + x0[x]] * (1 - tx[x]) + d[r1 + x1[x]] * tx[x]
      const v = a * (1 - ty) + b * ty
      if (v > 0) alpha[y * w + x] = Math.round(alpha[y * w + x] * (1 - v))
    }
  }
  return cnt / mask.length
}

// Keep the biggest connected blob plus any blob >= minFrac of it (a gown with a
// detached veil/train piece), drop the rest (props, stands, stray shadows).
export function keepMainBlobs(alpha, w, h, { thr = 128, minFrac = 0.02, grow = 3 } = {}) {
  const n = w * h
  const lab = new Int32Array(n)
  const stack = new Int32Array(n)
  const sizes = [0]
  let next = 0
  for (let s = 0; s < n; s++) {
    if (lab[s] || alpha[s] < thr) continue
    next++
    let sp = 0, size = 0
    stack[sp++] = s; lab[s] = next
    while (sp) {
      const p = stack[--sp]; size++
      const x = p % w
      if (x > 0     && !lab[p - 1] && alpha[p - 1] >= thr) { lab[p - 1] = next; stack[sp++] = p - 1 }
      if (x < w - 1 && !lab[p + 1] && alpha[p + 1] >= thr) { lab[p + 1] = next; stack[sp++] = p + 1 }
      if (p >= w    && !lab[p - w] && alpha[p - w] >= thr) { lab[p - w] = next; stack[sp++] = p - w }
      if (p < n - w && !lab[p + w] && alpha[p + w] >= thr) { lab[p + w] = next; stack[sp++] = p + w }
    }
    sizes.push(size)
  }
  if (!next) return { blobs: 0, kept: 0, mainPx: 0 }
  let max = 0
  for (let l = 1; l <= next; l++) if (sizes[l] > max) max = sizes[l]
  const keepLab = new Uint8Array(next + 1)
  let kept = 0
  for (let l = 1; l <= next; l++) if (sizes[l] >= minFrac * max) { keepLab[l] = 1; kept++ }
  const keep = new Uint8Array(n)
  for (let i = 0; i < n; i++) keep[i] = keepLab[lab[i]]
  const k2 = dilate(keep, w, h, grow)           // keeps the soft edge around kept blobs
  for (let i = 0; i < n; i++) if (!k2[i]) alpha[i] = 0
  return { blobs: next, kept, mainPx: max }
}

// Median colour of the photo's outer ring = the studio background.
export function estimateBg(rgba, w, h) {
  const step = Math.max(1, Math.floor(Math.min(w, h) / 64))
  const R = [], G = [], B = []
  const push = (x, y) => { const j = (y * w + x) * 4; R.push(rgba[j]); G.push(rgba[j + 1]); B.push(rgba[j + 2]) }
  for (let x = 0; x < w; x += step) { push(x, 0); push(x, h - 1) }
  for (let y = 0; y < h; y += step) { push(0, y); push(w - 1, y) }
  const med = a => { a.sort((p, q) => p - q); return a[a.length >> 1] }
  return [med(R), med(G), med(B)]
}

// Remove the background colour that bled into semi-transparent edge pixels.
export function decontaminate(rgba, w, h, bg) {
  const n = w * h
  for (let i = 0; i < n; i++) {
    const j = i * 4, a = rgba[j + 3]
    if (a < 32 || a > 249) continue
    const al = a / 255
    for (let c = 0; c < 3; c++) {
      const v = (rgba[j + c] - (1 - al) * bg[c]) / al
      rgba[j + c] = v < 0 ? 0 : v > 255 ? 255 : v
    }
  }
}

export function alphaBBox(alpha, w, h, thr = 16) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (alpha[row + x] >= thr) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

// Quality report for the admin: warnings are advice, `ok:false` means "do not use".
export function analyzeMatte(alpha, w, h) {
  const bbox = alphaBBox(alpha, w, h)
  const warnings = []
  if (!bbox) return { ok: false, coverage: 0, bbox: null, warnings: ['Nothing was detected. Is the gown in the photo?'] }
  let on = 0
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > 127) on++
  const coverage = on / alpha.length
  const bw = bbox.x1 - bbox.x0, bh = bbox.y1 - bbox.y0

  const edgeFrac = (get, len) => { let c = 0; for (let i = 0; i < len; i++) if (get(i) > 127) c++; return c / len }
  const sides = []
  if (edgeFrac(i => alpha[i], w) > 0.01) sides.push('top')
  if (edgeFrac(i => alpha[(h - 1) * w + i], w) > 0.01) sides.push('bottom')
  if (edgeFrac(i => alpha[i * w], h) > 0.01) sides.push('left')
  if (edgeFrac(i => alpha[i * w + w - 1], h) > 0.01) sides.push('right')
  if (sides.length) warnings.push(`The gown touches the ${sides.join(' / ')} edge of the photo, so part of it may be cut off.`)
  if (coverage < 0.04) warnings.push('The gown fills a very small part of the photo. Try a tighter or higher-resolution shot.')
  if (bh / bw < 1.0) warnings.push('The cut-out is wider than tall. The try-on expects a full-length, front-facing gown.')
  return { ok: coverage >= 0.01, coverage, bbox, warnings }
}

// ─────────────────────────────────────────────────────────────────────────────
// BROWSER PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

let _bire = null
async function loadBiRefNet(onStatus) {
  if (_bire) return _bire
  // Loaded from the CDN at runtime so webpack never bundles the ONNX runtime.
  const tf = await import(
    /* webpackIgnore: true */
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0'
  )
  const { AutoModel, AutoProcessor } = tf
  const hasGpu = typeof navigator !== 'undefined' && !!navigator.gpu
  let model = null
  if (hasGpu) {
    onStatus('Loading cut-out model (first run downloads ~200 MB, then it is cached)…')
    try { model = await AutoModel.from_pretrained(BIREF_ID, { dtype: 'fp32', device: 'webgpu' }) }
    catch (e) { console.warn('[matte] WebGPU load failed, falling back to CPU:', e) }
  }
  if (!model) {
    onStatus('No usable WebGPU, loading the model on CPU. Expect a minute per photo.')
    model = await AutoModel.from_pretrained(BIREF_ID, { dtype: 'fp32' })
  }
  const processor = await AutoProcessor.from_pretrained(BIREF_ID)
  _bire = { tf, model, processor }
  return _bire
}

async function subjectAlpha(canvas, W, H, onStatus) {
  const { tf, model, processor } = await loadBiRefNet(onStatus)
  onStatus('Finding the gown…')
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
  const image = await tf.RawImage.fromBlob(blob)
  const { pixel_values } = await processor(image)
  const { output_image } = await model({ input_image: pixel_values })
  const mask = await tf.RawImage.fromTensor(output_image[0].sigmoid().mul(255).to('uint8')).resize(W, H)
  if (mask.channels === 1) return new Uint8ClampedArray(mask.data)
  const out = new Uint8ClampedArray(W * H)               // defensive: take channel 0
  for (let i = 0; i < out.length; i++) out[i] = mask.data[i * mask.channels]
  return out
}

let _seg = null
async function personClasses(canvas) {
  if (!_seg) {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE)
    _seg = await ImageSegmenter.createFromOptions(vision, {
      // CPU on purpose: the GPU delegate scrambles the class ids on iOS Safari
      baseOptions: { modelAssetPath: SEG_MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    })
  }
  const k = Math.min(1, 512 / Math.max(canvas.width, canvas.height))
  const small = document.createElement('canvas')
  small.width = Math.round(canvas.width * k); small.height = Math.round(canvas.height * k)
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height)
  const res = _seg.segment(small)
  const m = res.categoryMask
  const out = { cat: m.getAsUint8Array().slice(), cw: m.width, ch: m.height }
  m.close?.(); res.close?.()
  return out
}

/**
 * @param {Blob|File} file
 * @param {{removeSkin?:boolean, format?:'webp'|'png', maxSize?:number, onStatus?:(s:string)=>void}} opts
 *   removeSkin: true for gowns photographed on a human model. Set false for
 *   mannequins, or for sheer / illusion lace, where skin shows through the fabric.
 * @returns {{blob:Blob, url:string, width:number, height:number, ok:boolean, warnings:string[], coverage:number, ms:number}}
 */
export async function matteGown(file, { removeSkin = true, format = 'webp', maxSize = MATTE_MAX, onStatus = () => {} } = {}) {
  const t0 = performance.now()
  const warnings = []
  onStatus('Reading the photo…')
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const k = Math.min(1, maxSize / Math.max(bmp.width, bmp.height))
  const W = Math.round(bmp.width * k), H = Math.round(bmp.height * k)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const cx = cv.getContext('2d', { willReadFrequently: true })
  cx.imageSmoothingQuality = 'high'
  cx.drawImage(bmp, 0, 0, W, H); bmp.close?.()
  const img = cx.getImageData(0, 0, W, H)

  const alpha = await subjectAlpha(cv, W, H, onStatus)
  hardenAlpha(alpha)

  if (removeSkin) {
    onStatus('Removing the model (hair, face, skin)…')
    try {
      const { cat, cw, ch } = await personClasses(cv)
      const removed = removeClassesFromAlpha(alpha, W, H, cat, cw, ch)
      if (removed > 0.02) warnings.push('A person was detected and their hair / skin was removed. If sheer lace or sleeves went missing, run again with "Remove model" off.')
    } catch (e) {
      console.warn('[matte] person removal failed:', e)
      warnings.push('Could not remove the model automatically. Check the preview for a face or arms.')
    }
  }

  onStatus('Cleaning the edges…')
  keepMainBlobs(alpha, W, H)
  const report = analyzeMatte(alpha, W, H)
  warnings.push(...report.warnings)
  if (!report.ok) {
    return { blob: null, url: null, width: W, height: H, ok: false, warnings, coverage: report.coverage, ms: performance.now() - t0 }
  }

  const rgba = img.data
  decontaminate(rgba, W, H, estimateBg(rgba, W, H))
  for (let i = 0; i < alpha.length; i++) rgba[i * 4 + 3] = alpha[i]
  cx.putImageData(img, 0, 0)

  // crop to the gown + 1.5% padding, so the corners are guaranteed transparent
  const bb = report.bbox
  const pad = Math.round(Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.015) + 2
  const sx = Math.max(0, bb.x0 - pad), sy = Math.max(0, bb.y0 - pad)
  const ex = Math.min(W, bb.x1 + pad), ey = Math.min(H, bb.y1 + pad)
  const out = document.createElement('canvas'); out.width = ex - sx; out.height = ey - sy
  const ox = out.getContext('2d')
  ox.drawImage(cv, sx, sy, out.width, out.height, 0, 0, out.width, out.height)
  // force the 1px border transparent even where the gown reaches the photo edge
  ox.clearRect(0, 0, out.width, 1); ox.clearRect(0, out.height - 1, out.width, 1)
  ox.clearRect(0, 0, 1, out.height); ox.clearRect(out.width - 1, 0, 1, out.height)

    if (out.height < 1400) warnings.push(`The cut-out is only ${out.height}px tall, so it will look soft on large screens. Use a photo at least 1500px tall if you can.`)
  onStatus('Saving…')
  let blob = null
  if (format === 'webp') {
    blob = await new Promise(r => out.toBlob(r, 'image/webp', 0.92))
    if (blob && blob.type !== 'image/webp') blob = null          // Safari silently returns PNG
  }
  if (!blob) blob = await new Promise(r => out.toBlob(r, 'image/png'))

  return {
        blob, canvas: out, url: URL.createObjectURL(blob), width: out.width, height: out.height,
    ok: true, warnings, coverage: report.coverage, ms: performance.now() - t0,
  }
}