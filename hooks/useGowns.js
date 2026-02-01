'use client'

import { useState, useEffect } from 'react'

export function useGowns() {
  const [gowns, setGowns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch('/api/gowns')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load gowns')
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setGowns(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return { gowns, loading, error }
}

export function getGownById(gowns, id) {
  if (!Array.isArray(gowns) || id == null) return null
  return gowns.find((g) => Number(g.id) === Number(id)) || null
}
