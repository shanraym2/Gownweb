import './globals.css'

const DEFAULTS = {
  title:       'JCE Bridal Boutique | Luxury Wedding Gowns',
  description: 'Discover your dream wedding look at JCE Bridal Boutique. Designer collections, comfort, and elegance.',
  ogImage:     '/images/og-default.jpg',
}

export async function generateMetadata() {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    const res  = await fetch(`${base}/api/cms/content?section=global-seo`, {
      next: { revalidate: 300 },
    })
    const data = await res.json()
    if (data?.ok) {
      const f = data.fields || {}
      const title       = f.site_name ? `${f.site_name} | Luxury Wedding Gowns` : DEFAULTS.title
      const description = f.meta_desc || DEFAULTS.description
      const ogImage     = f.og_image  || DEFAULTS.ogImage
      return {
        title,
        description,
        openGraph: { title, description, images: [{ url: ogImage }] },
      }
    }
  } catch {
    // fetch failed — fall through to defaults
  }

  return {
    title:       DEFAULTS.title,
    description: DEFAULTS.description,
    openGraph: {
      title:       DEFAULTS.title,
      description: DEFAULTS.description,
      images:      [{ url: DEFAULTS.ogImage }],
    },
  }
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}