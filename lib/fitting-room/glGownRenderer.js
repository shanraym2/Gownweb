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

const COLS = 32, ROWS = 64
const MIN_SQUASH = 0.8     // above the waist a row is never squashed below 80% of uniform scale (keeps sleeves/straps)
const MAX_STRETCH = 1.5    // ...and never stretched past 150% of uniform scale (keeps halter straps from ballooning)
const MAX_TEX = 2048
const FEATHER_PX = 1.5     // edge softness, screen px
const HEM_SHADOW = 0.38    // hem contact shadow strength (0 = off)

const clamp  = (v, a, b) => Math.min(Math.max(v, a), b)
const lerp   = (a, b, t) => a + (b - a) * t
const smooth = t => t * t * (3 - 2 * t)

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
uniform vec3  uTint;
uniform vec2  uFeather;
out vec4 o;
void main() {
  vec4 t = texture(uTex, vUV);
  // soften the silhouette edge: shrink alpha toward the neighbourhood average
  float a = (texture(uTex, vUV + vec2(uFeather.x, 0.0)).a + texture(uTex, vUV - vec2(uFeather.x, 0.0)).a
           + texture(uTex, vUV + vec2(0.0, uFeather.y)).a + texture(uTex, vUV - vec2(0.0, uFeather.y)).a) * 0.25;
  float k = t.a > 0.001 ? min(1.0, mix(t.a, a, 0.7) / t.a) : 0.0;
  vec3 rgb = min(t.rgb * uBright * uTint, vec3(t.a));
  o = vec4(rgb, t.a) * k * uAlpha;   // premultiplied output
}`

let G = null            // live GL state, rebuilt after context loss
let failed = false      // permanent failure (no WebGL2 / shader error)
let announced = false
// ── cloth (stage 5) ──────────────────────────────────────────────────────────
const CLOTH = true                      // false = skirt hangs rigid, no sway
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
function ensureProfile(prof) {
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
function drawHemShadow(ctx, opacity, vh, torsoH) {
  if (HEM_SHADOW <= 0) return
  const yb = SIL[ROWS * 3], xl = SIL[ROWS * 3 + 1], xr = SIL[ROWS * 3 + 2]
  const rx = (xr - xl) / 2
  if (!(rx > 4) || yb > vh - 2) return          // hem off-screen: skip
  const ry = Math.max(rx * 0.1, torsoH * 0.03)
  ctx.save()
  ctx.translate((xl + xr) / 2, yb - ry * 0.3)
  ctx.scale(1, ry / rx)
  const gr = ctx.createRadialGradient(0, 0, rx * 0.35, 0, 0, rx * 1.05)
  gr.addColorStop(0, `rgba(0,0,0,${(HEM_SHADOW * opacity).toFixed(3)})`)
  gr.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gr
  ctx.beginPath(); ctx.arc(0, 0, rx * 1.05, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}
// ── Cloth step ───────────────────────────────────────────────────────────────
// Reads the pose-driven mesh in v (targets), simulates, writes displaced
// positions back into v and shifts SIL by each row's mean displacement.
function stepCloth(v, img, hipY, bottomY, torsoH, now) {
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
    c.kRow[r] = K_HIP * Math.pow(K_HEM / K_HIP, w)
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
  const waistEase    = w.waistEase  ?? 1.05
  const hipEase      = w.hipEase    ?? 1.10
  const waistRatio   = w.waistRatio ?? 0.72
  const wf           = clamp(w.waistRow ?? prof.waistFrac, 0.1, 0.8)

  const waistY = sm.y + torsoH * 0.65 + dyOff
  const hipY   = hm.y + dyOff
  const smY    = sm.y + dyOff
  if (!(bottomY > hipY + 4 && waistY > topY + 4 && hipY > waistY)) return false

  const shoulderW = sw * shoulderEase
  let waistW = sw * waistRatio * waistEase
  const m = layout.meas
  if (m?.waist > 0 && m?.hips > 0) {
    const hipRef = layout.rawHw ?? hw
    waistW = clamp(hipRef * (m.waist / m.hips) * waistEase, sw * 0.5, sw * 1.0)
  }
  const hipW = hw * hipEase

  const srcH = prof.srcH ?? prof.ih
  const kU   = (waistY - topY) / (srcH * wf)               // uniform scale, bodice
  const kV   = (bottomY - waistY) / (srcH * (1 - wf))      // uniform scale, skirt
  const hf   = wf + ((hipY - waistY) / (bottomY - waistY)) * (1 - wf)
  const kHip = clamp(hipW / Math.max(at(prof.glWid, hf), 1), kV * 0.5, kV * 2)

  const bodyW = y => {
    if (y <= smY)    return shoulderW
    if (y <= waistY) return lerp(shoulderW, waistW, smooth((y - smY) / (waistY - smY)))
    return lerp(waistW, hipW, smooth((y - waistY) / (hipY - waistY)))
  }
  const now = performance.now()
  const cLine = y => lerp(sm.x, hm.x, clamp((y - smY) / (hm.y - sm.y), 0, 1)) + dx

  const flareSpan = Math.max((bottomY - hipY) * 0.5, 1)
  const skirtSpan = Math.max((bottomY - hipY) * 0.15, 1)

  // ── build the mesh (rows are denser around the waist: a row sits exactly on it) ──
  const Ru = clamp(Math.round(ROWS * wf), 1, ROWS - 1), Rl = ROWS - Ru
  const v = g.verts
  let o = 0
  for (let r = 0; r <= ROWS; r++) {
    const f = r <= Ru ? wf * r / Ru : wf + (1 - wf) * (r - Ru) / Rl
    const y = f <= wf ? lerp(topY, waistY, f / wf) : lerp(waistY, bottomY, (f - wf) / (1 - wf))
    const gw = Math.max(at(prof.glWid, f), 1)
    const cc = at(prof.glCtr, f)

    let s
    if (y <= hipY) {
      s = bodyW(y) / gw
      // protection zone fades out by the waist, so the cinch still follows the body
      const prot = 1 - smooth(clamp((y - smY) / Math.max(waistY - smY, 1), 0, 1))
      s = clamp(s, kU * MIN_SQUASH * prot, lerp(kU * 4, kU * MAX_STRETCH, prot))
    } else {
      s = lerp(kHip, kV, smooth(clamp((y - hipY) / flareSpan, 0, 1)))
    }
    s *= scaleX * lerp(1, skirtMult, smooth(clamp((y - hipY) / skirtSpan, 0, 1)))

    const cx = cLine(y)
    const vv = (prof.srcTop + f * srcH) / prof.ih
    SIL[r * 3]     = y
    SIL[r * 3 + 1] = cx + (at(prof.glL, f) - cc) * s     // gown's real left/right edge on screen
    SIL[r * 3 + 2] = cx + (at(prof.glR, f) - cc) * s
    for (let c = 0; c <= COLS; c++) {
      const u = c / COLS
      v[o++] = cx + (u * prof.iw - cc) * s
      v[o++] = y
      v[o++] = u
      v[o++] = vv
    }
  }
  if (CLOTH) stepCloth(v, img, hipY, bottomY, torsoH, now)
  // ── draw ──────────────────────────────────────────────────────────────────
  const dprMain = window.devicePixelRatio || 1
  const dprS = Math.min(2, dprMain)
  const vw = size?.w ?? ctx.canvas.width  / dprMain
  const vh = size?.h ?? ctx.canvas.height / dprMain
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
  gl.uniform1f(g.u.bright, layout.brightness || 1)
  gl.uniform3f(g.u.tint, tint[0], tint[1], tint[2])
  gl.uniform2f(g.u.feather, FEATHER_PX / (fs * prof.iw), FEATHER_PX / (fs * prof.ih))
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.uniform1i(g.u.tex, 0)
  gl.drawElements(gl.TRIANGLES, g.nIdx, gl.UNSIGNED_SHORT, 0)

  // composite: reveal background -> hem shadow -> gown
  if (layout.reveal) eraseBehind(ctx, layout.reveal, vw, vh)
  drawHemShadow(ctx, opacity, vh, torsoH)

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