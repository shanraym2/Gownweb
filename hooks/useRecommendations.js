/**
 * useRecommendations
 * ───────────────────
 * React hook that wraps the hybrid recommender engine.
 * Handles:
 *   - Lazy computation (runs after gowns load)
 *   - Interaction tracking (auto-records 'view' events)
 *   - Re-computation when the context gown changes
 *   - Exposes trackEvent for cart_add / favorite / inquiry
 *
 * Usage:
 *   const { recommendations, meta, trackEvent } = useRecommendations({
 *     gowns,
 *     contextGownId: gown.id,   // optional: detail page context
 *     topN: 6,
 *   })
 */

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getCurrentUser } from '@/utils/authClient'
import {
  getHybridRecommendations,
  trackEvent as _trackEvent,
  getSessionId,
} from '@/utils/recommender/hybridRecommender'

export function useRecommendations({ gowns = [], contextGownId, topN = 8 } = {}) {
  const [recommendations, setRecommendations] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(false)
  const computedRef = useRef(false)

  // Stable user ID: logged-in email or anonymous session ID
  const getUserId = useCallback(() => {
    const user = getCurrentUser()
    return user?.email || getSessionId()
  }, [])

  // Track view of context gown
  useEffect(() => {
    if (!contextGownId || typeof window === 'undefined') return
    const uid = getUserId()
    _trackEvent(uid, contextGownId, 'view')
  }, [contextGownId, getUserId])

  // Compute recommendations when gowns are loaded
  useEffect(() => {
    if (!gowns || gowns.length === 0) return

    // Debounce slightly so rapid context changes don't spam re-computation
    const timer = setTimeout(() => {
      setLoading(true)
      try {
        const uid = getUserId()
        const result = getHybridRecommendations(gowns, uid, {
          contextGownId,
          topN,
          excludeSeen: true,
        })
        setRecommendations(result.recommendations)
        setMeta(result.meta)
      } catch (err) {
        console.error('[useRecommendations] error:', err)
      } finally {
        setLoading(false)
      }
    }, 80)

    return () => clearTimeout(timer)
  }, [gowns, contextGownId, topN, getUserId])

  /**
   * Track an interaction event and trigger a recommendations refresh.
   * @param {number|string} gownId
   * @param {'view'|'cart_add'|'favorite'|'inquiry'} eventType
   */
  const trackEvent = useCallback(
    (gownId, eventType) => {
      const uid = getUserId()
      _trackEvent(uid, gownId, eventType)

      // Re-run recommendations after a short delay to reflect new interaction
      setTimeout(() => {
        if (!gowns || gowns.length === 0) return
        try {
          const result = getHybridRecommendations(gowns, uid, {
            contextGownId,
            topN,
            excludeSeen: true,
          })
          setRecommendations(result.recommendations)
          setMeta(result.meta)
        } catch { /* silent */ }
      }, 200)
    },
    [gowns, contextGownId, topN, getUserId]
  )

  /**
   * Force a refresh (e.g. after the user logs in and we switch from
   * session ID to their actual user ID).
   */
  const refresh = useCallback(() => {
    if (!gowns || gowns.length === 0) return
    const uid = getUserId()
    const result = getHybridRecommendations(gowns, uid, { contextGownId, topN })
    setRecommendations(result.recommendations)
    setMeta(result.meta)
  }, [gowns, contextGownId, topN, getUserId])

  return { recommendations, meta, loading, trackEvent, refresh }
}
