'use client'

import { useState, useEffect, useCallback } from 'react'

let cache = null  // module-level cache so re-renders don't refetch

export function useGowns() {
  const [gowns,   setGowns  ] = useState(cache || [])
  const [loading, setLoading] = useState(!cache)
  const [error,   setError  ] = useState('')

  const fetchGowns = useCallback(async () => {
    if (cache) { setGowns(cache); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const res  = await fetch('/api/gowns')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load gowns')
      cache = data.gowns || []
      setGowns(cache)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchGowns() }, [fetchGowns])

  // Call this after admin adds/edits/deletes to bust the cache
  const invalidate = useCallback(() => { cache = null; fetchGowns() }, [fetchGowns])

  return { gowns, loading, error, invalidate }
}

export function getGownById(gowns, id) {
  if (!id) return null
  return gowns.find(g => String(g.id) === String(id)) ?? null
}