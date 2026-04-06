'use client'

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

import Link from 'next/link'

const PANEL_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Jost:wght@300;400;500&display=swap');

  .rp-section {
    --ivory:      #faf7f4;
    --champagne:  #f0e6d3;
    --blush:      #d4a5a0;
    --espresso:   #2c1a10;
    --warm-brown: #6b3f2a;
    --muted:      #9b8880;
    --accent:     #b8860b;
    padding: 72px 0 88px;
    background: var(--ivory);
    border-top: 1px solid var(--champagne);
    font-family: 'Jost', sans-serif;
  }

  /* ── Header ── */
  .rp-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    margin-bottom: 40px;
    gap: 16px;
    flex-wrap: wrap;
  }
  .rp-header-left {}
  .rp-overline {
    display: block;
    font-size: 9px;
    letter-spacing: 0.42em;
    text-transform: uppercase;
    color: var(--blush);
    margin-bottom: 10px;
  }
  .rp-title {
    font-family: 'Cormorant Garamond', serif;
    font-size: clamp(28px, 4vw, 44px);
    font-weight: 300;
    color: var(--espresso);
    margin: 0;
    line-height: 1.05;
  }
  .rp-title em { font-style: italic; color: var(--warm-brown); }

  /* ── Engine badge ── */
  .rp-engine-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 9px;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--muted);
    border: 1px solid var(--champagne);
    padding: 6px 14px;
    cursor: pointer;
    background: none;
    transition: border-color 0.2s, color 0.2s;
    font-family: 'Jost', sans-serif;
  }
  .rp-engine-badge:hover { border-color: var(--blush); color: var(--warm-brown); }
  .rp-engine-badge svg { flex-shrink: 0; }

  /* ── Engine info panel ── */
  .rp-engine-info {
    background: linear-gradient(135deg, #fdf9f5 0%, #f7ede3 100%);
    border: 1px solid var(--champagne);
    padding: 24px 28px;
    margin-bottom: 40px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px 32px;
  }
  .rp-engine-section-title {
    font-size: 8px;
    letter-spacing: 0.4em;
    text-transform: uppercase;
    color: var(--blush);
    margin: 0 0 10px;
  }
  .rp-weight-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .rp-weight-label {
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--espresso);
    width: 90px;
    flex-shrink: 0;
  }
  .rp-weight-bar-wrap {
    flex: 1;
    height: 4px;
    background: var(--champagne);
    border-radius: 2px;
    overflow: hidden;
  }
  .rp-weight-bar {
    height: 100%;
    border-radius: 2px;
    background: var(--warm-brown);
    transition: width 0.5s ease;
  }
  .rp-weight-pct {
    font-size: 11px;
    color: var(--muted);
    width: 32px;
    text-align: right;
    flex-shrink: 0;
  }
  .rp-stat {
    font-size: 12px;
    color: var(--muted);
    margin: 0 0 5px;
    display: flex;
    justify-content: space-between;
  }
  .rp-stat strong { color: var(--espresso); font-weight: 500; }
  .rp-profile-label {
    font-family: 'Cormorant Garamond', serif;
    font-size: 17px;
    color: var(--warm-brown);
    margin: 0 0 6px;
    font-style: italic;
  }
  .rp-cold-start-note {
    font-size: 11px;
    color: var(--muted);
    line-height: 1.6;
    margin: 0;
    font-style: italic;
  }

  /* ── Grid ── */
  .rp-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
  }

  /* ── Card ── */
  .rp-card {
    position: relative;
    display: flex;
    flex-direction: column;
    text-decoration: none;
    color: inherit;
    overflow: hidden;
    cursor: pointer;
  }
  .rp-card-img {
    position: relative;
    aspect-ratio: 3/4;
    overflow: hidden;
    background: var(--champagne);
  }
  .rp-card-img img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
    display: block;
    transition: transform 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                filter 0.5s ease;
    filter: brightness(0.97) saturate(0.9);
  }
  .rp-card:hover .rp-card-img img {
    transform: scale(1.06);
    filter: brightness(0.82) saturate(1.0);
  }
  .rp-card-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to top,
      rgba(44, 26, 16, 0.7) 0%,
      rgba(44, 26, 16, 0.1) 40%,
      transparent 65%
    );
    opacity: 0;
    transition: opacity 0.4s ease;
  }
  .rp-card:hover .rp-card-overlay { opacity: 1; }
  .rp-card-cta {
    position: absolute;
    bottom: 18px;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 9px;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: #faf7f4;
    border-bottom: 1px solid rgba(250,247,244,0.4);
    display: inline-block;
    width: fit-content;
    margin: 0 auto;
    padding-bottom: 2px;
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.3s ease 0.06s, transform 0.3s ease 0.06s;
  }
  .rp-card:hover .rp-card-cta { opacity: 1; transform: translateY(0); }

  /* Source badges */
  .rp-card-badges {
    position: absolute;
    top: 10px;
    right: 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    align-items: flex-end;
  }
  .rp-badge {
    font-size: 7px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 1px;
    font-family: 'Jost', sans-serif;
  }
  .rp-badge-cbf     { background: rgba(107,63,42,0.85); color: #faf7f4; }
  .rp-badge-knn     { background: rgba(44,26,16,0.85);  color: #faf7f4; }
  .rp-badge-apriori { background: rgba(184,134,11,0.85); color: #faf7f4; }

  /* Score bar */
  .rp-card-score {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: rgba(250,247,244,0.2);
    overflow: hidden;
  }
  .rp-card-score-fill {
    height: 100%;
    background: rgba(212,165,160,0.8);
    transition: width 0.4s ease;
  }

  .rp-card-info {
    padding: 12px 14px 16px;
    background: var(--ivory);
    border-top: 1px solid var(--champagne);
  }
  .rp-card-name {
    font-family: 'Cormorant Garamond', serif;
    font-size: 17px;
    font-weight: 400;
    color: var(--espresso);
    margin: 0 0 3px;
    line-height: 1.2;
  }
  .rp-card-meta {
    font-size: 11px;
    color: var(--muted);
    margin: 0;
    letter-spacing: 0.04em;
  }

  /* ── Score tooltip ── */
  .rp-card-score-row {
    display: flex;
    gap: 6px;
    margin-top: 6px;
    flex-wrap: wrap;
  }
  .rp-score-chip {
    font-size: 9px;
    letter-spacing: 0.1em;
    color: var(--muted);
    background: var(--champagne);
    padding: 2px 7px;
    border-radius: 1px;
  }

  /* ── Empty / Loading states ── */
  .rp-skeleton-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
  }
  .rp-skeleton-card {
    background: var(--champagne);
    aspect-ratio: 3/4;
    animation: rp-shimmer 1.4s ease-in-out infinite alternate;
  }
  @keyframes rp-shimmer { from { opacity: 0.4; } to { opacity: 0.9; } }

  .rp-empty {
    grid-column: 1 / -1;
    text-align: center;
    padding: 48px 0;
  }
  .rp-empty-text {
    font-family: 'Cormorant Garamond', serif;
    font-size: 22px;
    font-weight: 300;
    color: var(--muted);
    margin: 0;
    font-style: italic;
  }

  @media (max-width: 1024px) { .rp-grid, .rp-skeleton-grid { grid-template-columns: repeat(3, 1fr); } }
  @media (max-width: 720px)  { .rp-grid, .rp-skeleton-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 480px)  { .rp-grid, .rp-skeleton-grid { grid-template-columns: 1fr; } }
`

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
  showMethodBadges = false,
  showEngineInfo = true,
}) {
  const { useState: _useState } = require('react')
  const [infoOpen, setInfoOpen] = _useState(showEngineInfo)

  if (!loading && recommendations.length === 0) return null

  const weights = meta?.weights
  const isColdStart = weights?.label === 'Content-based'

  return (
    <section className="rp-section">
      <style>{PANEL_STYLES}</style>
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
