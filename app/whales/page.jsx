'use client';
import WhalePage from '../../src/views/WhalePage';

import { useState, useEffect, useCallback } from 'react';
import { fetchWhales } from '../../src/api';

export default function WhalesRoute() {
  const [whaleData, setWhaleData] = useState(null);
  const [loading, setLoading]     = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await fetchWhales();
      setWhaleData(d);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <WhalePage
      whales={whaleData?.whales ?? []}
      dexSummary={whaleData?.dexSummary ?? {}}
      whaleLoading={loading}
    />
  );
}
