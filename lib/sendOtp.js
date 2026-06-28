import nodemailer from 'nodemailer'
import { query } from '@/lib/db'
import crypto from 'crypto'

const OTP_EXPIRY_MS       = 10 * 60 * 1000
const OTP_RESEND_COOLDOWN = 30

// ── IP rate limiter ───────────────────────────────────────────────────────────
// Max 5 OTP requests per IP per 10 minutes across all purposes.
// The per-email DB cooldown (30s) still applies on top of this.
const otpIpMap  = new Map()
const OTP_WINDOW = 10 * 60 * 1000
const OTP_IP_MAX = 5

export function checkOtpIpLimit(ip) {
  const now   = Date.now()
  const entry = otpIpMap.get(ip)
  if (!entry || now - entry.windowStart > OTP_WINDOW) {
    otpIpMap.set(ip, { windowStart: now, count: 1 })
    return true
  }
  entry.count++
  return entry.count <= OTP_IP_MAX
}

setInterval(() => {
  const cutoff = Date.now() - OTP_WINDOW
  for (const [k, v] of otpIpMap) if (v.windowStart < cutoff) otpIpMap.delete(k)
}, OTP_WINDOW)

export async function sendOtp(cleanEmail, purpose = 'password_reset') {
  // Cooldown check
  const recent = await query(
    `SELECT created_at FROM otp_codes
     WHERE email = $1 AND purpose = $2
       AND consumed_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [cleanEmail, purpose]
  )
  if (recent.length > 0) {
    const secondsAgo  = Math.floor((Date.now() - new Date(recent[0].created_at).getTime()) / 1000)
    const secondsLeft = OTP_RESEND_COOLDOWN - secondsAgo
    if (secondsLeft > 0)
      return { ok: false, error: `Please wait ${secondsLeft}s before requesting another code.`, status: 429 }
  }

  const otp       = String(crypto.randomInt(100000, 1000000))
  const codeHash  = crypto.createHash('sha256').update(otp).digest('hex')
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS)

  await query(
    `UPDATE otp_codes SET consumed_at = NOW()
     WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [cleanEmail, purpose]
  )
  await query(
    `INSERT INTO otp_codes (email, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [cleanEmail, purpose, codeHash, expiresAt]
  )

  const gmailUser        = process.env.GMAIL_USER
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD

  if (!gmailUser || !gmailAppPassword) {
    console.log('\n╔══════════════════════════════════════╗')
    console.log('║       JCE Bridal — Dev OTP           ║')
    console.log('╠══════════════════════════════════════╣')
    console.log(`║  Purpose : ${purpose.padEnd(27)}║`)
    console.log(`║  Email   : ${cleanEmail.slice(0, 27).padEnd(27)}║`)
    console.log(`║  Code    : ${otp.padEnd(27)}║`)
    console.log(`║  Expires : ${expiresAt.toLocaleTimeString().padEnd(27)}║`)
    console.log('╚══════════════════════════════════════╝\n')
    return { ok: true, devMode: true }
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailAppPassword },
  })
  await transporter.sendMail({
    from:    `"JCE Bridal" <${gmailUser}>`,
    to:      cleanEmail,
    subject: 'Your verification code – JCE Bridal',
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;">
        <h2 style="color:#3D2F27;margin-bottom:8px;">JCE Bridal</h2>
        <p style="color:#555;margin-bottom:24px;">Your one-time verification code is:</p>
        <p style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#3D2F27;margin:0 0 24px;">${otp}</p>
        <p style="color:#888;font-size:14px;">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
        <p style="color:#bbb;font-size:12px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  })
  return { ok: true, devMode: false }
}