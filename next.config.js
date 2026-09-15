/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, net: false, tls: false, dns: false,
        pg: false, crypto: false, stream: false, os: false, path: false,
      }
    }
    return config
  },

  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },

  // FIX: CORS headers for /images/* so canvas.drawImage() with
  // crossOrigin='anonymous' doesn't taint the canvas.
  // Without these, the canvas goes opaque and white PNG pixels show through.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security',  value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Frame-Options',            value: 'SAMEORIGIN'                          },
          { key: 'X-Content-Type-Options',     value: 'nosniff'                             },
          { key: 'Referrer-Policy',            value: 'strict-origin-when-cross-origin'     },
          { key: 'Permissions-Policy',         value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
          { key: 'Content-Security-Policy',    value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: blob: https://*.digitaloceanspaces.com",
            "font-src 'self' data: https://fonts.gstatic.com",
            "connect-src 'self' https://*.digitaloceanspaces.com https://api.paymongo.com https://cdn.jsdelivr.net https://storage.googleapis.com",
            "media-src 'self' blob:",
            "worker-src 'self' blob:",
            "frame-src https://checkout.paymongo.com",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "object-src 'none'",
          ].join('; ') },
          { key: 'X-Powered-By',              value: ''                                    },
        ],
      },
      {
        source: '/images/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin',  value: '*'            },
          { key: 'Access-Control-Allow-Methods', value: 'GET'          },
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
        ],
      },
    ]
  },
}

module.exports = nextConfig