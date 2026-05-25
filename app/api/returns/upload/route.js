// app/api/returns/upload/route.js
// Handles evidence file uploads (photos / videos) for return requests.
// Mirrors the pattern in app/api/admin/upload/route.js but is customer-facing
// and accepts images + short video clips.

import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE  = 20 * 1024 * 1024  // 20 MB
const MAX_FILES      = 5

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',   // .mov
  'video/x-m4v',
])

const EXT_MAP = {
  'image/jpeg':    '.jpg',
  'image/png':     '.png',
  'image/webp':    '.webp',
  'image/gif':     '.gif',
  'video/mp4':     '.mp4',
  'video/quicktime': '.mov',
  'video/x-m4v':  '.m4v',
}

// ── Spaces Upload ─────────────────────────────────────────────────────────────

async function uploadToSpaces(buffer, filename, mimeType) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')

  const region    = process.env.DO_SPACES_REGION
  const bucket    = process.env.DO_SPACES_BUCKET
  const cdnUrl    = process.env.DO_SPACES_CDN_URL?.replace(/\/$/, '')
  const accessKey = process.env.DO_SPACES_KEY
  const secretKey = process.env.DO_SPACES_SECRET

  if (!region || !bucket || !cdnUrl || !accessKey || !secretKey) {
    throw new Error('Missing DigitalOcean Spaces configuration.')
  }

  const client = new S3Client({
    endpoint: `https://${region}.digitaloceanspaces.com`,
    region,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: false,
  })

  const key = `returns/evidence/${filename}`

  await client.send(new PutObjectCommand({
    Bucket:      bucket,
    Key:         key,
    Body:        buffer,
    ContentType: mimeType,
    ACL:         'public-read',
  }))

  return `${cdnUrl}/${key}`
}

// ── Local Disk Upload (dev) ───────────────────────────────────────────────────

async function uploadToDisk(buffer, filename) {
  const dir = path.join(process.cwd(), 'public', 'returns', 'evidence')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, filename), buffer)
  return `/returns/evidence/${filename}`
}

// ── POST /api/returns/upload ──────────────────────────────────────────────────

export async function POST(req) {
  // Must be signed-in customer
  const userId = req.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Sign in required' }, { status: 401 })
  }

  let formData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid form data' }, { status: 400 })
  }

  // Support uploading multiple files in a single request
  const files = formData.getAll('file')

  if (!files.length) {
    return NextResponse.json({ ok: false, error: 'No files provided' }, { status: 400 })
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ ok: false, error: `Maximum ${MAX_FILES} files allowed` }, { status: 400 })
  }

  const hasSpaces = !!(
    process.env.DO_SPACES_KEY &&
    process.env.DO_SPACES_SECRET &&
    process.env.DO_SPACES_BUCKET &&
    process.env.DO_SPACES_REGION &&
    process.env.DO_SPACES_CDN_URL
  )

  const results = []

  for (const file of files) {
    if (typeof file === 'string') {
      return NextResponse.json({ ok: false, error: 'Invalid file' }, { status: 400 })
    }

    const mimeType = file.type || ''

    if (!ALLOWED_TYPES.has(mimeType)) {
      return NextResponse.json({
        ok: false,
        error: `File type not allowed: ${mimeType || 'unknown'}. Allowed: JPEG, PNG, WEBP, GIF, MP4, MOV`,
      }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({
        ok: false,
        error: `File "${file.name}" exceeds the 20 MB limit`,
      }, { status: 400 })
    }

    const ext      = EXT_MAP[mimeType] || path.extname(file.name || '').toLowerCase() || '.bin'
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
    const buffer   = Buffer.from(await file.arrayBuffer())

    try {
      const url = hasSpaces
        ? await uploadToSpaces(buffer, filename, mimeType)
        : await uploadToDisk(buffer, filename)

      results.push({ url, name: file.name, type: mimeType })
    } catch (err) {
      console.error('[returns/upload] upload error:', err)
      return NextResponse.json({ ok: false, error: 'Upload failed. Please try again.' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, files: results })
}