import '../src/styles.css';
import ClientShell from './ClientShell';

export const metadata = {
  title: 'Offshore Protocol | Dashboard',
  description: 'Live on-chain analytics for the Offshore Protocol on MegaETH',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <script async src="https://plausible.io/js/pa-jkj15-qX_bOuYK_JtTUsj.js" />
        <script dangerouslySetInnerHTML={{ __html: `
          window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)};
          window.plausible.init=window.plausible.init||function(i){plausible.o=i||{}};
          plausible.init();
        `}} />
      </head>
      <body>
        <div id="root">
          <ClientShell>{children}</ClientShell>
        </div>
      </body>
    </html>
  );
}
