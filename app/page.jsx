'use client';
import { useState, useEffect, useCallback } from 'react';
import { fetchDashboard, fetchWhales, getVaultCycle } from '../src/api';
import StatCard from '../src/components/StatCard';
import VaultCycle from '../src/components/VaultCycle';
import EmissionChart from '../src/components/EmissionChart';
import TransactionFeed from '../src/components/TransactionFeed';
import TopEarners from '../src/components/TopEarners';
import WhaleLeaderboard from '../src/components/WhaleLeaderboard';
import BurnChart from '../src/components/BurnChart';
import FlowChart from '../src/components/FlowChart';
import SupplyChart from '../src/components/SupplyChart';
import InfluenceChart from '../src/components/InfluenceChart';
import ParticipantsChart from '../src/components/ParticipantsChart';
import ActiveWalletsChart from '../src/components/ActiveWalletsChart';

const REFRESH_MS = 15_000;

export default function DashboardPage() {
  const [data, setData]         = useState(null);
  const [whaleData, setWhales]  = useState(null);
  const [cycle, setCycle]       = useState(getVaultCycle());
  const [loading, setLoading]   = useState(true);
  const [wLoading, setWLoading] = useState(true);
  const [error, setError]       = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchDashboard();
      setData(d);
      setError(null);
      setLastUpdate(Date.now());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWhales = useCallback(async () => {
    try {
      const d = await fetchWhales();
      setWhales(d);
    } catch { /* non-critical */ }
    finally { setWLoading(false); }
  }, []);

  useEffect(() => {
    const t = setInterval(() => setCycle(getVaultCycle()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    loadWhales();
    const t = setInterval(loadWhales, 5 * 60_000);
    return () => clearInterval(t);
  }, [loadWhales]);

  return (
    <>
      {error && (
        <div className="error-banner">
          Backend error: {error}
        </div>
      )}

      <div className="stats-row">
        <StatCard
          label="$DIRTY SUPPLY"
          value={data?.supply != null ? data.supply.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
          sub="total circulating"
          accent="gold"
          loading={loading && !data}
        />
        <StatCard
          label="BURNED / SUPPLY"
          value={data?.supply ? (data.dirtySpentTotal / data.supply).toFixed(2) : '—'}
          sub={data ? `${(data.dirtySpentTotal / 1_000_000).toFixed(2)}M burned all time` : 'loading...'}
          accent="red"
          loading={loading && !data}
        />
        <StatCard
          label="TOTAL OPS"
          value={data ? data.opsTotal.toLocaleString() : '—'}
          sub={data ? `${(data.dirtyMintedTotal / 1_000_000).toFixed(2)}M $DIRTY emitted` : 'loading...'}
          accent="green"
          loading={loading && !data}
        />
        <StatCard
          label="TOKEN HOLDERS"
          value={data?.holders ?? '—'}
          sub={data ? `${data.uniqueAddrs.toLocaleString()} unique wallets` : 'loading...'}
          accent="amber"
          loading={loading && !data}
        />
      </div>

      <div className="main-grid">
        <VaultCycle cycle={cycle} opBreakdown={data?.opBreakdown} />
        <div className="charts-stack">
          <EmissionChart  dailyBuckets={data?.dailyBuckets ?? []}  hourlyBuckets={data?.hourlyBuckets ?? []} />
          <BurnChart      dailyBurnBuckets={data?.dailyBurnBuckets ?? []}  hourlyBurnBuckets={data?.hourlyBurnBuckets ?? []} />
          <FlowChart      dailyFlowBuckets={data?.dailyFlowBuckets ?? []}  hourlyFlowBuckets={data?.hourlyFlowBuckets ?? []} />
          <SupplyChart    dailySupply={data?.dailySupply ?? []}    hourlySupply={data?.hourlySupply ?? []} />
          <InfluenceChart dailyInfluence={data?.dailyInfluence ?? []} hourlyInfluence={data?.hourlyInfluence ?? []} influenceStats={data?.influenceStats} />
          <ParticipantsChart  dailyParticipants={data?.dailyParticipants ?? []}  hourlyParticipants={data?.hourlyParticipants ?? []} />
          <ActiveWalletsChart dailyActiveWallets={data?.dailyActiveWallets ?? []} hourlyActiveWallets={data?.hourlyActiveWallets ?? []} />
        </div>
      </div>

      <div className="bottom-grid">
        <TransactionFeed transfers={data?.transfers ?? []} loading={loading && !data} />
        <TopEarners earners={data?.earners ?? []} loading={loading && !data} onRefresh={load} />
      </div>

      <div className="section-divider">
        <span className="section-label">WHALE INTELLIGENCE</span>
      </div>

      <WhaleLeaderboard
        whales={whaleData?.whales}
        supply={whaleData?.supply}
        knownContracts={whaleData?.knownContracts ?? {}}
        loading={wLoading}
      />

      <footer style={{ textAlign: 'center', padding: '24px 0 16px', fontSize: 11, color: 'var(--text-2)', letterSpacing: '0.04em' }}>
        made with love by{' '}
        <a href="https://x.com/s_exas" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-2)', textDecoration: 'underline' }}>s_exas</a>
        {' '}and{' '}
        <span style={{ color: 'var(--text-2)' }}>dragonslayer42069.mega</span>
      </footer>
    </>
  );
}
