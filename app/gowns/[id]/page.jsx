'use client'

import Header from '../../components/Header'
import Footer from '../../components/Footer'
import ProductCard from '../../components/ProductCard'
import { GOWNS, getGownById } from '../../data/gowns'
import { addToCart } from '../../utils/cartClient'
import { useRouter } from 'next/navigation'

export default function GownDetailPage({ params }) {
  const id = Number(params.id)
  const gown = getGownById(id)
  const router = useRouter()

  if (!gown) {
    return (
      <main className="gowns-page">
        <Header />
        <section className="gowns-header-spacer" />
        <section className="gown-detail">
          <div className="container">
            <p>Sorry, this gown could not be found.</p>
          </div>
        </section>
        <Footer />
      </main>
    )
  }

  const related = GOWNS.filter(
    (item) =>
      item.id !== gown.id &&
      (item.type === gown.type ||
        item.color === gown.color ||
        (item.silhouette && item.silhouette === gown.silhouette))
  ).slice(0, 3)

  const handleAddToCart = () => {
    if (!gown?.id) return
    addToCart(gown.id)
    router.push('/cart')
  }

  return (
    <main className="gowns-page">
      <Header />

      <section className="gowns-header-spacer" />

      <section className="gown-detail">
        <div className="container gown-detail-layout">
          <div className="gown-detail-image-wrapper">
            <img src={gown.image} alt={gown.alt} className="gown-detail-image" />
          </div>

          <div className="gown-detail-info">
            <span className="subtitle">Gown Details</span>
            <h1>{gown.name}</h1>
            <p className="gown-detail-price">{gown.price}</p>

            <p className="gown-detail-description">{gown.description}</p>

            <div className="gown-detail-meta">
              <p>
                <strong>Type:</strong> {gown.type}
              </p>
              <p>
                <strong>Color:</strong> {gown.color}
              </p>
              {gown.silhouette && (
                <p>
                  <strong>Silhouette:</strong> {gown.silhouette}
                </p>
              )}
            </div>

            <p className="gown-detail-note">
              To check availability, sizing, or customization options for this style, please contact JCE Bridal
              directly through our contact form or social channels.
            </p>

            <div className="gown-detail-actions">
              <button type="button" className="btn btn-primary" onClick={handleAddToCart}>
                Add to Cart
              </button>
            </div>
          </div>
        </div>
      </section>

      {related.length > 0 && (
        <section className="gown-recommendations">
          <div className="container">
            <div className="gown-recommendations-header">
              <span className="subtitle">You may also love</span>
              <h2>Similar Styles</h2>
            </div>
            <div className="gown-recommendations-grid">
              {related.map((item, index) => (
                <ProductCard key={item.id} product={item} delay={index * 0.05} />
              ))}
            </div>
          </div>
        </section>
      )}

      <Footer />
    </main>
  )
}

