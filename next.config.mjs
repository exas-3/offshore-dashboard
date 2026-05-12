/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // In local dev without DATABASE_URL, proxy /api to the Express/SQLite server on :3001
  async rewrites() {
    if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') return [];
    return [
      { source: '/api/:path*', destination: 'http://localhost:3001/api/:path*' },
    ];
  },
};

export default nextConfig;
