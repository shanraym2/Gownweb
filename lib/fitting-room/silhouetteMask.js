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
  const T  = rows.hmY - rows.smY
  const x0 = Math.max(0, Math.round(rows.cx - T * 1.5)), y0 = Math.max(0, Math.round(rows.smY - T))
  const w  = Math.min(img.naturalWidth,  Math.round(rows.cx + T * 1.5)) - x0
  const h  = Math.min(img.naturalHeight, Math.round(rows.hmY + T * 2.6)) - y0
  const c  = document.createElement('canvas'); c.width = w; c.height = h
  c.getContext('2d').drawImage(img, x0, y0, w, h, 0, 0, w, h)
  rows = { smY: rows.smY - y0, hmY: rows.hmY - y0, cx: rows.cx - x0 }

  const people = await seg.segmentPeople(c, { multiSegmentation: false, segmentBodyParts: false })
  if (!people?.length) return null
  try {
    const raw = await people[0].mask.toImageData()
    const mx = [0, 0, 0, 0]
    for (let i = 0; i < raw.data.length; i++) if (raw.data[i] > mx[i % 4]) mx[i % 4] = raw.data[i]
    console.log('[mask raw]', JSON.stringify({ type: people[0].mask.getUnderlyingType?.(), w: raw.width, h: raw.height, maxRGBA: mx }))
  } catch (e) { console.warn('[mask raw]', e) }
  // The model's confidence can peak below 0.5 for a small full-body figure, so
  // threshold relative to this mask's own maximum instead of a fixed 0.5.
  const raw = await people[0].mask.toImageData()
  const mw = raw.width, mh = raw.height
  let peak = 0
  for (let i = 3; i < raw.data.length; i += 4) if (raw.data[i] > peak) peak = raw.data[i]
  if (peak < 40) return null
  const cut = peak * 0.5
  const m = new Uint8ClampedArray(raw.data.length)
  for (let i = 3; i < raw.data.length; i += 4) m[i] = raw.data[i] > cut ? 255 : 0
  const kx = mw / w, ky = mh / h            // the mask may be smaller than the frame
  const gap = Math.max(2, Math.round(6 * kx))
  const torso = rows.hmY - rows.smY
  let onCount = 0
  for (let i = 3; i < m.length; i += 4) if (m[i] > 128) onCount++
  console.log('[mask]', JSON.stringify({ w, h, mw, mh, onPct: +(onCount / (mw * mh) * 100).toFixed(1), rows, people: people.length }))

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
    chestPx: sample(0.28, 0.38, rows.smY, median),
    waistPx: sample(0.60, 0.80, rows.smY, a => Math.min(...a)),   // narrowest in the waist band
    hipPx:   sample(0.02, 0.22, rows.hmY, a => Math.max(...a)),   // widest in the hip band
  }
}