// app/api/admin/upload/route.js
// CMS upload endpoint (hero slides, testimonials, etc.)
// - DigitalOcean Spaces in production
// - Local disk in development

import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { checkAdminAuth } from '@/lib/adminAuth'

// ─────────────────────────────────────────────────────────────
// Spaces Upload
// ─────────────────────────────────────────────────────────────

async function uploadToSpaces(buffer, filename, mimeType) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')

  const region    = process.env.DO_SPACES_REGION
  const bucket    = process.env.DO_SPACES_BUCKET
  const cdnUrl    = process.env.DO_SPACES_CDN_URL?.replace(/\/$/, '')
  const accessKey = process.env.DO_SPACES_KEY
  const secretKey = process.env.DO_SPACES_SECRET

  if (!region || !bucket || !cdnUrl || !accessKey || !secretKey) {
    throw new Error(
      'Missing DO_SPACES_REGION, DO_SPACES_BUCKET, DO_SPACES_CDN_URL, DO_SPACES_KEY, or DO_SPACES_SECRET'
    )
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

  // IMPORTANT: match local structure
  const key = `images/uploads/${filename}`

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ACL: 'public-read', // REQUIRED for public access in many DO setups
    })
  )

  return `${cdnUrl}/${key}`
}

// ─────────────────────────────────────────────────────────────
// Local Disk Upload (DEV ONLY)
// ─────────────────────────────────────────────────────────────

async function uploadToDisk(buffer, filename) {
  const uploadDir = path.join(process.cwd(), 'public', 'images', 'uploads')
  await mkdir(uploadDir, { recursive: true })
  await writeFile(path.join(uploadDir, filename), buffer)

  return `/images/uploads/${filename}`
}

// ─────────────────────────────────────────────────────────────
// POST Handler
// ─────────────────────────────────────────────────────────────

export async function POST(req) {
  // Auth
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file')

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // ── Basic validation (important) ──
    if (!file.type?.startsWith('image/')) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })
    }

    const mimeType = file.type || 'image/jpeg'
    const ext = path.extname(file.name || '').toLowerCase() || '.jpg'
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    // ── Check full Spaces config ──
    const hasSpacesConfig = !!(
      process.env.DO_SPACES_KEY &&
      process.env.DO_SPACES_SECRET &&
      process.env.DO_SPACES_BUCKET &&
      process.env.DO_SPACES_REGION &&
      process.env.DO_SPACES_CDN_URL
    )

    const url = hasSpacesConfig
      ? await uploadToSpaces(buffer, filename, mimeType)
      : await uploadToDisk(buffer, filename)

    return NextResponse.json({ url })

  } catch (err) {
    console.error('[upload]', err)
    return NextResponse.json(
      { error: err.message || 'Upload failed' },
      { status: 500 }
    )
  }
}