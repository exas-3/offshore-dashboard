'use client';
import { useEffect, useState, useMemo } from 'react';
import { Region, GridCell, Sortable, fmt, LabelChip } from '../terminal.jsx';
import { usePagedRows, Pager } from '../trade-helpers.jsx';
import { useAtParam } from '../hooks/use-virtual-clock.js';

function shortAddr(a) {
  if (!a) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// Top earners per cycle from Supabase cycle_user_results (in our DB as
// cycle_rewards). Cycle picker on the right lets the user scrub backward.
export function CycleEarnersSection({ grid, aliases = {}, onWallet, noSection = false }) {
  const { spans, heights, resize } = grid;
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [cycle, setCycle]     = useState(null);
  const [sortKey, setSortKey] = useState('rank');
  const [sortDir, setSortDir] = useState('asc');

  const at = useAtParam(300);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = [cycle ? `cycle=${cycle}` : null, at || null].filter(Boolean).join('&');
    const url = `/api/cycle-earners${qs ? `?${qs}` : ''}`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (!alive || !d || d.error) return;
        setData(d);
        if (!cycle && d.cycle) setCycle(d.cycle);
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [cycle, at]);

  function sortBy(k) {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'rank' ? 'asc' : 'desc'); }
  }

  const rows = data?.items ?? [];
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const x = typeof av === 'number'
        ? av - bv
        : String(av ?? '').localeCompare(String(bv ?? ''));
      return sortDir === 'asc' ? x : -x;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const pager = usePagedRows(sorted);
  const cycles = data?.cycles ?? [];

  // Cycle picker — dropdown of recent cycles with user count + pool size.
  const picker = (
    <select
      value={cycle ?? ''}
      onChange={(e) => setCycle(Number(e.target.value))}
      style={{
        background: 'var(--t-bg)',
        color: 'var(--t-fg)',
        border: '1px solid var(--t-rule)',
        fontFamily: 'var(--t-font)',
        fontSize: 'var(--t-fs-sm)',
        padding: '1px 6px',
        marginLeft: 8,
      }}
    >
      {cycles.map(c => (
        <option key={c.id} value={c.id}>
          cycle {c.id} · {c.users} users · ${fmt.k(c.pool)} pool
        </option>
      ))}
    </select>
  );

  const cell = (
    <GridCell id="cycle-earners" span={spans['cycle-earners'] ?? 12} height={heights['cycle-earners']} onResize={(r) => resize('cycle-earners', r)}>
        <Region
          title="top earners by cycle"
          sub="USDm allocated · sourced from cycle_user_results"
          actions={picker}
        >
          <div className="tm-scroll-bl" style={{ maxHeight: 420, overflowY: 'auto', overflowX: 'hidden' }}>
            <table className="tm-tab tm-tab-bl" style={{ tableLayout: 'fixed', width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--t-bg)', zIndex: 1 }}>
                <tr>
                  <th style={{ width: 36 }}><Sortable label="#"     k="rank"     sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th style={{ width: 180 }}><Sortable label="wallet" k="address" sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th style={{ width: 84 }}><Sortable label="behavior" k="label" sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th className="num" style={{ width: 96 }}><Sortable label="reward $m" k="reward" sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th className="num" style={{ width: 80 }}><Sortable label="flux"     k="flux"   sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th className="num" style={{ width: 56 }}><Sortable label="loadouts" k="loadouts" sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 && (
                  <tr><td colSpan={6} className="dim" style={{ padding: '6px 0', fontSize: 'var(--t-fs-xs)' }}>loading…</td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={6} className="dim" style={{ padding: '6px 0', fontSize: 'var(--t-fs-xs)' }}>no rows for this cycle</td></tr>
                )}
                {pager.pageRows.map((r) => {
                  const display = r.alias || aliases[r.address] || shortAddr(r.address);
                  return (
                    <tr key={r.address}>
                      <td className="dim" style={{ fontSize: 'var(--t-fs-xs)' }}>{r.rank}</td>
                      <td style={{ fontSize: 'var(--t-fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span
                          className="tm-num"
                          style={{ cursor: onWallet ? 'pointer' : 'default', color: 'var(--t-hdr)' }}
                          onClick={() => onWallet && onWallet(r.address)}
                        >{display}</span>
                      </td>
                      <td style={{ fontSize: 'var(--t-fs-xs)' }}>
                        <LabelChip label={r.label} size="xs" />
                      </td>
                      <td className="num pos" style={{ fontSize: 'var(--t-fs-xs)', fontWeight: 600 }}>${fmt.k(r.reward)}</td>
                      <td className="num dim" style={{ fontSize: 'var(--t-fs-xs)' }}>{fmt.n(r.flux)}</td>
                      <td className="num dim" style={{ fontSize: 'var(--t-fs-xs)' }}>{r.loadouts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager {...pager} />
        </Region>
      </GridCell>
  );
  return noSection ? cell : <section id="sec-cycle-earners" className="tm-grid-12">{cell}</section>;
}
