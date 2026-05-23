'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import Header from '../../components/Header'
import Footer from '../../components/Footer'
import { getCurrentUser } from '../../utils/authClient'

// ─────────────────────────────────────────────────────────────────────────────
// REFERENCE NUMBER VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

const GCASH_PATTERN = /^\d[\d\s]{10,14}\d$/
const BDO_FT        = /^FT-\d{8}-\d{6,10}$/i
const BDO_PC        = /^(?:MA_)?PC-\d{8}-\d{6,10}$/i
const BDO_NUMERIC   = /^\d{10,18}$/

function stripSpaces(s) { return s.replace(/\s+/g, '') }

function validateReferenceNumber(refNo, paymentMethod) {
  const raw     = refNo.trim()
  const compact = stripSpaces(raw)
  if (!raw) return { valid: true, warning: null }

  if (paymentMethod === 'gcash') {
    const digits = compact.replace(/\D/g, '')
    if (digits.length === 13 && GCASH_PATTERN.test(raw)) return { valid: true, warning: null }
    if (digits.length !== 13)
      return { valid: false, warning: `GCash reference numbers are 13 digits. You entered ${digits.length}.` }
    if (/[a-zA-Z]/.test(compact))
      return { valid: false, warning: 'GCash reference numbers contain digits only — no letters.' }
    return { valid: true, warning: null }
  }

  if (paymentMethod === 'bdo') {
    if (BDO_FT.test(compact) || BDO_PC.test(compact) || BDO_NUMERIC.test(compact))
      return { valid: true, warning: null }
    if (/^\d{13}$/.test(compact))
      return { valid: false, warning: 'This looks like a GCash number. BDO refs look like FT-YYYYMMDD-NNNNNNNN.' }
    return { valid: false, warning: 'BDO reference numbers look like FT-20240315-12345678 or PC-20240315-12345678.' }
  }

  return { valid: true, warning: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE VERIFICATION — MULTI-SIGNAL SCORING
//
// Rather than a single AI binary gate, we run three independent checks and
// combine their scores. This makes the system robust to any single signal
// failing (blurry image, API timeout, unusual app version).
//
// Signal 1 — Structural heuristics (instant, client-side canvas analysis)
//   Checks image dimensions, aspect ratio, and colour distribution.
//   A GCash/BDO screenshot from a phone has predictable proportions.
//   Score: 0–30 points.
//
// Signal 2 — Keyword OCR via Claude (text extraction pass)
//   First API call: asks Claude to list every word/number visible in the image.
//   We then run regex against the returned text for GCash/BDO keywords,
//   peso amounts, dates, and reference number patterns.
//   Score: 0–50 points.
//
// Signal 3 — Visual confirmation via Claude (second pass, only if score < 60)
//   Second API call: asks Claude directly whether the image looks like a
//   payment screenshot. Only fires when signals 1+2 are inconclusive.
//   Score: 0–20 points.
//
// Final decision thresholds:
//   score >= 55  → PASS   (green, upload allowed)
//   score >= 30  → WARN   (amber, upload allowed with warning)
//   score <  30  → REJECT (red, upload blocked — but user can override)
//
// Fail-open: any unhandled exception at any signal returns PASS so a
// service outage never blocks a legitimate customer.
// ─────────────────────────────────────────────────────────────────────────────

// Keywords that strongly indicate a GCash payment screenshot
const GCASH_KEYWORDS = [
  /gcash/i, /g-cash/i, /gcash\.com/i,
  /send\s+money/i, /gsend/i, /gpadala/i,
  /transfer\s+successful/i, /transaction\s+successful/i,
  /payment\s+successful/i, /transaction\s+complete/i,
  /ref\.?\s*no\.?/i, /reference\s+number/i,
  /\b\d{4}\s\d{3}\s\d{6}\b/,   // GCash ref formatted with spaces
  /\b\d{13}\b/,                  // raw 13-digit ref
]

// Keywords that strongly indicate a BDO payment screenshot
const BDO_KEYWORDS = [
  /bdo/i, /banco\s+de\s+oro/i, /bdo\s+unibank/i,
  /fund\s+transfer/i, /send\s+money/i,
  /transfer\s+successful/i, /transaction\s+acknowledgement/i,
  /ft-\d{8}/i, /pc-\d{8}/i,
  /internet\s+banking/i, /mobile\s+banking/i,
  /online\s+banking/i,
]

// Keywords that are positive signals for ANY payment screenshot
const GENERIC_PAYMENT_KEYWORDS = [
  /₱[\d,]+/, /php[\s\d,]+/i, /peso/i,
  /amount/i, /total/i, /balance/i,
  /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/, // date pattern
  /\d{1,2}:\d{2}\s*(am|pm)/i,           // time pattern
  /transaction/i, /payment/i, /receipt/i,
  /approved/i, /success/i, /confirmed/i,
  /sender/i, /recipient/i, /receiver/i,
]

// Keywords that are strong negative signals (not a payment screenshot)
const NEGATIVE_KEYWORDS = [
  /instagram/i, /facebook/i, /twitter/i, /tiktok/i,
  /youtube/i, /messenger/i, /whatsapp/i, /viber/i,
  /google\s+maps/i, /grab\s+food/i, /shopee/i, /lazada/i,
  /camera\s+roll/i, /gallery/i, /screenshot.*desktop/i,
]

/**
 * Signal 1: Structural heuristics from canvas pixel analysis.
 * Returns 0–30 points.
 */
async function scoreStructural(dataUrl) {
  return new Promise((resolve) => {
    try {
      const img = new Image()
      img.onload = () => {
        let score = 0
        const { width, height } = img

        // Mobile screenshot: portrait, phone-like aspect ratio (1.5–2.5 tall)
        const ratio = height / width
        if (ratio >= 1.5 && ratio <= 2.8) score += 12
        else if (ratio >= 1.0 && ratio <= 3.5) score += 6

        // Reasonable resolution — not too small (blurry crop) or huge (raw photo)
        const area = width * height
        if (area >= 80_000 && area <= 4_000_000) score += 8
        else if (area >= 40_000) score += 3

        // Canvas colour analysis — payment screenshots are mostly white/light
        const canvas  = document.createElement('canvas')
        const sampleW = Math.min(width, 100)
        const sampleH = Math.min(height, 200)
        canvas.width  = sampleW
        canvas.height = sampleH
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, sampleW, sampleH)
        const px       = ctx.getImageData(0, 0, sampleW, sampleH).data
        let lightPixels = 0, totalPixels = 0
        for (let i = 0; i < px.length; i += 4) {
          const luma = px[i] * 0.299 + px[i+1] * 0.587 + px[i+2] * 0.114
          if (luma > 180) lightPixels++
          totalPixels++
        }
        const lightRatio = lightPixels / totalPixels
        // Payment app UIs are mostly white background
        if (lightRatio > 0.55) score += 10
        else if (lightRatio > 0.35) score += 5

        resolve(Math.min(score, 30))
      }
      img.onerror = () => resolve(0)
      img.src = dataUrl
    } catch {
      resolve(0)
    }
  })
}

/**
 * Signal 2: Keyword scoring against Claude OCR text extraction.
 * Returns { score: 0–50, extractedText: string }
 */
async function scoreKeywords(b64Data, mediaType, paymentMethod) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64Data } },
            {
              type: 'text',
              text: `Extract and list every piece of text visible in this image. Include all words, numbers, labels, amounts, dates, times, and reference numbers exactly as they appear. Output only the raw extracted text, nothing else. If the image is blank or has no readable text, output: NO_TEXT`,
            },
          ],
        }],
      }),
    })

    if (!res.ok) return { score: 0, extractedText: '' }

    const data  = await res.json()
    const text  = data.content?.find(c => c.type === 'text')?.text ?? ''

    if (!text || text.includes('NO_TEXT')) return { score: 0, extractedText: '' }

    let score = 0

    // Method-specific keywords — high value signals
    const methodKeywords = paymentMethod === 'gcash' ? GCASH_KEYWORDS : BDO_KEYWORDS
    for (const kw of methodKeywords) {
      if (kw.test(text)) score += 8
    }
    score = Math.min(score, 30)  // cap method bonus at 30

    // Generic payment signals — moderate value
    let genericHits = 0
    for (const kw of GENERIC_PAYMENT_KEYWORDS) {
      if (kw.test(text)) genericHits++
    }
    score += Math.min(genericHits * 4, 16)

    // Negative signals — deduct
    for (const kw of NEGATIVE_KEYWORDS) {
      if (kw.test(text)) score -= 12
    }

    return { score: Math.max(0, Math.min(score, 50)), extractedText: text }
  } catch {
    return { score: 0, extractedText: '' }
  }
}

