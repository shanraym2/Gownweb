import { NextResponse } from 'next/server'
import path from 'path'
import fs   from 'fs'

const USE_DB   = process.env.USE_DB === 'true'
const dataFile = path.join(process.cwd(), 'data', 'orders.json')

function loadJson() {
  if (!fs.existsSync(dataFile)) return []
  try { return JSON.parse(fs.readFileSync(dataFile,'utf8')) } catch { return [] }
}
function saveJson(o) {
  fs.mkdirSync(path.dirname(dataFile),{recursive:true})
  fs.writeFileSync(dataFile, JSON.stringify(o,null,2))
}

// POST /api/orders/upload-proof
export async function POST(request) {
  const userId = request.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ ok:false, error:'Not authenticated' }, { status:401 })

  let body
  try { body = await request.json() }
  catch { return NextResponse.json({ ok:false, error:'Invalid request body' }, { status:400 }) }

  const { orderId, image, referenceNo } = body

  if (!orderId) return NextResponse.json({ ok:false, error:'orderId required' }, { status:400 })
  if (!image)   return NextResponse.json({ ok:false, error:'image required' },   { status:400 })

  // Validate image format
  if (!String(image).startsWith('data:image/'))
    return NextResponse.json({ ok:false, error:'Invalid image format. Use JPEG or PNG.' }, { status:400 })

  // 5 MB limit (base64 is ~1.37x raw size)
  if (image.length > 7_000_000)
    return NextResponse.json({ ok:false, error:'Image too large. Max 5MB.' }, { status:400 })

  // Sanitise reference number — strip HTML/script
  const cleanRef = referenceNo
    ? String(referenceNo).replace(/[<>"']/g,'').trim().slice(0,100)
    : null

  if (!USE_DB) {
    const all = loadJson()
    const idx = all.findIndex(o => String(o.id) === String(orderId))
    if (idx === -1) return NextResponse.json({ ok:false, error:'Order not found' }, { status:404 })
    if (String(all[idx].userId) !== String(userId))
      return NextResponse.json({ ok:false, error:'Unauthorized' }, { status:403 })
    if (all[idx].paymentMethod === 'cash')
      return NextResponse.json({ ok:false, error:'Cash orders do not require proof' }, { status:400 })
    if (['paid','refunded','cancelled'].includes(all[idx].paymentStatus))
      return NextResponse.json({ ok:false, error:'Payment already verified or cancelled' }, { status:400 })
    all[idx].paymentStatus    = 'pending'
    all[idx].proofImage       = image
    all[idx].proofReferenceNo = cleanRef
    all[idx].proofUploadedAt  = new Date().toISOString()
    saveJson(all)
    return NextResponse.json({ ok:true })
  }

  try {
    const { query } = await import('@/lib/db')

    // Verify order exists and belongs to user
    const orders = await query(
      'SELECT id,user_id,payment_method,payment_status,status FROM orders WHERE id=$1',
      [orderId]
    )
    if (!orders.length)
      return NextResponse.json({ ok:false, error:'Order not found' }, { status:404 })

    const order = orders[0]
    if (String(order.user_id) !== String(userId))
      return NextResponse.json({ ok:false, error:'Unauthorized' }, { status:403 })
    if (order.payment_method === 'cash')
      return NextResponse.json({ ok:false, error:'Cash orders do not require proof' }, { status:400 })
    if (['paid','refunded','cancelled'].includes(order.payment_status))
      return NextResponse.json({ ok:false, error:'Payment already verified or cancelled' }, { status:400 })

    // Upsert into payments table
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
      [orderId, image, cleanRef]
    )

    // Move order to pending_payment
    await query(
      `UPDATE orders SET payment_status='pending', status='pending_payment', updated_at=NOW() WHERE id=$1`,
      [orderId]
    )

    return NextResponse.json({ ok:true })
  } catch(err) {
    console.error('POST /api/orders/upload-proof error:', err)
    return NextResponse.json({ ok:false, error:'Failed to upload proof' }, { status:500 })
  }
}

// GET /api/orders/upload-proof?orderId=xxx  — admin only
export async function GET(request) {
  const adminSecret = request.headers.get('x-admin-secret')
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET)
    return NextResponse.json({ ok:false, error:'Unauthorized' }, { status:401 })

  const orderId = new URL(request.url).searchParams.get('orderId')
  if (!orderId) return NextResponse.json({ ok:false, error:'orderId required' }, { status:400 })

  if (!USE_DB) {
    const order = loadJson().find(o => String(o.id) === String(orderId))
    if (!order) return NextResponse.json({ ok:false, error:'Order not found' }, { status:404 })
    return NextResponse.json({ ok:true, proofImage:order.proofImage||null, referenceNo:order.proofReferenceNo||null, uploadedAt:order.proofUploadedAt||null })
  }

  try {
    const { query } = await import('@/lib/db')
    const rows = await query('SELECT proof_image_url,reference_no,created_at FROM payments WHERE order_id=$1',[orderId])
    if (!rows.length) return NextResponse.json({ ok:false, error:'No proof found' }, { status:404 })
    return NextResponse.json({ ok:true, proofImage:rows[0].proof_image_url, referenceNo:rows[0].reference_no, uploadedAt:rows[0].created_at })
  } catch(err) {
    console.error('GET upload-proof error:', err)
    return NextResponse.json({ ok:false, error:'Failed to fetch proof' }, { status:500 })
  }
}