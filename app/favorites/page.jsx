'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import Footer from '../components/Footer'
import HeartButton from '../components/HeartButton'
import { useGowns, getGownById } from '../../hooks/useGowns'
import { useFavorites } from '../../hooks/useFavorites'
import { getCurrentUser } from '../../app/utils/authClient'

export default function FavoritesPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState(null)   // null = checking

  useEffect(() => {
    const u = getCurrentUser()
    if (!u) { router.replace('/login?redirect=/favorites'); return }
    setAuthed(true)
  }, [router])

  const { gowns, loading: gownsLoading } = useGowns()
  const { favoriteIds, loading: favsLoading } = useFavorites()

  const loading = gownsLoading || favsLoading || authed === null

  const favorites = gowns.filter(g => favoriteIds.has(String(g.id)))

  if (authed === null || loading) {
    return (
      <main>
        <Header solid />
        <div style={{ height: 80 }} />
        <div style={{ padding: '4rem 2rem', textAlign: 'center', color: '#aaa', fontSize: 14 }}>
          Loading…
        </div>
        <Footer />
      </main>
    )
  }

  return (
    <main className="fav-page">
      <Header solid />
      <div className="fav-spacer" />

      <section className="fav-banner">
        <div className="fav-banner-in">
          <p className="fav-eye">Your collection</p>
          <h1 className="fav-h1">Saved Gowns</h1>
          <p className="fav-sub">
            {favorites.length === 0
              ? 'Heart any gown to save it here.'
              : `${favorites.length} piece${favorites.length !== 1 ? 's' : ''} saved`}
          </p>
        </div>
      </section>

      <section className="fav-body container">
        {favorites.length === 0 ? (
          <div className="fav-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            <p className="fav-empty-h">Nothing saved yet</p>
            <p className="fav-empty-s">
              Browse our catalogue and tap the heart on any gown you love.
            </p>
            <Link href="/gowns" className="fav-browse-btn">Browse collection →</Link>
          </div>
        ) : (
          <div className="fav-grid">
            {favorites.map(g => (
              <FavCard key={g.id} g={g} />
            ))}
          </div>
        )}
      </section>

      <Footer />

      <style>{`
        /* ── Page shell ── */
        .fav-page {
          min-height: 100vh;
          background: #faf7f4;
          font-family: 'Jost', sans-serif;
          color: #2c2420;
          width: 100%;
        }
        .fav-page *, .fav-page *::before, .fav-page *::after { box-sizing: border-box; }
        .fav-spacer { height: 80px; }

        /* ── Hero — dark, matches mo-hero ── */
        .fav-banner {
          width: 100%;
          background: #1a0f0a;
          padding: 28px clamp(1.25rem, 5vw, 4rem) 24px;
          border-bottom: 1px solid rgba(201,169,110,.12);
        }
        .fav-banner-in { max-width: 1040px; margin: 0 auto; }

        .fav-eye {
          font-family: 'Jost', sans-serif;
          font-size: 10px;
          letter-spacing: .42em;
          text-transform: uppercase;
          color: #c9a96e;
          display: block;
          margin-bottom: 10px;
          font-weight: 600;
        }
        .fav-h1 {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(2.2rem, 4.5vw, 3.4rem);
          font-weight: 300;
          color: #fff;
          margin: 0 0 10px;
          line-height: 1.06;
          letter-spacing: .02em;
        }
        .fav-sub {
          font-size: 12px;
          font-weight: 300;
          color: rgba(255,255,255,.4);
          margin: 0;
          line-height: 1.9;
        }

        /* ── Body ── */
        .fav-body {
          width: 100%;
          max-width: 1040px;
          margin: 0 auto;
          padding: 20px clamp(1rem, 4vw, 3rem) 40px;
        }

        /* ── Grid ── */
        .fav-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 0.875rem;

        }

        /* ── Card ── */
        .fav-card {
          display: flex;
          flex-direction: column;
          text-decoration: none;
          color: inherit;
          background: #fff;
          border: 1px solid #e8ddd6;
          border-radius: 16px;
          overflow: hidden;
          transition: box-shadow .2s, border-color .2s;
        }
        .fav-card:hover {
          border-color: #ccc2bb;
          box-shadow: 0 2px 16px rgba(26,15,10,.07);
        }

        .fav-card-img-w {
          position: relative;
          aspect-ratio: 3/4;
          overflow: hidden;
          background: #f0e4db;
        }
        .fav-card-img {
          width: 100%; height: 100%;
          object-fit: cover;
          display: block;
          transition: transform .35s ease;
        }
        .fav-card:hover .fav-card-img { transform: scale(1.03); }

        .fav-card-heart {
          position: absolute;
          top: 10px; right: 10px;
          z-index: 2;
        }

        .fav-card-ov {
          position: absolute; inset: 0;
          background: rgba(0,0,0,0);
          display: flex; align-items: flex-end; justify-content: center;
          padding-bottom: 14px;
          transition: background .25s;
        }
        .fav-card:hover .fav-card-ov { background: rgba(26,15,10,.18); }

        .fav-card-cta {
          opacity: 0; transform: translateY(6px);
          transition: opacity .2s, transform .2s;
          background: rgba(255,255,255,0.92);
          color: #2c2420;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: .14em;
          text-transform: uppercase;
          padding: 8px 20px;
          border-radius: 999px;
          backdrop-filter: blur(4px);
        }
        .fav-card:hover .fav-card-cta { opacity: 1; transform: translateY(0); }

        .fav-card-badge {
          position: absolute; top: 10px; left: 10px;
          background: rgba(255,255,255,0.88);
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: .1em;
          text-transform: uppercase;
          padding: 4px 10px;
          border-radius: 999px;
          color: #2c2420;
          backdrop-filter: blur(2px);
        }

        .fav-card-info { padding: 10px 12px 12px; }
        .fav-card-name {
          font-size: 13px;
          font-weight: 400;
          margin: 0 0 5px;
          line-height: 1.35;
          color: #2c2420;
        }
        .fav-card-price {
          font-size: 12px;
          color: #9a7e72;
          font-weight: 300;
        }

        /* ── Empty state ── */
        .fav-empty {
          text-align: center;
          padding: 40px 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .fav-empty-h {
          font-family: 'Cormorant Garamond', serif;
          font-size: 1.9rem;
          font-weight: 300;
          color: #2c2420;
          margin: 0;
        }
        .fav-empty-s {
          font-size: 13px;
          color: #9a7e72;
          max-width: 320px;
          line-height: 1.8;
          margin: 0;
        }
        .fav-browse-btn {
          margin-top: 8px;
          display: inline-block;
          padding: 12px 28px;
          background: #1a0f0a;
          color: #fff;
          font-family: 'Jost', sans-serif;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .3em;
          text-transform: uppercase;
          border: none;
          cursor: pointer;
          text-decoration: none;
          border-radius: 999px;
          transition: background .2s;
        }
        .fav-browse-btn:hover { background: #6b3f2a; }

        /* ── Responsive ── */
        @media (max-width: 768px) {
          .fav-body { padding: 16px 1rem 32px; }
          .fav-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; }
        }
        @media (max-width: 480px) {
          .fav-grid { grid-template-columns: 1fr 1fr; gap: .75rem; }
        }
      `}</style>
    </main>
  )
}

function FavCard({ g }) {
  const soldOut = g.sizeStock?.length > 0 && g.sizeStock.every(s => s.stock === 0)
  return (
    <Link href={`/gowns/${g.id}`} className="fav-card">
      <div className="fav-card-img-w">
        <img src={g.image} alt={g.alt || g.name} className="fav-card-img" />
        <div className="fav-card-ov">
          <span className="fav-card-cta">View Details</span>
        </div>
        {(g.category || g.type) && (
          <span className="fav-card-badge">{g.category || g.type}</span>
        )}
        <div className="fav-card-heart">
          <HeartButton gownId={g.id} size="sm" redirectPath="/favorites" />
        </div>
      </div>
      <div className="fav-card-info">
        <p className="fav-card-name">{g.name}</p>
        <p className="fav-card-price">{soldOut ? 'Sold out · ' : ''}{g.price}</p>
      </div>
    </Link>
  )
}