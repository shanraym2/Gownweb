import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'

function checkAuth(request) {
  const secret = request.headers.get('x-admin-secret') || ''
  return process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET
}

export async function POST(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { image } = await request.json()
    if (!image || !image.startsWith('data:image/png;base64,')) {
      return NextResponse.json({ ok: false, error: 'Expected a PNG data URL.' }, { status: 400 })
    }

    const base64 = image.replace('data:image/png;base64,', '')
    const buffer = Buffer.from(base64, 'base64')

    // Save to public/images with a unique name
    const filename = `tryon-${Date.now()}.png`
    const outDir   = path.join(process.cwd(), 'public', 'images')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, filename), buffer)

    return NextResponse.json({ ok: true, path: `/images/${filename}` })
  } catch (err) {
    console.error('upload-tryon-image error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to save image.' }, { status: 500 })
  }
}