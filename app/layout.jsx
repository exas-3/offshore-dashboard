import '../src/styles.css';
import '../design/megaethDashboards/lib/terminal.css';

export const metadata = {
  title: 'Offshore Protocol | Dashboard',
  description: 'Live on-chain analytics for the Offshore Protocol on MegaETH',
  icons: {
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    images: [{ url: '/og-mark.png' }],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var C={amber:['#ffb000','#000000'],purple:['#a674ff','#050009'],green:['#4ade80','#020603'],paper:['#6b4400','#f7f3e8']};var t=localStorage.getItem('offshore-theme')||'purple';var c=C[t]||C.purple;var s='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="'+c[1]+'"/><circle cx="32" cy="32" r="24" fill="none" stroke="'+c[0]+'" stroke-width="2.5"/><line x1="8" y1="32" x2="56" y2="32" stroke="'+c[0]+'" stroke-width="2.5"/><ellipse cx="32" cy="32" rx="9" ry="24" fill="none" stroke="'+c[0]+'" stroke-width="2.5"/><circle cx="44" cy="22" r="5" fill="'+c[0]+'"/></svg>';var u='data:image/svg+xml,'+encodeURIComponent(s);document.querySelectorAll("link[rel~='icon']").forEach(function(e){e.parentNode.removeChild(e);});var l=document.createElement('link');l.rel='icon';l.type='image/svg+xml';l.href=u;document.head.appendChild(l);}catch(e){}})();` }} />
        <script defer data-domain="offshoredashboard.xyz" data-api="/ps/event" src="/ps/script.js" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
