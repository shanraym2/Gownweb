/**
 * lib/fitting-room/glGownRenderer.js   (stage 4)
 *
 * WebGL2 mesh gown renderer. Renders the gown into an off-screen GL canvas;
 * the caller's 2D ctx composites it with drawImage, so capture, Enhanced mode
 * and the old fallback keep working unchanged.
 *
 * Stage 4 adds, all inside drawGownGL:
 *   - layout.reveal  { plate, mask, margin }  -> real body/clothes that stick
 *     out past the gown edge are replaced by the clean background plate
 *   - layout.tint    [r,g,b]                  -> room colour cast on the gown
 *   - soft hem contact shadow, feathered gown edge
 *
 * Every failure path returns false -> caller falls back to gownWarp.js.
 */
import { getProfile } from './gownWarp.js'
import { seamsFor, snapColumns, coreRowMap, ADV_DEFAULTS } from './calibration.js'

const COLS = 32, ROWS = 64
const MIN_SQUASH = 0.8     // above the waist a row is never squashed below 80% of uniform scale (keeps sleeves/straps)
const MAX_STRETCH = 1.5    // ...and never stretched past 150% of uniform scale (keeps halter straps from ballooning)
const MAX_TEX = 2048
const FEATHER_PX = 0.8     // edge softness, screen px
const SHARPEN = 0.3        // interior sharpening, 0 = off     // edge softness, screen px
const HEM_SHADOW = 0.38    // hem contact shadow strength (0 = off)
const SEAM_BLEND = 0.08    // enhanced: half-width (image fraction) of the bodice-to-skirt scale blend

const clamp  = (v, a, b) => Math.min(Math.max(v, a), b)
const lerp   = (a, b, t) => a + (b - a) * t
const smooth = t => t * t * (3 - 2 * t)

// One smooth width curve through body anchors [[y, width], ...] (monotone cubic, flat ends).
function makeWidthFn(pts) {
  const n = pts.length
  if (n < 2) { const w0 = pts[0]?.[1] ?? 0; return () => w0 }
  const h = [], d = []
  for (let i = 0; i < n - 1; i++) { h[i] = Math.max(pts[i + 1][0] - pts[i][0], 1e-6); d[i] = (pts[i + 1][1] - pts[i][1]) / h[i] }
  const m = new Array(n).fill(0)
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]) }
  }
  return y => {
    if (y <= pts[0][0]) return pts[0][1]
    if (y >= pts[n - 1][0]) return pts[n - 1][1]
    let i = 0
    while (i < n - 2 && y > pts[i + 1][0]) i++
    const t = (y - pts[i][0]) / h[i], t2 = t * t, t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * pts[i][1] + (t3 - 2 * t2 + t) * h[i] * m[i]
         + (-2 * t3 + 3 * t2) * pts[i + 1][1] + (t3 - t2) * h[i] * m[i + 1]
  }
}

