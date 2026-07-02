// lib/audit.js
// Fire-and-forget audit logger for all admin mutations.
// Never throws — a logging failure must never break the actual operation.
//
// Usage:
//   import { logAudit } from '@/lib/audit'
//   logAudit({ request, action: 'order.status', entityType: 'order', entityId: order.id, payload: { ... } })

import { query } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth'

/**
 * Resolve the actor email from the real session table (sessions →
 * users), rather than re-parsing the session cookie's contents. The
 * cookie is now an opaque random token with no embedded identity, so
 * the only correct way to resolve "who is this" is the same session
 * lookup every authenticated route already uses.
 *
 * @param {Request} request
 * @returns {Promise<string>}
 */
async function getActorEmail(request) {
  try {
    const user = await getAuthenticatedUser(request)
    return user?.email ? user.email.toLowerCase() : 'admin@system'
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
export async function logAudit({ request, action, entityType = null, entityId = null, payload = null, actor: actorOverride = null }) {
  try {
    const actor = actorOverride
      || request.headers.get('x-actor-email')?.trim().toLowerCase()
      || await getActorEmail(request)
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