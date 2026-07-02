'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser } from '../../utils/authClient'
import { adminFetch }     from '../adminFetch'

// ── Domain → badge config ────────────────────────────────────────────────────
const ACTION_DOMAINS = {
  'order':  { label: 'Orders',   colorVar: 'var(--adm-blue,  #4a7fd4)', bgVar: 'var(--adm-blue-dim,  rgba(74,127,212,0.12))'  },
  'user':   { label: 'Users',    colorVar: 'var(--adm-warn)',            bgVar: 'var(--adm-warn-bg)'                           },
  'gown':   { label: 'Gowns',    colorVar: 'var(--adm-success)',         bgVar: 'var(--adm-success-bg)'                        },
  'cms':    { label: 'CMS',      colorVar: 'var(--adm-accent)',          bgVar: 'var(--adm-accent-bg)'                         },
  'report': { label: 'Reports',  colorVar: 'var(--adm-text-3)',          bgVar: 'var(--adm-surface-alt)'                       },
  'upload': { label: 'Uploads',  colorVar: 'var(--adm-text-3)',          bgVar: 'var(--adm-surface-alt)'                       },
  'secret': { label: 'Security', colorVar: 'var(--adm-danger)',          bgVar: 'var(--adm-danger-bg)'                         },
}

function getDomain(action = '') {
  const prefix = action.split('.')[0]
  return ACTION_DOMAINS[prefix] || {
    label: prefix,
    colorVar: 'var(--adm-text-3)',
    bgVar: 'var(--adm-surface-alt)',
  }
}

function fmtTs(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  )
}

function ActionBadge({ action }) {
  const domain = getDomain(action)
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '3px 9px',
      borderRadius: 99,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      color: domain.colorVar,
      background: domain.bgVar,
      border: `1px solid ${domain.colorVar}`,
      whiteSpace: 'nowrap',
      opacity: 0.95,
    }}>
      <span style={{
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: domain.colorVar,
        flexShrink: 0,
      }} />
      {action}
    </span>
  )
}

