/**
 * POST /api/recommendations
 * ──────────────────────────
 * Records interaction events server-side so data persists across devices
 * and sessions. Also accepts batch events for efficiency.
 *
 * Body:
 *   { userId: string, gownId: number|string, eventType: string }
 *   OR
 *   { userId: string, events: [{ gownId, eventType }] }
 *
 * GET /api/recommendations?userId=xxx&gownId=yyy&topN=8
 *   Returns pre-computed recommendations (useful for SSR or non-JS contexts).
 *   Note: For client-side use, the JS engine is faster (no round-trip).
 */

import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const EVENT_WEIGHTS = { view: 1, favorite: 3, cart_add: 5, inquiry: 7 }
const MAX_USERS = 2000

function getStorePath() {
  const dir = join(tmpdir(), 'jce-recommender')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'interactions.json')
}

function loadServerInteractions() {
  const path = getStorePath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

function saveServerInteractions(data) {
  // Evict oldest users if over limit
  const keys = Object.keys(data)
  if (keys.length > MAX_USERS) {
    const evict = keys.slice(0, keys.length - MAX_USERS)
    evict.forEach((k) => delete data[k])
  }
  writeFileSync(getStorePath(), JSON.stringify(data))
}

function applyInteraction(data, userId, gownId, eventType) {
  const weight = EVENT_WEIGHTS[eventType]
  if (!weight) return

  if (!data[userId]) data[userId] = {}
  const key = String(gownId)
  const current = data[userId][key] || 0
  const decay = 1 / (1 + 0.3 * (current / weight))
  data[userId][key] = Math.round((current + weight * decay) * 100) / 100
}

// ── POST ───────────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const body = await request.json()
    const { userId, gownId, eventType, events } = body

    if (!userId) {
      return NextResponse.json({ ok: false, error: 'userId is required' }, { status: 400 })
    }

    const data = loadServerInteractions()

    if (Array.isArray(events)) {
      // Batch mode
      for (const e of events) {
        if (e.gownId && e.eventType) {
          applyInteraction(data, userId, e.gownId, e.eventType)
        }
      }
    } else if (gownId && eventType) {
      applyInteraction(data, userId, gownId, eventType)
    } else {
      return NextResponse.json(
        { ok: false, error: 'Provide gownId+eventType or events[]' },
        { status: 400 }
      )
    }

    saveServerInteractions(data)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Recommendations POST error:', err)
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}

// ── GET (stats) ────────────────────────────────────────────────────────────

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    const data = loadServerInteractions()
    const totalUsers = Object.keys(data).length

    if (userId) {
      return NextResponse.json({
        ok: true,
        totalUsers,
        userVector: data[userId] || {},
        interactionCount: Object.keys(data[userId] || {}).length,
      })
    }

    return NextResponse.json({ ok: true, totalUsers })
  } catch (err) {
    console.error('Recommendations GET error:', err)
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
