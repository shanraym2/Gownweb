import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { query } from '@/lib/db'
import crypto from 'crypto'

const OTP_EXPIRY_MS        = 10 * 60 * 1000  // 10 minutes
const OTP_RESEND_COOLDOWN  = 30              // seconds

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex')
}

// Map frontend purpose → DB CHECK constraint values
const PURPOSE_MAP = {
  login:           'login',
  signup:          'signup',
  auth:            'login',
  'reset-password': 'password_reset',
}

export async function POST(request) {
  try {
    const { email, purpose } = await request.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ ok: false, error: 'Email is required' }, { status: 400 })
    }

    const cleanEmail   = email.trim().toLowerCase()
    const rawPurpose   = String(purpose || 'login').trim().toLowerCase()
    const dbPurpose    = PURPOSE_MAP[rawPurpose]

    if (!dbPurpose) {
      return NextResponse.json({ ok: false, error: 'Invalid OTP purpose' }, { status: 400 })
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return NextResponse.json({ ok: false, error: 'Invalid email format' }, { status: 400 })
    }

    // Cooldown check — look for a recent unexpired OTP for this email+purpose
    const recent = await query(
      `SELECT created_at FROM otp_codes
       WHERE email = $1 AND purpose = $2
         AND consumed_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [cleanEmail, dbPurpose]
    )

    if (recent.length > 0) {
      const sentAt      = new Date(recent[0].created_at).getTime()
      const secondsAgo  = Math.floor((Date.now() - sentAt) / 1000)
      const secondsLeft = OTP_RESEND_COOLDOWN - secondsAgo

      if (secondsLeft > 0) {
        return NextResponse.json(
          { ok: false, error: `Please wait ${secondsLeft}s before requesting another code.` },
          { status: 429 }
        )
      }
    }

    const otp      = generateOtp()
    const codeHash = hashOtp(otp)
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS)

    // Invalidate old OTPs for this email+purpose first
    await query(
      `UPDATE otp_codes SET consumed_at = NOW()
       WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [cleanEmail, dbPurpose]
    )

    // Insert new OTP
    await query(
      `INSERT INTO otp_codes (email, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [cleanEmail, dbPurpose, codeHash, expiresAt]
    )

    const gmailUser        = process.env.GMAIL_USER
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD

    // Dev mode — no email credentials
    if (!gmailUser || !gmailAppPassword) {
      console.log('\n╔══════════════════════════════════════╗')
      console.log('║       JCE Bridal — Dev OTP           ║')
      console.log('╠══════════════════════════════════════╣')
      console.log(`║  Purpose : ${rawPurpose.padEnd(27)}║`)
      console.log(`║  Email   : ${cleanEmail.slice(0, 27).padEnd(27)}║`)
      console.log(`║  Code    : ${otp.padEnd(27)}║`)
      console.log(`║  Expires : ${expiresAt.toLocaleTimeString().padEnd(27)}║`)
      console.log('╚══════════════════════════════════════╝\n')

      return NextResponse.json({ ok: true, devMode: true, message: 'Dev mode: OTP printed to terminal' })
    }

    // Production — send via Gmail
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

    return NextResponse.json({ ok: true, devMode: false, message: 'OTP sent to your email' })
  } catch (err) {
    console.error('Send OTP error:', err)
    return NextResponse.json(
      { ok: false, error: 'Failed to send OTP. Please try again.' },
      { status: 500 }
    )
  }
}