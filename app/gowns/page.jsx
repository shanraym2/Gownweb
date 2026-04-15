'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { useGowns } from '@/hooks/useGowns'

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

// ── Determine if a gown is fully sold out ─────────────────────────────────────
// sizeStock is an array of { size, stock }. A gown is sold out only when
// every size has stock === 0. Unknown stock (null) is treated as available.
function isGownSoldOut(g) {
  const ss = g.sizeStock
  if (!ss || ss.length === 0) return false
  return ss.every(s => s.stock === 0)
}

// ── Grid card ─────────────────────────────────────────────────────────────────

function GownCard({ g, score }) {
  const soldOut   = isGownSoldOut(g)
  const isRec     = (score || 0) > 0
  const badgeText = g.category || g.type

  return (
    <Link href={`/gowns/${g.id}`} className={`gc${soldOut ? ' gc--soldout' : ''}`}>
      <div className="gc-img-w">
        <img
          src={g.image}
          alt={g.alt || g.name}
          className={`gc-img${soldOut ? ' gc-img--grey' : ''}`}
        />

        {/* Sold-out overlay — greyscale is on the img, badge sits on top */}
        {soldOut ? (
          <div className="gc-soldout-overlay">
            <span className="gc-soldout-badge">Sold Out</span>
          </div>
        ) : (
          <div className="gc-ov">
            <span className="gc-cta">View Details</span>
          </div>
        )}

        {badgeText && (
          <span className={`gc-badge${soldOut ? ' gc-badge--dim' : ''}`}>
            {badgeText}
          </span>
        )}

        {/* Relevance dot — only on in-stock items */}
        {isRec && !soldOut && (
          <span className="gc-rec" title="Recommended for you" />
        )}
      </div>

      <div className="gc-info">
        <p className={`gc-name${soldOut ? ' gc-name--dim' : ''}`}>{g.name}</p>
        <div className="gc-row2">
          <span className={`gc-price${soldOut ? ' gc-price--dim' : ''}`}>{g.price}</span>
          {g.silhouette && <span className="gc-sil">{g.silhouette}</span>}
          {soldOut && <span className="gc-sold-label">Sold out</span>}
        </div>
      </div>
    </Link>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GownsPage() {
  const { gowns, loading, error } = useGowns()
  const searchParams = useSearchParams()
  const query        = searchParams.get('search') ?? ''
  const router       = useRouter()

  const [draft,        setDraft       ] = useState(EMPTY)
  const [applied,      setApplied     ] = useState(EMPTY)
  const [draftPrice,   setDraftPrice  ] = useState([0, 200000])
  const [appliedPrice, setAppliedPrice] = useState(null)
  const [sortBy,       setSortBy      ] = useState('relevance')
  const [scores,       setScores      ] = useState({})
  const [dirty,        setDirty       ] = useState(false)

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
      JSON.stringify(draftPrice) !== JSON.stringify(appliedPrice ?? [opts.minP, opts.maxP])
  }, [draft, applied, draftPrice, appliedPrice, opts])

  useEffect(() => { setDirty(isDirty) }, [isDirty])

  const toggle = key => val =>
    setDraft(p => ({ ...p, [key]: p[key].includes(val) ? p[key].filter(v=>v!==val) : [...p[key], val] }))

  const apply = () => { setApplied({...draft}); setAppliedPrice([...draftPrice]); setDirty(false) }

  const clearAll = () => {
    setDraft(EMPTY); setApplied(EMPTY)
    setDraftPrice([opts.minP, opts.maxP]); setAppliedPrice(null)
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
    if (sortBy==='relevance')  r.sort((a,b)=>(scores[b.id]||0)-(scores[a.id]||0))
    if (sortBy==='price-asc')  r.sort((a,b)=>parsePrice(a.price)-parsePrice(b.price))
    if (sortBy==='price-desc') r.sort((a,b)=>parsePrice(b.price)-parsePrice(a.price))
    if (sortBy==='name-asc')   r.sort((a,b)=>a.name.localeCompare(b.name))
    if (sortBy==='name-desc')  r.sort((a,b)=>b.name.localeCompare(a.name))
    return r
  }, [gowns, applied, appliedPrice, sortBy, scores, query])

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
          </div>
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

          {appliedChips.length > 0 && (
            <div className="gp-chips">
              {appliedChips.map(({v,k}) => (
                <span key={v} className="gp-chip">{v}<button onClick={()=>removeChip(k,v)} aria-label={`Remove ${v}`}>×</button></span>
              ))}
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
      <Footer />
    </main>
  )
}