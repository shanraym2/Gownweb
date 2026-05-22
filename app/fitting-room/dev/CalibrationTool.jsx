'use client'

/**
 * app/fitting-room/dev/CalibrationTool.jsx
 *
 * Dev-only calibration tool for comparing scanned body measurements against
 * tape-measure ground truth. Helps diagnose multiplier drift in the ellipse
 * compensation and segment scale pipeline.
 *
 * PRODUCTION GUARD: Returns null immediately unless NODE_ENV === 'development'.
 * Safe to leave imported in a page — it will never render in production.
 *
 * Usage:
 *   import CalibrationTool from './dev/CalibrationTool'
 *   // Drop anywhere inside FittingRoomProvider tree (dev page, layout, etc.)
 *   <CalibrationTool />
 */

import { useState } from 'react'
import { useFittingRoom } from '../FittingRoomProvider'
import { BODY_DEPTH, SEGMENT_SCALE } from '../../../lib/fitting-room/measurementUtils'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MEASUREMENTS = ['bust', 'waist', 'hips']

const STATUS = {
  OK:   { label: 'OK',   color: '#0F6E56', bg: 'rgba(29,158,117,0.08)'  },
  WARN: { label: 'WARN', color: '#854F0B', bg: 'rgba(239,159,39,0.10)'  },
  BAD:  { label: 'BAD',  color: '#791F1F', bg: 'rgba(226,75,74,0.10)'   },
}

