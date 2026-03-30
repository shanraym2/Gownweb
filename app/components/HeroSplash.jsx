'use client'

import { useState, useEffect } from 'react'
import { getCurrentUser } from '../utils/authClient'

function useGreeting() {
  const [greeting, setGreeting] = useState(null)

  useEffect(() => {
    const user = getCurrentUser()
    const hour = new Date().getHours()
    const timeGreeting =
      hour < 12 ? 'Good morning' :
      hour < 17 ? 'Good afternoon' :
                  'Good evening'

    setGreeting(
      user?.name
        ? { salutation: timeGreeting, name: user.name, sub: 'Your dream look awaits.' }
        : { salutation: 'Welcome to', name: 'JCE Bridal', sub: 'Designer gowns for your special day.' }
    )
  }, [])

  return greeting
}

export default function HeroSplash({ onDismissed }) {
  const greeting = useGreeting()
  const [phase, setPhase] = useState('enter') 

  useEffect(() => {
    if (!greeting) return

    const holdTimer = setTimeout(() => setPhase('exit'), 2200)
    return () => clearTimeout(holdTimer)
  }, [greeting])

  useEffect(() => {
    if (phase !== 'exit') return
    const exitTimer = setTimeout(() => {
      setPhase('done')
      onDismissed?.()
    }, 800)
    return () => clearTimeout(exitTimer)
  }, [phase, onDismissed])

  if (phase === 'done' || !greeting) return null

  return (
    <div
      className={`splash splash--${phase}`}
      aria-live="polite"
      aria-label="Welcome greeting"
      onClick={() => phase === 'hold' && setPhase('exit')}
    >
      <div className="splash-grain" aria-hidden="true" />

      <div className="splash-corner splash-corner--tl" aria-hidden="true" />
      <div className="splash-corner splash-corner--br" aria-hidden="true" />

      <div className="splash-inner">
        <span className="splash-salutation">{greeting.salutation}</span>
        <h2 className="splash-name">{greeting.name}</h2>
        <div className="splash-divider" aria-hidden="true" />
        <p className="splash-sub">{greeting.sub}</p>
      </div>

      <button
        className="splash-skip"
        onClick={(e) => { e.stopPropagation(); setPhase('exit') }}
        aria-label="Skip greeting"
      >
        <span>Enter</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  )
}