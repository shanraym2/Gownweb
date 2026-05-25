'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useFavorites } from '../../hooks/useFavorites'

/**
 * Reusable heart toggle button.
 *
 * Props:
 *   gownId      — required
 *   size        — 'sm' (16px, catalogue cards) | 'md' (20px, detail page) — default 'sm'
 *   className   — extra class on the outer <button>
 *   redirectPath — where to redirect after login if unauthenticated (default current path)
 */
export default function HeartButton({ gownId, size = 'sm', className = '', redirectPath }) {
  const { toggle, isFavorited, isLoggedIn } = useFavorites()
  const router  = useRouter()
  const [busy, setBusy] = useState(false)

  const fav = isFavorited(gownId)
  const px  = size === 'md' ? 20 : 16

  const handleClick = useCallback(async (e) => {
    e.preventDefault()   // prevent Link navigation when button is inside a card link
    e.stopPropagation()

    if (!isLoggedIn) {
      const redirect = redirectPath || (typeof window !== 'undefined' ? window.location.pathname : '/gowns')
      router.push(`/login?redirect=${encodeURIComponent(redirect)}`)
      return
    }

    if (busy) return
    setBusy(true)
    await toggle(gownId)
    setBusy(false)
  }, [isLoggedIn, busy, toggle, gownId, router, redirectPath])

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={fav ? 'Remove from favorites' : 'Save to favorites'}
      aria-pressed={fav}
      disabled={busy}
      className={`hb${fav ? ' hb--on' : ''}${busy ? ' hb--busy' : ''} ${className}`.trim()}
      style={{ '--hb-px': `${px}px` }}
    >
      <svg
        width={px} height={px}
        viewBox="0 0 24 24"
        fill={fav ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={fav ? 0 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>

      <style>{`
        .hb {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(255,255,255,0.85);
          border: none;
          border-radius: 50%;
          width: calc(var(--hb-px) + 16px);
          height: calc(var(--hb-px) + 16px);
          cursor: pointer;
          color: #bbb;
          transition: color 0.18s, background 0.18s, transform 0.12s;
          flex-shrink: 0;
          backdrop-filter: blur(2px);
        }
        .hb:hover { color: #E24B4A; background: rgba(255,255,255,0.95); }
        .hb--on   { color: #E24B4A; background: rgba(255,255,255,0.95); }
        .hb--busy { opacity: 0.55; cursor: default; }
        .hb:active:not(.hb--busy) { transform: scale(0.88); }
      `}</style>
    </button>
  )
}