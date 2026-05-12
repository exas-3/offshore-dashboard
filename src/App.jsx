import { useState, useEffect, useCallback } from 'react';
import { fetchDashboard, fetchWhales, getVaultCycle } from './api';
import WhalePage from './pages/WhalePage';
import VaultPage from './pages/VaultPage';
import PlayersPage from './pages/PlayersPage';
import Header from './components/Header';
import StatCard from './components/StatCard';
import VaultCycle from './components/VaultCycle';
import EmissionChart from './components/EmissionChart';
import TransactionFeed from './components/TransactionFeed';
import TopEarners from './components/TopEarners';
import WhaleLeaderboard from './components/WhaleLeaderboard';
import BurnChart from './components/BurnChart';
import FlowChart from './components/FlowChart';
import SupplyChart from './components/SupplyChart';
import InfluenceChart from './components/InfluenceChart';
import ParticipantsChart from './components/ParticipantsChart';
import ActiveWalletsChart from './components/ActiveWalletsChart';
import WhaleAlerts from './components/WhaleAlerts';

const REFRESH_MS = 15_000;

export default function App() {
  const [tab, setTab]           = useState('dashboard');
  const [dexAlerts, setDexAlerts] = useState(false);
  const [data, setData]       = useState(null);
  const [whaleData, setWhales] = useState(null);
  const [cycle, setCycle]     = useState(getVaultCycle());
  const [loading, setLoading] = useState(true);
  const [wLoading, setWLoading] = useState(true);
  const [error, setError]     = useState(null);
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
    } catch (_) {
      // whale data is non-critical, fail silently
    } finally {
      setWLoading(false);
    }
  }, []);

  // Live vault cycle countdown
  useEffect(() => {
    const t = setInterval(() => setCycle(getVaultCycle()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch on mount + interval
  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Whale data refreshes every 5 min (matches server poller)
  useEffect(() => {
    loadWhales();
    const t = setInterval(loadWhales, 5 * 60_000);
    return () => clearInterval(t);
  }, [loadWhales]);

  return (
    <div className="app">
      <div style={{
        background: '#1a1200', borderBottom: '1px solid #3a2a00',
        padding: '6px 16px', fontSize: 11, color: '#a07830',
        textAlign: 'center', letterSpacing: '0.02em',
      }}>
        Data may be incomplete or inaccurate. Not financial advice — do not make financial decisions based on this site.
      </div>
      <Header ethPrice={data?.ethPrice} lastUpdate={lastUpdate} tab={tab} setTab={setTab}>
        <WhaleAlerts enabled={dexAlerts} onToggle={() => setDexAlerts(v => !v)} />
      </Header>

      {tab === 'vault' ? (
        <VaultPage />
      ) : tab === 'whales' ? (
        <WhalePage
          whales={whaleData?.whales ?? []}
          dexSummary={whaleData?.dexSummary ?? {}}
          whaleLoading={wLoading}
        />
      ) : tab === 'players' ? (
        <PlayersPage />
      ) : (<>

      {error && (
        <div className="error-banner">
          Backend error: {error} — make sure the server is running (<code>npm run server</code>)
        </div>
      )}

      <div className="stats-row">
        <StatCard
          label="$DIRTY SUPPLY"
          value={data?.supply != null
            ? data.supply.toLocaleString(undefined, { maximumFractionDigits: 0 })
            : '—'}
          sub="total circulating"
          accent="gold"
          loading={loading && !data}
        />
        <StatCard
          label="BURNED / SUPPLY"
          value={data?.supply
            ? (data.dirtySpentTotal / data.supply).toFixed(2)
            : '—'}
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
          <EmissionChart
            dailyBuckets={data?.dailyBuckets ?? []}
            hourlyBuckets={data?.hourlyBuckets ?? []}
          />
          <BurnChart
            dailyBurnBuckets={data?.dailyBurnBuckets ?? []}
            hourlyBurnBuckets={data?.hourlyBurnBuckets ?? []}
          />
          <FlowChart
            dailyFlowBuckets={data?.dailyFlowBuckets ?? []}
            hourlyFlowBuckets={data?.hourlyFlowBuckets ?? []}
          />
          <SupplyChart
            dailySupply={data?.dailySupply ?? []}
            hourlySupply={data?.hourlySupply ?? []}
          />
          <InfluenceChart
            dailyInfluence={data?.dailyInfluence ?? []}
            hourlyInfluence={data?.hourlyInfluence ?? []}
            influenceStats={data?.influenceStats}
          />
          <ParticipantsChart
            dailyParticipants={data?.dailyParticipants ?? []}
            hourlyParticipants={data?.hourlyParticipants ?? []}
          />
          <ActiveWalletsChart
            dailyActiveWallets={data?.dailyActiveWallets ?? []}
            hourlyActiveWallets={data?.hourlyActiveWallets ?? []}
          />
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
      </>)}
    </div>
  );
}