/**
 * Signal 3: Visual confirmation — only called when combined score is 30–59.
 * Returns 0–20 points.
 */
async function scoreVisual(b64Data, mediaType, paymentMethod, extractedText) {
  try {
    const methodLabel = paymentMethod === 'gcash' ? 'GCash' : 'BDO bank transfer'
    const textContext = extractedText
      ? `Text found in image: "${extractedText.slice(0, 400)}"`
      : 'No text could be extracted from the image.'

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64Data } },
            {
              type: 'text',
              text: `${textContext}

Does this image look like a ${methodLabel} payment confirmation screenshot from a Philippine mobile phone? Consider: app UI layout, branding colours, transaction summary structure, and the extracted text above.

Reply with exactly one of these JSON objects and nothing else:
{"result":"yes","confidence":"high"}
{"result":"yes","confidence":"medium"}  
{"result":"yes","confidence":"low"}
{"result":"no","confidence":"high"}
{"result":"no","confidence":"medium"}`,
            },
          ],
        }],
      }),
    })

    if (!res.ok) return 0

    const data    = await res.json()
    const raw     = data.content?.find(c => c.type === 'text')?.text ?? ''
    const cleaned = raw.replace(/```json|```/g, '').trim()
    const parsed  = JSON.parse(cleaned)

    if (parsed.result === 'yes') {
      if (parsed.confidence === 'high')   return 20
      if (parsed.confidence === 'medium') return 14
      return 8
    }
    if (parsed.result === 'no') {
      if (parsed.confidence === 'high')   return -20
      if (parsed.confidence === 'medium') return -10
      return 0
    }
    return 0
  } catch {
    return 0   // fail open
  }
}

