'use client';
import { useState, useEffect, useCallback } from 'react';
import Header from '../src/components/Header';
import WhaleAlerts from '../src/components/WhaleAlerts';
import { fetchDashboard, fetchWhales } from '../src/api';

const REFRESH_MS = 15_000;

export default function ClientShell({ children }) {
  const [ethPrice, setEthPrice]   = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [dexAlerts, setDexAlerts] = useState(false);

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      if (res.ok) {
        const d = await res.json();
        setEthPrice(d.ethPrice ?? null);
        setLastUpdate(Date.now());
      }
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    refreshStats();
    const t = setInterval(refreshStats, REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshStats]);

  return (
    <div className="app">
      <div style={{
        background: '#1a1200', borderBottom: '1px solid #3a2a00',
        padding: '6px 16px', fontSize: 11, color: '#a07830',
        textAlign: 'center', letterSpacing: '0.02em',
      }}>
        Data may be incomplete or inaccurate. Not financial advice — do not make financial decisions based on this site.
      </div>
      <Header ethPrice={ethPrice} lastUpdate={lastUpdate}>
        <WhaleAlerts enabled={dexAlerts} onToggle={() => setDexAlerts(v => !v)} />
      </Header>
      {children}
    </div>
  );
}
