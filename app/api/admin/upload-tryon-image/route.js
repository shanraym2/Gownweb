// app/api/admin/upload-tryon-image/route.js
// Uploads images to DigitalOcean Spaces in production,
// local public/images/ in development.
//
// Required environment variables (set in DO App Platform → Settings → Environment):
//   DO_SPACES_KEY        — Spaces access key ID
//   DO_SPACES_SECRET     — Spaces secret access key
//   DO_SPACES_REGION     — e.g. "sgp1"
//   DO_SPACES_BUCKET     — e.g. "jce-bridal"
//   DO_SPACES_CDN_URL    — e.g. "https://jce-bridal.sgp1.cdn.digitaloceanspaces.com"
//                          (or https://jce-bridal.sgp1.digitaloceanspaces.com if no CDN)
//
// Install the AWS SDK v3 S3 client (Spaces is S3-compatible):
//   npm install @aws-sdk/client-s3

import { NextResponse } from 'next/server'
import path             from 'path'
import fs               from 'fs'
import { checkAdminAuth } from '@/lib/adminAuth'

export const maxDuration = 60  // seconds


// ── Spaces upload ─────────────────────────────────────────────────────────────

async function uploadToSpaces(buffer, filename, mimeType) {
  // Lazy-import so the module is only loaded when needed
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')

  const region = process.env.DO_SPACES_REGION
  const bucket = process.env.DO_SPACES_BUCKET
  const cdnUrl = process.env.DO_SPACES_CDN_URL?.replace(/\/$/, '')

  const accessKey = process.env.DO_SPACES_KEY
  const secretKey = process.env.DO_SPACES_SECRET

  if (!region || !bucket || !cdnUrl || !accessKey || !secretKey) {
    throw new Error(
      'Missing DO_SPACES_REGION, DO_SPACES_BUCKET, or DO_SPACES_CDN_URL env vars.'
    )
  }

  const client = new S3Client({
    endpoint:        `https://${region}.digitaloceanspaces.com`,
    region,
    credentials: {
      accessKeyId:     process.env.DO_SPACES_KEY     || '',
      secretAccessKey: process.env.DO_SPACES_SECRET  || '',
    },
    forcePathStyle: false,
  })

  // Store under uploads/ prefix so it's easy to manage in the Spaces dashboard
  const key = `uploads/${filename}`

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }))

  // Return the public CDN URL
  return `${cdnUrl}/${key}`
}

// ── Local disk upload (development only) ─────────────────────────────────────

function uploadToDisk(buffer, filename) {
  const outDir = path.join(process.cwd(), 'public', 'images')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, filename), buffer)
  return `/images/${filename}`
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request) {
  if (!await checkAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const contentType = request.headers.get('content-type') || ''
    let buffer, filename, mimeType

    if (contentType.includes('multipart/form-data')) {
      // ── FormData upload ────────────────────────────────────────────────────
      const formData = await request.formData()
      const file     = formData.get('file')

      if (!file || typeof file === 'string') {
        return NextResponse.json(
          { ok: false, error: 'No file provided.' },
          { status: 400 }
        )
      }

      mimeType = file.type || 'image/jpeg'
      const ext = path.extname(file.name || '').toLowerCase() || '.jpg'
      filename  = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
      buffer    = Buffer.from(await file.arrayBuffer())

    } else {
      // ── Base64 JSON upload (BgRemover) ─────────────────────────────────────
      const body  = await request.json()
      const { image } = body

      if (!image || !image.startsWith('data:image/')) {
        return NextResponse.json(
          { ok: false, error: 'Expected an image data URL.' },
          { status: 400 }
        )
      }

      const [header, base64] = image.split(',')
      const isPng = header.includes('png')
      mimeType  = isPng ? 'image/png' : 'image/jpeg'
      const ext = isPng ? '.png' : '.jpg'
      filename  = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
      buffer    = Buffer.from(base64, 'base64')
    }

    // ── Route to the right storage backend ────────────────────────────────────
    const isProduction = process.env.NODE_ENV === 'production'
    const hasSpacesConfig = !!(
      process.env.DO_SPACES_KEY &&
      process.env.DO_SPACES_SECRET &&
      process.env.DO_SPACES_BUCKET
    )

    let publicUrl

    if (hasSpacesConfig) {
      publicUrl = await uploadToSpaces(buffer, filename, mimeType)
    } else {
      publicUrl = uploadToDisk(buffer, filename)
    }

    // Return both `path` and `url` so all callers work
    return NextResponse.json({ ok: true, path: publicUrl, url: publicUrl })

  } catch (err) {
    console.error('[upload-tryon-image]', err)
    return NextResponse.json(
      { ok: false, error: err.message || 'Failed to save image.' },
      { status: 500 }
    )
  }
}