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
  async redirects() {
    return [
      { source: '/players/:address', destination: '/criminal/:address', permanent: true },
      { source: '/whales',           destination: '/',                  permanent: true },
      { source: '/companies',        destination: '/',                  permanent: true },
      { source: '/monitor',          destination: '/',                  permanent: true },
      { source: '/vault',            destination: '/',                  permanent: true },
      { source: '/players',          destination: '/',                  permanent: true },
      { source: '/trades',           destination: '/',                  permanent: true },
      { source: '/token',            destination: '/',                  permanent: true },
      { source: '/protocol',         destination: '/',                  permanent: true },
      { source: '/hits',             destination: '/',                  permanent: true },
      { source: '/staking',          destination: '/',                  permanent: true },
      { source: '/leaderboards',     destination: '/',                  permanent: true },
    ];
  },
};

export default nextConfig;
