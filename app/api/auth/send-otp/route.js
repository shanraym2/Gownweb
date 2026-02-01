import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const OTP_EXPIRY_MS = 10 * 60 * 1000 // 10 minutes

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
    const otp = generateOtp()

    const otps = loadOtps()
    otps[cleanEmail] = {
      otp,
      expires: Date.now() + OTP_EXPIRY_MS,
      purpose: purpose || 'auth',
    }
    saveOtps(otps)

    const gmailUser = process.env.GMAIL_USER
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD

    if (!gmailUser || !gmailAppPassword) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Email sending is not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to .env.local in the project root, then restart the dev server (npm run dev). See .env.example for the format.',
        },
        { status: 503 }
      )
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailAppPassword,
      },
    })

    await transporter.sendMail({
      from: `"JCE Bridal" <${gmailUser}>`,
      to: cleanEmail,
      subject: 'Your verification code - JCE Bridal',
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
          <h2 style="color: #3D2F27;">JCE Bridal</h2>
          <p>Your verification code is:</p>
          <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #3D2F27;">${otp}</p>
          <p style="color: #666; font-size: 14px;">This code expires in 10 minutes. Do not share it with anyone.</p>
          <p style="color: #666; font-size: 12px;">If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    })

    return NextResponse.json({ ok: true, message: 'OTP sent to your email' })
  } catch (err) {
    console.error('Send OTP error:', err)
    const msg =
      err.code === 'EAUTH'
        ? 'Gmail login failed. Check GMAIL_USER and GMAIL_APP_PASSWORD in .env.local. Use an App Password, not your regular password.'
        : 'Failed to send OTP. Please try again.'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