// image-row fraction f <-> screen y. Pins top / waist / hem exactly, but the vertical
// scale blends smoothly across the waist (b > 0) instead of kinking. b = 0 = old linear map.
function buildYMap(wf, topY, waistY, bottomY, b = 0) {
  const Hu = waistY - topY, Hl = bottomY - waistY
  const linear = () => {
    const ka = Hu / wf, kb = Hl / (1 - wf)
    return { ka, kb,
      yOf: f => (f <= wf ? topY + ka * f : waistY + kb * (f - wf)),
      fOf: y => (y <= waistY ? clamp((y - topY) / ka, 0, wf) : clamp(wf + (y - waistY) / kb, wf, 1)) }
  }
  if (!(b > 0) || !(Hu > 0) || !(Hl > 0)) return linear()
  const Nu = 96, Nl = 160, N = Nu + Nl
  const F = new Float64Array(N + 1), CS = new Float64Array(N + 1), CT = new Float64Array(N + 1)
  const blend = f => smooth(clamp((f - (wf - b)) / (2 * b), 0, 1))
  for (let i = 0; i <= N; i++) F[i] = i <= Nu ? wf * i / Nu : wf + (1 - wf) * (i - Nu) / Nl
  for (let i = 1; i <= N; i++) {
    const df = F[i] - F[i - 1], s0 = blend(F[i - 1]), s1 = blend(F[i])
    CS[i] = CS[i - 1] + df * (s0 + s1) / 2
    CT[i] = CT[i - 1] + df * ((1 - s0) + (1 - s1)) / 2
  }
  const I1 = CT[Nu], J1 = CS[Nu], I2 = CT[N] - CT[Nu], J2 = CS[N] - CS[Nu]
  const det = I1 * J2 - J1 * I2
  if (!(Math.abs(det) > 1e-9)) return linear()
  const ka = (Hu * J2 - J1 * Hl) / det, kb = (I1 * Hl - I2 * Hu) / det
  if (!(ka > 0 && kb > 0)) return linear()
  const Y = new Float64Array(N + 1)
  for (let i = 0; i <= N; i++) Y[i] = topY + ka * CT[i] + kb * CS[i]
  const yOf = f => {
    f = clamp(f, 0, 1)
    const p = f <= wf ? (f / wf) * Nu : Nu + ((f - wf) / (1 - wf)) * Nl
    const i = Math.min(Math.floor(p), N - 1)
    return Y[i] + (Y[i + 1] - Y[i]) * (p - i)
  }
  const fOf = y => {
    if (y <= Y[0]) return 0
    if (y >= Y[N]) return 1
    let lo = 0, hi = N
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (Y[mid] <= y) lo = mid; else hi = mid }
    return F[lo] + (F[lo + 1] - F[lo]) * ((y - Y[lo]) / Math.max(Y[lo + 1] - Y[lo], 1e-9))
  }
  return { ka, kb, yOf, fOf }
}

const VERT = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUV;
uniform vec2 uRes;
out vec2 vUV;
void main() {
  vec2 c = aPos / uRes * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  vUV = aUV;
}`
const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uAlpha;
uniform float uBright;
uniform float uSharp;
uniform vec3  uTint;
uniform vec2  uFeather;
uniform float uShade;
uniform float uWaistV;
uniform vec2  uVSpan;
out vec4 o;
void main() {
  vec4 t  = texture(uTex, vUV);
  vec4 n1 = texture(uTex, vUV + vec2(uFeather.x, 0.0));
  vec4 n2 = texture(uTex, vUV - vec2(uFeather.x, 0.0));
  vec4 n3 = texture(uTex, vUV + vec2(0.0, uFeather.y));
  vec4 n4 = texture(uTex, vUV - vec2(0.0, uFeather.y));
  vec4 avg = (n1 + n2 + n3 + n4) * 0.25;
  // soften the silhouette edge: shrink alpha toward the neighbourhood average
  float k = t.a > 0.001 ? min(1.0, mix(t.a, avg.a, 0.7) / t.a) : 0.0;
  // unsharp mask, interior only, so the edge never gets a halo
  vec3 rgb = t.rgb + uSharp * (t.rgb - avg.rgb) * step(0.98, avg.a);
  float gy = clamp((vUV.y - uVSpan.x) / max(uVSpan.y - uVSpan.x, 1e-4), 0.0, 1.0);
  float wz = (vUV.y - uWaistV) / 0.04;
  float shade = 1.0 - uShade * (0.20 * exp(-wz * wz) + 0.10 * gy + 0.25 * (1.0 - avg.a) * step(0.01, t.a));
  rgb = min(rgb * uBright * uTint * shade, vec3(t.a));
  o = vec4(rgb, t.a) * k * uAlpha;   // premultiplied output
}`

