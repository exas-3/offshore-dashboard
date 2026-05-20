import { getEnhancedLeaderboard } from '../lib/index.js';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://offshoredashboard.xyz';

export const revalidate = 3600;

export default async function sitemap() {
  const now = new Date();
  const home = {
    url: `${SITE}/`,
    lastModified: now,
    changeFrequency: 'always',
    priority: 1.0,
  };

  // Per-wallet profile URLs (terminal opened on the criminal rail).
  let criminals = [];
  try {
    const rows = await getEnhancedLeaderboard(200);
    criminals = (rows || []).map(r => ({
      url: `${SITE}/criminal/${r.addr}`,
      lastModified: r.last_active ? new Date(r.last_active * 1000) : now,
      changeFrequency: 'daily',
      priority: 0.5,
    }));
  } catch {
    // DB unreachable — fall back to homepage-only sitemap rather than 500
  }

  return [home, ...criminals];
}
