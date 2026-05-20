const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://offshoredashboard.xyz';

export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/ps/'] }],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
