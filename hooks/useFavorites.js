'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getCurrentUser } from '../app/utils/authClient'

// Module-level cache — shared across all hook instances, same pattern as useGowns
let cachedIds   = null   // Set<string> | null
let cacheUserId = null   // whose cache this is

function getCached(userId) {
  if (cachedIds && cacheUserId === userId) return cachedIds
  return null
}

function setCached(userId, ids) {
  cacheUserId = userId
  cachedIds   = new Set(ids.map(String))
}

function clearCache() {
  cachedIds   = null
  cacheUserId = null
}

export function useFavorites() {
  const user = getCurrentUser()
  const userId = user?.id ?? null

  const existing = getCached(userId)

  const [favoriteIds, setFavoriteIds] = useState(existing ?? new Set())
  const [loading,     setLoading    ] = useState(!existing && !!userId)
  // Tracks in-flight toggles so the heart button can show a pending state
  const pending = useRef(new Set())

  const fetchFavorites = useCallback(async () => {
    if (!userId) { setFavoriteIds(new Set()); setLoading(false); return }
    setLoading(true)
    try {
      const res  = await fetch('/api/favorites', { credentials: 'include' })
      const data = await res.json()
      if (data.ok) {
        setCached(userId, data.favoriteIds)
        setFavoriteIds(new Set(data.favoriteIds.map(String)))
      }
    } catch { /* silent — UI just shows hearts as off */ }
    finally { setLoading(false) }
  }, [userId])

  useEffect(() => {
    if (!getCached(userId)) fetchFavorites()
  }, [userId, fetchFavorites])

  const toggle = useCallback(async (gownId) => {
    if (!userId) return { ok: false, needsAuth: true }

    const id = String(gownId)
    if (pending.current.has(id)) return { ok: false }   // debounce double-clicks

    const wasFav = favoriteIds.has(id)

    // Optimistic update
    setFavoriteIds(prev => {
      const next = new Set(prev)
      wasFav ? next.delete(id) : next.add(id)
      setCached(userId, [...next])
      return next
    })
    pending.current.add(id)

    try {
      const res = await fetch('/api/favorites', {
        method:  wasFav ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:    JSON.stringify({ gownId: id }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      return { ok: true, isFavorited: !wasFav }
    } catch {
      // Revert optimistic update on failure
      setFavoriteIds(prev => {
        const next = new Set(prev)
        wasFav ? next.add(id) : next.delete(id)
        setCached(userId, [...next])
        return next
      })
      return { ok: false }
    } finally {
      pending.current.delete(id)
    }
  }, [userId, favoriteIds])

  const isFavorited = useCallback((gownId) => favoriteIds.has(String(gownId)), [favoriteIds])

  return { favoriteIds, loading, toggle, isFavorited, isLoggedIn: !!userId }
}