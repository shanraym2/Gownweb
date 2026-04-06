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

// ── Case-insensitive dedup: "A-Line" and "A-line" become one entry ──
// Keeps first-seen casing but normalised (first letter uppercase, rest lower)
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
      silhouettes: uniqueCI(gowns.map(g=>g.silhouette)), // case-insensitive dedup applied here
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

    // All filter comparisons are case-insensitive to match the deduped labels
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
      <style suppressHydrationWarning>{CSS}</style>
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
            <FilterGroup title="Category"   options={opts.categories}   selected={draft.categories}   onToggle={toggle('categories')} />
            <FilterGroup title="Occasion"   options={opts.occasions}    selected={draft.occasions}    onToggle={toggle('occasions')} />
            <FilterGroup title="Gown Type"  options={opts.types}        selected={draft.types}        onToggle={toggle('types')} />
            <FilterGroup title="Silhouette" options={opts.silhouettes}  selected={draft.silhouettes}  onToggle={toggle('silhouettes')} />
            <FilterGroup title="Color"      options={opts.colors}       selected={draft.colors}       onToggle={toggle('colors')} />
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
                <Link key={g.id} href={`/gowns/${g.id}`} className="gc">
                  <div className="gc-img-w">
                    <img src={g.image} alt={g.alt||g.name} className="gc-img" />
                    <div className="gc-ov"><span className="gc-cta">View Details</span></div>
                    {(g.category||g.type) && <span className="gc-badge">{g.category||g.type}</span>}
                    {sortBy==='relevance' && (scores[g.id]||0)>0 && <span className="gc-rec" title="Recommended for you"/>}
                  </div>
                  <div className="gc-info">
                    <p className="gc-name">{g.name}</p>
                    <div className="gc-row2">
                      <span className="gc-price">{g.price}</span>
                      {g.silhouette && <span className="gc-sil">{g.silhouette}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
      <Footer />
    </main>
  )
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Jost:wght@200;300;400&display=swap');
.gp{--iv:#faf7f4;--ch:#f0e6d3;--bl:#d4a5a0;--es:#2c1a10;--wb:#6b3f2a;--mu:#9b8880;--go:#c9a96e;background:var(--iv);font-family:'Jost',sans-serif;color:var(--es);}
.gp-spacer{height:80px;}
.gp-banner{background:var(--es);padding:56px clamp(1.5rem,6vw,5rem) 48px;}
.gp-banner-in{max-width:580px;}
.gp-eye{font-size:9px;letter-spacing:.4em;text-transform:uppercase;color:var(--go);margin:0 0 14px;}
.gp-h1{font-family:'Cormorant Garamond',serif;font-size:clamp(2.6rem,5.5vw,4.2rem);font-weight:300;color:var(--iv);margin:0 0 14px;line-height:1.05;}
.gp-h1 em{font-style:italic;color:var(--go);}
.gp-sub{font-size:13px;font-weight:300;color:rgba(250,247,244,.5);margin:0;line-height:1.8;}
.gp-body{display:grid;grid-template-columns:256px 1fr;max-width:1440px;margin:0 auto;padding:0 clamp(1.5rem,4vw,4rem);}
.gp-sidebar{border-right:1px solid var(--ch);padding:36px 28px 40px 0;position:sticky;top:80px;height:calc(100vh - 80px);overflow-y:auto;scrollbar-width:none;display:flex;flex-direction:column;}
.gp-sidebar::-webkit-scrollbar{display:none;}
.gp-sb-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;}
.gp-sb-title{font-size:10px;letter-spacing:.35em;text-transform:uppercase;color:var(--es);}
.gp-sb-clear{background:none;border:none;font-family:'Jost',sans-serif;font-size:10px;color:var(--bl);cursor:pointer;padding:0;letter-spacing:.08em;transition:color .2s;}
.gp-sb-clear:hover{color:var(--wb);}
.gp-fgroups{flex:1;}
.fg{border-bottom:1px solid var(--ch);}
.fg-hd{display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:none;padding:14px 0;font-family:'Jost',sans-serif;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--es);cursor:pointer;text-align:left;}
.fg-right{display:flex;align-items:center;gap:6px;}
.fg-badge{background:var(--es);color:var(--iv);font-size:8px;padding:1px 6px;border-radius:10px;}
.fg-chev{transition:transform .2s;}
.fg-chev.open{transform:rotate(180deg);}
.fg-list{list-style:none;padding:2px 0 16px;margin:0;display:flex;flex-direction:column;gap:10px;}
.fg-opt{display:flex;align-items:center;gap:10px;cursor:pointer;}
.fg-opt input{display:none;}
.fg-box{width:15px;height:15px;border:1px solid rgba(44,26,16,.22);flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s;}
.fg-box.on{background:var(--es);border-color:var(--es);}
.fg-lbl{font-size:12px;color:var(--es);letter-spacing:.03em;}
.price-fg .fg-hd{cursor:default!important;}
.price-body{padding-bottom:16px;}
.price-vals{display:flex;justify-content:space-between;font-family:'Cormorant Garamond',serif;font-size:15px;color:var(--wb);margin-bottom:12px;}
.price-slider{width:100%;-webkit-appearance:none;height:2px;background:var(--ch);outline:none;margin-bottom:8px;cursor:pointer;}
.price-slider::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;background:var(--es);cursor:pointer;}
.gp-apply-zone{padding-top:20px;margin-top:auto;border-top:1px solid var(--ch);}
.gp-apply{width:100%;padding:13px 20px;font-family:'Jost',sans-serif;font-size:10px;letter-spacing:.25em;text-transform:uppercase;border:1px solid rgba(44,26,16,.15);background:transparent;color:rgba(44,26,16,.3);cursor:not-allowed;transition:all .25s;}
.gp-apply--on{background:var(--es);color:var(--iv);border-color:var(--es);cursor:pointer;animation:apulse .35s ease;}
.gp-apply--on:hover{background:var(--wb);}
@keyframes apulse{0%{transform:scale(1)}50%{transform:scale(1.015)}100%{transform:scale(1)}}
.gp-main{padding:36px 0 72px 40px;}
.gp-toolbar{display:flex;align-items:center;justify-content:space-between;padding-bottom:18px;border-bottom:1px solid var(--ch);margin-bottom:20px;}
.gp-count{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--mu);}
.gp-sort{display:flex;align-items:center;gap:10px;}
.gp-sort-lbl{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--mu);}
.gp-sort-sel{font-family:'Jost',sans-serif;font-size:11px;color:var(--es);background:transparent;border:1px solid var(--ch);padding:6px 10px;cursor:pointer;outline:none;}
.gp-sort-sel:focus{border-color:var(--wb);}
.gp-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:20px;align-items:center;}
.gp-chip{display:inline-flex;align-items:center;gap:6px;background:var(--es);color:var(--iv);font-size:9px;letter-spacing:.15em;text-transform:uppercase;padding:5px 8px 5px 12px;}
.gp-chip button{background:none;border:none;color:rgba(250,247,244,.5);cursor:pointer;font-size:15px;line-height:1;padding:0;transition:color .15s;}
.gp-chip button:hover{color:var(--iv);}
.gp-chips-clr{background:none;border:none;font-family:'Jost',sans-serif;font-size:10px;color:var(--bl);cursor:pointer;letter-spacing:.1em;margin-left:4px;padding:0;}
.gp-chips-clr:hover{color:var(--wb);}
.gp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;}
@media(max-width:1200px){.gp-grid{grid-template-columns:repeat(2,1fr);}}
@media(max-width:560px){.gp-grid{grid-template-columns:1fr;}}
.gc{display:block;text-decoration:none;color:inherit;}
.gc-img-w{position:relative;overflow:hidden;aspect-ratio:3/4;background:var(--ch);}
.gc-img{width:100%;height:100%;object-fit:cover;object-position:top;display:block;transition:transform .7s cubic-bezier(.25,.46,.45,.94);}
.gc:hover .gc-img{transform:scale(1.05);}
.gc-ov{position:absolute;inset:0;background:rgba(44,26,16,0);display:flex;align-items:flex-end;padding:20px;transition:background .35s;}
.gc:hover .gc-ov{background:rgba(44,26,16,.3);}
.gc-cta{font-size:9px;letter-spacing:.3em;text-transform:uppercase;color:var(--iv);background:var(--es);padding:8px 16px;opacity:0;transform:translateY(8px);transition:opacity .3s,transform .3s;}
.gc:hover .gc-cta{opacity:1;transform:translateY(0);}
.gc-badge{position:absolute;top:12px;left:12px;background:rgba(250,247,244,.92);backdrop-filter:blur(4px);font-size:8px;letter-spacing:.3em;text-transform:uppercase;color:var(--wb);padding:4px 10px;}
.gc-rec{position:absolute;top:12px;right:12px;width:8px;height:8px;border-radius:50%;background:var(--go);}
.gc-info{padding:14px 12px 16px;border-bottom:1px solid var(--ch);}
.gc-name{font-family:'Cormorant Garamond',serif;font-size:17px;font-weight:300;color:var(--es);margin:0 0 5px;}
.gc-row2{display:flex;align-items:center;justify-content:space-between;}
.gc-price{font-family:'Cormorant Garamond',serif;font-size:15px;color:var(--wb);}
.gc-sil{font-size:9px;letter-spacing:.15em;text-transform:uppercase;color:var(--mu);}
.gp-empty{padding:80px 0;text-align:center;}
.gp-empty-h{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:300;margin-bottom:16px;}
.gp-empty-btn{background:var(--es);color:var(--iv);border:none;font-family:'Jost',sans-serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;padding:12px 28px;cursor:pointer;}
.gc-sk{aspect-ratio:3/4;background:var(--ch);animation:sk 1.6s ease-in-out infinite alternate;}
@keyframes sk{from{opacity:.4}to{opacity:1}}
@media(max-width:860px){
  .gp-body{grid-template-columns:1fr;padding:0 1.25rem;}
  .gp-sidebar{position:static;height:auto;border-right:none;border-bottom:1px solid var(--ch);padding:24px 0;}
  .gp-main{padding:28px 0 48px;}
}
`