import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'
import { checkAdminAuth } from '@/lib/adminAuth'

export const maxDuration = 60

export async function POST(request) {
  if (!await checkAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const contentType = request.headers.get('content-type') || ''
    let buffer, filename

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file     = formData.get('file')

      if (!file || typeof file === 'string') {
        return NextResponse.json({ ok: false, error: 'No file provided.' }, { status: 400 })
      }

      const ext  = path.extname(file.name || '').toLowerCase() || '.jpg'
      filename   = `tryon-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
      buffer     = Buffer.from(await file.arrayBuffer())

    } else {
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
    return NextResponse.json({ ok: true, path: filePath, url: filePath })

  } catch (err) {
    console.error('upload-tryon-image error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to save image.' }, { status: 500 })
  }
}