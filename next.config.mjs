/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // In local dev without DATABASE_URL, proxy /api to the Express/SQLite server on :3001
  async rewrites() {
    const plausible = [
      { source: '/ps/script.js', destination: 'http://localhost:3001/js/script.js' },
      { source: '/ps/event',     destination: 'http://localhost:3001/api/event' },
    ];
    if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') return plausible;
    // Dev: skip plausible (localhost:3001 is the legacy Express API in dev, not Plausible)
    return [
      { source: '/api/:path*', destination: 'http://localhost:3001/api/:path*' },
    ];
  },
};

export default nextConfig;
