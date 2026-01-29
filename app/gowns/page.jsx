'use client'

import { useMemo, useState } from 'react'
import Header from '../components/Header'
import Footer from '../components/Footer'
import ProductCard from '../components/ProductCard'
import { GOWNS } from '../data/gowns'

const TYPE_OPTIONS = ['Dresses', 'Gowns', 'Suit']
const COLOR_OPTIONS = ['Ivory', 'Blush', 'Floral', 'Champagne']

export default function GownsPage() {
  const [selectedTypes, setSelectedTypes] = useState([])
  const [selectedColors, setSelectedColors] = useState([])

  const toggleSelection = (value, current, setter) => {
    if (current.includes(value)) {
      setter(current.filter((item) => item !== value))
    } else {
      setter([...current, value])
    }
  }

  const filteredGowns = useMemo(() => {
    return GOWNS.filter((gown) => {
      const typeMatch = selectedTypes.length === 0 || selectedTypes.includes(gown.type)
      const colorMatch = selectedColors.length === 0 || selectedColors.includes(gown.color)
      return typeMatch && colorMatch
    })
  }, [selectedTypes, selectedColors])

  return (
    <main className="gowns-page">
      <Header />

      <section className="gowns-header-spacer" />

      <section className="gowns-hero-simple">
        <div className="container">
          <div className="gowns-hero-inner">
            <span className="subtitle">EVENING & FORMAL</span>
            <h1>Evening & Formal Gowns</h1>
            <p>
              Browse every gown, dress and suit in our curated collection. Refine by type and color to
              find the look that feels most like you.
            </p>
          </div>
        </div>
      </section>

      <section className="gowns-catalog-layout">
        <div className="container gowns-layout">
          <aside className="gowns-filters">
            <div className="gowns-filters-header">
              <span className="filters-label">Filters</span>
              <span className="filters-count">{filteredGowns.length} items</span>
            </div>

            <div className="filters-group">
              <p className="filters-group-title">Type</p>
              <div className="filters-options">
                {TYPE_OPTIONS.map((type) => (
                  <label key={type} className="filter-option">
                    <input
                      type="checkbox"
                      checked={selectedTypes.includes(type)}
                      onChange={() => toggleSelection(type, selectedTypes, setSelectedTypes)}
                    />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="filters-group">
              <p className="filters-group-title">Color</p>
              <div className="filters-options">
                {COLOR_OPTIONS.map((color) => (
                  <label key={color} className="filter-option">
                    <input
                      type="checkbox"
                      checked={selectedColors.includes(color)}
                      onChange={() => toggleSelection(color, selectedColors, setSelectedColors)}
                    />
                    <span>{color}</span>
                  </label>
                ))}
              </div>
            </div>
          </aside>

          <div className="gowns-results">
            <div className="gowns-results-grid">
              {filteredGowns.map((gown, index) => (
                <ProductCard key={gown.id} product={gown} delay={index * 0.05} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}

