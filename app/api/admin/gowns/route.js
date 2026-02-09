import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { query } from '@/lib/db'
import { rowToGown } from '@/lib/gowns'

function getGownsPath() {
  return join(process.cwd(), 'data', 'gowns.json')
}

function loadGownsFromFile() {
  const path = getGownsPath()
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
}

function saveGownsToFile(gowns) {
  const dir = join(process.cwd(), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = getGownsPath()
  writeFileSync(path, JSON.stringify(gowns, null, 2), 'utf8')
}

function parsePriceAmount(priceStr) {
  if (priceStr == null) return 0
  const s = String(priceStr).replace(/[^\d.]/g, '')
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

function checkAuth(request) {
  const secret = request.headers.get('x-admin-secret') || ''
  const adminSecret = process.env.ADMIN_SECRET || ''
  return adminSecret && secret === adminSecret
}

export async function GET(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  const gowns = loadGownsFromFile()
  return NextResponse.json({ ok: true, gowns })
}

export async function POST(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await request.json()
    const { name, price, image, alt, type, color, silhouette, description, style } = body
    if (!name || !price || !image) {
      return NextResponse.json(
        { ok: false, error: 'Name, price, and image are required' },
        { status: 400 }
      )
    }
    const priceAmount = parsePriceAmount(price)
    const priceDisplay = String(price).trim()
    const styleJson = style && typeof style === 'object' ? JSON.stringify(style) : null

    const gowns = loadGownsFromFile()
    const maxId = gowns.length ? Math.max(...gowns.map((g) => Number(g.id) || 0)) : 0
    const newGown = {
      id: maxId + 1,
      name: String(name).trim(),
      price: priceDisplay,
      image: String(image).trim(),
      alt: String(alt || name).trim(),
      type: String(type || 'Gowns').trim(),
      color: String(color || '').trim(),
      silhouette: String(silhouette || '').trim(),
      description: String(description || '').trim(),
      ...(style && typeof style === 'object' ? { style } : {}),
    }
    gowns.push(newGown)
    saveGownsToFile(gowns)

    if (process.env.DATABASE_URL) {
      try {
        const result = await query(
          `INSERT INTO gowns (name, price_amount, price_display, image, alt, type, color, silhouette, description, style)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            String(name).trim(),
            priceAmount,
            priceDisplay,
            String(image).trim(),
            String(alt || name).trim(),
            String(type || 'Gowns').trim(),
            String(color || '').trim(),
            String(silhouette || '').trim(),
            String(description || '').trim(),
            styleJson,
          ]
        )
        newGown.id = result?.insertId ?? newGown.id
      } catch (err) {
        console.error('DB admin gowns POST error:', err)
      }
    }
    return NextResponse.json({ ok: true, gown: newGown })
  } catch (err) {
    console.error('Admin gowns POST error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to add gown' }, { status: 500 })
  }
}

export async function PUT(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await request.json()
    const { id, name, price, image, alt, type, color, silhouette, description, style } = body
    const gownId = id != null ? Number(id) : null
    if (gownId == null || !name || !price || !image) {
      return NextResponse.json(
        { ok: false, error: 'Id, name, price, and image are required' },
        { status: 400 }
      )
    }
    const priceAmount = parsePriceAmount(price)
    const priceDisplay = String(price).trim()
    const styleJson = style && typeof style === 'object' ? JSON.stringify(style) : null

    const gowns = loadGownsFromFile()
    const index = gowns.findIndex((g) => Number(g.id) === gownId)
    if (index === -1) {
      return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
    }
    const updated = {
      ...gowns[index],
      name: String(name).trim(),
      price: priceDisplay,
      image: String(image).trim(),
      alt: String(alt || name).trim(),
      type: String(type || 'Gowns').trim(),
      color: String(color || '').trim(),
      silhouette: String(silhouette || '').trim(),
      description: String(description || '').trim(),
      ...(style && typeof style === 'object' ? { style } : {}),
    }
    gowns[index] = updated
    saveGownsToFile(gowns)

    if (process.env.DATABASE_URL) {
      try {
        await query(
          `UPDATE gowns SET name = ?, price_amount = ?, price_display = ?, image = ?, alt = ?, type = ?, color = ?, silhouette = ?, description = ?, style = ?
           WHERE id = ?`,
          [
            String(name).trim(),
            priceAmount,
            priceDisplay,
            String(image).trim(),
            String(alt || name).trim(),
            String(type || 'Gowns').trim(),
            String(color || '').trim(),
            String(silhouette || '').trim(),
            String(description || '').trim(),
            styleJson,
            gownId,
          ]
        )
      } catch (err) {
        console.error('DB admin gowns PUT error:', err)
      }
    }
    return NextResponse.json({ ok: true, gown: updated })
  } catch (err) {
    console.error('Admin gowns PUT error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to update gown' }, { status: 500 })
  }
}

export async function DELETE(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const gownId = id != null ? Number(id) : null
    if (gownId == null) {
      return NextResponse.json({ ok: false, error: 'Id required' }, { status: 400 })
    }

    const gowns = loadGownsFromFile()
    const filtered = gowns.filter((g) => Number(g.id) !== gownId)
    if (filtered.length === gowns.length) {
      return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
    }
    saveGownsToFile(filtered)

    if (process.env.DATABASE_URL) {
      try {
        await query('DELETE FROM gowns WHERE id = ?', [gownId])
      } catch (err) {
        console.error('DB admin gowns DELETE error:', err)
      }
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Admin gowns DELETE error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to delete gown' }, { status: 500 })
  }
}