function getStatus(abs) {
  if (abs <= 2) return STATUS.OK
  if (abs <= 5) return STATUS.WARN
  return STATUS.BAD
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES — all inline, no external deps
// ─────────────────────────────────────────────────────────────────────────────

const S = {
  wrap: {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontSize: '12px',
    background: '#0D0F0E',
    border: '1px solid #2A2E2C',
    borderRadius: '8px',
    padding: '16px',
    maxWidth: '560px',
    color: '#C8CCC9',
    boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '14px',
    paddingBottom: '10px',
    borderBottom: '1px solid #1F2421',
  },
  badge: {
    display: 'inline-block',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    background: 'rgba(239,159,39,0.15)',
    color: '#EF9F27',
    border: '1px solid rgba(239,159,39,0.30)',
    borderRadius: '4px',
    padding: '2px 6px',
  },
  headerTitle: {
    color: '#6B7370',
    fontSize: '11px',
    letterSpacing: '0.04em',
    flex: 1,
  },
  sectionLabel: {
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#4A5450',
    marginBottom: '8px',
  },
  scannedGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
    marginBottom: '14px',
  },
  scannedCell: {
    background: '#141817',
    border: '1px solid #1F2421',
    borderRadius: '6px',
    padding: '8px 10px',
  },
  scannedKey: {
    color: '#4A5450',
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    display: 'block',
    marginBottom: '3px',
  },
  scannedVal: {
    color: '#1D9E75',
    fontSize: '15px',
    fontWeight: 700,
  },
  scannedNull: {
    color: '#2A2E2C',
    fontSize: '15px',
    fontWeight: 700,
  },
  inputGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
    marginBottom: '12px',
  },
  inputWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  inputLabel: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#4A5450',
  },
  input: {
    background: '#141817',
    border: '1px solid #2A2E2C',
    borderRadius: '5px',
    padding: '6px 8px',
    color: '#C8CCC9',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    appearance: 'textfield',
    WebkitAppearance: 'none',
    MozAppearance: 'textfield',
  },
  btn: {
    background: 'rgba(29,158,117,0.12)',
    border: '1px solid rgba(29,158,117,0.30)',
    borderRadius: '5px',
    color: '#1D9E75',
    fontSize: '12px',
    fontFamily: 'inherit',
    fontWeight: 700,
    letterSpacing: '0.04em',
    padding: '7px 18px',
    cursor: 'pointer',
    marginBottom: '14px',
    transition: 'background 0.15s',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginBottom: '14px',
    fontSize: '11px',
  },
  th: {
    textAlign: 'left',
    color: '#4A5450',
    fontWeight: 700,
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    padding: '4px 8px',
    borderBottom: '1px solid #1F2421',
  },
  td: {
    padding: '6px 8px',
    borderBottom: '1px solid #141817',
  },
  divider: {
    borderTop: '1px solid #1F2421',
    margin: '12px 0',
  },
  configLabel: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#4A5450',
    marginBottom: '6px',
  },
  pre: {
    background: '#0A0C0B',
    border: '1px solid #1F2421',
    borderRadius: '5px',
    padding: '10px 12px',
    fontSize: '11px',
    color: '#7DA89B',
    overflowX: 'auto',
    margin: 0,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function CalibrationTool() {
  // ── Production guard ──────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'development') return null

  const { profile } = useFittingRoom()
  const [tape,    setTape   ] = useState({ bust: '', waist: '', hips: '' })
  const [results, setResults] = useState(null)

  // ── Active config resolution ───────────────────────────────────────────────
  const shapeKey   = profile.bodyShape ?? 'rectangle'
  const segmentKey = profile.segment   ?? 'women'
  const activeDepth = BODY_DEPTH[shapeKey]   ?? BODY_DEPTH.rectangle
  const activeScale = SEGMENT_SCALE[segmentKey] ?? SEGMENT_SCALE.women

  // ── Delta computation ──────────────────────────────────────────────────────
  const handleSubmit = () => {
    const r = {}
    for (const key of MEASUREMENTS) {
      const scanned = profile[key]
      const tapeVal = parseFloat(tape[key])
      if (scanned != null && !isNaN(tapeVal)) {
        const delta = scanned - tapeVal
        r[key] = { scanned, tape: tapeVal, delta, abs: Math.abs(delta) }
      }
    }
    setResults(r)

    // Log structured table to devtools
    console.table(
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k, {
          scanned_cm: v.scanned,
          tape_cm:    v.tape,
          delta_cm:   v.delta.toFixed(1),
          status:     v.abs <= 2 ? 'OK' : v.abs <= 5 ? 'WARN' : 'BAD',
        }])
      )
    )

    // Also log active config for reference
    console.group('[CalibrationTool] Active config')
    console.log('bodyShape:', shapeKey, '→ BODY_DEPTH:', activeDepth)
    console.log('segment:',  segmentKey, '→ SEGMENT_SCALE:', activeScale)
    console.groupEnd()
  }

  // ── Config JSON for display ─────────────────────────────────────────────────
  const configJson = JSON.stringify(
    {
      bodyShape:    shapeKey,
      segment:      segmentKey,
      BODY_DEPTH:   activeDepth,
      SEGMENT_SCALE: activeScale,
    },
    null,
    2
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={S.wrap}>
      {/* Header */}
      <div style={S.header}>
        <span style={S.badge}>DEV</span>
        <span style={S.headerTitle}>calibration-tool · fitting-room/dev</span>
      </div>

      {/* Scanned values (read-only) */}
      <div style={S.sectionLabel}>Scanned values (from profile)</div>
      <div style={S.scannedGrid}>
        {MEASUREMENTS.map(k => {
          const val = profile[k]
          return (
            <div key={k} style={S.scannedCell}>
              <span style={S.scannedKey}>{k}</span>
              {val != null
                ? <span style={S.scannedVal}>{Math.round(val)} cm</span>
                : <span style={S.scannedNull}>—</span>
              }
            </div>
          )
        })}
      </div>

      {/* Tape measure inputs */}
      <div style={S.sectionLabel}>Tape measure (ground truth)</div>
      <div style={S.inputGrid}>
        {MEASUREMENTS.map(k => (
          <div key={k} style={S.inputWrap}>
            <label style={S.inputLabel}>{k} (cm)</label>
            <input
              type="number"
              style={S.input}
              value={tape[k]}
              placeholder="0.0"
              step="0.5"
              min="0"
              onChange={e => setTape(prev => ({ ...prev, [k]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      {/* Submit */}
      <button
        style={S.btn}
        onClick={handleSubmit}
        onMouseOver={e => (e.currentTarget.style.background = 'rgba(29,158,117,0.20)')}
        onMouseOut={e  => (e.currentTarget.style.background = 'rgba(29,158,117,0.12)')}
      >
        Compare →
      </button>

      {/* Results table */}
      {results && Object.keys(results).length > 0 && (
        <>
          <div style={S.sectionLabel}>Delta analysis</div>
          <table style={S.table}>
            <thead>
              <tr>
                {['Measurement', 'Scanned', 'Tape', 'Delta', 'Status'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MEASUREMENTS.filter(k => results[k]).map(k => {
                const { scanned, tape: tv, delta, abs } = results[k]
                const st = getStatus(abs)
                return (
                  <tr key={k} style={{ background: st.bg }}>
                    <td style={{ ...S.td, color: '#8FA89E', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '10px' }}>
                      {k}
                    </td>
                    <td style={{ ...S.td, color: '#C8CCC9' }}>{scanned} cm</td>
                    <td style={{ ...S.td, color: '#C8CCC9' }}>{tv} cm</td>
                    <td style={{ ...S.td, color: delta > 0 ? '#EF9F27' : delta < 0 ? '#E24B4A' : '#1D9E75', fontWeight: 700 }}>
                      {delta > 0 ? '+' : ''}{delta.toFixed(1)} cm
                    </td>
                    <td style={{ ...S.td, color: st.color, fontWeight: 700, fontSize: '10px', letterSpacing: '0.06em' }}>
                      {st.label}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}

      {results && Object.keys(results).length === 0 && (
        <div style={{ color: '#4A5450', fontSize: '11px', marginBottom: '14px' }}>
          No overlapping measurements to compare. Make sure the scan panel has locked values and at least one tape field is filled.
        </div>
      )}

      {/* Active config JSON */}
      <div style={S.divider}/>
      <div style={S.configLabel}>Active config — {shapeKey} / {segmentKey}</div>
      <pre style={S.pre}>{configJson}</pre>
    </div>
  )
}