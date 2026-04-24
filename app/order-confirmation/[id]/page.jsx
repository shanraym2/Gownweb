'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import Header from '../../components/Header'
import Footer from '../../components/Footer'
import { getCurrentUser } from '../../utils/authClient'

// ─── Proof upload ─────────────────────────────────────────────────────────────

function ProofUpload({ orderId, paymentMethod, onUploaded }) {
  const [image, setImage] = useState(null)
  const [preview, setPreview] = useState(null)
  const [refNo, setRefNo] = useState('')
  const [uploading, setUploading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const fileRef = useRef(null)
  const user = getCurrentUser()

  const handleFile = useCallback((file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please select a JPEG or PNG image.')
      return
    }
    if (file.size > 5_000_000) {
      setError('File too large — max 5 MB.')
      return
    }
    setError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      setImage(e.target.result)
      setPreview(e.target.result)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    handleFile(e.dataTransfer.files?.[0])
  }, [handleFile])
  
  const handleUpload = async () => {
    if (!image) {
      setError('Please select your proof of payment image.')
      return
    }

    if (!user) {
      setError('You must be logged in.')
      return
    }

    setUploading(true)
    setError('')

    try {
      const res = await fetch('/api/orders/upload-proof', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({
          orderId,
          image,
          referenceNo: refNo,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.ok) {
        setError(data.error || 'Upload failed.')
        return
      }

      setDone(true)
      onUploaded?.()
    } catch {
      setError('Could not connect. Please try again.')
    } finally {
      setUploading(false)
    }
  }
  const fetchOrder = useCallback(() => {
    if (!orderId || !user) return
    fetch(`/api/orders?userId=${user.id}`, {
      headers: { 'x-user-id': user.id },
    })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) {
          setError('Could not load order.')
          return
        }
        const found = (d.orders || []).find(o => String(o.id) === String(orderId))
        if (!found) setError('Order not found.')
      })
      .catch(() => setError('Could not connect.'))
      .finally(() => setLoading(false))
  }, [orderId, user])

  useEffect(() => {
    fetchOrder()
  }, [fetchOrder])

  // ✅ SAFE: return AFTER hooks
  if (paymentMethod === 'cash') return null

  if (done) return (
    <div className="conf-proof-done">
      ✔ Proof uploaded
    </div>
  )

  return (
    <div className="conf-proof">
      <p className="conf-proof-title">Upload proof of payment</p>
      <p className="conf-proof-sub">
        Send your payment to the account shown at checkout, then upload a clear screenshot here.
        Orders without proof within 24 hours may be cancelled.
      </p>

      <div
        className={`conf-dropzone${preview ? ' conf-dropzone--has-img' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter') fileRef.current?.click() }}
      >
        {preview
          ? <img src={preview} alt="Proof preview" className="conf-dropzone-img" />
          : <>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <p>Click or drag your screenshot here</p>
              <p className="conf-dropzone-hint">JPEG or PNG · max 5 MB</p>
            </>
        }
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/jpg"
        style={{ display:'none' }} onChange={e => handleFile(e.target.files?.[0])} />

      {preview && (
        <button className="conf-change-img" onClick={() => fileRef.current?.click()}>Change image</button>
      )}

      <div className="conf-field">
        <label className="conf-label">
          Reference / transaction number <span>(optional but recommended)</span>
        </label>
        <input type="text" className="conf-input"
          placeholder="e.g. GCash ref 123456789"
          value={refNo} onChange={e => setRefNo(e.target.value)} />
      </div>

      {error && <p className="conf-error">{error}</p>}

      <button
        className={`conf-upload-btn${uploading ? ' conf-upload-btn--loading' : ''}`}
        onClick={handleUpload} disabled={uploading || !image}
      >
        {uploading ? 'Uploading…' : 'Submit proof of payment'}
      </button>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrderConfirmationPage() {
  const params  = useParams()
  const orderId = params?.id

  const [order,    setOrder   ] = useState(null)
  const [loading,  setLoading ] = useState(true)
  const [error,    setError   ] = useState('')
  const [confirming, setConfirming] = useState(false)

  const user = typeof window !== 'undefined' ? getCurrentUser() : null

  useEffect(() => {
    if (!orderId || !user) { setLoading(false); return }

    // Fetch all user orders then find by id — same as Phase 1 but now with
    // proper header-based auth. Server verifies x-user-id matches userId.
    fetch(`/api/orders?userId=${user.id}`, {
      headers: { 'x-user-id': user.id },
    })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setError('Could not load order.'); return }
        const found = (d.orders||[]).find(o => String(o.id) === String(orderId))
        if (!found) setError('Order not found.')
        else setOrder(found)
      })
      .catch(() => setError('Could not connect.'))
      .finally(() => setLoading(false))
  }, [orderId])  // intentionally omit user to avoid re-fetch loop

  const handleConfirmReceipt = async () => {
    if (!user || !order) return
    setConfirming(true)
    try {
      const res  = await fetch('/api/orders', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body:    JSON.stringify({ orderId: order.id, status: 'completed' }),
      })
      const data = await res.json()
      if (data.ok) fetchOrder()  // ← re-fetch instead of manual state patch
    } catch {}
    finally { setConfirming(false) }
  }

  const fmt  = n => n != null ? '₱'+Number(n).toLocaleString('en-PH') : '—'
  const payL = { gcash:'GCash', bdo:'BDO Bank Transfer', cash:'Cash on Pickup' }
  const delL = { pickup:'Store Pickup', lalamove:'Lalamove Delivery' }

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
            <p className="conf-hero-sub">Thank you, {user?.firstName || 'friend'}. We've received your order.</p>
            <div className="conf-order-number">
              <span className="conf-order-label">Order number</span>
              <span className="conf-order-value">{order.orderNumber}</span>
            </div>
          </section>

          <div className="conf-layout">
            <div className="conf-main">

              {/* What's next */}
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
                paymentMethod={order.paymentMethod}
                onUploaded={() => setOrder(o => ({ ...o, paymentStatus:'pending' }))}
              />

              {['ready','shipped'].includes(order.status) && (
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Order received and completed. Thank you!
                </div>
              )}
            </div>

            <aside className="conf-sidebar">
              <div className="conf-card">
                <p className="conf-card-title">Order summary</p>
                <div className="conf-summary-rows">
                  {(order.items||[]).map((item,idx) => (
                    <div key={idx} className="conf-summary-item">
                      <span>{item.gownName}{item.sizeLabel ? ` (${item.sizeLabel})` : ''} ×{item.quantity||1}</span>
                      <span>{fmt((item.unitPrice||0)*(item.quantity||1))}</span>
                    </div>
                  ))}
                </div>
                <div className="conf-summary-divider" />
                <div className="conf-summary-total">
                  <span>Total</span><span>{fmt(order.total)}</span>
                </div>
                <div className="conf-summary-meta">
                  <div className="conf-meta-row">
                    <span>Payment</span><span>{payL[order.paymentMethod]||order.paymentMethod}</span>
                  </div>
                  <div className="conf-meta-row">
                    <span>Delivery</span><span>{delL[order.deliveryMethod]||order.deliveryMethod}</span>
                  </div>
                  {order.deliveryAddress && (
                    <div className="conf-meta-row conf-meta-row--col">
                      <span>Address</span><span>{order.deliveryAddress}</span>
                    </div>
                  )}
                  <div className="conf-meta-row">
                    <span>Order status</span>
                    <span className={`conf-status conf-status--${order.status}`}>
                      {(order.status||'').replace(/_/g,' ')}
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