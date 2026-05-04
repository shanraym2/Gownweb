import { NextResponse } from 'next/server'

const USE_DB   = process.env.USE_DB === 'true'

// ── Helpers (mirrors upload-tryon-image/route.js) ─────────────────────────────

async function uploadToSpaces(buffer, filename, mimeType) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')

  const region = process.env.DO_SPACES_REGION
  const bucket = process.env.DO_SPACES_BUCKET
  const cdnUrl = process.env.DO_SPACES_CDN_URL?.replace(/\/$/, '')
  const accessKey = process.env.DO_SPACES_KEY
  const secretKey = process.env.DO_SPACES_SECRET

  if (!region || !bucket || !cdnUrl || !accessKey || !secretKey)
    throw new Error('Missing DO Spaces environment variables.')

  const client = new S3Client({
    endpoint: `https://${region}.digitaloceanspaces.com`,
    region,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: false,
  })

  const key = `uploads/${filename}`

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    ACL: 'public-read',
  }))

  return `${cdnUrl}/${key}`
}

function base64ToBuffer(dataUrl) {
  const [header, base64] = dataUrl.split(',')
  const mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg'
  const isPng    = mimeType.includes('png')
  const ext      = isPng ? '.png' : '.jpg'
  const buffer   = Buffer.from(base64, 'base64')
  return { buffer, mimeType, ext }
}

// ── JSON store helpers (unchanged) ───────────────────────────────────────────

import path from 'path'
import fs   from 'fs'

const dataFile = path.join(process.cwd(), 'data', 'orders.json')

function loadJson() {
  if (!fs.existsSync(dataFile)) return []
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')) } catch { return [] }
}
function saveJson(o) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true })
  fs.writeFileSync(dataFile, JSON.stringify(o, null, 2))
}

// ── POST /api/orders/upload-proof ─────────────────────────────────────────────

export async function POST(request) {
  const userId = request.headers.get('x-user-id')
  if (!userId)
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })

  let body
  try { body = await request.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 }) }

  const { orderId, image, referenceNo } = body

  if (!orderId) return NextResponse.json({ ok: false, error: 'orderId required' },  { status: 400 })
  if (!image)   return NextResponse.json({ ok: false, error: 'image required' },    { status: 400 })

  if (!String(image).startsWith('data:image/'))
    return NextResponse.json({ ok: false, error: 'Invalid image format. Use JPEG or PNG.' }, { status: 400 })

  if (image.length > 7_000_000)
    return NextResponse.json({ ok: false, error: 'Image too large. Max 5MB.' }, { status: 400 })

  const cleanRef = referenceNo
    ? String(referenceNo).replace(/[<>"']/g, '').trim().slice(0, 100)
    : null

  // ── Convert base64 → buffer & build filename ─────────────────────────────
  const { buffer, mimeType, ext } = base64ToBuffer(image)
  const filename = `proof-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`

  // ── Upload to Spaces (or fall back to keeping the data URL for local dev) ─
  const hasSpacesConfig = !!(
    process.env.DO_SPACES_KEY &&
    process.env.DO_SPACES_SECRET &&
    process.env.DO_SPACES_BUCKET &&
    process.env.DO_SPACES_REGION &&
    process.env.DO_SPACES_CDN_URL
  )

  let proofImageUrl
  try {
    proofImageUrl = hasSpacesConfig
      ? await uploadToSpaces(buffer, filename, mimeType)
      : image   // local dev: keep data URL as-is (same behaviour as before)
  } catch (err) {
    console.error('upload-proof: Spaces upload failed', err)
    return NextResponse.json({ ok: false, error: 'Failed to upload image.' }, { status: 500 })
  }

  // ── Persist ──────────────────────────────────────────────────────────────

  if (!USE_DB) {
    const all = loadJson()
    const idx = all.findIndex(o => String(o.id) === String(orderId))
    if (idx === -1) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })
    if (String(all[idx].userId) !== String(userId))
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 403 })
    if (all[idx].paymentMethod === 'cash')
      return NextResponse.json({ ok: false, error: 'Cash orders do not require proof' }, { status: 400 })
    if (['paid', 'refunded', 'cancelled'].includes(all[idx].paymentStatus))
      return NextResponse.json({ ok: false, error: 'Payment already verified or cancelled' }, { status: 400 })

    all[idx].paymentStatus    = 'pending'
    all[idx].proofImage       = proofImageUrl   // now a CDN URL in prod, data URL in dev
    all[idx].proofReferenceNo = cleanRef
    all[idx].proofUploadedAt  = new Date().toISOString()
    saveJson(all)
    return NextResponse.json({ ok: true, proofImageUrl })
  }

  try {
    const { query } = await import('@/lib/db')

    const orders = await query(
      'SELECT id,user_id,payment_method,payment_status,status FROM orders WHERE id=$1',
      [orderId]
    )
    if (!orders.length)
      return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

    const order = orders[0]
    if (String(order.user_id) !== String(userId))
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 403 })
    if (order.payment_method === 'cash')
      return NextResponse.json({ ok: false, error: 'Cash orders do not require proof' }, { status: 400 })
    if (['paid', 'refunded', 'cancelled'].includes(order.payment_status))
      return NextResponse.json({ ok: false, error: 'Payment already verified or cancelled' }, { status: 400 })

    await query(
      `INSERT INTO payments (order_id, method, amount, proof_image_url, reference_no, status)
       VALUES (
         $1,
         (SELECT payment_method FROM orders WHERE id=$1),
         (SELECT total           FROM orders WHERE id=$1),
         $2, $3, 'pending'
       )
       ON CONFLICT (order_id) DO UPDATE
         SET proof_image_url=$2, reference_no=$3, status='pending', created_at=NOW()`,
      [orderId, proofImageUrl, cleanRef]   // stores CDN URL, not base64
    )

    await query(
      `UPDATE orders SET payment_status='pending', status='pending_payment', updated_at=NOW() WHERE id=$1`,
      [orderId]
    )

    return NextResponse.json({ ok: true, proofImageUrl })
  } catch (err) {
    console.error('POST /api/orders/upload-proof error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to upload proof' }, { status: 500 })
  }
}

// ── GET /api/orders/upload-proof?orderId=xxx  — admin only ───────────────────

export async function GET(request) {
  const adminSecret = request.headers.get('x-admin-secret')
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET)
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const orderId = new URL(request.url).searchParams.get('orderId')
  if (!orderId) return NextResponse.json({ ok: false, error: 'orderId required' }, { status: 400 })

  if (!USE_DB) {
    const order = loadJson().find(o => String(o.id) === String(orderId))
    if (!order) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })
    return NextResponse.json({
      ok: true,
      proofImage:  order.proofImage       || null,
      referenceNo: order.proofReferenceNo || null,
      uploadedAt:  order.proofUploadedAt  || null,
    })
  }

  try {
    const { query } = await import('@/lib/db')
    const rows = await query(
      'SELECT proof_image_url, reference_no, created_at FROM payments WHERE order_id=$1',
      [orderId]
    )
    if (!rows.length) return NextResponse.json({ ok: false, error: 'No proof found' }, { status: 404 })
    return NextResponse.json({
      ok: true,
      proofImage:  rows[0].proof_image_url,
      referenceNo: rows[0].reference_no,
      uploadedAt:  rows[0].created_at,
    })
  } catch (err) {
    console.error('GET upload-proof error:', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch proof' }, { status: 500 })
  }
}