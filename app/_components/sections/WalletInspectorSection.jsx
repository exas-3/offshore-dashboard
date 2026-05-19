'use client';
import { useState, useEffect, useMemo } from 'react';
import { Region, KV, KVSep, GridCell, fmt } from '../terminal.jsx';
import { OP_LABELS_SHORT, usePagedRows, Pager } from '../trade-helpers.jsx';
import { durationToOpType } from '../../../lib/chain-constants.js';

function relTime(ts) {
  const diff = Math.floor(Date.now() / 1000) - Number(ts);
  if (diff < 0)     return 'now';
  if (diff < 60)    return `${diff}s`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function fmtMadeMan(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

export function WalletInspectorSection({ address, grid, ethPrice = 0, liveData = null }) {
  const { spans, heights, resize } = grid;
  const isFullAddr = /^0x[0-9a-fA-F]{40}$/.test(address);
  if (!isFullAddr) return null;

  const [dbData,   setDbData]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [, setTick]             = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // /api/players gives us the transfers history + aggregates. Live monitor
  // data (companies, balances) arrives via the `liveData` prop driven by the
  // single parent-level poll in offshore.jsx (3 s).
  useEffect(() => {
    let live = true;
    const addr = address.toLowerCase();
    const loadPlayers = (showLoader) => {
      if (showLoader) setLoading(true);
      return fetch(`/api/players/${addr}`)
        .then(r => r.json())
        .then(db => {
          if (live) setDbData(db?.error ? null : db);
          if (live && showLoader) setLoading(false);
        })
        .catch(() => { if (live && showLoader) setLoading(false); });
    };
    loadPlayers(true);
    const t = setInterval(() => loadPlayers(false), 10_000);
    return () => { live = false; clearInterval(t); };
  }, [address]);

  // Synthetic "in-progress" activity rows derived from the live companies
  // array — duration → op_type lets the recent-activity table surface a
  // freshly-started op in ≤3 s without waiting for syncCompanyStarts.
  // Prefer the server-computed `tradeType` (one read pair, no race) and
  // fall back to recomputing the duration client-side only if missing.
  const syntheticInProgress = useMemo(() => {
    if (!liveData?.companies) return [];
    const out = [];
    for (const c of liveData.companies) {
      if (!c.active || !(c.endTime > 0) || !(c.startTime > 0)) continue;
      const opType = c.tradeType ?? durationToOpType(Number(c.endTime) - Number(c.startTime));
      if (!opType) continue;
      out.push({
        hash:      c.company,
        log_index: 0,
        timestamp: c.startTime,
        from_addr: '0x0000000000000000000000000000000000000000',
        to_addr:   address.toLowerCase(),
        amount:    null,
        kind:      'MINT',
        op_type:   opType,
        // Once the on-chain position is liquidatable (ETH below liqPrice),
        // surface it as busted immediately. The synthetic row is replaced
        // by the real DB tx as soon as the claim is indexed — c.active
        // flips false at that point and the for-loop above skips it.
        result:    c.liquidatable ? 'busted' : 'in-progress',
      });
    }
    return out;
  }, [liveData, address]);
  const activityRows = useMemo(() => {
    // Collapse multi-hop tx noise: a single DEX swap can fire 2-3 Transfer
    // events at the wallet (player → pool A → pool B). Keep only the
    // largest-amount row per (tx_hash, op_type) so the feed shows the
    // economically meaningful leg instead of a stream of dust rows.
    const dedup = new Map();
    for (const r of (dbData?.activity ?? [])) {
      const key = `${r.hash}:${r.op_type || r.kind}`;
      const prev = dedup.get(key);
      if (!prev || Number(r.amount) > Number(prev.amount)) dedup.set(key, r);
    }
    const all = [...dedup.values(), ...syntheticInProgress];
    all.sort((a, b) => Number(b.timestamp) - Number(a.timestamp) || Number(b.log_index) - Number(a.log_index));
    return all;
  }, [dbData, syntheticInProgress]);

  // ── Region: indexed stats (4) ─────────────────────────────────────────
  const indexedStats = dbData?.stats ? (
    <Region title="indexed stats">
      <KV k="made man" v={fmtMadeMan(dbData.stats.first_active)} sub={dbData.stats.first_active ? `${relTime(dbData.stats.first_active)} ago` : null} cls="hdr" />
      <KVSep />
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
      <KVSep />
      <KV
        k="hits made"
        v={
          <>
            <span className="pos">{dbData.stats.hits_made_won ?? 0}</span>
            <span className="dim"> · </span>
            <span className="neg">{dbData.stats.hits_made_lost ?? 0}</span>
          </>
        }
        sub="this cycle"
      />
      <KV
        k="hits received"
        v={`${dbData.stats.hits_received_cycle ?? 0} / 10`}
        sub="this cycle"
        cls={(dbData.stats.hits_received_cycle ?? 0) >= 10 ? 'warn' : ''}
      />
    </Region>
  ) : (
    <Region title="indexed stats">
      <div className="dim" style={{ fontSize: 'var(--t-fs-xs)', padding: '4px 0' }}>
        {loading ? 'loading…' : 'no data found'}
      </div>
    </Region>
  );

  // ── Region: recent activity (8) ───────────────────────────────────────
  const activityPager = usePagedRows(activityRows);
  const recentActivity = activityRows.length > 0 ? (
    <Region title="recent activity" sub={`${activityRows.length} txs`}>
      <div className="tm-scroll-bl" style={{ maxHeight: 425, overflowY: 'auto' }}>
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
            {activityPager.pageRows.map(a => {
              const playerLc   = address.toLowerCase();
              const inProgress = a.result === 'in-progress';
              // Synthetic rows (active trade not yet indexed as a real tx)
              // carry amount=null. Show — for them across all statuses so a
              // liquidatable position doesn't render as "0".
              const pending    = a.amount === null;
              const amt        = Number(a.amount) || 0;
              const isIncoming = a.kind === 'MINT' || (a.kind === 'TRANSFER' && a.to_addr === playerLc);
              // HIT rows show the gross mint (stolen). The W/L verdict comes
              // from the row's `result` (set via stolen-vs-cost at sync time)
              // and is conveyed by the label. The matching HIT_COST burn row
              // separately shows the −cost.
              const signed = isIncoming ? amt : -amt;
              let baseLabel = OP_LABELS_SHORT[a.op_type] || (a.op_type ? a.op_type.toLowerCase() : a.kind.toLowerCase());
              if (a.op_type === 'HIT') baseLabel = a.result === 'completed' ? 'hit won' : 'hit lost';
              const mark       = inProgress ? '⏳' : a.result === 'busted' ? '✗' : a.result === 'completed' ? '✓' : '';
              const markCls    = inProgress ? 'warn' : a.result === 'busted' ? 'neg' : a.result === 'completed' ? 'pos' : '';
              // HIT_REFUND (victim): show kept (+green) and stolen (-red)
              // side-by-side so the victim sees both what they kept and what
              // the attacker took from them.
              const isRefund = a.op_type === 'HIT_REFUND';
              const stolen   = isRefund ? Number(a.hit_stolen) || 0 : 0;
              return (
                <tr key={`${a.hash}:${a.log_index}`}>
                  <td className="dim" style={{ fontSize: 'var(--t-fs-xs)' }}>{relTime(a.timestamp)}</td>
                  <td style={{ fontSize: 'var(--t-fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {mark && <span className={markCls} style={{ marginRight: 4 }}>{mark}</span>}
                    {baseLabel}
                  </td>
                  <td className="num" style={{ fontSize: 'var(--t-fs-xs)' }}>
                    {pending ? <span className="dim">—</span>
                      : isRefund ? (
                        <>
                          <span className="pos">+{fmt.k(amt)}</span>
                          <span className="dim"> / </span>
                          <span className="neg">−{fmt.k(stolen)}</span>
                        </>
                      ) : (
                        // For game-op MINTs flagged 'busted' (Season 2 partial
                        // payouts), keep amount red even though the sign is
                        // positive — the outcome was a loss, not a gain.
                        <span className={
                          a.result === 'busted' ? 'neg'
                          : signed > 0 ? 'pos'
                          : signed < 0 ? 'neg'
                          : 'dim'
                        }>
                          {`${signed > 0 ? '+' : signed < 0 ? '−' : ''}${fmt.k(Math.abs(signed))}`}
                        </span>
                      )}
                  </td>
                  <td>
                    <a
                      href={pending
                        ? `https://mega.etherscan.io/address/${a.hash}`
                        : `https://mega.etherscan.io/tx/${a.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="dim"
                      style={{ fontSize: 'var(--t-fs-xs)', textDecoration: 'none' }}
                      title={pending ? `company ${a.hash}` : a.hash}
                    >
                      {a.hash.slice(-6)}↗
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager {...activityPager} />
    </Region>
  ) : (
    <Region title="recent activity">
      <div className="dim" style={{ fontSize: 'var(--t-fs-xs)', padding: '4px 0' }}>
        {loading ? 'loading…' : 'no activity'}
      </div>
    </Region>
  );

  // ── Region: farmed daily (8) ──────────────────────────────────────────
  const farmedDaily = dbData?.history?.length > 1 ? (() => {
    const totalCompleted = dbData.history.reduce((s, h) => s + Number(h.completed || 0), 0);
    const totalBusted    = dbData.history.reduce((s, h) => s + Number(h.busted    || 0), 0);
    const totalOps       = totalCompleted + totalBusted;
    const totalRate      = totalOps > 0 ? (totalCompleted / totalOps * 100).toFixed(1) + '%' : '—';
    const rows = dbData.history.map(h => ({
      x:         h.day?.slice(5) ?? h.day,
      earned:    Number(h.earned || 0),
      spent:     Number(h.spent  || 0),
      completed: Number(h.completed || 0),
      busted:    Number(h.busted    || 0),
    }));
    const maxAbs = Math.max(1, ...rows.map(d => Math.max(d.earned, d.spent)));
    const BAR_H  = 16;
    const ROW_H  = 22;
    return (
      <Region title="farmed daily" sub={`win rate ${totalRate}`}>
        <div style={{ fontFamily: 'var(--t-font)', fontSize: 'var(--t-fs-xs)' }}>
          {rows.map(d => {
            const earnedPct = (d.earned / maxAbs) * 50;
            const spentPct  = (d.spent  / maxAbs) * 50;
            const ops  = d.completed + d.busted;
            const rate = ops > 0 ? (d.completed / ops * 100).toFixed(1) + '%' : '—';
            return (
              <div key={d.x} title={`earned ${fmt.k(d.earned)} · spent ${fmt.k(d.spent)} · win rate ${rate} (${d.completed}/${ops})`}
                style={{ display: 'flex', alignItems: 'center', height: ROW_H, gap: 8 }}>
                <span style={{ width: 40, color: 'var(--t-fg-soft)' }}>{d.x}</span>
                <div style={{ flex: 1, position: 'relative', height: BAR_H }}>
                  {/* centerline */}
                  <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--t-rule-hot)' }} />
                  {/* spent — extends LEFT from center */}
                  <div style={{
                    position: 'absolute', right: '50%', top: 0, height: '100%',
                    width: `${spentPct}%`, background: 'var(--t-neg)',
                  }} />
                  {/* earned — extends RIGHT from center */}
                  <div style={{
                    position: 'absolute', left: '50%', top: 0, height: '100%',
                    width: `${earnedPct}%`, background: 'var(--t-pos)',
                  }} />
                </div>
                <span style={{ width: 64, textAlign: 'right', color: 'var(--t-fg-mut)' }}>
                  <span className="pos">+{fmt.k(d.earned)}</span>{' / '}
                  <span className="neg">−{fmt.k(d.spent)}</span>
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 4, fontSize: 'var(--t-fs-sm)', color: 'var(--t-fg-soft)', display: 'flex', gap: 12, fontFamily: 'var(--t-font)' }}>
          <span><span style={{ color: 'var(--t-neg)' }}>█</span> spent</span>
          <span><span style={{ color: 'var(--t-pos)' }}>█</span> earned</span>
        </div>
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
      <GridCell id="farmed-daily"    span={spans['farmed-daily']}    height={heights['farmed-daily']}    onResize={(r) => resize('farmed-daily', r)}>{farmedDaily}</GridCell>
    </section>
  );
}
