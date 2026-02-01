'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { useGowns } from '@/hooks/useGowns'

export default function GownsPage() {
  const { gowns, loading, error } = useGowns()
  const [typeFilter, setTypeFilter] = useState('')

  const types = useMemo(() => [...new Set(gowns.map((g) => g.type).filter(Boolean))].sort(), [gowns])
  const filtered = useMemo(() => {
    if (!typeFilter) return gowns
    return gowns.filter((g) => g.type === typeFilter)
  }, [gowns, typeFilter])

  return (
    <main className="gowns-page">
      <Header />
      <section className="gowns-header-spacer" />
      <section className="gowns-hero-simple">
        <div className="container">
          <div className="gowns-hero-inner">
            <h1>Gowns &amp; Dresses</h1>
            <p>Explore our collection of wedding gowns, dresses, and suits.</p>
          </div>
        </div>
      </section>
      <div className="container gowns-catalog-layout">
        <div className="gowns-layout">
          <aside className="gowns-filters">
            <div className="gowns-filters-header">Filters</div>
            <div className="filters-group">
              <div className="filters-group-title">Type</div>
              <div className="filters-options">
                <label className="filter-option">
                  <input
                    type="radio"
                    name="type"
                    checked={!typeFilter}
                    onChange={() => setTypeFilter('')}
                  />
                  <span>All</span>
                </label>
                {types.map((t) => (
                  <label key={t} className="filter-option">
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
          <div className="gowns-results-grid">
            {loading ? (
              <p>Loading gowns…</p>
            ) : error ? (
              <p>{error}</p>
            ) : (
              filtered.map((gown) => (
              <article key={gown.id} className="product-card">
                <Link href={`/gowns/${gown.id}`} className="product-img-wrapper">
                  <img src={gown.image} alt={gown.alt} style={gown.style} />
                </Link>
                <div className="product-info">
                  <h3>{gown.name}</h3>
                  <p className="price">{gown.price}</p>
                  <Link href={`/gowns/${gown.id}`} className="btn btn-primary btn-buy">
                    View Details
                  </Link>
                </div>
              </article>
            ))
            )}
          </div>
        </div>
      </div>
      <Footer />
    </main>
  )
}
