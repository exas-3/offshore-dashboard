'use client';
import { useState, useEffect, useCallback } from 'react';
import Header from '../src/components/Header';
import FeedbackButton from '../src/components/FeedbackButton';
import WhaleAlerts from '../src/components/WhaleAlerts';

const REFRESH_MS = 15_000;

export default function ClientShell({ children }) {
  const [ethPrice, setEthPrice]     = useState(null);
  const [dirtyPrice, setDirtyPrice] = useState(null);
  const [infCost, setInfCost]       = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      if (res.ok) {
        const d = await res.json();
        setDirtyPrice(d.dirtyPrice ?? null);
        setInfCost(d.infCost ?? null);
        setLastUpdate(Date.now());
      }
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    refreshStats();
    const t = setInterval(refreshStats, REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshStats]);

  useEffect(() => {
    const es = new EventSource('/api/eth-price/stream');
    es.onmessage = ({ data }) => {
      const price = parseFloat(data);
      if (isFinite(price) && price > 0) setEthPrice(price);
    };
    return () => es.close();
  }, []);

  return (
    <div className="app">
      <Header ethPrice={ethPrice} dirtyPrice={dirtyPrice} infCost={infCost} lastUpdate={lastUpdate} />
      {children}
      <WhaleAlerts />
      <FeedbackButton />
    </div>
  );
}
