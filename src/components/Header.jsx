'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

const TABS = [
  { href: '/',          label: 'Dashboard'  },
  { href: '/vault',     label: 'Swiss Vault' },
  { href: '/companies', label: 'Ongoing Ops' },
];

export default function Header({ ethPrice, dirtyPrice, infCost }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [search, setSearch] = useState('');

  function handleSearch(e) {
    e.preventDefault();
    const addr = search.trim().toLowerCase();
    if (/^0x[0-9a-f]{40}$/i.test(addr)) {
      router.push(`/players/${addr}`);
      setSearch('');
    }
  }

  return (
    <header className="header">
      <div className="header-left">
        <Link href="/" style={{ textDecoration: 'none' }}>
          <div className="header-logo">
            <span className="logo-text">OFFSHORE</span>
            <span className="logo-sub">DASHBOARD</span>
          </div>
        </Link>
        <form onSubmit={handleSearch} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="search address…"
            style={{
              width: 220, background: 'var(--bg-2)', border: '1px solid var(--border-2)',
              color: 'var(--text)', padding: '5px 10px', borderRadius: 4,
              fontFamily: 'var(--mono)', fontSize: 11, outline: 'none',
            }}
          />
          {/^0x[0-9a-f]{40}$/i.test(search.trim()) && (
            <button type="submit" className="toggle-btn toggle-btn--active"
              style={{ fontSize: 10, padding: '5px 10px' }}>→</button>
          )}
        </form>
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
        {dirtyPrice != null && (
          <div className="eth-price">
            <span className="eth-label">DIRTY</span>
            <span className="eth-value" style={{ color: '#c084fc' }}>
              ${dirtyPrice.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
            </span>
          </div>
        )}
        {infCost != null && (
          <div className="eth-price">
            <span className="eth-label">OP COST</span>
            <span className="eth-value" style={{ color: 'orange' }}>
              {infCost.toFixed(2)} INF
            </span>
          </div>
        )}

      </div>
    </header>
  );
}
