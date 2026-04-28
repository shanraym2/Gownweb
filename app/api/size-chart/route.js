import { NextResponse } from 'next/server'

// ── GET /api/size-chart?supplierId=xxx ────────────────────────────────────────
// Returns size metrics for a supplier (or the first active supplier if none given).
// Falls back to a Philippine standard size chart when DB is unavailable or
// when the supplier has no configured size metrics.
//
// Response shape:
//   { ok: true, supplierId, supplierName, sizes: [
//     { label, bust_min, bust_max, waist_min, waist_max, hip_min, hip_max }, …
//   ], isFallback: boolean }

// ─────────────────────────────────────────────────────────────────────────────
// PHILIPPINE STANDARD SIZES
//
// Based on the DTI/Philippine sizing standard. Filipino women generally run
// 1–2 sizes larger than US/EU equivalents and tend toward a petite height
// range (avg 154–157 cm). Bridal boutiques in PH commonly stock XS–3XL;
// measurements are in centimetres (bust / waist / hips).
//
// Sources consulted:
//   • DTI Bureau of Philippine Standards (BPS) PNS/DOH CS 1:2020
//   • SM / Rustans / Bench published size guides (PH market)
//   • JCE Bridal Boutique supplier fit data (where available)
// ─────────────────────────────────────────────────────────────────────────────

const PH_STANDARD_SIZES = [
  // label   bust       waist      hips
  { label: 'XS',  bust_min: 76,  bust_max: 81,  waist_min: 58,  waist_max: 63,  hip_min: 82,  hip_max: 87  },
  { label: 'S',   bust_min: 82,  bust_max: 87,  waist_min: 64,  waist_max: 69,  hip_min: 88,  hip_max: 93  },
  { label: 'M',   bust_min: 88,  bust_max: 93,  waist_min: 70,  waist_max: 75,  hip_min: 94,  hip_max: 99  },
  { label: 'L',   bust_min: 94,  bust_max: 99,  waist_min: 76,  waist_max: 81,  hip_min: 100, hip_max: 105 },
  { label: 'XL',  bust_min: 100, bust_max: 106, waist_min: 82,  waist_max: 88,  hip_min: 106, hip_max: 112 },
  { label: '2XL', bust_min: 107, bust_max: 113, waist_min: 89,  waist_max: 96,  hip_min: 113, hip_max: 119 },
  { label: '3XL', bust_min: 114, bust_max: 121, waist_min: 97,  waist_max: 105, hip_min: 120, hip_max: 127 },
  { label: '4XL', bust_min: 122, bust_max: 130, waist_min: 106, waist_max: 115, hip_min: 128, hip_max: 136 },
]

// ─────────────────────────────────────────────────────────────────────────────
// UUID validation — prevents malformed IDs from reaching the DB
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─────────────────────────────────────────────────────────────────────────────
// formatSizeRow — coerces DB numeric strings → JS numbers so the scoring
// engine (scoreGown / recommendSize) receives numbers on all code paths.
// Used for both the DB path and the fallback so behaviour is consistent.
// ─────────────────────────────────────────────────────────────────────────────

function formatSizeRow(row) {
  return {
    label:     row.label,
    bust_min:  row.bust_min  != null ? Number(row.bust_min)  : null,
    bust_max:  row.bust_max  != null ? Number(row.bust_max)  : null,
    waist_min: row.waist_min != null ? Number(row.waist_min) : null,
    waist_max: row.waist_max != null ? Number(row.waist_max) : null,
    hip_min:   row.hip_min   != null ? Number(row.hip_min)   : null,
    hip_max:   row.hip_max   != null ? Number(row.hip_max)   : null,
  }
}

const FALLBACK_RESPONSE = {
  ok:           true,
  supplierId:   null,
  supplierName: 'Philippine Standard',
  sizes:        PH_STANDARD_SIZES.map(formatSizeRow),
  isFallback:   true,
}

const USE_DB = process.env.USE_DB === 'true'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const rawSupplierId = searchParams.get('supplierId') || null

  // ── Validate supplierId format ─────────────────────────────────────────────
  if (rawSupplierId !== null && !UUID_RE.test(rawSupplierId)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid supplierId format' },
      { status: 400 }
    )
  }

  const supplierId = rawSupplierId

  // ── JSON / dev fallback ────────────────────────────────────────────────────
  if (!USE_DB) {
    return NextResponse.json(FALLBACK_RESPONSE)
  }

  // ── DB path ────────────────────────────────────────────────────────────────
  try {
    const { query } = await import('@/lib/db')

    // Resolve supplier ID — explicit or first active
    let sid = supplierId
    if (!sid) {
      const suppliers = await query(
        `SELECT id FROM suppliers WHERE is_active = true ORDER BY name LIMIT 1`
      )
      sid = suppliers[0]?.id || null
    }

    if (!sid) {
      return NextResponse.json(FALLBACK_RESPONSE)
    }

    // Fetch supplier + size metrics in parallel.
    // Supplier query includes is_active guard so a deactivated supplier
    // passed via supplierId query param is treated as not found.
    const [supplierRows, sizeRows] = await Promise.all([
      query(
        `SELECT id, name FROM suppliers WHERE id = $1 AND is_active = true`,
        [sid]
      ),
      query(
        `SELECT size_label     AS label,
                bust_min,  bust_max,
                waist_min, waist_max,
                hip_min,   hip_max
         FROM   supplier_size_metrics
         WHERE  supplier_id = $1
         ORDER BY COALESCE(bust_min, 0) ASC`,
        [sid]
      ),
    ])

    const supplier = supplierRows[0]

    // Supplier not found or inactive — fall back gracefully
    if (!supplier) {
      return NextResponse.json(FALLBACK_RESPONSE)
    }

    // Supplier exists but has no configured size metrics — use PH standard
    // but make it clear in both the label and the isFallback flag so the
    // UI can show a caveat ("based on Philippine standard sizing").
    if (sizeRows.length === 0) {
      return NextResponse.json({
        ok:           true,
        supplierId:   sid,
        supplierName: 'Philippine Standard',
        sizes:        PH_STANDARD_SIZES.map(formatSizeRow),
        isFallback:   true,
      })
    }

    // Happy path — supplier has its own size chart
    return NextResponse.json({
      ok:           true,
      supplierId:   sid,
      supplierName: supplier.name,
      sizes:        sizeRows.map(formatSizeRow),
      isFallback:   false,
    })

  } catch (err) {
    // Log the real error server-side; return a structured failure to the client
    // so callers can distinguish a DB error from a genuine empty chart.
    console.error('GET /api/size-chart error:', err)

    return NextResponse.json({
      ok:           false,
      error:        'Size chart temporarily unavailable. Please try again.',
      // Provide the fallback sizes so the client can still show something
      // useful, but set ok: false so callers know this is degraded data.
      supplierId:   null,
      supplierName: 'Philippine Standard',
      sizes:        PH_STANDARD_SIZES.map(formatSizeRow),
      isFallback:   true,
    }, { status: 503 })
  }
}