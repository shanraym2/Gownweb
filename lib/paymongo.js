// lib/paymongo.js
const PAYMONGO_API = 'https://api.paymongo.com/v1'

function authHeader() {
  const key = process.env.PAYMONGO_SECRET_KEY
  if (!key) throw new Error('PAYMONGO_SECRET_KEY is not set')
  return 'Basic ' + Buffer.from(`${key}:`).toString('base64')
}

export async function createQrPhIntent({ amountPesos, description, orderId }) {
  const amountCentavos = Math.round(amountPesos * 100)

  const intentRes = await fetch(`${PAYMONGO_API}/payment_intents`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        attributes: {
          amount: amountCentavos,
          payment_method_allowed: ['qrph'],
          payment_method_options: { qrph: { require_auth: false } },
          currency: 'PHP',
          description: description || `JCE Bridal order ${orderId}`,
          metadata: { order_id: orderId },
        },
      },
    }),
  })
  const intentData = await intentRes.json()
  if (!intentRes.ok) throw new Error(intentData?.errors?.[0]?.detail || 'Failed to create payment intent')
  const intentId = intentData.data.id
  const clientKey = intentData.data.attributes.client_key

  const pmRes = await fetch(`${PAYMONGO_API}/payment_methods`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { attributes: { type: 'qrph' } } }),
  })
  const pmData = await pmRes.json()
  if (!pmRes.ok) throw new Error(pmData?.errors?.[0]?.detail || 'Failed to create payment method')
  const paymentMethodId = pmData.data.id

  const attachRes = await fetch(`${PAYMONGO_API}/payment_intents/${intentId}/attach`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: { attributes: { payment_method: paymentMethodId, client_key: clientKey } },
    }),
  })
  const attachData = await attachRes.json()
  if (!attachRes.ok) throw new Error(attachData?.errors?.[0]?.detail || 'Failed to attach payment method')

  const qrImageUrl = attachData.data.attributes?.next_action?.code?.image_url || null
  const status      = attachData.data.attributes?.status

  return { intentId, qrImageUrl, status }
}

export async function getPaymentIntentStatus(intentId) {
  const res  = await fetch(`${PAYMONGO_API}/payment_intents/${intentId}`, {
    headers: { Authorization: authHeader() },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.errors?.[0]?.detail || 'Failed to fetch payment intent')
  return data.data.attributes.status
}

// Verifies the `Paymongo-Signature` header: "t=<ts>,te=<test_sig>,li=<live_sig>"
export function verifyWebhookSignature(rawBody, signatureHeader) {
  const crypto = require('crypto')
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET
  if (!secret || !signatureHeader) return false

  const parts = Object.fromEntries(
    signatureHeader.split(',').map(p => p.split('='))
  )
  const { t: timestamp, te: testSig, li: liveSig } = parts
  if (!timestamp) return false

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')

  // Live vs test mode is determined by the API secret key's prefix
  // (sk_live_ / sk_test_), since PayMongo's webhook secret itself
  // doesn't carry a mode marker in its prefix. Never fall back between
  // te/li — mixing modes always fails verification, which is why every
  // live delivery was 401ing (te was always tried first regardless of mode).
  const isLiveMode = process.env.PAYMONGO_SECRET_KEY?.startsWith('sk_live_')
  const candidate = isLiveMode ? liveSig : testSig
  if (!candidate) return false

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))
  } catch {
    return false // length mismatch etc.
  }
}