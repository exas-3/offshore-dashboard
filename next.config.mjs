/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // In local dev without DATABASE_URL, proxy /api to the Express/SQLite server on :3001
  async rewrites() {
    const plausible = [
      { source: '/ps/script.js', destination: 'https://plausible.io/js/pa-pvmdShSyRP77Pz6QfiEXk.js' },
      { source: '/ps/event',     destination: 'https://plausible.io/api/event' },
    ];
    if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') return plausible;
    return [
      ...plausible,
      { source: '/api/:path*', destination: 'http://localhost:3001/api/:path*' },
    ];
  },
};

export default nextConfig;
