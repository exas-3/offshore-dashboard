'use client';
import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';



// ── helpers ──────────────────────────────────────────────────────────────────

function shortAddr(a) {
  if (!a) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtD(n) {
  if (!n) return '0';
  n = Number(n);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

function fmtUsd(n) {
  if (!n) return '—';
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function pct(part, total) {
  if (!total) return '—';
  return `${((part / total) * 100).toFixed(1)}%`;
}

function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function absTime(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

const OP_LABELS = {
  DRUG_DEAL: 'Drug Deal', ARMS_DEAL: 'Arms Deal', EXTORTION: 'Extortion',
  PARTIAL: 'Partial', LEVEL_UP: 'Level Up', BUY_ASSET: 'Buy Asset',
  THIRD_ENTERPRISE: '3rd Enterprise', BURN: 'Protocol Burn',
};

const OP_COLORS = {
  DRUG_DEAL: '#3ecf6a', ARMS_DEAL: '#4a9fd8', EXTORTION: '#c8a951',
  PARTIAL: '#888', LEVEL_UP: '#9b59d8', BUY_ASSET: '#e0a030',
  THIRD_ENTERPRISE: '#ff6b35', BURN: '#e05252',
};

const LP = '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1';

function classifyRow(row, address) {
  const { kind, op_type, from_addr, to_addr } = row;
  if (kind === 'MINT')  return { label: OP_LABELS[op_type] ?? op_type, color: OP_COLORS[op_type] ?? '#3ecf6a', dir: '+' };
  if (kind === 'SPEND') return { label: OP_LABELS[op_type] ?? op_type, color: OP_COLORS[op_type] ?? '#c8a951', dir: '-' };
  if (kind === 'BURN')  return { label: 'Protocol Burn', color: '#e05252', dir: '-' };
  if (kind === 'TRANSFER') {
    if (to_addr === LP)   return { label: 'DEX Sell', color: '#e05252', dir: '-' };
    if (from_addr === LP) return { label: 'DEX Buy',  color: '#3ecf6a', dir: '+' };
    if (to_addr === address)   return { label: 'Received', color: '#4a9fd8', dir: '+' };
    if (from_addr === address) return { label: 'Sent',     color: '#888',    dir: '-' };
  }
  return { label: kind, color: '#888', dir: '' };
}

// ── sub-components ───────────────────────────────────────────────────────────

function StatBox({ label, value, color = 'var(--text)', sub }) {
  return (
    <div style={{ background: 'var(--bg-2)', borderRadius: 6, padding: '10px 14px', minWidth: 110 }}>
      <div style={{ fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontFamily: 'JetBrains Mono', color, fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: 'var(--text-2)', letterSpacing: '0.1em', marginBottom: 8, borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ── History chart ─────────────────────────────────────────────────────────────

function HistoryChart({ history }) {
  if (!history?.length) return null;
  const data = history.map(r => ({ ...r, net: r.earned - r.spent }));

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const by = Object.fromEntries(payload.map(p => [p.dataKey, p.value]));
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-label">{label}</div>
        <div className="chart-tooltip-row"><span style={{ color: '#3ecf6a' }}>Earned</span><span>{(by.earned ?? 0).toLocaleString()}</span></div>
        <div className="chart-tooltip-row"><span style={{ color: '#e05252' }}>Spent</span><span>{(by.spent ?? 0).toLocaleString()}</span></div>
        <div className="chart-tooltip-row"><span style={{ color: '#888' }}>Ops</span><span>{by.ops ?? 0}</span></div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" stroke="#1a241a" vertical={false} />
        <XAxis dataKey="day" tick={{ fill: '#4a5448', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false}
          tickFormatter={d => { const p = d.split('-'); return `${parseInt(p[1])}/${parseInt(p[2])}`; }} />
        <YAxis tick={{ fill: '#4a5448', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false}
          tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="earned" name="Earned" fill="#3ecf6a" maxBarSize={40} radius={[2,2,0,0]} />
        <Bar dataKey="spent"  name="Spent"  fill="#e05252" maxBarSize={40} radius={[2,2,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── PlayerDetail ──────────────────────────────────────────────────────────────

function PlayerDetail({ address, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actTab, setActTab] = useState('all');

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`${API}/api/players/${address}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [address]);

  if (loading) return <div className="feed-empty" style={{ padding: 60, textAlign: 'center' }}>Loading…</div>;
  if (!data?.stats) return <div className="feed-empty" style={{ padding: 40 }}>No data for this address.</div>;

  const { stats, activity, vault, breakdown, history, influence } = data;
  const net        = (stats.earned ?? 0) + (stats.dex_bought ?? 0) - (stats.spent ?? 0) - (stats.dex_sold ?? 0);
  const totalEarned = stats.earned ?? 0;
  const totalSpent  = stats.spent  ?? 0;

  const actFiltered = actTab === 'all'    ? activity
    : actTab === 'earn' ? activity.filter(r => r.kind === 'MINT')
    : actTab === 'spend'? activity.filter(r => r.kind === 'SPEND' || r.kind === 'BURN')
    : actTab === 'dex'  ? activity.filter(r => r.kind === 'TRANSFER' && (r.to_addr === LP || r.from_addr === LP))
    : activity;

  return (
    <div>
      <button className="toggle-btn" onClick={onBack} style={{ marginBottom: 16 }}>← All Players</button>

      {/* ── Header ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <a href={`https://mega.etherscan.io/address/${address}`} target="_blank" rel="noopener noreferrer"
             style={{ color: 'var(--gold)', fontFamily: 'JetBrains Mono', fontSize: 13, wordBreak: 'break-all' }}>
            {address}
          </a>
          <span style={{ fontSize: 10, color: 'var(--text-2)', marginLeft: 'auto' }}>
            Active {absTime(stats.first_active)} → {timeAgo(stats.last_active)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <StatBox label="TOTAL OPS"     value={(stats.ops ?? 0).toLocaleString()}  color="var(--gold)" />
          <StatBox label="DIRTY EARNED"  value={fmtD(totalEarned)}       color="var(--green)" />
          <StatBox label="DIRTY SPENT"   value={fmtD(totalSpent)}        color="var(--red)" />
          <StatBox label="NET DIRTY"     value={fmtD(net)}               color={net >= 0 ? 'var(--green)' : 'var(--red)'} />
          <StatBox label="INF BOUGHT"    value={(influence?.totalPurchased ?? 0).toLocaleString()}  color="#4a9fd8" sub={influence?.purchaseCount > 0 ? `${influence.purchaseCount} purchases` : undefined} />
          <StatBox label="INF REFUNDED"  value={(influence?.totalRefunded  ?? 0).toLocaleString()}  color="var(--green)" />
          <StatBox label="DEX SOLD"      value={fmtD(stats.dex_sold)}    color="#e05252" sub={stats.dex_sold > 0 ? `${breakdown?.dex_sold?.cnt ?? 0} txs` : undefined} />
          <StatBox label="DEX BOUGHT"    value={fmtD(stats.dex_bought)}  color="#3ecf6a" sub={stats.dex_bought > 0 ? `${breakdown?.dex_bought?.cnt ?? 0} txs` : undefined} />
          <StatBox label="VAULT CLAIMED" value={fmtUsd(stats.vault_claimed)} color="var(--gold)" sub={stats.vault_count > 0 ? `${stats.vault_count} payouts` : undefined} />
          <StatBox label="BALANCE"       value={fmtD(stats.balance)}     color="var(--text)" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {/* ── Ops breakdown (earned) ── */}
        <div className="card">
          <Section title="DIRTY EARNED BY OPERATION">
            {breakdown?.earned?.length ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'JetBrains Mono' }}>
                <thead>
                  <tr style={{ color: 'var(--text-2)', fontSize: 10 }}>
                    <th style={{ textAlign: 'left', padding: '3px 6px' }}>TYPE</th>
                    <th style={{ textAlign: 'right', padding: '3px 6px' }}>OPS</th>
                    <th style={{ textAlign: 'right', padding: '3px 6px' }}>DIRTY</th>
                    <th style={{ textAlign: 'right', padding: '3px 6px' }}>SHARE</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.earned.map(r => (
                    <tr key={r.op_type} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 6px' }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: OP_COLORS[r.op_type] ?? '#888', marginRight: 6 }} />
                        {OP_LABELS[r.op_type] ?? r.op_type}
                      </td>
                      <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-2)' }}>{r.cnt.toLocaleString()}</td>
                      <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--green)' }}>{fmtD(r.total)}</td>
                      <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-2)' }}>{pct(r.total, totalEarned)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="feed-empty">No ops yet</div>}
          </Section>
        </div>

        {/* ── Spend breakdown ── */}
        <div className="card">
          <Section title="HOW DIRTY WAS SPENT">
            {breakdown?.spent?.length ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'JetBrains Mono' }}>
                <thead>
                  <tr style={{ color: 'var(--text-2)', fontSize: 10 }}>
                    <th style={{ textAlign: 'left', padding: '3px 6px' }}>TYPE</th>
                    <th style={{ textAlign: 'right', padding: '3px 6px' }}>COUNT</th>
                    <th style={{ textAlign: 'right', padding: '3px 6px' }}>DIRTY</th>
                    <th style={{ textAlign: 'right', padding: '3px 6px' }}>SHARE</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.spent.map(r => (
                    <tr key={r.op_type} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 6px' }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: OP_COLORS[r.op_type] ?? '#888', marginRight: 6 }} />
                        {OP_LABELS[r.op_type] ?? r.op_type}
                      </td>
                      <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-2)' }}>{r.cnt.toLocaleString()}</td>
                      <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--red)' }}>{fmtD(r.total)}</td>
                      <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-2)' }}>{pct(r.total, totalSpent)}</td>
                    </tr>
                  ))}
                  {(stats.dex_sold ?? 0) > 0 && (
                    <tr style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 6px' }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#e05252', marginRight: 6 }} />
                        DEX Sell
                      </td>
                      <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-2)' }}>{breakdown?.dex_sold?.cnt ?? '—'}</td>
                      <td style={{ textAlign: 'right', padding: '4px 6px', color: '#e05252' }}>{fmtD(stats.dex_sold)}</td>
                      <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-2)' }}>—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : <div className="feed-empty">Nothing spent</div>}
          </Section>
        </div>
      </div>

      {/* ── Daily history chart ── */}
      {history?.length > 1 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <Section title="$DIRTY FARMED OVER TIME (DAILY)">
            <HistoryChart history={history} />
          </Section>
        </div>
      )}

      {/* ── Vault payouts ── */}
      {vault?.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <Section title={`VAULT PAYOUTS (${vault.length})`}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '5px 16px', fontSize: 11, fontFamily: 'JetBrains Mono' }}>
              {vault.map(v => (
                <React.Fragment key={`${v.hash}-${v.log_index}`}>
                  <span style={{ color: 'var(--text-2)' }}>{absTime(v.timestamp)}</span>
                  <a href={`https://mega.etherscan.io/tx/${v.hash}`} target="_blank" rel="noopener noreferrer"
                     style={{ color: 'var(--text-2)' }}>{v.hash.slice(0, 14)}…</a>
                  <span style={{ color: 'var(--gold)', textAlign: 'right' }}>{fmtUsd(v.amount)}</span>
                </React.Fragment>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* ── Activity feed ── */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: 'var(--text-2)', letterSpacing: '0.1em' }}>ACTIVITY</span>
          <div className="chart-toggle" style={{ marginLeft: 8 }}>
            {[['all','All'], ['earn','Earned'], ['spend','Spent'], ['dex','DEX']].map(([k, l]) => (
              <button key={k} className={`toggle-btn ${actTab === k ? 'toggle-btn--active' : ''}`}
                onClick={() => setActTab(k)} style={{ fontSize: 10 }}>{l}</button>
            ))}
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-2)' }}>{actFiltered.length} events</span>
        </div>
        <div style={{ overflowY: 'auto', maxHeight: 420 }}>
          {actFiltered.length === 0
            ? <div className="feed-empty">No activity</div>
            : actFiltered.map(row => {
                const { label, color, dir } = classifyRow(row, address);
                return (
                  <div key={`${row.hash}-${row.log_index}`}
                    style={{ display: 'grid', gridTemplateColumns: '130px 1fr 110px 90px', gap: 8, padding: '5px 0',
                             borderBottom: '1px solid var(--border)', fontSize: 11, fontFamily: 'JetBrains Mono', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-2)', fontSize: 10 }}>{timeAgo(row.timestamp)}</span>
                    <a href={`https://mega.etherscan.io/tx/${row.hash}`} target="_blank" rel="noopener noreferrer"
                       style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.hash.slice(0, 16)}…
                    </a>
                    <span style={{ color }}>{label}</span>
                    <span style={{ color, textAlign: 'right' }}>{dir}{fmtD(row.amount)}</span>
                  </div>
                );
              })
          }
        </div>
      </div>
    </div>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

export default function PlayersPage() {
  const [players, setPlayers] = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState(null);
  const [sort, setSort] = useState('earned');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/players?limit=500`);
      const d = await r.json();
      setPlayers(d.players ?? []);
      setTotal(d.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = players.filter(p =>
    !search || p.addr.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'earned')     return (b.earned ?? 0) - (a.earned ?? 0);
    if (sort === 'spent')      return (b.spent ?? 0) - (a.spent ?? 0);
    if (sort === 'dex_sold')   return (b.dex_sold ?? 0) - (a.dex_sold ?? 0);
    if (sort === 'dex_bought') return (b.dex_bought ?? 0) - (a.dex_bought ?? 0);
    if (sort === 'ops')        return (b.ops ?? 0) - (a.ops ?? 0);
    if (sort === 'net') {
      const na = (a.earned ?? 0) + (a.dex_bought ?? 0) - (a.spent ?? 0) - (a.dex_sold ?? 0);
      const nb = (b.earned ?? 0) + (b.dex_bought ?? 0) - (b.spent ?? 0) - (b.dex_sold ?? 0);
      return nb - na;
    }
    if (sort === 'last_active') return (b.last_active ?? 0) - (a.last_active ?? 0);
    return 0;
  });

  if (selected) {
    return (
      <div className="content">
        <PlayerDetail address={selected} onBack={() => setSelected(null)} />
      </div>
    );
  }

  const SortHdr = ({ col, label }) => (
    <span style={{ cursor: 'pointer', color: sort === col ? 'var(--gold)' : 'var(--text-2)', userSelect: 'none' }}
          onClick={() => setSort(col)}>
      {label}{sort === col ? ' ↓' : ''}
    </span>
  );

  return (
    <div className="content">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <span className="card-title" style={{ margin: 0 }}>PLAYER ACTIVITY &amp; PNL</span>
        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{total.toLocaleString()} players</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="search address…"
          style={{
            marginLeft: 'auto', background: 'var(--bg-2)', border: '1px solid var(--border)',
            color: 'var(--text)', padding: '5px 10px', borderRadius: 4,
            fontFamily: 'JetBrains Mono', fontSize: 11, width: 240,
          }}
        />
        {search && /^0x[0-9a-fA-F]{40}$/.test(search) && (
          <button className="toggle-btn toggle-btn--active" onClick={() => setSelected(search.toLowerCase())}>
            View →
          </button>
        )}
      </div>

      <div className="card" style={{ overflow: 'auto' }}>
        {loading ? (
          <div className="feed-empty" style={{ padding: 40 }}>Loading players…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'JetBrains Mono' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-2)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px', width: 36 }}>#</th>
                <th style={{ padding: '6px 8px' }}>ADDRESS</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="earned"      label="EARNED" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="ops"         label="OPS" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="spent"       label="COSTS" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="net"         label="NET" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="dex_sold"    label="DEX SOLD" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="dex_bought"  label="DEX BOUGHT" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="last_active" label="LAST ACTIVE" /></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const net = (p.earned ?? 0) + (p.dex_bought ?? 0) - (p.spent ?? 0) - (p.dex_sold ?? 0);
                return (
                  <tr key={p.addr} onClick={() => setSelected(p.addr)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={{ padding: '5px 8px', color: 'var(--text-2)' }}>{i + 1}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--gold)' }}>{shortAddr(p.addr)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--green)' }}>{fmtD(p.earned)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text-2)' }}>{(p.ops ?? 0).toLocaleString()}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--red)' }}>{fmtD(p.spent)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtD(net)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: '#e05252' }}>{p.dex_sold  > 0 ? fmtD(p.dex_sold)  : '—'}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: '#3ecf6a' }}>{p.dex_bought > 0 ? fmtD(p.dex_bought) : '—'}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text-2)' }}>{timeAgo(p.last_active)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
