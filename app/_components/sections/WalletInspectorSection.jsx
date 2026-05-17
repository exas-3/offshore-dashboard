'use client';
import { useState, useRef, useEffect } from 'react';
import { Region, KV, KVSep, BarRow2, GridCell, fmt } from '../terminal.jsx';
import { fmtCountdownLocal, OP_LABELS_SHORT } from '../trade-helpers.jsx';

function relTime(ts) {
  const diff = Math.floor(Date.now() / 1000) - Number(ts);
  if (diff < 0)     return 'now';
  if (diff < 60)    return `${diff}s`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function WalletInspectorSection({ address, grid, ethPrice = 0 }) {
  const { spans, heights, resize } = grid;
  const isFullAddr = /^0x[0-9a-fA-F]{40}$/.test(address);
  if (!isFullAddr) return null;

  const [dbData,   setDbData]   = useState(null);
  const [liveData, setLiveData] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [, setTick]             = useState(0);
  const compAddrsRef = useRef([]);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setLoading(true);
    const addr = address.toLowerCase();
    Promise.all([
      fetch(`/api/players/${addr}`).then(r => r.json()).catch(() => null),
      fetch(`/api/monitor?wallet=${addr}`).then(r => r.json()).catch(() => null),
    ]).then(([db, live]) => {
      setDbData(db?.error ? null : db);
      if (live && !live.error) {
        compAddrsRef.current = (live.companies ?? []).map(c => c.company);
        setLiveData(live);
      }
      setLoading(false);
    });
  }, [address]);

  useEffect(() => {
    const poll = () => {
      const addrs = compAddrsRef.current;
      if (!addrs.length) return;
      fetch(`/api/monitor/states?addrs=${addrs.join(',')}`)
        .then(r => r.json())
        .then(d => {
          if (!d?.error && d.companies) {
            setLiveData(prev => prev ? { ...prev, companies: d.companies } : prev);
          }
        })
        .catch(() => {});
    };
    const t = setInterval(poll, 1_000);
    return () => clearInterval(t);
  }, [address]);

  // ── Region: indexed stats (4) ─────────────────────────────────────────
  const indexedStats = dbData?.stats ? (
    <Region title="indexed stats">
      {liveData?.influenceBalance != null && (
        <>
          <KV k="inf bal"   v={fmt.k(liveData.influenceBalance)} />
          <KV k="dirty bal" v={fmt.k(liveData.dirtyBalance)} />
          <KVSep />
        </>
      )}
      <KV k="total ops"    v={fmt.n(dbData.stats.ops)} />
      <KV k="dirty earned" v={fmt.k(dbData.stats.earned)}  cls="pos" />
      <KV k="dirty spent"  v={fmt.k(dbData.stats.spent)}   cls="neg" />
      <KV k="balance"      v={fmt.k(dbData.stats.balance)} />
      <KVSep />
      <KV k="inf bought"   v={fmt.n(dbData.influence?.totalPurchased ?? 0)} sub={`${dbData.influence?.purchaseCount ?? 0} purchases`} />
      <KV k="inf refunded" v={fmt.n(dbData.influence?.totalRefunded  ?? 0)} />
      <KV k="dex bought"   v={fmt.k(dbData.stats.dex_bought)} sub={`${dbData.breakdown?.dex_bought?.cnt ?? 0} txs`} />
      <KV k="dex sold"     v={fmt.k(dbData.stats.dex_sold)}   sub={`${dbData.breakdown?.dex_sold?.cnt   ?? 0} txs`} cls="neg" />
      <KVSep />
      <KV k="vault claimed" v={`$${fmt.k(dbData.stats.vault_claimed)}`} cls="hdr" sub={`${dbData.stats.vault_count} payouts`} />
    </Region>
  ) : (
    <Region title="indexed stats">
      <div className="dim" style={{ fontSize: 'var(--t-fs-xs)', padding: '4px 0' }}>
        {loading ? 'loading…' : 'no data found'}
      </div>
    </Region>
  );

  // ── Region: recent activity (8) ───────────────────────────────────────
  const recentActivity = dbData?.activity?.length > 0 ? (
    <Region title="recent activity" sub={`${dbData.activity.length} txs`}>
      <div className="tm-scroll-bl" style={{ maxHeight: 280, overflowY: 'auto' }}>
        <table className="tm-tab tm-tab-bl" style={{ width: '100%', tableLayout: 'fixed' }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--t-bg)', zIndex: 1 }}>
            <tr>
              <th style={{ width: 38 }}>time</th>
              <th>op</th>
              <th className="num" style={{ width: 64 }}>amount</th>
              <th style={{ width: 50 }}>tx</th>
            </tr>
          </thead>
          <tbody>
            {dbData.activity.map(a => {
              const playerLc  = address.toLowerCase();
              const amt       = Number(a.amount) || 0;
              const isIncoming = a.kind === 'MINT' || (a.kind === 'TRANSFER' && a.to_addr === playerLc);
              const signed    = isIncoming ? amt : -amt;
              const baseLabel = OP_LABELS_SHORT[a.op_type] || (a.op_type ? a.op_type.toLowerCase() : a.kind.toLowerCase());
              const mark      = a.result === 'busted' ? '✗' : a.result === 'completed' ? '✓' : '';
              const markCls   = a.result === 'busted' ? 'neg' : a.result === 'completed' ? 'pos' : '';
              return (
                <tr key={`${a.hash}:${a.log_index}`}>
                  <td className="dim" style={{ fontSize: 'var(--t-fs-xs)' }}>{relTime(a.timestamp)}</td>
                  <td style={{ fontSize: 'var(--t-fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {mark && <span className={markCls} style={{ marginRight: 4 }}>{mark}</span>}
                    {baseLabel}
                  </td>
                  <td className={`num ${signed > 0 ? 'pos' : signed < 0 ? 'neg' : 'dim'}`} style={{ fontSize: 'var(--t-fs-xs)' }}>
                    {signed > 0 ? '+' : signed < 0 ? '−' : ''}{fmt.k(Math.abs(signed))}
                  </td>
                  <td>
                    <a href={`https://mega.etherscan.io/tx/${a.hash}`} target="_blank" rel="noopener noreferrer" className="dim" style={{ fontSize: 'var(--t-fs-xs)', textDecoration: 'none' }}>
                      {a.hash.slice(-6)}↗
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Region>
  ) : (
    <Region title="recent activity">
      <div className="dim" style={{ fontSize: 'var(--t-fs-xs)', padding: '4px 0' }}>
        {loading ? 'loading…' : 'no activity'}
      </div>
    </Region>
  );

  // ── Region: live companies (4) ────────────────────────────────────────
  const activeCompanies = (liveData?.companies ?? []).filter(c => c.active && c.endTime > 0);
  const liveCompanies = (
    <Region title="live companies" sub={activeCompanies.length ? `${activeCompanies.length} active` : 'none active'}>
      {activeCompanies.length === 0 ? (
        <div className="dim" style={{ fontSize: 'var(--t-fs-xs)', padding: '4px 0' }}>none active</div>
      ) : activeCompanies.map(c => {
        const liveEth = ethPrice || liveData.currentEthPrice || 0;
        const buf = liveEth && c.liqPrice
          ? Math.round((liveEth - (Number(BigInt(c.liqPrice) / 10n ** 12n) / 1e6)) * 100) / 100
          : null;
        return (
          <div key={c.company} className="tm-kv" style={{ marginBottom: 2 }}>
            <span className="k" style={{ fontFamily: 'var(--t-font)', fontSize: 'var(--t-fs-xs)' }}>
              {c.company.slice(0, 6)}…{c.company.slice(-4)}
              {c.autoTradeEnabled && <span className="dim"> auto</span>}
            </span>
            <span className={`v ${buf == null ? '' : buf >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 'var(--t-fs-xs)' }}>
              {buf == null ? '—' : `${buf >= 0 ? '+' : ''}${buf.toFixed(2)}`}
              <span className="dim"> {fmtCountdownLocal(c.endTime)}</span>
            </span>
          </div>
        );
      })}
    </Region>
  );

  // ── Region: farmed daily (8) ──────────────────────────────────────────
  const farmedDaily = dbData?.history?.length > 1 ? (() => {
    const totalCompleted = dbData.history.reduce((s, h) => s + Number(h.completed || 0), 0);
    const totalBusted    = dbData.history.reduce((s, h) => s + Number(h.busted    || 0), 0);
    const totalOps       = totalCompleted + totalBusted;
    const totalRate      = totalOps > 0 ? (totalCompleted / totalOps * 100).toFixed(1) + '%' : '—';
    return (
      <Region title="farmed daily" sub={`win rate ${totalRate}`}>
        <BarRow2
          data={dbData.history.map(h => ({
            x:         h.day?.slice(5) ?? h.day,
            earned:    Number(h.earned),
            spent:     Number(h.spent),
            completed: Number(h.completed || 0),
            busted:    Number(h.busted    || 0),
          }))}
          series={[
            { key: 'spent',  label: 'spent',  color: 'neg', dir: 'rtl' },
            { key: 'earned', label: 'earned', color: 'pos' },
          ]}
          hideNum
          extraRows={(d) => {
            const ops = (d.completed || 0) + (d.busted || 0);
            const rate = ops > 0 ? (d.completed / ops * 100).toFixed(1) + '%' : '—';
            return [{ k: 'win rate', v: `${rate} · ${d.completed}/${ops}`, color: 'var(--t-hdr)' }];
          }}
        />
      </Region>
    );
  })() : (
    <Region title="farmed daily">
      <div className="dim" style={{ fontSize: 'var(--t-fs-xs)', padding: '4px 0' }}>
        {loading ? 'loading…' : 'not enough history'}
      </div>
    </Region>
  );

  return (
    <section id="sec-inspect" className="tm-grid-12">
      <GridCell id="indexed-stats"   span={spans['indexed-stats']}   height={heights['indexed-stats']}   onResize={(r) => resize('indexed-stats', r)}>{indexedStats}</GridCell>
      <GridCell id="recent-activity" span={spans['recent-activity']} height={heights['recent-activity']} onResize={(r) => resize('recent-activity', r)}>{recentActivity}</GridCell>
      <GridCell id="live-companies"  span={spans['live-companies']}  height={heights['live-companies']}  onResize={(r) => resize('live-companies', r)}>{liveCompanies}</GridCell>
      <GridCell id="farmed-daily"    span={spans['farmed-daily']}    height={heights['farmed-daily']}    onResize={(r) => resize('farmed-daily', r)}>{farmedDaily}</GridCell>
    </section>
  );
}
