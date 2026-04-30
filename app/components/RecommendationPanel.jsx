'use client'
import { useState } from 'react'
import Link from 'next/link'
/**
 * RecommendationPanel
 * ────────────────────
 * Displays hybrid recommendations with an editorial bridal aesthetic.
 * Shows which algorithms contributed to each recommendation.
 *
 * Props:
 *   recommendations  — array of gown objects with _scores field
 *   meta             — metadata from the hybrid engine (weights, stats)
 *   loading          — boolean
 *   title            — section title (default: "Recommended for You")
 *   showMethodBadges — show CBF/KNN/Apriori source badges (default: false)
 *   showEngineInfo   — show collapsible engine transparency panel (default: false)
 */



function WeightBar({ label, value, color = 'var(--warm-brown)' }) {
  if (value === 0) return null
  return (
    <div className="rp-weight-row">
      <span className="rp-weight-label">{label}</span>
      <div className="rp-weight-bar-wrap">
        <div className="rp-weight-bar" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
      <span className="rp-weight-pct">{Math.round(value * 100)}%</span>
    </div>
  )
}

function SourceBadges({ scores }) {
  if (!scores) return null
  const badges = []
  if (scores.cbf > 0.15)    badges.push({ key: 'cbf',     label: 'Style match', cls: 'rp-badge-cbf' })
  if (scores.knn > 0.15)    badges.push({ key: 'knn',     label: 'Trending',    cls: 'rp-badge-knn' })
  if (scores.apriori > 0.1) badges.push({ key: 'apriori', label: 'Often paired',cls: 'rp-badge-apriori' })
  if (badges.length === 0) return null
  return (
    <div className="rp-card-badges">
      {badges.slice(0, 2).map((b) => (
        <span key={b.key} className={`rp-badge ${b.cls}`}>{b.label}</span>
      ))}
    </div>
  )
}

export default function RecommendationPanel({
  recommendations = [],
  meta = null,
  loading = false,
  title = 'Recommended for You',
  showMethodBadges = true,
  showEngineInfo = true,
}) {
 
  const [infoOpen, setInfoOpen] = useState(showEngineInfo)

  if (!loading && recommendations.length === 0) return null

  const weights = meta?.weights
  const isColdStart = weights?.label === 'Content-based'

  return (
    <section className="rp-section">
      
      <div className="container">

        <div className="rp-header">
          <div className="rp-header-left">
            <span className="rp-overline">FitMatcher · AI Recommendations</span>
            <h2 className="rp-title">
              {title.includes(' ') ? (
                <>
                  {title.split(' ').slice(0, -1).join(' ')}{' '}
                  <em>{title.split(' ').slice(-1)[0]}</em>
                </>
              ) : (
                <em>{title}</em>
              )}
            </h2>
          </div>

          {meta && (
            <button className="rp-engine-badge" onClick={() => setInfoOpen((v) => !v)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {infoOpen ? 'Hide' : 'How this works'}
            </button>
          )}
        </div>

        {infoOpen && meta && (
          <div className="rp-engine-info">
            <div>
              <p className="rp-engine-section-title">Algorithm Weights</p>
              <p className="rp-profile-label">{weights?.label}</p>
              <WeightBar label="Content-Based" value={weights?.cbf || 0} />
              <WeightBar label="KNN Collab." value={weights?.knn || 0} color="var(--espresso)" />
              <WeightBar label="Apriori" value={weights?.apriori || 0} color="var(--accent)" />
              {isColdStart && (
                <p className="rp-cold-start-note">
                  Recommendations are based on style similarity. Interact with more gowns to
                  activate collaborative filtering.
                </p>
              )}
            </div>
            <div>
              <p className="rp-engine-section-title">Data Stats</p>
              <p className="rp-stat">Users with data <strong>{meta.totalUsers}</strong></p>
              <p className="rp-stat">Baskets mined <strong>{meta.aprioriStats?.basketCount || 0}</strong></p>
              <p className="rp-stat">Apriori rules <strong>{meta.aprioriStats?.ruleCount || 0}</strong></p>
              <p className="rp-stat">CBF candidates <strong>{meta.cbfCandidates}</strong></p>
              <p className="rp-stat">KNN candidates <strong>{meta.knnCandidates}</strong></p>
            </div>
            {meta.aprioriStats?.topRules?.length > 0 && (
              <div>
                <p className="rp-engine-section-title">Top Association Rules</p>
                {meta.aprioriStats.topRules.map((r, i) => (
                  <p key={i} className="rp-stat" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                      Gown {r.if} → Gown {r.then}
                    </span>
                    <strong style={{ fontSize: 10 }}>
                      {r.confidence}% conf · {r.lift}× lift
                    </strong>
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Grid ── */}
        {loading ? (
          <div className="rp-skeleton-grid">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rp-skeleton-card" style={{ animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        ) : (
          <div className="rp-grid">
            {recommendations.map((gown, index) => (
              <Link
                key={gown.id}
                href={`/gowns/${gown.id}`}
                className="rp-card"
                style={{ animationDelay: `${index * 0.07}s` }}
              >
                <div className="rp-card-img">
                  <img src={gown.image} alt={gown.alt || gown.name} />
                  <div className="rp-card-overlay" />
                  <div className="rp-card-cta">View details</div>
                  {showMethodBadges && <SourceBadges scores={gown._scores} />}
                  {gown._scores && (
                    <div className="rp-card-score">
                      <div
                        className="rp-card-score-fill"
                        style={{ width: `${Math.round((gown._scores.hybrid || 0) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="rp-card-info">
                  <h3 className="rp-card-name">{gown.name}</h3>
                  <p className="rp-card-meta">{gown.type}{gown.color ? ` · ${gown.color}` : ''}</p>
                  {showMethodBadges && gown._scores && (
                    <div className="rp-card-score-row">
                      {gown._scores.cbf > 0.05 && (
                        <span className="rp-score-chip">Style {Math.round(gown._scores.cbf * 100)}%</span>
                      )}
                      {gown._scores.knn > 0.05 && (
                        <span className="rp-score-chip">KNN {Math.round(gown._scores.knn * 100)}%</span>
                      )}
                      {gown._scores.apriori > 0.05 && (
                        <span className="rp-score-chip">Assoc {Math.round(gown._scores.apriori * 100)}%</span>
                      )}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

      </div>
    </section>
  )
}
