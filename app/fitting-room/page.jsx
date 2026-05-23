'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { getCurrentUser } from '../utils/authClient'

import { FittingRoomProvider, useFittingRoom } from './FittingRoomProvider'
import ProfileSidebar from './components/ProfileSidebar'
import ScanPanel  from './panels/ScanPanel'
import SizePanel  from './panels/SizePanel'
import StylePanel from './panels/StylePanel'
import TryOnPanel from './panels/TryOnPanel'


// ─────────────────────────────────────────────────────────────────────────────
// PANEL DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

const PANELS = [
  { id: 'scan',  label: 'Scan',   sub: 'Measure & detect' },
  { id: 'size',  label: 'Size',   sub: 'Find your fit'    },
  { id: 'style', label: 'Style',  sub: 'Gown matches'     },
  { id: 'tryon', label: 'Try On', sub: 'See it on you'    },
]

// ─────────────────────────────────────────────────────────────────────────────
// SKELETON LOADER
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonLoader() {
  return (
    <main style={{ minHeight: '100vh', background: '#faf9f7' }}>
      <div style={{ height: '72px', background: '#1a1108' }}/>
      <div style={{ background: '#1a1108', padding: '2.5rem 1.5rem 2rem' }}>
        <div className="sk-line" style={{ width: '80px', height: '10px', marginBottom: '12px' }}/>
        <div className="sk-line" style={{ width: '340px', height: '36px', marginBottom: '12px' }}/>
        <div className="sk-line" style={{ width: '420px', height: '13px' }}/>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', maxWidth: '1160px', margin: '0 auto' }}>
        <div style={{ padding: '1.25rem', borderRight: '1px solid #eee', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="sk-line" style={{ height: '14px', width: '80px' }}/>
          <div className="sk-line" style={{ height: '80px' }}/>
          <div className="sk-line" style={{ height: '60px' }}/>
        </div>
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="sk-line" style={{ flex: 1, height: '72px', borderRadius: '8px' }}/>
            ))}
          </div>
          <div className="sk-line" style={{ height: '320px', borderRadius: '10px' }}/>
        </div>
      </div>
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// INNER — consumes context, owns page-level state
// ─────────────────────────────────────────────────────────────────────────────

function FittingRoomInner() {
  const searchParams = useSearchParams()
  const gownId       = searchParams.get('gown')
  const { profile, sizeResult, updateProfile } = useFittingRoom()

  const [activePanel, setActivePanel] = useState(gownId ? 'tryon' : 'scan')
  const [mounted,     setMounted    ] = useState(false)
  const [saving,      setSaving     ] = useState(false)
  const [saveMsg,     setSaveMsg    ] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const user = mounted ? getCurrentUser() : null

  const [cmsContent, setCmsContent] = useState({
    heading:    'My Fitting Room',
    subheading: 'Find your size, match your style, try on virtually.',
  })

  useEffect(() => {
    fetch('/api/cms/content?section=fitting-room')
      .then(r => r.json())
      .then(d => { if (d.ok && d.fields) setCmsContent(prev => ({ ...prev, ...d.fields })) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setMounted(true)
    const u = getCurrentUser()
    if (!u) return

    fetch('/api/measurements', { headers: { 'x-user-id': u.id } })
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.measurements) {
          const m = d.measurements
          updateProfile({
            bust: m.bust_cm, waist: m.waist_cm, hips: m.hips_cm,
            height: m.height_cm, weight: m.weight_kg, source: m.source,
          })
        }
      }).catch(() => {})

    fetch('/api/auth/style-prefs', { headers: { 'x-user-id': u.id } })
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.prefs) {
          const p = d.prefs
          updateProfile({
            bodyShape: p.bodyType || null,
            skinTone:  p.skinTone || null,
            occasion:  p.styleTags?.[0] || null,
            colors:    p.preferredColors || [],
          })
        }
      }).catch(() => {})
  }, [updateProfile])

  const saveProfile = useCallback(async () => {
    if (!user || !profile) return
    setSaving(true); setSaveMsg('')
    try {
      const [measRes, styleRes] = await Promise.all([
        fetch('/api/measurements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
          body: JSON.stringify({
            bust_cm: profile.bust ?? null, waist_cm: profile.waist ?? null,
            hips_cm: profile.hips ?? null, height_cm: profile.height ?? null,
            weight_kg: profile.weight ?? null, source: profile.source ?? 'manual',
          }),
        }).then(r => r.json()),
        fetch('/api/auth/save-style-prefs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
          body: JSON.stringify({
            bodyType:            profile.bodyShape || null,
            skinTone:            profile.skinTone  || null,
            styleTags:           profile.occasion ? [profile.occasion] : [],
            preferredSilhouettes:[],
            preferredColors:     profile.colors || [],
          }),
        }).then(r => r.json()),
      ])
      setSaveMsg(measRes.ok && styleRes.ok ? '✓ Profile saved' : (measRes.error || styleRes.error || 'Save failed'))
    } catch {
      setSaveMsg('Could not save. Check connection.')
    } finally {
      setSaving(false)
    }
  }, [user, profile])

  if (!mounted) return null

  return (
    <main className="fr-page">
      <Header solid/>
      <div className="fr-spacer"/>

      <section className="fr-hero">
        <div className="fr-hero-inner">
          <span className="fr-eyebrow">Fitting Room</span>
          <h1 className="fr-h1">{cmsContent.heading}</h1>
          <p className="fr-hero-sub">{cmsContent.subheading}</p>
        </div>
      </section>

      <div className={`fr-layout${sidebarOpen ? '' : ' fr-layout--collapsed'}`}>
        <ProfileSidebar
          user={user}
          onSave={saveProfile}
          saving={saving}
          saveMsg={saveMsg}
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(v => !v)}
        />

        <div className="fr-main">
          <nav className="fr-panel-nav" aria-label="Fitting room sections">
            {PANELS.map((p, i) => {
              const isActive = activePanel === p.id
              const hasBadge = (p.id === 'size' && sizeResult?.size) || (p.id === 'scan' && profile.bust)
              return (
                <button
                  key={p.id}
                  className={`fr-panel-tab${isActive ? ' active' : ''}`}
                  onClick={() => setActivePanel(p.id)}
                  aria-selected={isActive}
                  role="tab"
                >
                  <span className="fr-tab-step">{i + 1}</span>
                  <div className="fr-tab-text">
                    <span className="fr-tab-label">{p.label}</span>
                    <span className="fr-tab-sub">{p.sub}</span>
                  </div>
                  {hasBadge && (
                    <span className="fr-panel-badge">
                      {p.id === 'size' ? sizeResult.size.label : 'Done'}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>

          <div className="fr-panel-body" role="tabpanel">
            {activePanel === 'scan'  && <ScanPanel/>}
            {activePanel === 'size'  && <SizePanel/>}
            {activePanel === 'style' && <StylePanel/>}
            {activePanel === 'tryon' && <TryOnPanel initialGownId={gownId}/>}
          </div>
        </div>
      </div>

      <Footer/>
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export default function FittingRoomPage() {
  const [gowns,        setGowns       ] = useState([])
  const [sizes,        setSizes       ] = useState([])
  const [supplierName, setSupplierName] = useState('')
  const [ready,        setReady       ] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/gowns')
        .then(r => r.json())
        .then(d => setGowns((d.gowns || []).filter(g => g.image)))
        .catch(() => {}),
      fetch('/api/size-chart?segment=women')
        .then(r => r.json())
        .then(d => { if (d.ok) { setSizes(d.sizes); setSupplierName(d.supplierName || '') } })
        .catch(() => {}),
    ]).finally(() => setReady(true))
  }, [])

  if (!ready) return <SkeletonLoader/>

  return (
    <FittingRoomProvider gowns={gowns} initialSizes={sizes} initialSupplierName={supplierName}>
      <FittingRoomInner/>
    </FittingRoomProvider>
  )
}