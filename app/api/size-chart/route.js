// api/size-chart/route.js
import { NextResponse } from 'next/server'
import { SIZES_BY_SEGMENT, SIZES_WOMEN, formatSizeRow } from '@/app/constants/sizeConstants'

// ── GET /api/size-chart?supplierId=xxx&segment=women ─────────────────────────
// segment: 'women' | 'men' | 'children'  (default: 'women')
//
// Response shape:
//   { ok, supplierId, supplierName, segment, sizes: [...], isFallback }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_SEGMENTS = new Set(['women', 'men', 'children'])
const USE_DB = process.env.USE_DB === 'true'

function fallback(segment, supplierId = null, supplierName = 'Philippine Standard') {
  const sizes = SIZES_BY_SEGMENT[segment] ?? SIZES_WOMEN
  return {
    ok:           true,
    supplierId,
    supplierName,
    segment,
    sizes:        sizes.map(formatSizeRow),
    isFallback:   true,
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const rawSupplierId = searchParams.get('supplierId') || null
  const rawSegment    = (searchParams.get('segment') || 'women').toLowerCase()

  // ── Validate inputs ────────────────────────────────────────────────────────
  if (rawSupplierId !== null && !UUID_RE.test(rawSupplierId)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid supplierId format' },
      { status: 400 }
    )
  }

  // Unknown segment → default to women rather than error (graceful degradation)
  const segment = VALID_SEGMENTS.has(rawSegment) ? rawSegment : 'women'

  // ── JSON / dev fallback ────────────────────────────────────────────────────
  if (!USE_DB) {
    return NextResponse.json(fallback(segment))
  }

  // ── DB path ────────────────────────────────────────────────────────────────
  try {
    const { query } = await import('@/lib/db')

    // Resolve supplier
    let sid = rawSupplierId
    if (!sid) {
      const rows = await query(
        `SELECT id FROM suppliers WHERE is_active = true ORDER BY name LIMIT 1`
      )
      sid = rows[0]?.id || null
    }
    if (!sid) return NextResponse.json(fallback(segment))

    const [supplierRows, sizeRows] = await Promise.all([
      query(
        `SELECT id, name FROM suppliers WHERE id = $1 AND is_active = true`,
        [sid]
      ),
      // segment column added to supplier_size_metrics — filter by it.
      // Falls back to all rows if segment column doesn't exist yet (migration guard).
      query(
        `SELECT size_label     AS label,
                bust_min,  bust_max,
                waist_min, waist_max,
                hip_min,   hip_max
         FROM   supplier_size_metrics
         WHERE  supplier_id = $1
           AND  (segment = $2 OR segment IS NULL)
         ORDER BY COALESCE(bust_min, 0) ASC`,
        [sid, segment]
      ),
    ])

    const supplier = supplierRows[0]
    if (!supplier) return NextResponse.json(fallback(segment))

    // Supplier exists but no size rows for this segment → PH standard
    if (sizeRows.length === 0) {
      return NextResponse.json(fallback(segment, sid, 'Philippine Standard'))
    }

    return NextResponse.json({
      ok:           true,
      supplierId:   sid,
      supplierName: supplier.name,
      segment,
      sizes:        sizeRows.map(formatSizeRow),
      isFallback:   false,
    })

  } catch (err) {
    console.error('GET /api/size-chart error:', err)
    return NextResponse.json({
      ok:           false,
      error:        'Size chart temporarily unavailable. Please try again.',
      ...fallback(segment),
    }, { status: 503 })
  }
}