function PayloadDrawer({ payload }) {
  const [open, setOpen] = useState(false)
  if (!payload || Object.keys(payload).length === 0) {
    return <span style={{ color: 'var(--adm-text-3)', fontSize: 12 }}>—</span>
  }
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="adm-btn-sm"
        style={{ fontFamily: 'monospace', fontSize: 11 }}
      >
        {open ? '▲ hide' : '▼ view'}
      </button>
      {open && (
        <pre style={{
          marginTop: 6,
          padding: '10px 12px',
          borderRadius: 'var(--adm-radius-md)',
          background: 'var(--adm-surface-alt)',
          border: '1px solid var(--adm-border-em)',
          color: 'var(--adm-accent)',
          fontSize: 11,
          fontFamily: 'monospace',
          overflowX: 'auto',
          maxWidth: 320,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          lineHeight: 1.6,
        }}>
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  )
}

const ENTITY_TYPES = [
  '', 'order', 'user', 'gown', 'cms_block',
  'hero_slide', 'testimonial', 'upload', 'secret', 'report',
]
const PAGE_SIZE = 50

export default function AuditPage() {
  const router = useRouter()
  const [ready,   setReady  ] = useState(false)
  const [logs,    setLogs   ] = useState([])
  const [total,   setTotal  ] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error,   setError  ] = useState('')
  const [offset,  setOffset ] = useState(0)

  // Filters
  const [filterAction, setFilterAction] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [filterActor,  setFilterActor ] = useState('')
  const [filterFrom,   setFilterFrom  ] = useState('')
  const [filterTo,     setFilterTo    ] = useState('')

  // Auth guard
  useEffect(() => {
    const u = getCurrentUser()
    if (!u || !['admin', 'staff'].includes(u.role)) { router.replace('/login'); return }
    if (u.role !== 'admin')                          { router.replace('/staff'); return }
    setReady(true)
  }, [router])

  const fetchLogs = useCallback(async (off = 0) => {
    setLoading(true)
    setError('')

    const params = new URLSearchParams({ limit: PAGE_SIZE, offset: off })
    if (filterAction) params.set('action',      filterAction)
    if (filterEntity) params.set('entity_type', filterEntity)
    if (filterActor)  params.set('actor',       filterActor)
    if (filterFrom)   params.set('from',        filterFrom + 'T00:00:00')
    if (filterTo)     params.set('to',          filterTo   + 'T23:59:59')

    try {
      const res  = await adminFetch(`/api/admin/audit?${params}`)
      const data = await res.json()
      if (data.ok) {
        setLogs(data.logs || [])
        setTotal(data.total || 0)
        setOffset(off)
      } else {
        setError(data.error || 'Failed to load logs.')
      }
    } catch {
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }, [filterAction, filterEntity, filterActor, filterFrom, filterTo])

  useEffect(() => { if (ready) fetchLogs(0) }, [ready])

  function handleFilter(e) {
    e.preventDefault()
    fetchLogs(0)
  }

  function handleReset() {
    setFilterAction('')
    setFilterEntity('')
    setFilterActor('')
    setFilterFrom('')
    setFilterTo('')
    setTimeout(() => fetchLogs(0), 0)
  }

  const totalPages  = Math.ceil(total / PAGE_SIZE)
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  if (!ready) return null

  return (
    <div className="adm-audit-page">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="adm-topbar">
        <div>
          <h1 className="adm-page-title">Audit Trail</h1>
          <p className="adm-page-meta">
            Append-only log of all admin mutations — orders, users, gowns, CMS, exports, and security events.
          </p>
        </div>
        <span className="adm-audit-count-badge">
          {total.toLocaleString()} event{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="adm-card">
        <p className="adm-card-title">Filters</p>
        <form onSubmit={handleFilter} className="adm-audit-filters">

          <div className="adm-form-row">
            <label className="adm-label">Action</label>
            <input
              className="adm-input"
              value={filterAction}
              onChange={e => setFilterAction(e.target.value)}
              placeholder="e.g. order.status"
            />
          </div>

          <div className="adm-form-row">
            <label className="adm-label">Entity type</label>
            <select
              className="adm-input"
              value={filterEntity}
              onChange={e => setFilterEntity(e.target.value)}
            >
              {ENTITY_TYPES.map(t => (
                <option key={t} value={t}>{t || '— all —'}</option>
              ))}
            </select>
          </div>

          <div className="adm-form-row">
            <label className="adm-label">Actor (email)</label>
            <input
              className="adm-input"
              value={filterActor}
              onChange={e => setFilterActor(e.target.value)}
              placeholder="partial email"
            />
          </div>

          <div className="adm-form-row">
            <label className="adm-label">From</label>
            <input
              type="date"
              className="adm-input"
              value={filterFrom}
              onChange={e => setFilterFrom(e.target.value)}
            />
          </div>

          <div className="adm-form-row">
            <label className="adm-label">To</label>
            <input
              type="date"
              className="adm-input"
              value={filterTo}
              onChange={e => setFilterTo(e.target.value)}
            />
          </div>

          <div className="adm-audit-filter-actions">
            <button type="submit" className="adm-btn">Apply</button>
            <button type="button" onClick={handleReset} className="adm-btn-outline">Reset</button>
          </div>
        </form>
      </div>

      {/* ── Error ───────────────────────────────────────────────────────── */}
      {error && <p className="adm-error-msg">{error}</p>}

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="adm-audit-table-wrap">
        <div className="adm-audit-table-scroll">
          <table className="adm-audit-table">
            <thead>
              <tr>
                {['Timestamp', 'Actor', 'Action', 'Entity type', 'Entity ID', 'IP', 'Payload'].map(h => (
                  <th key={h} className="adm-audit-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="adm-audit-empty">
                    <span className="adm-loading-text">Loading…</span>
                  </td>
                </tr>
              )}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={7} className="adm-audit-empty">
                    No audit events match your filters.
                  </td>
                </tr>
              )}
              {!loading && logs.map((log, i) => (
                <tr key={log.id} className={`adm-audit-tr${i % 2 === 0 ? '' : ' adm-audit-tr--alt'}`}>
                  <td className="adm-audit-td">
                    <span className="adm-audit-ts">{fmtTs(log.logged_at)}</span>
                  </td>
                  <td className="adm-audit-td">
                    <span className="adm-audit-actor">{log.actor_email || '—'}</span>
                  </td>
                  <td className="adm-audit-td adm-audit-td--nowrap">
                    <ActionBadge action={log.action} />
                  </td>
                  <td className="adm-audit-td">
                    <span className="adm-audit-entity-type">{log.entity_type || '—'}</span>
                  </td>
                  <td className="adm-audit-td">
                    <span className="adm-audit-entity-id">{log.entity_id || '—'}</span>
                  </td>
                  <td className="adm-audit-td">
                    <span className="adm-audit-ip">{log.ip || '—'}</span>
                  </td>
                  <td className="adm-audit-td adm-audit-td--payload">
                    <PayloadDrawer payload={log.payload} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ──────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="adm-audit-pagination">
            <span className="adm-page-meta">
              Page {currentPage} of {totalPages} &nbsp;·&nbsp; {total.toLocaleString()} total
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => fetchLogs(offset - PAGE_SIZE)}
                disabled={offset === 0 || loading}
                className="adm-btn-outline"
                style={{ opacity: offset === 0 ? 0.4 : 1 }}
              >
                ← Prev
              </button>
              <button
                onClick={() => fetchLogs(offset + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total || loading}
                className="adm-btn-outline"
                style={{ opacity: offset + PAGE_SIZE >= total ? 0.4 : 1 }}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}