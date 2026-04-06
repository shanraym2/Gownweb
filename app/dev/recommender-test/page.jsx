'use client'

/**
 * /dev/recommender-test
 * ──────────────────────
 * A live, interactive test harness for the FitMatcher recommendation engine.
 *
 * Features:
 *   - Seed synthetic multi-user data with one click
 *   - Simulate any user profile and context gown
 *   - See CBF / KNN / Apriori scores side-by-side
 *   - Watch Apriori rules mined from baskets in real time
 *   - Run self-validating assertions and see pass/fail
 *   - Clear all data to start fresh
 *
 * This page is for DEVELOPMENT/CAPSTONE DEMO only.
 * Add a guard in middleware.js to block in production:
 *   if (process.env.NODE_ENV === 'production' && req.nextUrl.pathname.startsWith('/dev'))
 *     return NextResponse.redirect(new URL('/', req.url))
 */

import { useState, useCallback, useEffect } from 'react'
import { useGowns } from '@/hooks/useGowns'
import {
  getHybridRecommendations,
  trackEvent,
  computeWeights,
  WEIGHT_PROFILES,
} from '@/app/utils/recommender/hybridRecommender'
import {
  recordInteraction,
  loadInteractions,
  saveInteractions,
  getInteractionUserCount,
} from '@/app/utils/recommender/knnCollaborative'
import {
  recordBasket,
  loadBaskets,
  getRules,
  getAprioriStats,
  invalidateRulesCache,
} from '@/app/utils/recommender/apriori'

// ── Synthetic user profiles ────────────────────────────────────────────────

const SYNTHETIC_USERS = {
  user_ballgown_lover: { label: 'Ball Gown Lover', interactions: { '1': 8, '2': 6, '10': 7, '3': 1 } },
  user_mermaid_fan:    { label: 'Mermaid Fan',     interactions: { '5': 9, '6': 7, '3': 3, '4': 1 } },
  user_minimal_bride:  { label: 'Minimal Bride',   interactions: { '7': 8, '8': 6, '3': 2, '9': 1 } },
  user_aline_classic:  { label: 'A-Line Classic',  interactions: { '3': 8, '4': 7, '9': 5, '1': 1 } },
  user_mixed:          { label: 'Mixed Taste',     interactions: { '1': 3, '5': 3, '7': 3, '3': 5 } },
  user_ballgown_lover_2: { label: 'Ball Gown Lover 2', interactions: { '1': 6, '2': 8, '10': 9, '4': 2 } },
  user_mermaid_fan_2:  { label: 'Mermaid Fan 2',   interactions: { '5': 7, '6': 8, '8': 3 } },
  user_aline_2:        { label: 'A-Line 2',        interactions: { '3': 7, '4': 8, '9': 6, '7': 1 } },
}

const SYNTHETIC_BASKETS = [
  ['1','2'],['1','2','10'],['2','10'],['1','10'],['1','2'],['2','10'],['1','2','10'],
  ['5','6'],['5','6'],['5','6','3'],['5','6'],
  ['3','4'],['3','4','9'],['3','9'],['4','9'],['3','4'],
  ['7','8'],['7','8'],['7','8'],
  ['1','3'],['5','7'],['3','5'],
]

// ── Assertion engine ───────────────────────────────────────────────────────

