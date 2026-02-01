import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

function getGownsPath() {
  return join(process.cwd(), 'data', 'gowns.json')
}

function loadGowns() {
  const path = getGownsPath()
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
}

function saveGowns(gowns) {
  const path = getGownsPath()
  writeFileSync(path, JSON.stringify(gowns, null, 2), 'utf8')
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
  const gowns = loadGowns()
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
    const gowns = loadGowns()
    const maxId = gowns.length ? Math.max(...gowns.map((g) => Number(g.id) || 0)) : 0
    const newGown = {
      id: maxId + 1,
      name: String(name).trim(),
      price: String(price).trim(),
      image: String(image).trim(),
      alt: String(alt || name).trim(),
      type: String(type || 'Gowns').trim(),
      color: String(color || '').trim(),
      silhouette: String(silhouette || '').trim(),
      description: String(description || '').trim(),
      ...(style && typeof style === 'object' ? { style } : {}),
    }
    gowns.push(newGown)
    saveGowns(gowns)
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
    const gowns = loadGowns()
    const index = gowns.findIndex((g) => Number(g.id) === gownId)
    if (index === -1) {
      return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
    }
    const updated = {
      ...gowns[index],
      name: String(name).trim(),
      price: String(price).trim(),
      image: String(image).trim(),
      alt: String(alt || name).trim(),
      type: String(type || 'Gowns').trim(),
      color: String(color || '').trim(),
      silhouette: String(silhouette || '').trim(),
      description: String(description || '').trim(),
      ...(style && typeof style === 'object' ? { style } : {}),
    }
    gowns[index] = updated
    saveGowns(gowns)
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
    const gowns = loadGowns()
    const filtered = gowns.filter((g) => Number(g.id) !== gownId)
    if (filtered.length === gowns.length) {
      return NextResponse.json({ ok: false, error: 'Gown not found' }, { status: 404 })
    }
    saveGowns(filtered)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Admin gowns DELETE error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to delete gown' }, { status: 500 })
  }
}
