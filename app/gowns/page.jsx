'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { useGowns } from '@/hooks/useGowns'

export default function GownsPage() {
  const { gowns, loading, error } = useGowns()
  const [typeFilter, setTypeFilter] = useState('')
  const [sortBy, setSortBy] = useState('default')

  const types = useMemo(
    () => [...new Set(gowns.map((g) => g.type).filter(Boolean))].sort(),
    [gowns]
  )

  const filtered = useMemo(() => {
    let result = typeFilter
      ? gowns.filter((g) => g.type === typeFilter)
      : [...gowns]

    if (sortBy === 'name-asc')
      result.sort((a, b) => a.name.localeCompare(b.name))

    if (sortBy === 'name-desc')
      result.sort((a, b) => b.name.localeCompare(a.name))

    return result
  }, [gowns, typeFilter, sortBy])

  return (
    <main className="gowns-page">
      <Header solid />
      <section className="gowns-header-spacer" />

      {/* Hero */}
      <section className="gowns-hero">
        <div className="container">
          <span className="gowns-hero-label">
            FitMatcher — JCE Bridal Boutique
          </span>

          <h1 className="gowns-hero-title">
            Gowns &amp; <em>Dresses</em>
          </h1>

          <p className="gowns-hero-sub">
            Each piece is selected for its artistry. Find your silhouette, then
            let FitMatcher guide you to your perfect size and style.
          </p>

          <div className="gowns-hero-rule" />

          {!loading && (
            <p className="gowns-count">
              {filtered.length} piece{filtered.length !== 1 ? 's' : ''} in collection
            </p>
          )}
        </div>
      </section>

      {/* Catalog */}
      <section className="gowns-catalog">
        <div className="container gowns-layout">

          {/* Sidebar */}
          <aside className="gowns-sidebar">
            <p className="sidebar-title">Refine</p>

            <div className="filter-group">
              <p className="filter-label">Category</p>

              <div className="filter-options">
                <label>
                  <input
                    type="radio"
                    name="type"
                    checked={!typeFilter}
                    onChange={() => setTypeFilter('')}
                  />
                  <span>All pieces</span>
                </label>

                {types.map((t) => (
                  <label key={t}>
                    <input
                      type="radio"
                      name="type"
                      checked={typeFilter === t}
                      onChange={() => setTypeFilter(t)}
                    />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
            </div>
          </aside>

          {/* Main */}
          <div>
            <div className="gowns-toolbar">
              <span>
                {loading
                  ? '—'
                  : `${filtered.length} result${
                      filtered.length !== 1 ? 's' : ''
                    }`}
              </span>

              <div>
                <span>Sort </span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <option value="default">Featured</option>
                  <option value="name-asc">Name A–Z</option>
                  <option value="name-desc">Name Z–A</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div className="gowns-grid">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="skeleton-card" />
                ))}
              </div>
            ) : error ? (
              <div className="empty-state">
                <h2>Something went wrong</h2>
                <p>{error}</p>
              </div>
            ) : (
              <div className="gowns-grid">
                {filtered.map((gown) => (
                  <Link
                    key={gown.id}
                    href={`/gowns/${gown.id}`}
                    className="gown-card"
                  >
                    <div className="gown-image">
                      <img src={gown.image} alt={gown.name} />
                      {gown.type && (
                        <span className="gown-badge">{gown.type}</span>
                      )}
                    </div>

                    <div className="gown-info">
                      <h3>{gown.name}</h3>
                      <p>{gown.price}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}