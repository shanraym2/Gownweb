'use client'

import { useState, useEffect, useCallback } from 'react'

const CACHE_TTL_MS = 60 * 1000  // 1 minute — keeps pages fast but picks up inventory changes

let cache     = null
let cacheTime = 0

function isCacheValid() {
  return cache !== null && Date.now() - cacheTime < CACHE_TTL_MS
}

export function useGowns() {
  const [gowns,   setGowns  ] = useState(isCacheValid() ? cache : [])
  const [loading, setLoading] = useState(!isCacheValid())
  const [error,   setError  ] = useState('')

  const fetchGowns = useCallback(async (force = false) => {
    if (!force && isCacheValid()) {
      setGowns(cache)
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const res  = await fetch('/api/gowns')
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to load gowns')

      cache     = data.gowns || []
      cacheTime = Date.now()
      setGowns(cache)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchGowns() }, [fetchGowns])

  // Call after admin adds/edits/deletes to bust the cache immediately
  const invalidate = useCallback(() => {
    cache     = null
    cacheTime = 0
    fetchGowns(true)
  }, [fetchGowns])

  return { gowns, loading, error, invalidate }
}

export function getGownById(gowns, id) {
  if (!id) return null
  return gowns.find(g => String(g.id) === String(id)) ?? null
}