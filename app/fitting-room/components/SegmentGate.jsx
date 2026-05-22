'use client'

/**
 * app/fitting-room/components/SegmentGate.jsx
 *
 * Renders the "Who is being measured?" segment picker above any panel content
 * that needs to be segment-aware (ScanPanel, StylePanel).
 */

import { SEGMENTS } from '../../constants/sizeConstants'
import { useFittingRoom } from '../FittingRoomProvider'

export default function SegmentGate({ children }) {
  const { profile, updateProfile } = useFittingRoom()

  return (
    <div className="sg-wrap">
      <div className="sg-picker">
        <p className="sg-label">Who is being measured?</p>
        <div className="sg-row">
          {SEGMENTS.map(s => (
            <button
              key={s.id}
              className={`sg-btn${profile.segment === s.id ? ' sg-btn--sel' : ''}`}
              onClick={() => updateProfile({ segment: s.id })}
              aria-pressed={profile.segment === s.id}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {children}
    </div>
  )
}