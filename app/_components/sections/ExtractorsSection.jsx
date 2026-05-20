'use client';
import { useEffect, useMemo, useState } from 'react';
import { Region, GridCell, Sortable, fmt, LabelChip } from '../terminal.jsx';
import { usePagedRows, Pager } from '../trade-helpers.jsx';

function shortAddr(a) {
  if (!a) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// Top extractors leaderboard. Polls /api/extractors every 60s (server-side
// cache TTL is 60s too, so this aligns).
//
// Score = (sold − 2×burned − bought + net P2P) × (2.5 if spent < 0.2×earned else 1).
// Per-address (no funder roll-up). See lib/db/extractors.js for the SQL.
export function ExtractorsSection({ grid, aliases = {}, onWallet, noSection = false }) {
  const { spans, heights, resize } = grid;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState('score');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    let alive = true;
    const refresh = () => fetch('/api/extractors')
      .then(r => r.json())
      .then(d => {
        if (!alive || !d || d.error) return;
        setRows(Array.isArray(d.rows) ? d.rows : []);
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  function sortBy(k) {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'address' ? 'asc' : 'desc'); }
  }

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

  const cell = (
    <GridCell id="extractors" span={spans['extractors'] ?? 12} height={heights['extractors']} onResize={(r) => resize('extractors', r)}>
        <Region
          title="top extractors"
          sub="score = sold − 2×burned − bought + net P2P (×2.5 if spent < 20% earned) · refresh 60s"
          actions={
            <span style={{
              fontSize: 'var(--t-fs-xs)',
              fontFamily: 'var(--t-font)',
              color: 'var(--t-warn)',
              border: '1px solid var(--t-warn)',
              padding: '1px 6px',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}>beta</span>
          }
        >
          <div className="tm-scroll-bl" style={{ maxHeight: 420, overflowY: 'auto', overflowX: 'hidden' }}>
            <table className="tm-tab tm-tab-bl" style={{ tableLayout: 'fixed', width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--t-bg)', zIndex: 1 }}>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th style={{ width: 160 }}><Sortable label="wallet"   k="address"    sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th style={{ width: 84 }}><Sortable label="behavior" k="label"      sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th className="num" style={{ width: 68 }}><Sortable label="earned"   k="earned"     sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th className="num" style={{ width: 68 }}><Sortable label="spent"    k="spent"      sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th className="num" style={{ width: 72 }}><Sortable label="dex sold" k="dex_sold"   sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th className="num" style={{ width: 76 }}><Sortable label="dex bought" k="dex_bought" sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th className="num" style={{ width: 72 }}><Sortable label="net p2p"  k="net_p2p"    sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th className="num" style={{ width: 80 }}><Sortable label="score"    k="score"      sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 && (
                  <tr><td colSpan={9} className="dim" style={{ padding: '6px 0', fontSize: 'var(--t-fs-xs)' }}>loading…</td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={9} className="dim" style={{ padding: '6px 0', fontSize: 'var(--t-fs-xs)' }}>no extractors found</td></tr>
                )}
                {pager.pageRows.map((r, i) => {
                  const display = r.alias || aliases[r.address] || shortAddr(r.address);
                  const rank    = pager.start + i + 1;
                  return (
                    <tr key={r.address}>
                      <td className="dim" style={{ fontSize: 'var(--t-fs-xs)' }}>{rank}</td>
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
                      <td className="num pos" style={{ fontSize: 'var(--t-fs-xs)' }}>{fmt.k(r.earned)}</td>
                      <td className="num neg" style={{ fontSize: 'var(--t-fs-xs)' }}>{fmt.k(r.spent)}</td>
                      <td className="num pos" style={{ fontSize: 'var(--t-fs-xs)' }}>{fmt.k(r.dex_sold)}</td>
                      <td className="num neg" style={{ fontSize: 'var(--t-fs-xs)' }}>{fmt.k(r.dex_bought)}</td>
                      <td className={`num ${r.net_p2p > 0 ? 'pos' : r.net_p2p < 0 ? 'neg' : 'dim'}`} style={{ fontSize: 'var(--t-fs-xs)' }}>
                        {r.net_p2p > 0 ? '+' : r.net_p2p < 0 ? '−' : ''}{fmt.k(Math.abs(r.net_p2p || 0))}
                      </td>
                      {/* extractor = bad → high positive score is red;
                          contributor = good → negative score is green. */}
                      <td className={`num ${r.score > 0 ? 'neg' : r.score < 0 ? 'pos' : 'dim'}`} style={{ fontSize: 'var(--t-fs-xs)', fontWeight: 600 }}>
                        {r.score > 0 ? '+' : r.score < 0 ? '−' : ''}{fmt.k(Math.abs(r.score))}
                      </td>
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
  return noSection ? cell : <section id="sec-extractors" className="tm-grid-12">{cell}</section>;
}
