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
          { key: 'Permissions-Policy',         value: 'camera=(), microphone=(), geolocation=(), payment=()' },
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