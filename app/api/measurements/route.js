import { NextResponse } from 'next/server'

const USE_DB   = process.env.USE_DB === 'true'

// ── JSON fallback (dev mode) ──────────────────────────────────────────────────
import path from 'path'
import fs   from 'fs'

const dataFile = path.join(process.cwd(), 'data', 'measurements.json')

function loadJson() {
  if (!fs.existsSync(dataFile)) return []
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')) } catch { return [] }
}
function saveJson(rows) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true })
  fs.writeFileSync(dataFile, JSON.stringify(rows, null, 2))
}

// ── Validation helpers ────────────────────────────────────────────────────────
const NUM_BOUNDS = {
  height_cm: [100, 250],
  weight_kg:  [30,  300],
  bust_cm:    [50,  200],
  waist_cm:   [40,  180],
  hips_cm:    [50,  200],
}

function validateMeasurement(key, value) {
  const bounds = NUM_BOUNDS[key]
  if (!bounds) return null                     // unknown field — ignore
  const n = Number(value)
  if (!Number.isFinite(n)) return `${key} must be a number`
  if (n < bounds[0] || n > bounds[1])
    return `${key} must be between ${bounds[0]} and ${bounds[1]}`
  return null
}

// ── GET /api/measurements — fetch saved measurements for the authed user ──────
export async function GET(request) {
  const userId = request.headers.get('x-user-id')
  if (!userId)
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })

  if (!USE_DB) {
    const all = loadJson()
    const row = all.find(r => String(r.userId) === String(userId)) || null
    return NextResponse.json({ ok: true, measurements: row })
  }

  try {
    const { query } = await import('@/lib/db')
    const rows = await query(
      `SELECT id, height_cm, weight_kg, bust_cm, waist_cm, hips_cm, source, measured_at
       FROM user_measurements WHERE user_id = $1`,
      [userId]
    )
    return NextResponse.json({ ok: true, measurements: rows[0] || null })
  } catch (err) {
    console.error('GET /api/measurements error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch measurements' }, { status: 500 })
  }
}

// ── POST /api/measurements — upsert measurements for the authed user ──────────
export async function POST(request) {
  const userId = request.headers.get('x-user-id')
  if (!userId)
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })

  let body
  try { body = await request.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 }) }

  const { height_cm, weight_kg, bust_cm, waist_cm, hips_cm, source } = body

  // At least one real measurement required
  const hasMeasurement = [bust_cm, waist_cm, hips_cm].some(v => v != null)
  if (!hasMeasurement)
    return NextResponse.json(
      { ok: false, error: 'Provide at least one of bust_cm, waist_cm, or hips_cm' },
      { status: 400 }
    )

  // Validate each provided field
  const FIELDS = { height_cm, weight_kg, bust_cm, waist_cm, hips_cm }
  for (const [key, value] of Object.entries(FIELDS)) {
    if (value == null) continue
    const err = validateMeasurement(key, value)
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 })
  }

  const validSources = ['camera', 'manual', 'tape']
  const safeSource   = validSources.includes(source) ? source : 'manual'

  // ── JSON path ─────────────────────────────────────────────────────────────
  if (!USE_DB) {
    const all = loadJson()
    const idx = all.findIndex(r => String(r.userId) === String(userId))
    const row = {
      id:         idx >= 0 ? all[idx].id : Date.now(),
      userId:     String(userId),
      height_cm:  height_cm != null ? Number(height_cm) : null,
      weight_kg:  weight_kg != null ? Number(weight_kg) : null,
      bust_cm:    bust_cm   != null ? Number(bust_cm)   : null,
      waist_cm:   waist_cm  != null ? Number(waist_cm)  : null,
      hips_cm:    hips_cm   != null ? Number(hips_cm)   : null,
      source:     safeSource,
      measured_at: new Date().toISOString(),
    }
    if (idx >= 0) all[idx] = row; else all.unshift(row)
    saveJson(all)
    return NextResponse.json({ ok: true, measurements: row })
  }

  // ── DB path — upsert (one row per user, UNIQUE on user_id) ───────────────
  try {
    const { query } = await import('@/lib/db')
    const rows = await query(
      `INSERT INTO user_measurements
         (user_id, height_cm, weight_kg, bust_cm, waist_cm, hips_cm, source, measured_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         height_cm   = COALESCE(EXCLUDED.height_cm,  user_measurements.height_cm),
         weight_kg   = COALESCE(EXCLUDED.weight_kg,  user_measurements.weight_kg),
         bust_cm     = COALESCE(EXCLUDED.bust_cm,    user_measurements.bust_cm),
         waist_cm    = COALESCE(EXCLUDED.waist_cm,   user_measurements.waist_cm),
         hips_cm     = COALESCE(EXCLUDED.hips_cm,    user_measurements.hips_cm),
         source      = EXCLUDED.source,
         measured_at = NOW()
       RETURNING id, height_cm, weight_kg, bust_cm, waist_cm, hips_cm, source, measured_at`,
      [
        userId,
        height_cm != null ? Number(height_cm) : null,
        weight_kg != null ? Number(weight_kg) : null,
        bust_cm   != null ? Number(bust_cm)   : null,
        waist_cm  != null ? Number(waist_cm)  : null,
        hips_cm   != null ? Number(hips_cm)   : null,
        safeSource,
      ]
    )
    return NextResponse.json({ ok: true, measurements: rows[0] })
  } catch (err) {
    console.error('POST /api/measurements error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to save measurements' }, { status: 500 })
  }
}

// ── DELETE /api/measurements — clear saved measurements ───────────────────────
export async function DELETE(request) {
  const userId = request.headers.get('x-user-id')
  if (!userId)
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })

  if (!USE_DB) {
    const all = loadJson().filter(r => String(r.userId) !== String(userId))
    saveJson(all)
    return NextResponse.json({ ok: true })
  }

  try {
    const { query } = await import('@/lib/db')
    await query('DELETE FROM user_measurements WHERE user_id = $1', [userId])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/measurements error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to delete measurements' }, { status: 500 })
  }
}
