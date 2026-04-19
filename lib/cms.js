// lib/cms.js — CMS data helpers (mirrors lib/gowns.js pattern)

const USE_DB = process.env.USE_DB === 'true'

// ── Hero Slides ───────────────────────────────────────────────────────────────

export async function getHeroSlides() {
  if (!USE_DB) {
    return [
      { id: 1, image_url: '/images/weds.jpg',   subtitle: 'DESIGNER COLLECTION', heading: 'Your New\nDream Look.',  body: 'JCE Bridal Boutique is your destination for designer and comfortable wedding gowns for your special day.', sort_order: 0 },
      { id: 2, image_url: '/images/image1.png', subtitle: 'LUXURY GOWNS',        heading: 'Timeless\nElegance.',    body: 'From classic silhouettes to modern couture — discover the gown that was made for you.',                    sort_order: 1 },
      { id: 3, image_url: '/images/image2.png', subtitle: 'BRIDAL READY',        heading: 'Walk Down\nIn Style.',   body: 'Every stitch crafted with love. Every detail designed to make you shine on your most beautiful day.',       sort_order: 2 },
    ]
  }
  const { query } = await import('@/lib/db')
  return await query(
    `SELECT * FROM cms_hero_slides WHERE is_active = TRUE ORDER BY sort_order ASC`
  )
}

// ── Testimonials ──────────────────────────────────────────────────────────────

export async function getTestimonials() {
  if (!USE_DB) {
    return [{ id: 1, quote_text: 'I have always had difficulties with buying clothes for every-day wear. Therefore, together with Linda, we decided to create our own brand.', author_name: 'Karina Ayacocho', image_url: '/images/image2.png' }]
  }
  const { query } = await import('@/lib/db')
  return await query(
    `SELECT * FROM cms_testimonials WHERE is_active = TRUE ORDER BY sort_order ASC`
  )
}

// ── Content Block (single section) ───────────────────────────────────────────

export async function getContentBlock(section) {
  if (!USE_DB) {
    const defaults = {
      'about':                { eyebrow_label: 'ABOUT US', heading: 'Comfort and Quality Come First.', body_1: 'JCE Bridal has always dreamed of comfortable women\'s clothing that would look appropriate in any circumstances.', body_2: 'This is how the JCE Bridal brand appeared — it is a brand for women who like to feel confident, seductive, and stylish in any situation.', image_url: '/images/aboutus.png' },
      'collection-spotlight': { eyebrow_label: 'THE COLLECTION', heading: 'Handpicked Elegance' },
      'footer':               { brand_name: 'JCE Bridal.', instagram: '#', facebook: '#', pinterest: '#', copyright: '© 2026 JCE Bridal Boutique. All rights reserved.' },
      'theme-config':         { colors: { navBg: '#1a1a2e', primary: '#c8a96e' }, fonts: { body: 'Jost, sans-serif' } },
    }
    return defaults[section] || {}
  }
  const { query } = await import('@/lib/db')
  const rows = await query(
    `SELECT fields FROM cms_content_blocks WHERE section = $1`, [section]
  )
  return rows[0]?.fields || {}
}