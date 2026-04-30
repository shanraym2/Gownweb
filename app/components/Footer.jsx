'use client'
import { useState, useEffect } from 'react'

export default function Footer() {
  const [content, setContent] = useState({
    brand_name: 'JCE Bridal.',
    instagram:  '#',
    facebook:   '#',
    pinterest:  '#',
    copyright:  '© 2026 JCE Bridal Boutique. All rights reserved.',
})
  useEffect(() => {
    fetch('/api/cms/content?section=footer')
      .then(r => r.json())
      .then(d => { if (d.ok && d.fields) setContent(d.fields) })
      .catch(() => {})
  }, [])
  return (
    <footer>
      <div className="footer-content">
        <div className="brand">{content.brand_name}</div>
        <div className="links">
          <a href={content.instagram}
            {...(content.instagram !== '#' && {
              target: '_blank',
              rel: 'noopener noreferrer',
            })}
          >
            Instagram
          </a>
          <a href={content.facebook}
            {...(content.facebook !== '#' && {
              target: '_blank',
              rel: 'noopener noreferrer',
            })}
          >
            Facebook
          </a>
          <a href={content.pinterest}
            {...(content.pinterest !== '#' && {
              target: '_blank',
              rel: 'noopener noreferrer',
            })}
          >
            Pinterest
          </a>
        </div>
        <p className="copyright">{content.copyright}</p>
      </div>
    </footer>
  )
}
