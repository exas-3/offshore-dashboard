'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/',        label: 'Dashboard'     },
  { href: '/vault',   label: 'Swiss Vault'   },
  { href: '/whales',  label: 'Whale Tracker' },
  { href: '/players', label: 'Players'       },
];

export default function Header({ ethPrice, lastUpdate, children }) {
  const pathname = usePathname();
  const [ago, setAgo] = useState('—');

  useEffect(() => {
    const tick = () => {
      if (!lastUpdate) return setAgo('loading...');
      const s = Math.floor((Date.now() - lastUpdate) / 1000);
      setAgo(s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [lastUpdate]);

  return (
    <header className="header">
      <div className="header-left">
        <div className="header-logo">
          <span className="logo-text">OFFSHORE</span>
          <span className="logo-sub">PROTOCOL</span>
        </div>
        <div className="live-badge">
          <span className="live-dot" />
          LIVE
        </div>
        <div className="network-badge">MegaETH</div>
      </div>

      <div className="header-tabs">
        {TABS.map(({ href, label }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link key={href} href={href}
              className={`header-tab ${active ? 'header-tab--active' : ''}`}>
              {label}
            </Link>
          );
        })}
      </div>

      <div className="header-right">
        {children}
        {ethPrice != null && (
          <div className="eth-price">
            <span className="eth-label">ETH/USD</span>
            <span className="eth-value">
              ${ethPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        )}
        <div className="last-update">/ {ago}</div>
      </div>
    </header>
  );
}
