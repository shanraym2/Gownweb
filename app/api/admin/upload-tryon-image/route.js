// app/api/admin/upload-tryon-image/route.js

import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { checkAdminAuth } from '@/lib/adminAuth'

export const maxDuration = 60

// ── Spaces upload ────────────────────────────────────────────────
async function uploadToSpaces(buffer, filename, mimeType) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')

  const region = process.env.DO_SPACES_REGION
  const bucket = process.env.DO_SPACES_BUCKET
  const cdnUrl = process.env.DO_SPACES_CDN_URL?.replace(/\/$/, '')

  const accessKey = process.env.DO_SPACES_KEY
  const secretKey = process.env.DO_SPACES_SECRET

  // HARD FAIL (no silent fallback)
  if (!region || !bucket || !cdnUrl || !accessKey || !secretKey) {
    throw new Error('Missing DigitalOcean Spaces environment variables.')
  }

  const client = new S3Client({
    endpoint: `https://${region}.digitaloceanspaces.com`,
    region,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    forcePathStyle: false,
  })

  const key = `uploads/${filename}`

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ACL: 'public-read',
    })
  )

  return `${cdnUrl}/${key}`
}

// ── Local upload (DEV ONLY) ─────────────────────────────────────
function uploadToDisk(buffer, filename) {
  const outDir = path.join(process.cwd(), 'public', 'images')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, filename), buffer)
  return `/images/${filename}`
}

// ── POST handler ────────────────────────────────────────────────
export async function POST(request) {
  if (!(await checkAdminAuth(request))) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 }
    )
  }

  try {
    const contentType = request.headers.get('content-type') || ''
    let buffer, filename, mimeType

    // ── Multipart upload ─────────────────────────────
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')

      if (!file || typeof file === 'string') {
        return NextResponse.json(
          { ok: false, error: 'No file provided.' },
          { status: 400 }
        )
      }

      mimeType = file.type || 'image/jpeg'
      const ext = path.extname(file.name || '') || '.jpg'

      filename = `upload-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}${ext}`

      buffer = Buffer.from(await file.arrayBuffer())
    }

    // ── Base64 upload ────────────────────────────────
    else {
      const body = await request.json()
      const { image } = body

      if (!image?.startsWith('data:image/')) {
        return NextResponse.json(
          { ok: false, error: 'Invalid image data URL.' },
          { status: 400 }
        )
      }

      const [header, base64] = image.split(',')

      const isPng = header.includes('png')
      mimeType = isPng ? 'image/png' : 'image/jpeg'

      const ext = isPng ? '.png' : '.jpg'

      filename = `upload-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}${ext}`

      buffer = Buffer.from(base64, 'base64')
    }

    // ── ENV SAFETY CHECK (IMPORTANT FIX) ─────────────
    const isProduction = process.env.NODE_ENV === 'production'

    const hasSpacesConfig =
      !!process.env.DO_SPACES_KEY &&
      !!process.env.DO_SPACES_SECRET &&
      !!process.env.DO_SPACES_BUCKET &&
      !!process.env.DO_SPACES_REGION &&
      !!process.env.DO_SPACES_CDN_URL

    let url

    if (isProduction) {
      if (!hasSpacesConfig) {
        throw new Error('Spaces is required in production but not configured.')
      }
      url = await uploadToSpaces(buffer, filename, mimeType)
    } else {
      url = uploadToDisk(buffer, filename)
    }

    // IMPORTANT: always return FULL URL only
    return NextResponse.json({
      ok: true,
      url,
    })
  } catch (err) {
    console.error('[upload-tryon-image]', err)
    return NextResponse.json(
      { ok: false, error: err.message || 'Upload failed' },
      { status: 500 }
    )
  }
}