let G = null            // live GL state, rebuilt after context loss
let failed = false      // permanent failure (no WebGL2 / shader error)
let announced = false
// ── cloth (stage 5) ──────────────────────────────────────────────────────────
const CLOTH = true                      // false = skirt hangs rigid, no sway
const swingToK = s => 180 * Math.pow(0.25, 2 * s)   // swing 0.5 = K_HEM (45); 0 = stiff, 1 = loose
const K_HIP = 900, K_HEM = 45           // spring stiffness (1/s²), blended geometrically hip -> hem; lower K_HEM = floppier
const Z_HIP = 0.9, Z_HEM = 0.35         // damping ratio; lower Z_HEM = more swing before it settles
const NV = (ROWS + 1) * (COLS + 1)
const cloth = {
  px: new Float32Array(NV), py: new Float32Array(NV),
  vx: new Float32Array(NV), vy: new Float32Array(NV),
  tx: new Float32Array(NV), ty: new Float32Array(NV),
  dx: new Float32Array(NV), dy: new Float32Array(NV),
  wRow: new Float32Array(ROWS + 1), kRow: new Float32Array(ROWS + 1), cRow: new Float32Array(ROWS + 1),
  img: null, t: 0, acc: 0, ready: false,
}
const SIL = new Float32Array((ROWS + 1) * 3)   // per mesh row: y, left x, right x (this frame)
const XS = new Float32Array(COLS + 1)          // mesh column x-positions in gown-image px

function compile(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src); gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed')
  return s
}

function init() {
  if (G) return G
  if (failed) return null
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false,
    })
    if (!gl) throw new Error('WebGL2 unavailable')

    const prog = gl.createProgram()
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link failed')

    const nV = (ROWS + 1) * (COLS + 1)
    const idx = new Uint16Array(ROWS * COLS * 6)
    let k = 0
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = r * (COLS + 1) + c, b = a + 1, d = a + COLS + 1, e = d + 1
        idx[k++] = a; idx[k++] = d; idx[k++] = b
        idx[k++] = b; idx[k++] = d; idx[k++] = e
      }
    }

    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    const vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, nV * 16, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8)
    const ibo = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)
    gl.bindVertexArray(null)

    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE)

    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); G = null })

    G = {
      canvas, gl, prog, vao, vbo, nIdx: idx.length,
      verts: new Float32Array(nV * 4),
      tex: new WeakMap(),
      u: {
        res:     gl.getUniformLocation(prog, 'uRes'),
        tex:     gl.getUniformLocation(prog, 'uTex'),
        alpha:   gl.getUniformLocation(prog, 'uAlpha'),
        bright:  gl.getUniformLocation(prog, 'uBright'),
        tint:    gl.getUniformLocation(prog, 'uTint'),
        feather: gl.getUniformLocation(prog, 'uFeather'),
        sharp:   gl.getUniformLocation(prog, 'uSharp'),
        shade:   gl.getUniformLocation(prog, 'uShade'),
        waistV:  gl.getUniformLocation(prog, 'uWaistV'),
        vspan:   gl.getUniformLocation(prog, 'uVSpan'),
      },
      maxTex: Math.min(MAX_TEX, gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    }
    return G
  } catch (e) {
    console.warn('[glGownRenderer] disabled, using 2D fallback:', e)
    failed = true; G = null
    return null
  }
}

// One texture per gown image, cached. null = upload failed (e.g. tainted canvas).
function getTex(g, img) {
  let t = g.tex.get(img)
  if (t !== undefined) return t
  const gl = g.gl
  try {
    let src = img
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height
    const k = Math.min(1, g.maxTex / Math.max(iw, ih))
    if (k < 1) {
      const c = document.createElement('canvas')
      c.width = Math.round(iw * k); c.height = Math.round(ih * k)
      const cx = c.getContext('2d')
      cx.imageSmoothingQuality = 'high'
      cx.drawImage(img, 0, 0, c.width, c.height)
      src = c
    }
    t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const an = gl.getExtension('EXT_texture_filter_anisotropic')
    if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)))
  } catch (e) {
    console.warn('[glGownRenderer] texture upload failed, using 2D fallback:', e)
    t = null
  }
  g.tex.set(img, t)
  return t
}

