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
    const contentType = request.headers.get('content-type') || ''
    let buffer, filename

    if (contentType.includes('multipart/form-data')) {
      // ── FormData upload (from CMS ImageUploadField or fixed BgRemover) ──
      const formData = await request.formData()
      const file     = formData.get('file')

      if (!file || typeof file === 'string') {
        return NextResponse.json({ ok: false, error: 'No file provided.' }, { status: 400 })
      }

      const ext  = path.extname(file.name || '').toLowerCase() || '.jpg'
      filename   = `tryon-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
      buffer     = Buffer.from(await file.arrayBuffer())

    } else {
      // ── Base64 JSON upload (original gowns page BgRemover) ──
      const body = await request.json()
      const { image } = body

      if (!image || !image.startsWith('data:image/')) {
        return NextResponse.json({ ok: false, error: 'Expected an image data URL.' }, { status: 400 })
      }

      const [header, base64] = image.split(',')
      const ext = header.includes('png') ? '.png' : '.jpg'
      filename  = `tryon-${Date.now()}.${ext}`
      buffer    = Buffer.from(base64, 'base64')
    }

    const outDir  = path.join(process.cwd(), 'public', 'images')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, filename), buffer)

    const filePath = `/images/${filename}`

    // Return both `path` (original field) and `url` (used by CMS uploader)
    // so both callers work without any changes on the client side.
    return NextResponse.json({ ok: true, path: filePath, url: filePath })

  } catch (err) {
    console.error('upload-tryon-image error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to save image.' }, { status: 500 })
  }
}