function runAssertions(recommendations, meta, activeUser, contextGownId, gowns) {
  const results = []
  const gownMap = {}
  gowns.forEach((g) => { gownMap[g.id] = g })

  const assert = (label, condition, detail = '') => {
    results.push({ label, pass: !!condition, detail })
  }

  // Basic structure
  assert('Returns an array of recommendations', Array.isArray(recommendations))
  assert('Has at least 1 recommendation', recommendations.length > 0)
  assert(
    'All recommendations have _scores',
    recommendations.every((r) => r._scores && typeof r._scores.hybrid === 'number')
  )
  assert(
    'No duplicate gown IDs in results',
    new Set(recommendations.map((r) => r.id)).size === recommendations.length
  )
  assert(
    'All recommendations are valid catalog gowns',
    recommendations.every((r) => !!gownMap[r.id])
  )

  // Context gown exclusion
  if (contextGownId) {
    assert(
      'Context gown excluded from results',
      !recommendations.some((r) => r.id === contextGownId)
    )
  }

  // Sort order
  let sortedCorrectly = true
  for (let i = 1; i < recommendations.length; i++) {
    if (recommendations[i]._scores.hybrid > recommendations[i-1]._scores.hybrid) {
      sortedCorrectly = false
      break
    }
  }
  assert('Results sorted by hybrid score descending', sortedCorrectly)

  // Weight profile
  assert('Meta contains weight profile', !!meta?.weights?.label)
  const weightSum = (meta?.weights?.cbf || 0) + (meta?.weights?.knn || 0) + (meta?.weights?.apriori || 0)
  assert('Weights sum to 1.0', Math.abs(weightSum - 1.0) < 0.001, `Sum = ${weightSum.toFixed(3)}`)

  // Cold-start check
  const isColdStart = meta?.weights?.label === WEIGHT_PROFILES.COLD_START.label
  if (isColdStart) {
    assert('Cold-start: CBF weight = 1.0', meta.weights.cbf === 1.0)
    assert('Cold-start: KNN weight = 0.0', meta.weights.knn === 0.0)
  }

  // Semantic: ball gown context → top result should be ball gown (CBF dominant)
  if (contextGownId && (contextGownId === 1 || contextGownId === 2 || contextGownId === 10)) {
    const topGown = gownMap[recommendations[0]?.id]
    const isBallGown = topGown?.type === 'Ball Gown'
    assert(
      'Ball gown context → top result is also Ball Gown (CBF signal)',
      isBallGown,
      topGown ? `Got: ${topGown.type}` : 'No top result'
    )
  }

  // Apriori: if baskets loaded, rules should exist
  const stats = getAprioriStats()
  if (stats.basketCount >= 5) {
    assert(
      `Apriori mined rules from ${stats.basketCount} baskets`,
      stats.ruleCount > 0,
      `${stats.ruleCount} rules`
    )
  }

  return results
}

// ── Styles ─────────────────────────────────────────────────────────────────