// Light 3-tap smoothing (the old 7-tap blur erased the bust/waist definition).
export function ensureProfile(prof) {
  if (prof.glWid) return
  const B = prof.left.length
  const b3 = arr => arr.map((_, i) => (arr[clamp(i - 1, 0, B - 1)] + arr[i] + arr[clamp(i + 1, 0, B - 1)]) / 3)
  prof.glWid = b3(prof.right.map((r, i) => r - prof.left[i]))
  prof.glCtr = b3(prof.right.map((r, i) => (r + prof.left[i]) / 2))
  prof.glL   = b3(prof.left)
  prof.glR   = b3(prof.right)
}

const at = (arr, f) => {
  const B = arr.length
  const p = clamp(f * B - 0.5, 0, B - 1)
  const i = Math.floor(p)
  return lerp(arr[i], arr[Math.min(i + 1, B - 1)], p - i)
}

// ── Background reveal ────────────────────────────────────────────────────────
// plate (clean background, already mirrored) ∩ person mask (mirrored here)
// ∩ gown silhouette + margin (drawn at 1/8 res, so upscaling feathers its edge).
let polyC = null, layerC = null
function eraseBehind(ctx, rv, vw, vh) {
  const S = 8
  const lw = Math.round(vw), lh = Math.round(vh)
  const pw = Math.ceil(lw / S), ph = Math.ceil(lh / S)
  if (!polyC) { polyC = document.createElement('canvas'); layerC = document.createElement('canvas') }
  if (polyC.width !== pw || polyC.height !== ph) { polyC.width = pw; polyC.height = ph }
  if (layerC.width !== lw || layerC.height !== lh) { layerC.width = lw; layerC.height = lh }

  const m = rv.margin || 0
  const p = polyC.getContext('2d')
  p.setTransform(1, 0, 0, 1, 0, 0); p.clearRect(0, 0, pw, ph)
  p.setTransform(1 / S, 0, 0, 1 / S, 0, 0)
  p.fillStyle = '#fff'
  p.beginPath()
  for (let r = 0; r <= ROWS; r++) {
    const x = SIL[r * 3 + 1] - m, y = SIL[r * 3]
    if (r) p.lineTo(x, y); else p.moveTo(x, y)
  }
  for (let r = ROWS; r >= 0; r--) p.lineTo(SIL[r * 3 + 2] + m, SIL[r * 3])
  p.closePath(); p.fill()

  const l = layerC.getContext('2d')
  l.setTransform(1, 0, 0, 1, 0, 0)
  l.globalCompositeOperation = 'source-over'
  l.clearRect(0, 0, lw, lh)
  l.drawImage(rv.plate, 0, 0, lw, lh)
  l.globalCompositeOperation = 'destination-in'
  l.save(); l.translate(lw, 0); l.scale(-1, 1); l.drawImage(rv.mask, 0, 0, lw, lh); l.restore()
  l.imageSmoothingEnabled = true
  l.drawImage(polyC, 0, 0, lw, lh)
  l.globalCompositeOperation = 'source-over'

  ctx.drawImage(layerC, 0, 0, vw, vh)
}