/**
 * verifyPaymentImage(dataUrl, paymentMethod)
 *
 * Orchestrates all three signals and returns a verdict.
 *
 * @returns {{
 *   verdict:  'pass' | 'warn' | 'reject',
 *   score:    number,
 *   message:  string,
 *   canOverride: boolean,   // when true, user can proceed despite warning/reject
 * }}
 */
async function verifyPaymentImage(dataUrl, paymentMethod) {
  const FAIL_OPEN = {
    verdict: 'pass', score: 50,
    message: 'Image check unavailable — you may proceed.',
    canOverride: false,
  }

  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) return { ...FAIL_OPEN, verdict: 'warn', message: 'Could not read image data.' }

    const mediaType = match[1]
    const b64Data   = match[2]
    const supported = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (!supported.includes(mediaType))
      return { verdict: 'reject', score: 0, message: 'Please upload a JPEG or PNG file.', canOverride: false }

    // Signal 1: structural (instant, no API)
    const structuralScore = await scoreStructural(dataUrl)

    // Signal 2: keyword OCR (API call 1)
    const { score: keywordScore, extractedText } = await scoreKeywords(b64Data, mediaType, paymentMethod)

    let totalScore = structuralScore + keywordScore

    // Signal 3: visual (API call 2) — only when score is inconclusive
    let visualScore = 0
    if (totalScore >= 20 && totalScore < 60) {
      visualScore  = await scoreVisual(b64Data, mediaType, paymentMethod, extractedText)
      totalScore  += visualScore
    }

    const methodLabel = paymentMethod === 'gcash' ? 'GCash' : 'BDO'

    if (totalScore >= 55) {
      return {
        verdict: 'pass', score: totalScore,
        message: 'Image looks like a valid payment screenshot.',
        canOverride: false,
      }
    }

    if (totalScore >= 30) {
      return {
        verdict: 'warn', score: totalScore,
        message: `Image may not be a ${methodLabel} payment screenshot — check that it shows the transaction confirmation screen. You can still submit if this is correct.`,
        canOverride: true,
      }
    }

    return {
      verdict: 'reject', score: totalScore,
      message: `This doesn't look like a ${methodLabel} payment confirmation. Please upload a screenshot of your ${methodLabel} transaction success screen. You can still proceed if you believe this is correct.`,
      canOverride: true,   // never hard-block — staff verifies anyway
    }
  } catch {
    return FAIL_OPEN
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROOF UPLOAD COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function ProofUpload({ orderId, userId, paymentMethod, onUploaded, content }) {
  const [image,       setImage      ] = useState(null)
  const [preview,     setPreview    ] = useState(null)
  const [refNo,       setRefNo      ] = useState('')
  const [uploading,   setUploading  ] = useState(false)
  const [verifying,   setVerifying  ] = useState(false)
  const [done,        setDone       ] = useState(false)
  const [error,       setError      ] = useState('')
  const [refWarning,  setRefWarning ] = useState('')
  const [refValid,    setRefValid   ] = useState(true)

  // Image verification state
  const [imgVerdict,   setImgVerdict  ] = useState(null)    // 'pass'|'warn'|'reject'|null
  const [imgMessage,   setImgMessage  ] = useState('')
  const [imgScore,     setImgScore    ] = useState(null)
  const [canOverride,  setCanOverride ] = useState(false)
  const [overridden,   setOverridden  ] = useState(false)   // user clicked "proceed anyway"

  const fileRef = useRef(null)

  const resetImageState = () => {
    setImage(null); setPreview(null)
    setImgVerdict(null); setImgMessage(''); setImgScore(null)
    setCanOverride(false); setOverridden(false)
  }

  // ── Reference number live validation ─────────────────────────────────────
  const handleRefChange = (e) => {
    const val = e.target.value
    setRefNo(val)
    setError('')
    if (!val.trim()) { setRefWarning(''); setRefValid(true); return }
    const { valid, warning } = validateReferenceNumber(val, paymentMethod)
    setRefValid(valid)
    setRefWarning(warning || '')
  }

  // ── File handling + verification pipeline ────────────────────────────────
  const handleFile = useCallback(async (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please select a JPEG or PNG image.'); return }
    if (file.size > 5_000_000) { setError('File too large — max 5 MB.'); return }
    setError('')
    resetImageState()

    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target.result
      setPreview(dataUrl)
      setVerifying(true)

      try {
        const result = await verifyPaymentImage(dataUrl, paymentMethod)
        setImgVerdict(result.verdict)
        setImgMessage(result.message)
        setImgScore(result.score)
        setCanOverride(result.canOverride)

        // Only set the image for upload when pass or warn (or user overrides later)
        if (result.verdict === 'pass' || result.verdict === 'warn') {
          setImage(dataUrl)
        }
        // 'reject' with canOverride=true: preview stays, image stays null until override
        if (result.verdict === 'reject' && result.canOverride) {
          setImage(null)
        }
      } finally {
        setVerifying(false)
      }
    }
    reader.readAsDataURL(file)
  }, [paymentMethod])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    handleFile(e.dataTransfer.files?.[0])
  }, [handleFile])

  // User clicks "proceed anyway" on a warn/reject
  const handleOverride = () => {
    setImage(preview)
    setOverridden(true)
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!image && !refNo.trim()) {
      setError('Please provide a payment screenshot and/or a reference number.')
      return
    }
    if (refNo.trim() && !refValid) {
      setError('Please fix the reference number before submitting.')
      return
    }
    if (!userId) { setError('You must be logged in.'); return }

    setUploading(true); setError('')
    try {
      const res  = await fetch('/api/orders/upload-proof', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body:    JSON.stringify({ orderId, image, referenceNo: refNo }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setError(data.error || 'Upload failed.'); return }
      setDone(true)
      onUploaded?.()
    } catch {
      setError('Could not connect. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  if (paymentMethod === 'cash') return null
  if (done) return <div className="conf-proof-done">✔ Proof uploaded — we'll verify shortly</div>

  const methodLabel = paymentMethod === 'gcash' ? 'GCash' : 'BDO'
  const imageReady  = !!image || overridden
  const canSubmit   = !uploading && !verifying && refValid && (imageReady || !!refNo.trim())

  // Colour tokens per verdict
  const verdictStyle = {
    pass:   { color: '#0F6E56', bg: 'rgba(29,158,117,0.08)', border: 'rgba(29,158,117,0.25)' },
    warn:   { color: '#854F0B', bg: 'rgba(239,159,39,0.09)', border: 'rgba(239,159,39,0.30)' },
    reject: { color: '#791F1F', bg: 'rgba(226,75,74,0.09)',  border: 'rgba(226,75,74,0.30)'  },
  }
  const vs = imgVerdict ? verdictStyle[imgVerdict] : null

  return (
    <div className="conf-proof">
      <p className="conf-proof-title">{content.heading}</p>
      <p className="conf-proof-sub">{content.instructions}</p>

      {/* ── Dropzone ───────────────────────────────────────────────────── */}
      <div
        className={`conf-dropzone${preview ? ' conf-dropzone--has-img' : ''}`}
        onClick={() => !verifying && fileRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter') fileRef.current?.click() }}
        aria-label="Upload payment proof"
        style={{
          cursor: verifying ? 'wait' : 'pointer',
          borderColor: vs?.border,
          outline: vs && imgVerdict !== 'pass' ? `1px solid ${vs.border}` : undefined,
        }}
      >
        {verifying ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div className="conf-spinner" style={{ margin: '0 auto 10px' }}/>
            <p style={{ fontSize: 13, color: '#888' }}>Analysing image…</p>
            <p style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>Checking for payment keywords and structure</p>
          </div>
        ) : preview ? (
          <img
            src={preview}
            alt="Proof preview"
            className="conf-dropzone-img"
            style={{ opacity: imgVerdict === 'reject' && !overridden ? 0.45 : 1 }}
            onError={e => { e.target.onerror = null; e.target.style.display = 'none' }}
          />
        ) : (
          <>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p>Click or drag your {methodLabel} screenshot here</p>
            <p className="conf-dropzone-hint">{content.accepted_fmt}</p>
          </>
        )}
      </div>

      {/* ── Verdict banner ─────────────────────────────────────────────── */}
      {imgVerdict && !verifying && vs && (
        <div style={{
          marginTop: 10, padding: '10px 14px', borderRadius: 7,
          background: vs.bg, border: `1px solid ${vs.border}`,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            {/* Icon */}
            {imgVerdict === 'pass' && (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={vs.color} strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
            {imgVerdict === 'warn' && (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={vs.color} strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            )}
            {imgVerdict === 'reject' && (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={vs.color} strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            )}
            <span style={{ fontSize: 13, color: vs.color, lineHeight: 1.45 }}>{imgMessage}</span>
          </div>

          {/* Override button — shown for warn/reject when canOverride */}
          {canOverride && !overridden && (
            <button
              onClick={handleOverride}
              style={{
                alignSelf: 'flex-start', fontSize: 12, color: vs.color,
                background: 'none', border: `1px solid ${vs.border}`,
                borderRadius: 5, padding: '3px 10px', cursor: 'pointer',
                marginTop: 2,
              }}
            >
              Proceed anyway — my screenshot is correct
            </button>
          )}
          {overridden && (
            <span style={{ fontSize: 12, color: vs.color, opacity: 0.75 }}>
              ✓ Override accepted — staff will verify your screenshot manually.
            </span>
          )}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/jpg"
        style={{ display: 'none' }}
        onChange={e => handleFile(e.target.files?.[0])}
      />

      {preview && imgVerdict && (
        <button className="conf-change-img" onClick={() => { resetImageState(); fileRef.current?.click() }}>
          Change image
        </button>
      )}

      {/* ── Reference number ───────────────────────────────────────────── */}
      <div className="conf-field" style={{ marginTop: 16 }}>
        <label className="conf-label">
          {methodLabel} reference / transaction number
          {paymentMethod === 'gcash' && <span className="conf-label-note"> — 13-digit code from your GCash app</span>}
          {paymentMethod === 'bdo'   && <span className="conf-label-note"> — e.g. FT-20240315-12345678</span>}
        </label>
        <input
          type="text"
          className={`conf-input${!refValid && refNo.trim() ? ' conf-input--error' : ''}`}
          placeholder={paymentMethod === 'gcash' ? 'e.g. 1001543610110' : 'e.g. FT-20240315-12345678'}
          value={refNo}
          onChange={handleRefChange}
          autoComplete="off"
          spellCheck={false}
        />
        {refNo.trim() && refWarning && (
          <div className={`conf-field-warning${refValid ? ' conf-field-warning--soft' : ' conf-field-warning--error'}`}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>{refWarning}</span>
          </div>
        )}
        {refNo.trim() && refValid && !refWarning && (
          <div className="conf-field-warning conf-field-warning--ok">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>Reference number format looks correct.</span>
          </div>
        )}
      </div>

      {error && <p className="conf-error" style={{ marginTop: 10 }}>{error}</p>}

      <button
        className={`conf-upload-btn${uploading ? ' conf-upload-btn--loading' : ''}`}
        onClick={handleUpload}
        disabled={!canSubmit}
        style={{ marginTop: 16 }}
      >
        {verifying ? 'Checking image…' : uploading ? 'Uploading…' : content.submit_label}
      </button>

      <p style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
        Upload a screenshot, enter a reference number, or both.
        {imgScore !== null && process.env.NODE_ENV === 'development' && (
          <span style={{ marginLeft: 8, fontFamily: 'monospace', color: '#bbb' }}>
            [dev] score: {imgScore}
          </span>
        )}
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE — unchanged from original
// ─────────────────────────────────────────────────────────────────────────────

export default function OrderConfirmationPage() {
  const params  = useParams()
  const orderId = params?.id

  const [user,       setUser      ] = useState(null)
  const [order,      setOrder     ] = useState(null)
  const [loading,    setLoading   ] = useState(true)
  const [error,      setError     ] = useState('')
  const [confirming, setConfirming] = useState(false)

  const [content, setContent] = useState({
    heading:      'Upload Payment Proof',
    instructions: 'Please upload a clear screenshot or photo of your payment confirmation.',
    accepted_fmt: 'JPG or PNG — max 5 MB',
    submit_label: 'Send proof',
  })

  useEffect(() => { setUser(getCurrentUser()) }, [])

  useEffect(() => {
    fetch('/api/cms/content?section=upload-proof')
      .then(r => r.json())
      .then(d => { if (d.ok && d.fields) setContent(prev => ({ ...prev, ...d.fields })) })
      .catch(() => {})
  }, [])

  const fetchOrder = useCallback(() => {
    if (!orderId || !user?.id) return
    setLoading(true)
    fetch(`/api/orders?userId=${user.id}`, { headers: { 'x-user-id': user.id } })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setError('Could not load order.'); return }
        const found = (d.orders || []).find(o => String(o.id) === String(orderId))
        if (!found) setError('Order not found.')
        else { setError(''); setOrder(found) }
      })
      .catch(() => setError('Could not connect.'))
      .finally(() => setLoading(false))
  }, [orderId, user?.id])

  useEffect(() => { fetchOrder() }, [fetchOrder])

  const handleConfirmReceipt = async () => {
    if (!user?.id || !order) return
    setConfirming(true)
    try {
      const res  = await fetch('/api/orders', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body:    JSON.stringify({ orderId: order.id, status: 'completed' }),
      })
      const data = await res.json()
      if (data.ok) fetchOrder()
    } catch {} finally { setConfirming(false) }
  }

  const fmt  = n  => n  != null ? '₱' + Number(n).toLocaleString('en-PH') : '—'
  const payL = { gcash: 'GCash', bdo: 'BDO Bank Transfer', cash: 'Cash on Pickup' }
  const delL = { pickup: 'Store Pickup', lalamove: 'Lalamove Delivery' }

  const isVoided = (() => {
    if (!order) return false
    if (['paid','processing','ready','shipped','completed','cancelled','refunded'].includes(order.status)) return false
    if (['paid','verified'].includes(order.paymentStatus)) return false
    return (Date.now() - new Date(order.placedAt).getTime()) / 86_400_000 >= 7
  })()

  const daysRemaining = (() => {
    if (!order || isVoided) return null
    if (['paid','processing','ready','shipped','completed','cancelled','refunded'].includes(order.status)) return null
    if (['paid','verified'].includes(order.paymentStatus)) return null
    const remaining = Math.ceil(7 - (Date.now() - new Date(order.placedAt).getTime()) / 86_400_000)
    return remaining <= 3 ? remaining : null
  })()

  return (
    <main className="conf-page">
      <Header solid />
      <div className="conf-spacer" />

      {loading ? (
        <div className="conf-loading">Loading your order…</div>
      ) : error ? (
        <div className="conf-error-page">
          <p>{error}</p>
          <Link href="/my-orders" className="conf-btn-primary">My orders</Link>
        </div>
      ) : !user ? (
        <div className="conf-error-page">
          <p>Please log in to view this order.</p>
          <Link href="/login" className="conf-btn-primary">Log in</Link>
        </div>
      ) : order ? (
        <>
          <section className="conf-hero">
            <div className="conf-hero-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <h1 className="conf-hero-title">Order placed!</h1>
            <p className="conf-hero-sub">
              Thank you, {user.firstName || user.name || 'friend'}. We've received your order.
            </p>
            <div className="conf-order-number">
              <span className="conf-order-label">Order number</span>
              <span className="conf-order-value">{order.orderNumber}</span>
            </div>
          </section>

          <div className="conf-layout">
            <div className="conf-main">
              {daysRemaining !== null && (
                <div className="conf-card conf-card--warning">
                  <p className="conf-card-title">⚠ Payment required soon</p>
                  <p className="conf-card-sub">
                    This order expires in <strong>{daysRemaining} day{daysRemaining !== 1 ? 's' : ''}</strong>.
                    Please upload your proof of payment before then to avoid cancellation.
                  </p>
                </div>
              )}

              {isVoided ? (
                <div className="conf-card conf-card--voided">
                  <p className="conf-card-title">Order Expired</p>
                  <p className="conf-card-sub">
                    This order was placed more than 7 days ago without payment confirmation.
                    Please contact us or place a new order if you still wish to proceed.
                  </p>
                  <Link href="/gowns" className="conf-btn-primary">Browse collection</Link>
                </div>
              ) : (
                <>
                  <div className="conf-card">
                    <p className="conf-card-title">What happens next</p>
                    <ol className="conf-steps-list">
                      {order.paymentMethod !== 'cash' ? (
                        <>
                          <li>Upload your proof of payment below</li>
                          <li>Our team verifies your payment (usually within 1–2 hours)</li>
                          <li>You'll receive an email when your order is confirmed and being prepared</li>
                          {order.deliveryMethod === 'pickup'   && <li>We'll notify you when your order is ready for pickup</li>}
                          {order.deliveryMethod === 'lalamove' && <li>We'll arrange Lalamove and notify you of the delivery fee</li>}
                        </>
                      ) : (
                        <>
                          <li>Bring the exact amount when you collect your order</li>
                          <li>Our team will prepare your order and notify you when it's ready</li>
                          <li>Collect at the boutique — Mon–Sat 9AM–6PM</li>
                        </>
                      )}
                    </ol>
                  </div>

                  <ProofUpload
                    orderId={order.id}
                    userId={user.id}
                    paymentMethod={order.paymentMethod}
                    onUploaded={() => setOrder(o => ({ ...o, paymentStatus: 'pending' }))}
                    content={content}
                  />

                  {['ready', 'shipped'].includes(order.status) && (
                    <div className="conf-card conf-card--action">
                      <p className="conf-card-title">Received your order?</p>
                      <p className="conf-card-sub">Confirm receipt once you have your gown.</p>
                      <button className="conf-btn-primary" onClick={handleConfirmReceipt} disabled={confirming}>
                        {confirming ? 'Confirming…' : "Yes, I've received my order"}
                      </button>
                    </div>
                  )}

                  {order.status === 'completed' && (
                    <div className="conf-receipt-done">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      Order received and completed. Thank you!
                    </div>
                  )}
                </>
              )}
            </div>

            <aside className="conf-sidebar">
              <div className="conf-card">
                <p className="conf-card-title">Order summary</p>
                <div className="conf-summary-rows">
                  {(order.items || []).map((item, idx) => (
                    <div key={idx} className="conf-summary-item">
                      <span>
                        {item.gownName}{item.sizeLabel ? ` (${item.sizeLabel})` : ''} ×{item.quantity || 1}
                      </span>
                      <span>{fmt((item.unitPrice || 0) * (item.quantity || 1))}</span>
                    </div>
                  ))}
                </div>
                <div className="conf-summary-divider" />
                {Number(order.shippingFee) > 0 && (
                  <div className="conf-summary-item" style={{ opacity: 0.6, fontSize: 13 }}>
                    <span>Shipping (est.)</span><span>{fmt(order.shippingFee)}</span>
                  </div>
                )}
                <div className="conf-summary-total">
                  <span>Total</span><span>{fmt(order.total)}</span>
                </div>
                <div className="conf-summary-meta">
                  <div className="conf-meta-row"><span>Payment</span><span>{payL[order.paymentMethod] || order.paymentMethod}</span></div>
                  <div className="conf-meta-row"><span>Delivery</span><span>{delL[order.deliveryMethod] || order.deliveryMethod}</span></div>
                  {order.deliveryAddress && (
                    <div className="conf-meta-row conf-meta-row--col">
                      <span>Address</span><span>{order.deliveryAddress}</span>
                    </div>
                  )}
                  <div className="conf-meta-row">
                    <span>Order status</span>
                    <span className={`conf-status conf-status--${order.status}`}>
                      {(order.status || '').replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="conf-meta-row">
                    <span>Payment status</span>
                    <span className={`conf-status conf-status--${order.paymentStatus}`}>
                      {order.paymentStatus}
                    </span>
                  </div>
                </div>
              </div>
              <div className="conf-sidebar-links">
                <Link href="/my-orders" className="conf-link">View all orders →</Link>
                <Link href="/gowns"     className="conf-link">Continue browsing →</Link>
              </div>
            </aside>
          </div>
        </>
      ) : null}

      <Footer />
    </main>
  )
}