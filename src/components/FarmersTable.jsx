'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

function shortAddr(a) {
  if (!a) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function fmtD(n) {
  if (!n) return '0';
  n = Number(n);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(1);
}

const COLS = [
  { key: 'dirtyFarmed', label: 'DIRTY FARMED',  color: 'var(--green)',  fmt: fmtD },
  { key: 'mintOps',     label: 'FARM OPS',       color: 'var(--text-2)', fmt: n => n.toLocaleString() },
  { key: 'infConsumed', label: 'INF CONSUMED',   color: 'var(--amber)',  fmt: fmtD },
  { key: 'burnOps',     label: 'INF OPS',        color: 'var(--text-2)', fmt: n => n.toLocaleString() },
  { key: 'spent',       label: 'SPENT',          color: 'var(--red)',    fmt: fmtD },
  { key: 'net',         label: 'NET',            color: null,            fmt: fmtD, computed: r => r.dirtyFarmed - r.spent },
  { key: 'dexSold',     label: 'DEX SOLD',       color: 'var(--red)',    fmt: fmtD },
  { key: 'dexBought',   label: 'DEX BOUGHT',     color: 'var(--green)',  fmt: fmtD },
  { key: 'dirtyPerInf', label: 'DIRTY/INF',      color: 'var(--text-2)', fmt: n => n > 0 ? n.toFixed(1) : '—', computed: r => r.infConsumed > 0 ? r.dirtyFarmed / r.infConsumed : 0 },
  { key: 'opsDirty',    label: 'OPS/DIRTY',      color: 'var(--text-2)', fmt: n => n > 0 ? n.toFixed(4) : '—', computed: r => r.dirtyFarmed > 0 ? r.mintOps / r.dirtyFarmed : 0 },
  { key: 'successRate', label: 'SUCCESS%',        color: null,            fmt: n => n > 0 ? `${(n * 100).toFixed(1)}%` : '—', computed: r => r.missionOps > 0 ? r.successOps / r.missionOps : 0 },
];

export default function FarmersTable({ farmers, loading }) {
  const router = useRouter();
  const [sortCol, setSortCol] = useState('dirtyFarmed');
  const [search, setSearch]   = useState('');

  const enriched = useMemo(() => farmers.map(r => ({
    ...r,
    net:         r.dirtyFarmed - r.spent,
    dirtyPerInf: r.infConsumed > 0 ? r.dirtyFarmed / r.infConsumed : 0,
    opsDirty:    r.dirtyFarmed > 0  ? r.mintOps / r.dirtyFarmed    : 0,
    successRate: r.missionOps  > 0  ? r.successOps / r.missionOps  : 0,
  })), [farmers]);

  const rows = useMemo(() => enriched
    .filter(r => !search || r.addr.toLowerCase().includes(search.toLowerCase()))
    .slice()
    .sort((a, b) => b[sortCol] - a[sortCol]),
  [enriched, search, sortCol]);

  const SortHdr = ({ col, label }) => (
    <span style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                   color: sortCol === col ? 'var(--gold)' : 'var(--text-2)' }}
          onClick={() => setSortCol(col)}>
      {label}{sortCol === col ? ' ↓' : ''}
    </span>
  );

  return (
    <div className="card" style={{ overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="filter address…"
          style={{
            width: 240, background: 'var(--bg)', border: '1px solid var(--border-2)',
            color: 'var(--text)', padding: '5px 10px', borderRadius: 4,
            fontFamily: 'var(--mono)', fontSize: 11, outline: 'none',
          }}
        />
        {search && /^0x[0-9a-fA-F]{40}$/.test(search) && (
          <button className="toggle-btn toggle-btn--active"
            onClick={() => router.push(`/players/${search.toLowerCase()}`)}
            style={{ fontSize: 10, padding: '5px 12px' }}>VIEW →</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>
          {rows.length} farmers
        </span>
      </div>

      {loading ? (
        <div className="feed-empty" style={{ padding: 32 }}>Loading farmers…</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'JetBrains Mono' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-2)', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px', width: 32 }}>#</th>
              <th style={{ padding: '6px 8px' }}>ADDRESS</th>
              {COLS.map(c => (
                <th key={c.key} style={{ padding: '6px 8px', textAlign: 'right' }}>
                  <SortHdr col={c.key} label={c.label} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.addr}
                onClick={() => router.push(`/players/${r.addr}`)}
                style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
                <td style={{ padding: '5px 8px', color: 'var(--text-2)' }}>{i + 1}</td>
                <td style={{ padding: '5px 8px', color: 'var(--gold)' }}>{shortAddr(r.addr)}</td>
                {COLS.map(c => {
                  const val = r[c.key];
                  let color = c.color;
                  if (c.key === 'net')         color = val >= 0 ? 'var(--green)' : 'var(--red)';
                  if (c.key === 'successRate') color = val >= 0.85 ? 'var(--green)' : val >= 0.65 ? 'var(--amber)' : val > 0 ? 'var(--red)' : 'var(--text-3)';
                  return (
                    <td key={c.key} style={{ padding: '5px 8px', textAlign: 'right', color: color ?? 'var(--text-2)' }}>
                      {c.fmt(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
