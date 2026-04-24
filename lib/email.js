// app/lib/email.js
//
// Centralised email utility for JCE Bridal.
//
// Previously, three separate files each imported nodemailer and created their
// own transporter inline:
//   - app/api/orders/route.js          (sendOrderEmail, sendStatusEmail)
//   - app/api/admin/orders/route.js    (sendStatusEmail, sendVerifyEmail, sendRejectEmail)
//   - app/api/auth/send-otp/route.js   (OTP email)
//
// This module consolidates them. Each route imports only what it needs.
//
// Usage:
//   import { sendOrderConfirmation, sendStatusUpdate, sendPaymentVerified,
//            sendPaymentRejected, sendOtp } from '@/lib/email'

import nodemailer from 'nodemailer'

// ── Transport factory ─────────────────────────────────────────────────────────
// Returns null if credentials are not configured (dev mode / CI).

function createTransport() {
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return null
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })
}

function from() {
  return `"JCE Bridal Boutique" <${process.env.GMAIL_USER}>`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function orderNum(order)  { return order.order_number  || order.orderNumber  || '' }
function custName(order)  { return order.customer_name || order.customerName || 'there' }
function custEmail(order) { return order.customer_email || order.customerEmail || '' }

// ── sendOrderConfirmation ─────────────────────────────────────────────────────
// Sent when a new order is placed.

export async function sendOrderConfirmation(order) {
  const transport = createTransport()
  if (!transport) return

  const to = custEmail(order)
  if (!to) return

  const num       = orderNum(order)
  const name      = custName(order)
  const method    = order.paymentMethod || order.payment_method || ''
  const delivery  = order.deliveryMethod || order.delivery_method || ''
  const address   = order.deliveryAddress || order.delivery_address || ''

  const itemLines = (order.items || [])
    .map(i => `  • ${i.gownName || i.name}${i.sizeLabel ? ` (${i.sizeLabel})` : ''} ×${i.quantity || 1} — ₱${Number(i.unitPrice || i.unit_price || 0).toLocaleString('en-PH')}`)
    .join('\n')

  await transport.sendMail({
    from: from(),
    to,
    subject: `Order confirmed — ${num}`,
    text: `Hi ${name},

Thank you for your order at JCE Bridal Boutique!

Order number: ${num}
Status: Placed — awaiting payment confirmation

Items:
${itemLines}

Total: ₱${Number(order.total || 0).toLocaleString('en-PH')}

Payment method: ${method}
${method !== 'cash' ? 'Please upload your proof of payment within 24 hours to avoid cancellation.' : ''}

Delivery: ${delivery}
${address ? `Address: ${address}` : ''}

You can track your order on your profile page.

Thank you,
JCE Bridal Boutique`.trim(),
  })
}

// ── sendStatusUpdate ──────────────────────────────────────────────────────────
// Sent when admin changes order status.

const STATUS_TEMPLATES = {
  pending_payment: (num) => ({
    subject: `Awaiting payment — ${num}`,
    body:    `We're waiting for your proof of payment for order ${num}.\n\nPlease upload within 24 hours.`,
  }),
  paid: (num) => ({
    subject: `Payment verified ✓ — ${num}`,
    body:    `Your payment for order ${num} has been verified. We'll now begin preparing your order.`,
  }),
  processing: (num) => ({
    subject: `Order being prepared — ${num}`,
    body:    `Your order ${num} is now being prepared.`,
  }),
  ready: (num) => ({
    subject: `Ready for pickup — ${num}`,
    body:    `Your order ${num} is ready!`,
  }),
  shipped: (num) => ({
    subject: `Order on its way — ${num}`,
    body:    `Order ${num} has been dispatched.`,
  }),
  completed: (num) => ({
    subject: `Order completed — ${num}`,
    body:    `Order ${num} is complete. We hope you love your gown!`,
  }),
  cancelled: (num, note) => ({
    subject: `Order cancelled — ${num}`,
    body:    `Your order ${num} has been cancelled.${note ? `\n\nReason: ${note}` : ''}`,
  }),
  refunded: (num) => ({
    subject: `Refund processed — ${num}`,
    body:    `A refund for order ${num} has been processed. Allow 7–14 business days.`,
  }),
}

export async function sendStatusUpdate(order, status, note = '') {
  const transport = createTransport()
  if (!transport) return

  const to = custEmail(order)
  if (!to) return

  const tmplFn = STATUS_TEMPLATES[status]
  if (!tmplFn) return

  const num  = orderNum(order)
  const name = custName(order)
  const tmpl = tmplFn(num, note)

  await transport.sendMail({
    from:    from(),
    to,
    subject: tmpl.subject,
    text:    `Hi ${name},\n\n${tmpl.body}\n\nJCE Bridal Boutique`,
  })
}

// ── sendPaymentVerified ───────────────────────────────────────────────────────
// Sent when admin verifies a payment proof.

export async function sendPaymentVerified(order) {
  const transport = createTransport()
  if (!transport) return

  const to = custEmail(order)
  if (!to) return

  const num  = orderNum(order)
  const name = custName(order)

  await transport.sendMail({
    from:    from(),
    to,
    subject: `Payment verified ✓ — ${num}`,
    text:    `Hi ${name},\n\nYour payment for order ${num} has been verified. We'll now begin preparing your order.\n\nThank you,\nJCE Bridal Boutique`,
  })
}

// ── sendPaymentRejected ───────────────────────────────────────────────────────
// Sent when admin rejects a payment proof.

export async function sendPaymentRejected(order, reason = '') {
  const transport = createTransport()
  if (!transport) return

  const to = custEmail(order)
  if (!to) return

  const num  = orderNum(order)
  const name = custName(order)

  await transport.sendMail({
    from:    from(),
    to,
    subject: `Payment proof rejected — ${num}`,
    text:    `Hi ${name},\n\nUnfortunately your payment proof for order ${num} was rejected.${reason ? `\n\nReason: ${reason}` : ''}\n\nPlease re-upload a clear proof of payment.\n\nJCE Bridal Boutique`,
  })
}

// ── sendOtp ───────────────────────────────────────────────────────────────────
// Sends a 6-digit OTP code to the user.

export async function sendOtp(email, otp, expiresAt) {
  const transport = createTransport()
  // In dev mode, caller should print to terminal instead of calling this
  if (!transport) return false

  await transport.sendMail({
    from:    from(),
    to:      email,
    subject: 'Your verification code – JCE Bridal',
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;">
        <h2 style="color:#3D2F27;margin-bottom:8px;">JCE Bridal</h2>
        <p style="color:#555;margin-bottom:24px;">Your one-time verification code is:</p>
        <p style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#3D2F27;margin:0 0 24px;">
          ${otp}
        </p>
        <p style="color:#888;font-size:14px;">
          This code expires in <strong>10 minutes</strong>. Do not share it with anyone.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
        <p style="color:#bbb;font-size:12px;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  })

  return true
}