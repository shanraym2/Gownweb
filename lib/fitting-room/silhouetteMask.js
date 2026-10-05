/**
 * lib/fitting-room/silhouetteMask.js
 * Person-mask measurement of body width at chosen rows of a captured frame.
 */

const TFJS = [
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.10.0/dist/tf-core.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.10.0/dist/tf-converter.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@4.10.0/dist/tf-backend-webgl.min.js',
]
const SEG = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/body-segmentation@1.0.1/dist/body-segmentation.min.js'

let cachedSegmenter = null
let loading = null

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = Object.assign(document.createElement('script'), { src, async: false })
    s.onload = resolve; s.onerror = () => reject(new Error('Failed: ' + src))
    document.head.appendChild(s)
  })
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i); i.onerror = () => reject(new Error('image load failed')); i.src = src
  })
}

// Reuses the shared segmenter ref when it is filled, otherwise loads one once.
export function ensureSegmenter(ref) {
  if (ref?.current) return Promise.resolve(ref.current)
  if (cachedSegmenter) return Promise.resolve(cachedSegmenter)
  if (!loading) {
    loading = (async () => {
      await Promise.all(TFJS.map(loadScript))
      await window.tf.ready()
      try { await window.tf.setBackend('webgl') } catch { await window.tf.setBackend('cpu') }
      await loadScript(SEG)
      const s = await window.bodySegmentation.createSegmenter(
        window.bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,
        { runtime: 'tfjs' }
      )
      cachedSegmenter = s
      if (ref) ref.current = s
      return s
    })().catch(e => { loading = null; throw e })
  }
  return loading
}

// Width of the person run that contains (or sits nearest) x = cx on row y.
// Gaps up to `gap` px are bridged so one noisy pixel does not end the run.
function runWidth(m, mw, mh, y, cx, gap) {
  const row = Math.round(y)
  if (row < 0 || row >= mh) return null
  const on = x => m[(row * mw + x) * 4 + 3] > 128
  let x0 = Math.round(cx)
  if (x0 < 0 || x0 >= mw) return null
  if (!on(x0)) {
    let found = -1
    for (let d = 1; d < mw * 0.1; d++) {
      if (x0 + d < mw && on(x0 + d)) { found = x0 + d; break }
      if (x0 - d >= 0 && on(x0 - d)) { found = x0 - d; break }
    }
    if (found < 0) return null
    x0 = found
  }
  let l = x0, miss = 0
  for (let x = x0; x >= 0; x--) { if (on(x)) { l = x; miss = 0 } else if (++miss > gap) break }
  let r = x0; miss = 0
  for (let x = x0; x < mw; x++) { if (on(x)) { r = x; miss = 0 } else if (++miss > gap) break }
  return r - l + 1
}

// rows = { smY, hmY, cx } from the best frame (shoulder-mid y, hip-mid y, body centre x), in frame px.
// Returns widths in frame px.
export async function measureBodyFromSnapshot(segmenterRef, dataUrl, rows) {
  const seg = await ensureSegmenter(segmenterRef)
  const img = await loadImage(dataUrl)
  const w = img.naturalWidth, h = img.naturalHeight
  const c = document.createElement('canvas'); c.width = w; c.height = h
  c.getContext('2d').drawImage(img, 0, 0)

  const people = await seg.segmentPeople(c, { multiSegmentation: false, segmentBodyParts: false })
  if (!people?.length) return null
  const md = await window.bodySegmentation.toBinaryMask(
    people, { r: 255, g: 255, b: 255, a: 255 }, { r: 0, g: 0, b: 0, a: 0 }, false
  )
  const mw = md.width, mh = md.height, m = md.data
  const kx = mw / w, ky = mh / h            // the mask may be smaller than the frame
  const gap = Math.max(2, Math.round(6 * kx))
  const torso = rows.hmY - rows.smY

  const sample = (f0, f1, base, pick) => {
    const vals = []
    for (let f = f0; f <= f1 + 1e-6; f += 0.02) {
      const v = runWidth(m, mw, mh, (base + torso * f) * ky, rows.cx * kx, gap)
      if (v) vals.push(v / kx)
    }
    return vals.length >= 3 ? pick(vals) : null
  }
  const median = a => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]
  return {
    chestPx: sample(0.14, 0.22, rows.smY, median),
    waistPx: sample(0.60, 0.80, rows.smY, a => Math.min(...a)),   // narrowest in the waist band
    hipPx:   sample(0.02, 0.22, rows.hmY, a => Math.max(...a)),   // widest in the hip band
  }
}