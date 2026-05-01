/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        pg: false,
        crypto: false,
        stream: false,
        os: false,
        path: false,
      }
    }
    return config
  },
}

module.exports = nextConfig