// Soft elliptical contact shadow under the hem (drawn before the gown).
function drawHemShadow(ctx, opacity, vh, torsoH, strength) {
  if (!(strength > 0)) return
  const yb = SIL[ROWS * 3], xl = SIL[ROWS * 3 + 1], xr = SIL[ROWS * 3 + 2]
  const rx = (xr - xl) / 2
  if (!(rx > 4) || yb > vh - 2) return          // hem off-screen: skip
  const ry = Math.max(rx * 0.1, torsoH * 0.03)
  ctx.save()
  ctx.translate((xl + xr) / 2, yb - ry * 0.3)
  ctx.scale(1, ry / rx)
  const gr = ctx.createRadialGradient(0, 0, rx * 0.35, 0, 0, rx * 1.05)
  gr.addColorStop(0, `rgba(0,0,0,${(strength * opacity).toFixed(3)})`)
  gr.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gr
  ctx.beginPath(); ctx.arc(0, 0, rx * 1.05, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}
// ── Cloth step ───────────────────────────────────────────────────────────────
// Reads the pose-driven mesh in v (targets), simulates, writes displaced
// positions back into v and shifts SIL by each row's mean displacement.
function stepCloth(v, img, hipY, bottomY, torsoH, now, kHem = K_HEM) {
  const c = cloth, C1 = COLS + 1
  const gap = c.t ? (now - c.t) / 1000 : 0
  c.t = now
  const reset = !c.ready || c.img !== img || gap > 0.5     // new gown / camera restart / long stall
  c.img = img
  const span = Math.max(bottomY - hipY, 1)

  // targets + per-row weight (0 at/above the hip = pinned, 1 at the hem)
  for (let r = 0; r <= ROWS; r++) {
    const w = smooth(clamp((v[r * C1 * 4 + 1] - hipY) / span, 0, 1))
    c.wRow[r] = w
        c.kRow[r] = K_HIP * Math.pow(kHem / K_HIP, w)
    c.cRow[r] = 2 * lerp(Z_HIP, Z_HEM, w) * Math.sqrt(c.kRow[r])
    for (let i = r * C1, e = i + C1; i < e; i++) {
      c.tx[i] = v[i * 4]; c.ty[i] = v[i * 4 + 1]
      if (w <= 0) { c.px[i] = c.tx[i]; c.py[i] = c.ty[i]; c.vx[i] = 0; c.vy[i] = 0 }
    }
  }
  if (reset) {
    c.px.set(c.tx); c.py.set(c.ty); c.vx.fill(0); c.vy.fill(0)
    c.ready = true; c.acc = 0
    return
  }

  // fixed-timestep integration
  const DT = 1 / 120
  c.acc += Math.min(gap, 0.05)
  let n = 0
  while (c.acc >= DT && n < 6) {
    for (let r = 0; r <= ROWS; r++) {
      if (c.wRow[r] <= 0) continue
      const k = c.kRow[r], cd = c.cRow[r]
      for (let i = r * C1, e = i + C1; i < e; i++) {
        c.vx[i] += (k * (c.tx[i] - c.px[i]) - cd * c.vx[i]) * DT
        c.vy[i] += (k * (c.ty[i] - c.py[i]) - cd * c.vy[i]) * DT
        c.px[i] += c.vx[i] * DT
        c.py[i] += c.vy[i] * DT
      }
    }
    c.acc -= DT; n++
  }
  if (n === 6) c.acc = 0

  // displacement field: neighbour-smoothed, clamped, floor-limited
  const maxX = torsoH * 0.35, maxUp = torsoH * 0.09, maxDown = torsoH * 0.02
  for (let i = 0; i < NV; i++) { c.dx[i] = c.px[i] - c.tx[i]; c.dy[i] = c.py[i] - c.ty[i] }
  for (let r = 0; r <= ROWS; r++) {
    const w = c.wRow[r]
    if (w <= 0) continue
    const up = Math.max(r - 1, 0) * C1, dn = Math.min(r + 1, ROWS) * C1
    let mx = 0, my = 0
    for (let col = 0; col <= COLS; col++) {
      const i = r * C1 + col
      const l = r * C1 + Math.max(col - 1, 0), rt = r * C1 + Math.min(col + 1, COLS)
      const ax = (c.dx[l] + c.dx[rt] + c.dx[up + col] + c.dx[dn + col]) * 0.25
      const ay = (c.dy[l] + c.dy[rt] + c.dy[up + col] + c.dy[dn + col]) * 0.25
      const Dx = clamp(lerp(c.dx[i], ax, 0.35), -maxX * w, maxX * w)
      const Dy = clamp(lerp(c.dy[i], ay, 0.35), -maxUp * w, maxDown * w)   // floor: can lift, can't sink
      c.px[i] = c.tx[i] + Dx; c.py[i] = c.ty[i] + Dy
      v[i * 4] = c.px[i]; v[i * 4 + 1] = c.py[i]
      mx += Dx; my += Dy
    }
    SIL[r * 3] += my / C1; SIL[r * 3 + 1] += mx / C1; SIL[r * 3 + 2] += mx / C1   // shadow + background reveal follow the skirt
  }
}
// Call when a gown image finishes loading, so the upload cost isn't paid mid-frame.
export function prepareGownGL(img) {
  try {
    const prof = getProfile(img); if (!prof) return
    const g = init(); if (!g) return
    ensureProfile(prof)
    getTex(g, img)
  } catch { /* the draw call will fall back */ }
}

export function drawGownGL(ctx, img, layout, opacity, size) {
  const { topY, bottomY, sm, hm, sw, hw, torsoH, cal = {}, dx = 0, dy: dyOff = 0, scaleX = 1 } = layout
  if (!sm || !hm) return false
  const prof = getProfile(img); if (!prof) return false
  const g = init(); if (!g) return false
  const tex = getTex(g, img); if (!tex) return false
  ensureProfile(prof)

  // ── body parameters (same semantics as gownWarp.js) ───────────────────────
  const w = { ...(cal.warp || {}) }
  if (cal.waistRow  != null) w.waistRow  = cal.waistRow
  if (cal.waistEase != null) w.waistEase = cal.waistEase
  if (cal.hipEase   != null) w.hipEase   = cal.hipEase
  const shoulderEase = w.shoulderEase ?? cal.shoulderPad ?? 1.15
  const skirtMult    = (cal.skirtFlare ?? 1.10) / 1.10
  const E   = cal.enh || null
  const geo = E?.geo || null                       // null = simple mode: old behaviour
  const waistEase    = (w.waistEase ?? 1.05) * (geo?.waistWidth ?? 1)
  const hipEase      = (w.hipEase   ?? 1.10) * (geo?.hipWidth   ?? 1)
  const waistRatio   = w.waistRatio ?? 0.72
  const t0 = geo?.imgTop ?? 0, t1 = geo?.imgHem ?? 1, span = t1 - t0
  const wfFull = clamp(w.waistRow ?? prof.waistFrac, 0.1, 0.8)   // waist as a fraction of the full opaque image
  const wf     = clamp((wfFull - t0) / span, 0.08, 0.85)         // ...and of the trimmed garment
  const toFull = f => t0 + f * span

  const waistY = sm.y + torsoH * (geo?.waistAt ?? 0.65) + dyOff
  const hipY   = hm.y + dyOff
  const smY    = sm.y + dyOff
  if (!(bottomY > hipY + 4 && waistY > topY + 4 && hipY > waistY)) return false

  const shoulderW = sw * shoulderEase
  let waistW = sw * waistRatio * waistEase
  const m = layout.meas
  const hipRef = layout.rawHw ?? hw
  if (m?.waist > 0 && m?.hips > 0) {
    waistW = clamp(hipRef * (m.waist / m.hips) * waistEase, sw * 0.5, sw * 1.0)
  }
  const hipW = hw * hipEase

  // bust anchor (enhanced only): its own width, between shoulders and waist
  let bustY = null, bustW = 0
  if (geo) {
    const by = smY + torsoH * geo.bustAt
    if (by > smY + 4 && by < waistY - 4) {
      let base = lerp(shoulderW, waistW, smooth((by - smY) / (waistY - smY)))
      if (m?.bust > 0 && m?.hips > 0) base = clamp(hipRef * (m.bust / m.hips), sw * 0.7, sw * 1.4)
      bustY = by; bustW = base * geo.bustEase
    }
  }

  // vertical map: waist pinned to the calibrated line, scale blends across it (no break)
  const srcH  = prof.srcH ?? prof.ih
  const srcHe = srcH * span
  const ymap  = buildYMap(wf, topY, waistY, bottomY, geo ? SEAM_BLEND : 0)
  const kU   = ymap.ka / srcHe                             // bodice scale
  const kV   = ymap.kb / srcHe                             // skirt scale
  const hf   = ymap.fOf(hipY)
  const kHip = clamp(hipW / Math.max(at(prof.glWid, toFull(hf)), 1), kV * 0.5, kV * 2)

  // ONE width curve for bodice + upper skirt: shoulder -> bust -> waist -> hip
  let bodyW
  if (geo) {
    const pts = [[smY, shoulderW]]
    if (bustY != null) pts.push([bustY, bustW])
        pts.push([waistY, waistW])                    // bodice curve now stops at the waist
    const upperW = makeWidthFn(pts)
    const fs0 = geo.flareStart
    bodyW = y => {
      if (y <= waistY) return upperW(y)
      const t   = smooth(clamp((y - waistY) / Math.max(hipY - waistY, 1), 0, 1))
      const fit = lerp(waistW, hipW, t)
      if (!(fs0 > 0)) return fit
      const nat = at(prof.glWid, toFull(ymap.fOf(y))) * kV   // the gown's own width at this row
      return lerp(fit, Math.max(nat, fit), fs0 * t)           // only ever widens
    }
    bodyW = makeWidthFn(pts)
  } else {
    bodyW = y => {
      if (y <= smY)    return shoulderW
      if (y <= waistY) return lerp(shoulderW, waistW, smooth((y - smY) / (waistY - smY)))
      return lerp(waistW, hipW, smooth((y - waistY) / (hipY - waistY)))
    }
  }
    const kHipEff = lerp(kHip, Math.max(kV, kHip), geo?.flareStart ?? 0)   // hip scale after "flare from waist"
  const now = performance.now()
  const legX = layout.legX                                  // ankle midpoint (screen x), from the camera layout
  const cLine = y => {
    let c = lerp(sm.x, hm.x, clamp((y - smY) / (hm.y - sm.y), 0, 1)) + dx
    if (geo && legX != null && y > hipY)
      c = lerp(c, legX + dx, geo.legFollow * smooth(clamp((y - hipY) / Math.max(bottomY - hipY, 1), 0, 1)))
    return c
  }
  const armD = side => clamp((layout.arms?.[side] ?? 0.1) - 0.1, -0.3, 0.8)   // arm out-reach vs hanging at the side

  const adv = cal.enh?.adv || { ...ADV_DEFAULTS, hemShadow: HEM_SHADOW, edgePx: FEATHER_PX }   // simple mode = today's look
  const flareSpan = Math.max((bottomY - hipY) * adv.flare, 1)
  const skirtSpan = Math.max((bottomY - hipY) * 0.15, 1)

  // ── build the mesh (rows are denser around the waist: a row sits exactly on it) ──
    const seams = E ? seamsFor(prof.glL, prof.glR, wfFull, E) : null   // null = simple mode, or fall back
  for (let c = 0; c <= COLS; c++) XS[c] = (c / COLS) * prof.iw
  if (seams) snapColumns(XS, prof.iw, [seams.cL, seams.cR])
  const Ru = clamp(Math.round(ROWS * wf), 1, ROWS - 1), Rl = ROWS - Ru
  const v = g.verts
  let o = 0
  for (let r = 0; r <= ROWS; r++) {
    const f = r <= Ru ? wf * r / Ru : wf + (1 - wf) * (r - Ru) / Rl
    const ff = toFull(f)
    const y = ymap.yOf(f)
    const gw = Math.max(at(prof.glWid, ff), 1)
    const cc = at(prof.glCtr, ff)

    let s
    if (y <= hipY) {
      s = bodyW(y) / gw
      // protection zone fades out by the waist, so the cinch still follows the body
      const prot = 1 - smooth(clamp((y - smY) / Math.max(waistY - smY, 1), 0, 1))
      s = clamp(s, kU * MIN_SQUASH * prot, lerp(kU * 4, kU * MAX_STRETCH, prot))
    } else {
           s = lerp(kHipEff, kV, smooth(clamp((y - hipY) / flareSpan, 0, 1)))
    }
    s *= scaleX * (geo
      ? 1 + (geo.hemWidth - 1) * Math.pow(clamp((y - hipY) / Math.max(bottomY - hipY, 1), 0, 1), lerp(3, 0.6, geo.flareCurve))
      : lerp(1, skirtMult, smooth(clamp((y - hipY) / skirtSpan, 0, 1))))

       const cx = cLine(y)
    const vv = (prof.srcTop + ff * srcH) / prof.ih
    let mapX = x => cx + (x - cc) * s
    if (seams && y <= hipY) {
      // enhanced: fit only the part between the side seams, keep sleeves at their own scale
      const prot = 1 - smooth(clamp((y - smY) / Math.max(waistY - smY, 1), 0, 1))
      const cm = coreRowMap({
        cL: seams.cL, cR: seams.cR, gL: at(prof.glL, ff), gR: at(prof.glR, ff),
        tw: bodyW(y) * scaleX, k: kU * scaleX, cLine: cx,
        sMin: kU * 0.5 * scaleX, sMax: lerp(kU * 4, kU * 1.6, prot) * scaleX,
        kOut:   kU * scaleX * (geo?.sleeveWidth ?? 1),
        reachL: sw * ((geo?.sleeveReach ?? 0) + (geo?.sleeveFollow ?? 0) * armD('l')),
        reachR: sw * ((geo?.sleeveReach ?? 0) + (geo?.sleeveFollow ?? 0) * armD('r')),
      })
      if (cm) mapX = cm
    }
    SIL[r * 3]     = y
    SIL[r * 3 + 1] = mapX(at(prof.glL, ff))    // gown's real left/right edge on screen
    SIL[r * 3 + 2] = mapX(at(prof.glR, ff))
    for (let c = 0; c <= COLS; c++) {
      const x = XS[c]
      v[o++] = mapX(x)
      v[o++] = y
      v[o++] = x / prof.iw
      v[o++] = vv
    }
  }
    if (CLOTH && !layout.noCloth && adv.swing > 0) stepCloth(v, img, hipY, bottomY, torsoH, now, swingToK(adv.swing))
  // ── draw ──────────────────────────────────────────────────────────────────
  const sc   = ctx.getTransform().a                 // device px per logical px (dpr, render scale, editor zoom)
  const dprS = clamp(sc, 1, 3)
  const vw = size?.w ?? ctx.canvas.width  / sc
  const vh = size?.h ?? ctx.canvas.height / sc
  const W = Math.round(vw * dprS), H = Math.round(vh * dprS)
  const { gl, canvas } = g
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
  gl.viewport(0, 0, W, H)
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)

  const tint = layout.tint || [1, 1, 1]
  const fs = Math.max(kV, 0.05)
  gl.useProgram(g.prog)
  gl.bindVertexArray(g.vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, v)
  gl.uniform2f(g.u.res, vw, vh)
  gl.uniform1f(g.u.alpha, opacity)
  gl.uniform1f(g.u.bright, (layout.brightness || 1) * adv.bright)
  gl.uniform3f(g.u.tint, tint[0] * (1 + 0.08 * adv.warmth), tint[1], tint[2] * (1 - 0.08 * adv.warmth))
    gl.uniform2f(g.u.feather, adv.edgePx / (fs * prof.iw), adv.edgePx / (fs * prof.ih))
  gl.uniform1f(g.u.sharp, SHARPEN)
  gl.uniform1f(g.u.shade, adv.shade ?? 0)
  gl.uniform1f(g.u.waistV, (prof.srcTop + wfFull * srcH) / prof.ih)
  gl.uniform2f(g.u.vspan, (prof.srcTop + t0 * srcH) / prof.ih, (prof.srcTop + t1 * srcH) / prof.ih)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.uniform1i(g.u.tex, 0)
  gl.drawElements(gl.TRIANGLES, g.nIdx, gl.UNSIGNED_SHORT, 0)

  // composite: reveal background -> hem shadow -> gown
  if (layout.reveal) eraseBehind(ctx, layout.reveal, vw, vh)
    drawHemShadow(ctx, opacity, vh, torsoH, adv.hemShadow)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, vw, vh)     // same task as the draw, so no preserveDrawingBuffer needed
  ctx.restore()

  if (!announced) { announced = true; console.info('[glGownRenderer] drawing via WebGL2 mesh (stage 4)') }
  return true
}