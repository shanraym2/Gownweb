'use client'

import { Suspense, useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { useGowns } from '@/hooks/useGowns'
import { getCurrentUser } from '../utils/authClient'

function parsePrice(s) {
  if (!s || typeof s !== 'string') return 0
  return parseInt(s.replace(/[^\d]/g, ''), 10) || 0
}

function buildRelevanceScores(gowns) {
  try {
    const cart   = JSON.parse(localStorage.getItem('jce_cart')             || '[]')
    const viewed = JSON.parse(localStorage.getItem('jce_recently_viewed') || '[]')
    const cartIds = new Set(cart.map(i => Number(i.id)))
    const viewIds = new Set(viewed.map(Number))
    const tf = {}, cf = {}, sf = {}, kf = {}
    const tally = (g, w) => {
      if (g.type)       tf[g.type]       = (tf[g.type]       || 0) + w
      if (g.color)      cf[g.color]      = (cf[g.color]      || 0) + w
      if (g.silhouette) sf[g.silhouette] = (sf[g.silhouette] || 0) + w
      if (g.category)   kf[g.category]   = (kf[g.category]   || 0) + w
    }
    gowns.filter(g => cartIds.has(Number(g.id))).forEach(g => tally(g, 3))
    gowns.filter(g => viewIds.has(Number(g.id))).forEach(g => tally(g, 1))
    const scores = {}
    gowns.forEach(g => {
      let s = (tf[g.type]||0)*3 + (cf[g.color]||0)*2 + (sf[g.silhouette]||0)*2 + (kf[g.category]||0)*2
      if (cartIds.has(Number(g.id))) s -= 4
      scores[g.id] = s
    })
    return scores
  } catch { return {} }
}

function normalizeLabel(str) {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}
function uniqueCI(arr) {
  const seen = new Map()
  for (const v of arr) {
    if (!v) continue
    const key = v.toLowerCase()
    if (!seen.has(key)) seen.set(key, normalizeLabel(v))
  }
  return [...seen.values()].sort()
}

const EMPTY = { categories:[], types:[], silhouettes:[], colors:[], occasions:[] }
const DEFAULT_SHOW_UNAVAILABLE = true

function FilterGroup({ title, options, selected, onToggle }) {
  const [open, setOpen] = useState(true)
  if (!options.length) return null
  return (
    <div className="fg">
      <button className="fg-hd" onClick={() => setOpen(v=>!v)} type="button">
        <span className="fg-title">{title}</span>
        <span className="fg-right">
          {selected.length > 0 && <span className="fg-badge">{selected.length}</span>}
          <svg className={open ? 'fg-chev open' : 'fg-chev'} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </button>
      {open && (
        <ul className="fg-list">
          {options.map(opt => {
            const on = selected.includes(opt)
            return (
              <li key={opt}>
                <label className="fg-opt">
                  <span className={`fg-box${on?' on':''}`}>
                    {on && <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg>}
                  </span>
                  <input type="checkbox" checked={on} onChange={() => onToggle(opt)} />
                  <span className="fg-lbl">{opt}</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function isGownSoldOut(g) {
  const ss = g.sizeStock
  if (!ss || ss.length === 0) return false
  return ss.every(s => s.stock === 0)
}

function isGownUnavailable(g) {
  // No size/stock data at all — treat as unavailable
  const ss = g.sizeStock
  if (!ss || ss.length === 0) return true
  return ss.every(s => s.stock === 0)
}

function GownCard({ g, score }) {
  const soldOut   = isGownSoldOut(g)
  const noStock   = !g.sizeStock || g.sizeStock.length === 0
  const unavailable = soldOut || noStock
  const isRec     = (score || 0) > 0
  const badgeText = g.category || g.type

  // Label: prefer "Sold Out" when we know stock exists but is 0; "Unavailable" when no data
  const unavailLabel = soldOut ? 'Sold Out' : 'Unavailable'

  return (
    <Link href={`/gowns/${g.id}`} className={`gc${unavailable ? ' gc--soldout' : ''}`}>
      <div className="gc-img-w">
        <img
          src={g.image}
          alt={g.alt || g.name}
          className={`gc-img${unavailable ? ' gc-img--grey' : ''}`}
        />
        {unavailable ? (
          <div className="gc-soldout-overlay">
            <span className="gc-soldout-badge">{unavailLabel}</span>
          </div>
        ) : (
          <div className="gc-ov">
            <span className="gc-cta">View Details</span>
          </div>
        )}
        {badgeText && (
          <span className={`gc-badge${unavailable ? ' gc-badge--dim' : ''}`}>
            {badgeText}
          </span>
        )}
        {isRec && !unavailable && (
          <span className="gc-rec" title="Recommended for you" />
        )}
      </div>
      <div className="gc-info">
        <p className={`gc-name${unavailable ? ' gc-name--dim' : ''}`}>{g.name}</p>
        <div className="gc-row2">
          <span className={`gc-price${unavailable ? ' gc-price--dim' : ''}`}>{g.price}</span>
          {g.silhouette && <span className="gc-sil">{g.silhouette}</span>}
          {unavailable && <span className="gc-sold-label">{unavailLabel}</span>}
        </div>
      </div>
    </Link>
  )
}

// ── FitMatcher sidebar widget ──────────────────────────────────────────────────
// Shown below the filter groups in the sidebar.
// - Logged-in user with saved measurements: shows active state with measurements.
// - Logged-in user without measurements: CTA to the recommender.
// - Guest: invite to log in / try recommender.

function FitMatcherBanner({ user }) {
  const [meas, setMeas] = useState(undefined)  // undefined = loading, null = none

  useEffect(() => {
    if (!user?.id) { setMeas(null); return }
    fetch('/api/measurements', { headers: { 'x-user-id': user.id } })
      .then(r => r.json())
      .then(d => setMeas(d.ok ? d.measurements : null))
      .catch(() => setMeas(null))
  }, [user?.id])

  // Still loading
  if (meas === undefined) return null

  // Has measurements — compact active state for sidebar
  if (meas) {
    const parts = [
      meas.bust_cm  && `B ${meas.bust_cm}`,
      meas.waist_cm && `W ${meas.waist_cm}`,
      meas.hips_cm  && `H ${meas.hips_cm}`,
    ].filter(Boolean)

    return (
      <div className="gp-sb-fm gp-sb-fm--active">
        <div className="gp-sb-fm-row">
          <span className="gp-sb-fm-icon">📐</span>
          <div>
            <p className="gp-sb-fm-title">FitMatcher active</p>
            {parts.length > 0 && (
              <p className="gp-sb-fm-meas">{parts.join(' · ')} cm</p>
            )}
          </div>
        </div>
        <Link href="/size-recommender" className="gp-sb-fm-btn gp-sb-fm-btn--ghost">
          Update measurements →
        </Link>
      </div>
    )
  }

  // Logged in, no measurements
  if (user) {
    return (
      <div className="gp-sb-fm">
        <div className="gp-sb-fm-row">
          <span className="gp-sb-fm-icon">📏</span>
          <p className="gp-sb-fm-title">Not sure which size fits?</p>
        </div>
        <p className="gp-sb-fm-sub">
          Use your camera or enter measurements. FitMatcher will show your recommended size on every gown.
        </p>
        <Link href="/size-recommender" className="gp-sb-fm-btn">Get my size →</Link>
      </div>
    )
  }

  // Guest
  return (
    <div className="gp-sb-fm gp-sb-fm--guest">
      <div className="gp-sb-fm-row">
        <span className="gp-sb-fm-icon">✨</span>
        <p className="gp-sb-fm-title">Personalised size recommendations</p>
      </div>
      <p className="gp-sb-fm-sub">
        Log in and use FitMatcher to see your recommended size on every gown.
      </p>
      <div className="gp-sb-fm-btns">
        <Link href="/size-recommender" className="gp-sb-fm-btn">Try it →</Link>
        <Link href="/login?redirect=/gowns" className="gp-sb-fm-btn gp-sb-fm-btn--ghost">Log in</Link>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

function GownsPageContent() {
  const { gowns, loading, error } = useGowns()
  const searchParams = useSearchParams()
  const query        = searchParams.get('search') ?? ''
  const router       = useRouter()

  const [user,                setUser              ] = useState(null)
  const [draft,               setDraft             ] = useState(EMPTY)
  const [applied,             setApplied           ] = useState(EMPTY)
  const [draftPrice,          setDraftPrice        ] = useState([0, 200000])
  const [appliedPrice,        setAppliedPrice      ] = useState(null)
  const [draftShowUnavail,    setDraftShowUnavail  ] = useState(DEFAULT_SHOW_UNAVAILABLE)
  const [appliedShowUnavail,  setAppliedShowUnavail] = useState(DEFAULT_SHOW_UNAVAILABLE)
  const [sortBy,              setSortBy            ] = useState('relevance')
  const [scores,              setScores            ] = useState({})
  const [dirty,               setDirty             ] = useState(false)

  useEffect(() => { setUser(getCurrentUser()) }, [])
  useEffect(() => { if (gowns.length) setScores(buildRelevanceScores(gowns)) }, [gowns])

  const opts = useMemo(() => {
    const prices = gowns.map(g => parsePrice(g.price)).filter(p=>p>0)
    return {
      categories:  uniqueCI(gowns.map(g=>g.category)),
      types:       uniqueCI(gowns.map(g=>g.type)),
      silhouettes: uniqueCI(gowns.map(g=>g.silhouette)),
      colors:      uniqueCI(gowns.map(g=>g.color)),
      occasions:   uniqueCI(gowns.map(g=>g.occasion)),
      minP: prices.length ? Math.min(...prices) : 0,
      maxP: prices.length ? Math.max(...prices) : 200000,
    }
  }, [gowns])

  useEffect(() => {
    if (opts.maxP) setDraftPrice([opts.minP, opts.maxP])
  }, [opts.minP, opts.maxP])

  const isDirty = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(applied) ||
      JSON.stringify(draftPrice) !== JSON.stringify(appliedPrice ?? [opts.minP, opts.maxP]) ||
      draftShowUnavail !== appliedShowUnavail
  }, [draft, applied, draftPrice, appliedPrice, opts, draftShowUnavail, appliedShowUnavail])

  useEffect(() => { setDirty(isDirty) }, [isDirty])

  const toggle = key => val =>
    setDraft(p => ({ ...p, [key]: p[key].includes(val) ? p[key].filter(v=>v!==val) : [...p[key], val] }))

  const apply   = () => { setApplied({...draft}); setAppliedPrice([...draftPrice]); setAppliedShowUnavail(draftShowUnavail); setDirty(false) }
  const clearAll = () => {
    setDraft(EMPTY); setApplied(EMPTY)
    setDraftPrice([opts.minP, opts.maxP]); setAppliedPrice(null)
    setDraftShowUnavail(DEFAULT_SHOW_UNAVAILABLE); setAppliedShowUnavail(DEFAULT_SHOW_UNAVAILABLE)
    setDirty(false)
  }

  const draftCount   = Object.values(draft).reduce((s,a)=>s+a.length, 0)
  const appliedCount = Object.values(applied).reduce((s,a)=>s+a.length, 0)

  const filtered = useMemo(() => {
    let r = [...gowns]
    if (query.trim()) {
      const q = query.toLowerCase()
      r = r.filter(g =>
        g.name?.toLowerCase().includes(q) ||
        g.description?.toLowerCase().includes(q) ||
        g.type?.toLowerCase().includes(q) ||
        g.color?.toLowerCase().includes(q) ||
        g.silhouette?.toLowerCase().includes(q) ||
        g.category?.toLowerCase().includes(q) ||
        g.occasion?.toLowerCase().includes(q)
      )
    }
    if (applied.categories.length)  r = r.filter(g=>applied.categories.some(v=>v.toLowerCase()===g.category?.toLowerCase()))
    if (applied.types.length)       r = r.filter(g=>applied.types.some(v=>v.toLowerCase()===g.type?.toLowerCase()))
    if (applied.silhouettes.length) r = r.filter(g=>applied.silhouettes.some(v=>v.toLowerCase()===g.silhouette?.toLowerCase()))
    if (applied.colors.length)      r = r.filter(g=>applied.colors.some(v=>v.toLowerCase()===g.color?.toLowerCase()))
    if (applied.occasions.length)   r = r.filter(g=>applied.occasions.some(v=>v.toLowerCase()===g.occasion?.toLowerCase()))
    if (appliedPrice) r = r.filter(g=>{ const p=parsePrice(g.price); return p===0||(p>=appliedPrice[0]&&p<=appliedPrice[1]) })

    // Hide unavailable entirely when toggled off
    if (!appliedShowUnavail) r = r.filter(g => !isGownUnavailable(g))

    if (sortBy==='relevance') {
      // Available items sorted by score; unavailable items always sink to the bottom
      r.sort((a, b) => {
        const aUnavail = isGownUnavailable(a)
        const bUnavail = isGownUnavailable(b)
        if (aUnavail !== bUnavail) return aUnavail ? 1 : -1
        return (scores[b.id]||0) - (scores[a.id]||0)
      })
    }
    if (sortBy==='price-asc')  r.sort((a,b)=>parsePrice(a.price)-parsePrice(b.price))
    if (sortBy==='price-desc') r.sort((a,b)=>parsePrice(b.price)-parsePrice(a.price))
    if (sortBy==='name-asc')   r.sort((a,b)=>a.name.localeCompare(b.name))
    if (sortBy==='name-desc')  r.sort((a,b)=>b.name.localeCompare(a.name))
    return r
  }, [gowns, applied, appliedPrice, appliedShowUnavail, sortBy, scores, query])

  const appliedChips = [
    ...applied.categories.map(v=>({v,k:'categories'})),
    ...applied.types.map(v=>({v,k:'types'})),
    ...applied.silhouettes.map(v=>({v,k:'silhouettes'})),
    ...applied.colors.map(v=>({v,k:'colors'})),
    ...applied.occasions.map(v=>({v,k:'occasions'})),
  ]

  const removeChip = (k, v) => {
    const next = {...applied, [k]: applied[k].filter(x=>x!==v)}
    setApplied(next)
    setDraft(p=>({...p, [k]: p[k].filter(x=>x!==v)}))
  }

  useEffect(() => {
    if (!query.trim() || gowns.length === 0) return
    const q = query.toLowerCase()
    const exact = gowns.find(g => g.name?.toLowerCase() === q)
    if (exact) { router.replace(`/gowns/${exact.id}`); return }
    const matches = gowns.filter(g =>
      g.name?.toLowerCase().includes(q) ||
      g.description?.toLowerCase().includes(q) ||
      g.type?.toLowerCase().includes(q) ||
      g.color?.toLowerCase().includes(q) ||
      g.silhouette?.toLowerCase().includes(q) ||
      g.category?.toLowerCase().includes(q) ||
      g.occasion?.toLowerCase().includes(q)
    )
    if (matches.length === 1) router.replace(`/gowns/${matches[0].id}`)
  }, [query, gowns, router])

  return (
    <main className="gp">
      <Header solid />
      <div className="gp-spacer" />
      <section className="gp-banner">
        <div className="gp-banner-in">
          <p className="gp-eye">JCE Bridal Boutique</p>
          <h1 className="gp-h1">Gowns &amp; <em>Dresses</em></h1>
          <p className="gp-sub">Every silhouette. Every occasion. Filter to find the gown made for you.</p>
        </div>
      </section>
      <div className="gp-body">
        <aside className="gp-sidebar">
          <div className="gp-sb-top">
            <span className="gp-sb-title">Filters</span>
            {draftCount > 0 && <button className="gp-sb-clear" onClick={clearAll} type="button">Clear all</button>}
          </div>
          <div className="gp-fgroups">
            <FilterGroup title="Category"   options={opts.categories}  selected={draft.categories}  onToggle={toggle('categories')} />
            <FilterGroup title="Occasion"   options={opts.occasions}   selected={draft.occasions}   onToggle={toggle('occasions')} />
            <FilterGroup title="Gown Type"  options={opts.types}       selected={draft.types}       onToggle={toggle('types')} />
            <FilterGroup title="Silhouette" options={opts.silhouettes} selected={draft.silhouettes} onToggle={toggle('silhouettes')} />
            <FilterGroup title="Color"      options={opts.colors}      selected={draft.colors}      onToggle={toggle('colors')} />
            {opts.maxP > 0 && (
              <div className="fg price-fg">
                <div className="fg-hd" style={{cursor:'default',pointerEvents:'none'}}>
                  <span className="fg-title">Price Range</span>
                </div>
                <div className="price-body">
                  <div className="price-vals">
                    <span>₱{draftPrice[0].toLocaleString()}</span>
                    <span>₱{draftPrice[1].toLocaleString()}</span>
                  </div>
                  <input type="range" min={opts.minP} max={opts.maxP} step={1000}
                    value={draftPrice[0]}
                    onChange={e=>setDraftPrice([Math.min(+e.target.value, draftPrice[1]-1000), draftPrice[1]])}
                    className="price-slider" />
                  <input type="range" min={opts.minP} max={opts.maxP} step={1000}
                    value={draftPrice[1]}
                    onChange={e=>setDraftPrice([draftPrice[0], Math.max(+e.target.value, draftPrice[0]+1000)])}
                    className="price-slider" />
                </div>
              </div>
            )}

            {/* ── Availability toggle ── */}
            <div className="fg">
              <div className="fg-hd" style={{cursor:'default',pointerEvents:'none'}}>
                <span className="fg-title">Availability</span>
              </div>
              <label className="fg-avail-toggle">
                <span className="fg-lbl">Show sold out &amp; unavailable</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draftShowUnavail}
                  className={`fg-toggle${draftShowUnavail ? ' fg-toggle--on' : ''}`}
                  onClick={() => setDraftShowUnavail(v => !v)}
                >
                  <span className="fg-toggle-thumb" />
                </button>
              </label>
            </div>
          </div>

          {/* ── FitMatcher widget — below filters ── */}
          <FitMatcherBanner user={user} />

          <div className="gp-apply-zone">
            <button className={`gp-apply${dirty?' gp-apply--on':''}`} onClick={apply} type="button" disabled={!dirty}>
              {dirty
                ? `Apply ${draftCount>0 ? `· ${draftCount} filter${draftCount>1?'s':''}` : 'filters'}`
                : appliedCount > 0 ? `${filtered.length} results` : 'No filters yet'}
            </button>
          </div>
        </aside>

        <div className="gp-main">
          <div className="gp-toolbar">
            <span className="gp-count">{loading ? '—' : `${filtered.length} piece${filtered.length!==1?'s':''}`}</span>
            <div className="gp-sort">
              <span className="gp-sort-lbl">Sort by</span>
              <select className="gp-sort-sel" value={sortBy} onChange={e=>setSortBy(e.target.value)}>
                <option value="relevance">Relevance</option>
                <option value="price-asc">Price: Low → High</option>
                <option value="price-desc">Price: High → Low</option>
                <option value="name-asc">Name A–Z</option>
                <option value="name-desc">Name Z–A</option>
              </select>
            </div>
          </div>

          {query.trim() && (
            <div className="gp-chips">
              <span className="gp-chip">Search: "{query}"<button onClick={() => router.replace('/gowns')} aria-label="Clear search">×</button></span>
            </div>
          )}

          {(appliedChips.length > 0 || !appliedShowUnavail) && (
            <div className="gp-chips">
              {appliedChips.map(({v,k}) => (
                <span key={v} className="gp-chip">{v}<button onClick={()=>removeChip(k,v)} aria-label={`Remove ${v}`}>×</button></span>
              ))}
              {!appliedShowUnavail && (
                <span className="gp-chip gp-chip--unavail">
                  Hiding unavailable
                  <button onClick={() => { setDraftShowUnavail(true); setAppliedShowUnavail(true) }} aria-label="Show unavailable">×</button>
                </span>
              )}
              <button className="gp-chips-clr" onClick={clearAll}>Clear all</button>
            </div>
          )}

          {loading ? (
            <div className="gp-grid">{[...Array(6)].map((_,i)=><div key={i} className="gc-sk"/>)}</div>
          ) : error ? (
            <div className="gp-empty"><p>Could not load collection.</p></div>
          ) : filtered.length === 0 ? (
            <div className="gp-empty">
              <p className="gp-empty-h">No gowns match{query.trim() ? ` "${query}"` : ' these filters'}.</p>
              <button className="gp-empty-btn" onClick={() => { clearAll(); router.replace('/gowns') }}>Clear all filters</button>
            </div>
          ) : (
            <div className="gp-grid">
              {filtered.map(g => (
                <GownCard key={g.id} g={g} score={scores[g.id]} />
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        /* ── Availability toggle ── */
        .fg-avail-toggle {
          display: flex; align-items: center; justify-content: space-between;
          padding: 6px 0; cursor: pointer; gap: 8px;
        }
        .fg-toggle {
          flex-shrink: 0; width: 34px; height: 20px; border-radius: 10px;
          background: #ddd; border: none; cursor: pointer; position: relative;
          transition: background 0.2s; padding: 0;
        }
        .fg-toggle--on { background: #7F77DD; }
        .fg-toggle-thumb {
          position: absolute; top: 3px; left: 3px;
          width: 14px; height: 14px; border-radius: 50%;
          background: #fff; transition: left 0.2s;
          box-shadow: 0 1px 3px rgba(0,0,0,.2);
        }
        .fg-toggle--on .fg-toggle-thumb { left: 17px; }

        /* ── Unavailable hidden chip ── */
        .gp-chip--unavail { background: #fff3e0; border-color: #f5a623; color: #a0522d; }
        .gp-chip--unavail button { color: #a0522d; }

        /* ── FitMatcher sidebar widget ── */
        .gp-sb-fm {
          margin: 16px 0 8px;
          padding: 14px;
          background: #f5f0ff;
          border-radius: 10px;
          border: 0.5px solid #AFA9EC;
        }
        .gp-sb-fm--active {
          background: linear-gradient(135deg, #f5f0ff 0%, #eef8f3 100%);
        }
        .gp-sb-fm--guest {
          background: #fafafa;
          border-color: #e5e5e5;
        }
        .gp-sb-fm-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
        }
        .gp-sb-fm-icon  { font-size: 1.1rem; flex-shrink: 0; }
        .gp-sb-fm-title { font-size: 12px; font-weight: 600; color: #3C3489; line-height: 1.3; }
        .gp-sb-fm-meas  { font-size: 11px; color: #7F77DD; margin-top: 1px; }
        .gp-sb-fm-sub   { font-size: 11px; color: #666; line-height: 1.45; margin-bottom: 10px; }
        .gp-sb-fm-btns  { display: flex; gap: 6px; }
        .gp-sb-fm-btn {
          display: block;
          width: 100%;
          text-align: center;
          padding: 8px;
          border-radius: 7px;
          background: #7F77DD;
          color: #fff;
          font-size: 12px;
          font-weight: 500;
          text-decoration: none;
          border: none;
          cursor: pointer;
          margin-top: 4px;
        }
        .gp-sb-fm-btn:hover { background: #534AB7; }
        .gp-sb-fm-btn--ghost {
          background: transparent;
          border: 0.5px solid #AFA9EC;
          color: #534AB7;
          flex: 1;
        }
        .gp-sb-fm-btn--ghost:hover { background: rgba(127,119,221,.08); }
        .gp-sb-fm-btns .gp-sb-fm-btn { flex: 1; margin-top: 0; }
      `}</style>

      <Footer />
    </main>
  )
}

export default function GownsPage() {
  return (
    <Suspense fallback={<main className="gp"><Header solid /><div className="gp-spacer" /><div className="gp-empty"><p>Loading gowns...</p></div><Footer /></main>}>
      <GownsPageContent />
    </Suspense>
  )
}