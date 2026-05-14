// lib/audit.js
// Fire-and-forget audit logger for all admin mutations.
// Never throws — a logging failure must never break the actual operation.
//
// Usage:
//   import { logAudit } from '@/lib/audit'
//   logAudit({ request, action: 'order.status', entityType: 'order', entityId: order.id, payload: { ... } })

import { query } from '@/lib/db'

/**
 * Resolve the actor email from the incoming request.
 * Reads the same session JWT cookie that the client uses via getCurrentUser().
 * Falls back to 'admin@system' if the cookie is absent or unreadable.
 *
 * @param {Request} request
 * @returns {string}
 */
function getActorEmail(request) {
  try {
    const cookieHeader = request.headers.get('cookie') || ''

    // Try all likely cookie names — update this list to match yours
    const COOKIE_NAMES = ['jce_session', 'session', 'auth_token', 'jce_user']

    for (const name of COOKIE_NAMES) {
      const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
      if (!match) continue

      const raw = decodeURIComponent(match[1])

      // Handle both JWT (3 dot-separated parts) and raw JSON
      let payload
      if (raw.split('.').length === 3) {
        payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64url').toString('utf-8'))
      } else {
        payload = JSON.parse(raw)
      }

      const email = payload?.email || payload?.sub
      if (email) return email.toLowerCase()
    }

    return 'admin@system'
  } catch {
    return 'admin@system'
  }
}

/**
 * Resolve the client IP from standard proxy headers.
 *
 * @param {Request} request
 * @returns {string}
 */
function getIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    '0.0.0.0'
  )
}

/**
 * Write one audit row.  Always resolves (never rejects).
 *
 * @param {{
 *   request:    Request,
 *   action:     string,   // dot-namespaced verb, e.g. 'order.status'
 *   entityType: string?,  // 'order' | 'user' | 'gown' | 'cms_block' | 'hero_slide' | 'testimonial' | 'upload' | 'secret' | 'report'
 *   entityId:   string?,  // UUID, section slug, SKU, …
 *   payload:    object?,  // structured summary — NEVER include raw passwords/hashes/secrets
 * }} opts
 */
export async function logAudit({ request, action, entityType = null, entityId = null, payload = null }) {
  try {
    const actor = getActorEmail(request)
    const ip    = getIp(request)

    await query(
      `INSERT INTO admin_audit_log (actor_email, action, entity_type, entity_id, payload, ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actor, action, entityType, entityId ? String(entityId) : null, payload ? JSON.stringify(payload) : null, ip]
    )
  } catch (err) {
    // Never surface — audit failure must not break the main operation
    console.error('[audit] Failed to write audit log:', err?.message)
  }
}