const S = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400&family=Jost:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap');
  .th { --ivory:#faf7f4; --champagne:#f0e6d3; --blush:#d4a5a0; --espresso:#2c1a10; --warm-brown:#6b3f2a; --muted:#9b8880; --pass:#2d6a4f; --fail:#9b2226; --code:#f0e6d3; min-height:100vh; background:#1a0f09; color:#e8ddd5; font-family:'Jost',sans-serif; padding:0; }
  .th-header { background:#120a05; border-bottom:1px solid #3d2010; padding:16px 32px; display:flex; align-items:center; justify-content:space-between; }
  .th-logo { font-family:'Cormorant Garamond',serif; font-size:22px; font-weight:300; color:#d4a5a0; }
  .th-logo span { font-size:10px; letter-spacing:0.3em; text-transform:uppercase; color:#6b3f2a; display:block; }
  .th-env { font-size:10px; letter-spacing:0.2em; text-transform:uppercase; color:#6b3f2a; border:1px solid #3d2010; padding:4px 12px; }
  .th-body { display:grid; grid-template-columns:300px 1fr; gap:0; min-height:calc(100vh - 57px); }
  .th-sidebar { background:#120a05; border-right:1px solid #3d2010; padding:24px; overflow-y:auto; }
  .th-main { padding:24px; overflow-y:auto; }
  .th-section-title { font-size:8px; letter-spacing:0.4em; text-transform:uppercase; color:#6b3f2a; margin:0 0 16px; padding-bottom:8px; border-bottom:1px solid #3d2010; }
  .th-block { margin-bottom:28px; }
  .th-label { font-size:11px; letter-spacing:0.1em; color:#9b8880; margin-bottom:8px; display:block; }
  .th-select { width:100%; background:#1a0f09; border:1px solid #3d2010; color:#e8ddd5; font-family:'Jost',sans-serif; font-size:12px; padding:8px 10px; appearance:none; -webkit-appearance:none; outline:none; cursor:pointer; }
  .th-select:focus { border-color:#6b3f2a; }
  .th-btn { width:100%; padding:10px 16px; font-family:'Jost',sans-serif; font-size:9px; letter-spacing:0.3em; text-transform:uppercase; border:none; cursor:pointer; transition:background 0.2s; margin-bottom:8px; display:block; }
  .th-btn-primary { background:#6b3f2a; color:#faf7f4; }
  .th-btn-primary:hover { background:#8b5a3a; }
  .th-btn-secondary { background:#1a0f09; color:#9b8880; border:1px solid #3d2010; }
  .th-btn-secondary:hover { border-color:#6b3f2a; color:#d4a5a0; }
  .th-btn-danger { background:#4a0e0e; color:#d4a5a0; }
  .th-btn-danger:hover { background:#6b1515; }
  .th-stat { display:flex; justify-content:space-between; font-size:11px; margin-bottom:6px; color:#9b8880; }
  .th-stat strong { color:#e8ddd5; }
  .th-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
  .th-card { background:#1a0f09; border:1px solid #3d2010; padding:16px; }
  .th-card-title { font-size:8px; letter-spacing:0.35em; text-transform:uppercase; color:#6b3f2a; margin-bottom:12px; }
  .th-score-row { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  .th-score-label { font-size:11px; color:#9b8880; width:80px; flex-shrink:0; font-family:'JetBrains Mono',monospace; }
  .th-score-bar-wrap { flex:1; height:6px; background:#2c1a10; border-radius:0; overflow:hidden; }
  .th-score-bar { height:100%; border-radius:0; transition:width 0.4s ease; }
  .th-score-val { font-size:10px; color:#e8ddd5; width:36px; text-align:right; font-family:'JetBrains Mono',monospace; }
  .th-reco-list { display:flex; flex-direction:column; gap:8px; }
  .th-reco-item { display:grid; grid-template-columns:24px 1fr auto; gap:12px; align-items:center; padding:10px 12px; background:#120a05; border:1px solid #3d2010; }
  .th-reco-rank { font-family:'JetBrains Mono',monospace; font-size:12px; color:#6b3f2a; }
  .th-reco-name { font-family:'Cormorant Garamond',serif; font-size:16px; color:#e8ddd5; }
  .th-reco-type { font-size:9px; letter-spacing:0.2em; text-transform:uppercase; color:#9b8880; margin-top:2px; }
  .th-reco-score { font-family:'JetBrains Mono',monospace; font-size:11px; color:#d4a5a0; text-align:right; }
  .th-reco-breakdown { font-size:9px; color:#6b3f2a; font-family:'JetBrains Mono',monospace; }
  .th-assertions { display:flex; flex-direction:column; gap:6px; }
  .th-assert { display:flex; align-items:center; gap:10px; padding:8px 12px; font-size:11px; }
  .th-assert-pass { background:#0a1f16; border-left:3px solid #2d6a4f; color:#52b788; }
  .th-assert-fail { background:#1f0a0a; border-left:3px solid #9b2226; color:#e07a7a; }
  .th-assert-icon { font-size:14px; flex-shrink:0; }
  .th-assert-detail { font-size:9px; color:#9b8880; margin-left:auto; font-family:'JetBrains Mono',monospace; }
  .th-rules { display:flex; flex-direction:column; gap:6px; }
  .th-rule { padding:8px 12px; background:#120a05; border:1px solid #3d2010; font-family:'JetBrains Mono',monospace; font-size:10px; color:#9b8880; }
  .th-rule strong { color:#d4a5a0; }
  .th-rule-metrics { margin-top:4px; display:flex; gap:12px; }
  .th-rule-metric { color:#6b3f2a; }
  .th-rule-metric span { color:#e8ddd5; }
  .th-weight-profile { padding:12px; background:#120a05; border:1px solid #3d2010; margin-bottom:16px; }
  .th-weight-profile-name { font-family:'Cormorant Garamond',serif; font-size:18px; font-style:italic; color:#d4a5a0; margin-bottom:8px; }
  .th-interactions { font-family:'JetBrains Mono',monospace; font-size:10px; color:#9b8880; background:#120a05; padding:12px; border:1px solid #3d2010; white-space:pre; overflow:auto; max-height:200px; }
  .th-pass-count { font-size:12px; margin-top:10px; padding:8px 12px; text-align:center; }
  .th-pass-all { background:#0a1f16; color:#52b788; }
  .th-pass-partial { background:#1f1505; color:#d4a5a0; }
`

export default function RecommenderTestPage() {
  const { gowns, loading: gownsLoading } = useGowns()
  const [activeUser, setActiveUser] = useState('user_ballgown_lover')
  const [contextGownId, setContextGownId] = useState(1)
  const [results, setResults] = useState(null)
  const [assertions, setAssertions] = useState([])
  const [stats, setStats] = useState({ users: 0, baskets: 0, rules: 0 })
  const [seeded, setSeeded] = useState(false)
  const [running, setRunning] = useState(false)

  const refreshStats = useCallback(() => {
    invalidateRulesCache()
    const apStats = getAprioriStats()
    setStats({
      users: getInteractionUserCount(),
      baskets: apStats.basketCount,
      rules: apStats.ruleCount,
    })
  }, [])

  useEffect(() => { refreshStats() }, [refreshStats])

  const seedData = useCallback(() => {
    // Seed all synthetic users
    const existing = loadInteractions()
    Object.entries(SYNTHETIC_USERS).forEach(([uid, profile]) => {
      existing[uid] = profile.interactions
    })
    saveInteractions(existing)

    // Seed baskets
    SYNTHETIC_BASKETS.forEach((basket) => recordBasket(basket))
    invalidateRulesCache()
    setSeeded(true)
    refreshStats()
  }, [refreshStats])

  const clearData = useCallback(() => {
    localStorage.removeItem('jce_interactions')
    localStorage.removeItem('jce_baskets')
    sessionStorage.removeItem('jce_session_basket')
    invalidateRulesCache()
    setSeeded(false)
    setResults(null)
    setAssertions([])
    refreshStats()
  }, [refreshStats])

  const runTest = useCallback(() => {
    if (!gowns || gowns.length === 0) return
    setRunning(true)
    setTimeout(() => {
      try {
        const { recommendations, meta } = getHybridRecommendations(gowns, activeUser, {
          contextGownId: contextGownId || undefined,
          topN: 8,
          excludeSeen: true,
        })
        setResults({ recommendations, meta })
        setAssertions(runAssertions(recommendations, meta, activeUser, contextGownId, gowns))
        refreshStats()
      } catch (err) {
        console.error(err)
      } finally {
        setRunning(false)
      }
    }, 10)
  }, [gowns, activeUser, contextGownId, refreshStats])

  const passCount = assertions.filter((a) => a.pass).length
  const allPass = assertions.length > 0 && passCount === assertions.length

  const weights = results?.meta?.weights
  const apStats = getAprioriStats()
  const rules = apStats.topRules || []

  return (
    <div className="th">
      <style>{S}</style>

      <div className="th-header">
        <div className="th-logo">
          FitMatcher
          <span>Recommender Test Harness</span>
        </div>
        <span className="th-env">Development Only</span>
      </div>

      <div className="th-body">
        {/* ── Sidebar ── */}
        <aside className="th-sidebar">
          <div className="th-block">
            <p className="th-section-title">Test Data</p>
            <button className="th-btn th-btn-primary" onClick={seedData}>
              {seeded ? '↺ Re-seed Synthetic Users' : '⬇ Seed Synthetic Users'}
            </button>
            <button className="th-btn th-btn-danger" onClick={clearData}>
              ✕ Clear All Data
            </button>
          </div>

          <div className="th-block">
            <p className="th-section-title">Data Store</p>
            <div className="th-stat"><span>Users with data</span><strong>{stats.users}</strong></div>
            <div className="th-stat"><span>Baskets mined</span><strong>{stats.baskets}</strong></div>
            <div className="th-stat"><span>Apriori rules</span><strong>{stats.rules}</strong></div>
          </div>

          <div className="th-block">
            <p className="th-section-title">Simulation</p>
            <label className="th-label">Active User</label>
            <select className="th-select" value={activeUser} onChange={(e) => setActiveUser(e.target.value)}>
              <option value="brand_new_user">⭐ Brand New User (cold start)</option>
              {Object.entries(SYNTHETIC_USERS).map(([uid, p]) => (
                <option key={uid} value={uid}>{p.label}</option>
              ))}
            </select>

            <label className="th-label" style={{ marginTop: 14 }}>Context Gown (detail page)</label>
            <select className="th-select" value={contextGownId} onChange={(e) => setContextGownId(Number(e.target.value))}>
              <option value={0}>— None (catalog/home page) —</option>
              {gowns.map((g) => (
                <option key={g.id} value={g.id}>{g.id}. {g.name} ({g.type})</option>
              ))}
            </select>
          </div>

          <button className="th-btn th-btn-primary" onClick={runTest} disabled={running || gownsLoading}>
            {running ? 'Computing…' : '▶ Run Recommender'}
          </button>

          {weights && (
            <div className="th-block" style={{ marginTop: 20 }}>
              <p className="th-section-title">Active Weight Profile</p>
              <div className="th-weight-profile">
                <div className="th-weight-profile-name">{weights.label}</div>
                {[
                  { label: 'Content-Based', val: weights.cbf, color: '#d4a5a0' },
                  { label: 'KNN Collab.', val: weights.knn, color: '#9b8880' },
                  { label: 'Apriori', val: weights.apriori, color: '#6b3f2a' },
                ].map(({ label, val, color }) => (
                  <div key={label} className="th-score-row">
                    <span className="th-score-label" style={{ fontSize: 9, width: 70 }}>{label}</span>
                    <div className="th-score-bar-wrap">
                      <div className="th-score-bar" style={{ width: `${val * 100}%`, background: color }} />
                    </div>
                    <span className="th-score-val">{Math.round(val * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* ── Main ── */}
        <main className="th-main">
          {!results ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#6b3f2a' }}>
              <p style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 32, fontWeight: 300, margin: '0 0 12px' }}>
                Ready to run
              </p>
              <p style={{ fontSize: 12, color: '#6b3f2a', letterSpacing: '0.1em' }}>
                Seed data, choose a user, pick a context gown, then click Run
              </p>
            </div>
          ) : (
            <>
              <div className="th-grid">
                {/* Recommendations */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <p className="th-section-title">
                    Recommendations for "{SYNTHETIC_USERS[activeUser]?.label || activeUser}"
                    {contextGownId ? ` · Context: ${gowns.find(g=>g.id===contextGownId)?.name}` : ' · No context'}
                  </p>
                  <div className="th-reco-list">
                    {results.recommendations.map((r, i) => (
                      <div key={r.id} className="th-reco-item">
                        <span className="th-reco-rank">#{i + 1}</span>
                        <div>
                          <div className="th-reco-name">{r.name}</div>
                          <div className="th-reco-type">{r.type} · {r.color} · {r.silhouette}</div>
                        </div>
                        <div className="th-reco-score">
                          <div>{(r._scores.hybrid * 100).toFixed(1)}%</div>
                          <div className="th-reco-breakdown">
                            CBF:{(r._scores.cbf*100).toFixed(0)}
                            {' '}KNN:{(r._scores.knn*100).toFixed(0)}
                            {' '}APR:{(r._scores.apriori*100).toFixed(0)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Score breakdown */}
                <div className="th-card">
                  <p className="th-card-title">Algorithm Contributions</p>
                  {results.recommendations.slice(0, 5).map((r) => (
                    <div key={r.id} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, color: '#9b8880', marginBottom: 4 }}>{r.name}</div>
                      {[
                        { label: 'CBF', val: r._scores.cbf, color: '#d4a5a0' },
                        { label: 'KNN', val: r._scores.knn, color: '#9b8880' },
                        { label: 'APR', val: r._scores.apriori, color: '#6b3f2a' },
                      ].map(({ label, val, color }) => (
                        <div key={label} className="th-score-row">
                          <span className="th-score-label">{label}</span>
                          <div className="th-score-bar-wrap">
                            <div className="th-score-bar" style={{ width: `${val * 100}%`, background: color }} />
                          </div>
                          <span className="th-score-val">{(val * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {/* Apriori rules */}
                <div className="th-card">
                  <p className="th-card-title">Top Association Rules (Apriori)</p>
                  {rules.length === 0 ? (
                    <p style={{ fontSize: 11, color: '#6b3f2a' }}>
                      No rules yet. Seed data and run recommender.
                    </p>
                  ) : (
                    <div className="th-rules">
                      {rules.map((r, i) => (
                        <div key={i} className="th-rule">
                          <div>
                            Gown <strong>{r.if}</strong> → Gown <strong>{r.then}</strong>
                          </div>
                          <div className="th-rule-metrics">
                            <span className="th-rule-metric">conf <span>{r.confidence}%</span></span>
                            <span className="th-rule-metric">lift <span>{r.lift}×</span></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Assertions */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <p className="th-section-title">Self-Validating Assertions</p>
                  <div className="th-assertions">
                    {assertions.map((a, i) => (
                      <div key={i} className={`th-assert ${a.pass ? 'th-assert-pass' : 'th-assert-fail'}`}>
                        <span className="th-assert-icon">{a.pass ? '✓' : '✗'}</span>
                        <span>{a.label}</span>
                        {a.detail && <span className="th-assert-detail">{a.detail}</span>}
                      </div>
                    ))}
                  </div>
                  {assertions.length > 0 && (
                    <div className={`th-pass-count ${allPass ? 'th-pass-all' : 'th-pass-partial'}`}>
                      {passCount} / {assertions.length} assertions passed
                      {allPass ? ' — All good ✓' : ' — Check failures above'}
                    </div>
                  )}
                </div>

                {/* Raw interaction vector */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <p className="th-section-title">Raw Interaction Vector ({activeUser})</p>
                  <pre className="th-interactions">
                    {JSON.stringify(
                      Object.fromEntries(
                        Object.entries(loadInteractions()[activeUser] || {}).sort(([,a],[,b]) => b-a)
                      ),
                      null, 2
                    )}
                  </pre>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
