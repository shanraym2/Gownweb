// app/api/geocode/route.js
//
// Server-side geocoding proxy — keeps the Google Maps key off the browser.
// Called from checkout as: POST /api/geocode  { address: "..." }

import { NextResponse } from 'next/server'

export async function POST(request) {
  let body
  try { body = await request.json() }
  catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const { address } = body
  if (!address?.trim()) {
    return NextResponse.json({ ok: false, error: 'Address required' }, { status: 400 })
  }

  const apiKey = process.env.GOOGLE_MAPS_KEY  // server-only, no NEXT_PUBLIC_ prefix

  // ── No API key: return a clear signal so the client uses a flat fallback ──
  if (!apiKey) {
    console.warn('[geocode] GOOGLE_MAPS_KEY not set in environment')
    return NextResponse.json(
      { ok: false, noKey: true, error: 'Geocoding not configured on this server' },
      { status: 503 }
    )
  }

  try {
    const query = encodeURIComponent(address.trim() + ', Philippines')
    const url   = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${apiKey}`

    const res  = await fetch(url)
    const data = await res.json()

    // Google returned an API-level error
    if (data.status === 'REQUEST_DENIED') {
      console.error('[geocode] REQUEST_DENIED —', data.error_message)
      return NextResponse.json(
        { ok: false, error: 'API key invalid or Geocoding API not enabled', detail: data.error_message },
        { status: 503 }
      )
    }

    if (data.status === 'OVER_QUERY_LIMIT') {
      return NextResponse.json(
        { ok: false, error: 'Geocoding quota exceeded' },
        { status: 429 }
      )
    }

    // Address genuinely not found — not an error, just no results
    if (data.status === 'ZERO_RESULTS' || !data.results?.length) {
      return NextResponse.json({ ok: true, found: false, lat: null, lng: null })
    }

    if (data.status !== 'OK') {
      console.error('[geocode] Unexpected status:', data.status)
      return NextResponse.json(
        { ok: false, error: `Geocoding error: ${data.status}` },
        { status: 502 }
      )
    }

    const { lat, lng } = data.results[0].geometry.location
    const formatted    = data.results[0].formatted_address

    return NextResponse.json({ ok: true, found: true, lat, lng, formatted })

  } catch (err) {
    console.error('[geocode] fetch error:', err)
    return NextResponse.json(
      { ok: false, error: 'Could not reach geocoding service' },
      { status: 502 }
    )
  }
}