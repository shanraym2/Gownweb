import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const OTP_EXPIRY_MS = 10 * 60 * 1000     // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 30 * 1000  // 30 seconds

/**
 * Key by email + purpose so login and signup OTPs never overwrite each other.
 * e.g. "user@example.com::login"  vs  "user@example.com::signup"
 */
function storeKey(email, purpose) {
  return `${email}::${purpose}`
}

function getStorePath() {
  return join(tmpdir(), 'jce-otps.json')
}

function loadOtps() {
  const path = getStorePath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

function saveOtps(otps) {
  writeFileSync(getStorePath(), JSON.stringify(otps, null, 0))
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export async function POST(request) {
  try {
    const { email, purpose } = await request.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ ok: false, error: 'Email is required' }, { status: 400 })
    }

    const cleanEmail = email.trim().toLowerCase()
    const cleanPurpose = String(purpose || 'auth').trim().toLowerCase()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return NextResponse.json({ ok: false, error: 'Invalid email format' }, { status: 400 })
    }

    if (!['login', 'signup', 'auth', 'reset-password'].includes(cleanPurpose)) {
      return NextResponse.json({ ok: false, error: 'Invalid OTP purpose' }, { status: 400 })
    }

    const key = storeKey(cleanEmail, cleanPurpose)
    const otps = loadOtps()
    const prev = otps[key]

    // Cooldown check: prevent spam
    if (prev && Date.now() - Number(prev.sentAt || 0) < OTP_RESEND_COOLDOWN_MS) {
      const secondsLeft = Math.ceil(
        (OTP_RESEND_COOLDOWN_MS - (Date.now() - Number(prev.sentAt))) / 1000
      )
      return NextResponse.json(
        {
          ok: false,
          error: `Please wait ${secondsLeft} second${secondsLeft !== 1 ? 's' : ''} before requesting another code.`,
        },
        { status: 429 }
      )
    }

    const otp = generateOtp()

    otps[key] = {
      otp,
      expires: Date.now() + OTP_EXPIRY_MS,
      purpose: cleanPurpose,
      attempts: 0,
      sentAt: Date.now(),
    }
    saveOtps(otps)

    const gmailUser = process.env.GMAIL_USER
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD

    // ── Dev mode: no credentials → print to terminal ──────────────────────
    if (!gmailUser || !gmailAppPassword) {
      console.log('\n╔══════════════════════════════════════╗')
      console.log('║       JCE Bridal — Dev OTP           ║')
      console.log('╠══════════════════════════════════════╣')
      console.log(`║  Purpose : ${cleanPurpose.padEnd(27)}║`)
      console.log(`║  Email   : ${cleanEmail.slice(0, 27).padEnd(27)}║`)
      console.log(`║  Code    : ${otp.padEnd(27)}║`)
      console.log(`║  Expires : ${new Date(Date.now() + OTP_EXPIRY_MS).toLocaleTimeString().padEnd(27)}║`)
      console.log('╚══════════════════════════════════════╝\n')

      return NextResponse.json({
        ok: true,
        devMode: true,
        message: 'Dev mode: OTP printed to terminal',
      })
    }

    // ── Production: send via Gmail ────────────────────────────────────────
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailAppPassword },
    })

    await transporter.sendMail({
      from: `"JCE Bridal" <${gmailUser}>`,
      to: cleanEmail,
      subject: 'Your verification code – JCE Bridal',
      html: `
        <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;">
          <h2 style="color:#3D2F27;margin-bottom:8px;">JCE Bridal</h2>
          <p style="color:#555;margin-bottom:24px;">Your one-time verification code is:</p>
          <p style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#3D2F27;margin:0 0 24px;">
            ${otp}
          </p>
          <p style="color:#888;font-size:14px;">
            This code expires in <strong>10 minutes</strong>.
            Do not share it with anyone.
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

    const msg =
      err.code === 'EAUTH'
        ? 'Gmail login failed. Check GMAIL_USER and GMAIL_APP_PASSWORD in .env.local.'
        : 'Failed to send OTP. Please try again.'

    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}