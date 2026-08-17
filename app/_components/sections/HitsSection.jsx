'use client';
import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Region, GridCell, fmt } from '../terminal.jsx';
import { CHART_AXIS, TmTooltip, fmtLocalHour, usePagedRows, Pager } from '../trade-helpers.jsx';
import { useAtParam, useVirtualNow } from '../hooks/use-virtual-clock.js';

function shortAddr(a) {
  if (!a) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function relTime(ts, nowSec = null) {
  const diff = Math.max(0, (nowSec ?? Math.floor(Date.now() / 1000)) - Number(ts));
  if (diff < 60)        return `${diff}s ago`;
  if (diff < 3600)      return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)     return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function HitsSection({ D, grid, aliases = {}, onWallet }) {
  const { spans, heights, resize } = grid;
  const at = useAtParam();
  const vnow = useVirtualNow();
  // Seed from the slow /api/offshore-data payload so the panel is populated on
  // first paint, then poll /api/hits every 5s so newly-resolved hits appear
  // without waiting for the 60s offshore-data refresh. The poller already
  // indexes hits within ~1.5s via WS, so 5s polling is the user-visible delay.
  const [hitsData, setHitsData] = useState(D?.hits ?? { recent: [], summary: {}, buckets: [] });
  useEffect(() => {
    let alive = true;
    const refresh = () => fetch(`/api/hits${at ? `?${at}` : ''}`)
      .then(r => r.json())
      .then(d => { if (alive && d && !d.error) setHitsData(d); })
      .catch(() => {});
    if (at) refresh(); // demo: refetch when the virtual minute moves
    const t = setInterval(refresh, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [at]);
  const data    = hitsData;
  const summary = data.summary ?? {};
  const recent  = Array.isArray(data.recent)  ? data.recent  : [];
  const buckets = Array.isArray(data.buckets) ? data.buckets : [];
  const recentPager = usePagedRows(recent);

  // Bar-chart data — hourly DIRTY burned vs stolen, plus hit count on a
  // separate axis (count is 1-2 orders of magnitude smaller than DIRTY).
  const chartData = buckets.map(b => ({
    ts:     Number(b.ts),
    x:      fmtLocalHour(Number(b.ts)),
    burned: Number(b.burned),
    stolen: Number(b.stolen),
    n:      Number(b.n),
  }));

  const winRatePct = summary.total > 0
    ? `${(summary.winRate * 100).toFixed(1)}%`
    : '—';

  return (
    <section id="sec-hits" className="tm-grid-12">
      <GridCell id="hits-table" span={spans['hits-table']} height={heights['hits-table']} onResize={(r) => resize('hits-table', r)}>
        <Region title="recent hits" sub={`last ${recent.length}`}>
          <div className="tm-scroll-bl" style={{ maxHeight: 264, overflowY: 'auto', overflowX: 'hidden' }}>
            <table className="tm-tab tm-tab-bl" style={{ tableLayout: 'fixed', width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--t-bg)', zIndex: 1 }}>
                <tr>
                  <th style={{ width: 56 }}>time</th>
                  <th style={{ width: 100 }}>hitter</th>
                  <th className="num" style={{ width: 56 }}>cost</th>
                  <th style={{ width: 32 }}>w/l</th>
                  <th className="num" style={{ width: 64 }}>net</th>
                  <th style={{ width: 100 }}>hitted</th>
                  <th className="num" style={{ width: 56 }}>compl%</th>
                  <th className="num" style={{ width: 56 }}>kept</th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && (
                  <tr><td colSpan={8} className="dim" style={{ padding: '6px 0', fontSize: 'var(--t-fs-xs)' }}>no hits yet</td></tr>
                )}
                {recentPager.pageRows.map(h => {
                  const net    = Number(h.stolen) - Number(h.cost);
                  const won    = net > 0;
                  const cmpl   = Number(h.completion) / 100;
                  const aLabel = aliases[h.attacker] || shortAddr(h.attacker);
                  const vLabel = aliases[h.victim]   || shortAddr(h.victim);
                  return (
                    <tr key={`${h.tx_hash}`}>
                      <td className="dim" style={{ fontSize: 'var(--t-fs-xs)' }}>{relTime(h.timestamp, vnow)}</td>
                      <td style={{ fontSize: 'var(--t-fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {onWallet
                          ? <span style={{ cursor: 'pointer' }} onClick={() => onWallet(h.attacker)}>{aLabel}</span>
                          : aLabel}
                      </td>
                      <td className="num neg" style={{ fontSize: 'var(--t-fs-xs)' }}>−{fmt.k(Number(h.cost))}</td>
                      <td className={won ? 'pos' : 'neg'} style={{ fontSize: 'var(--t-fs-xs)', fontWeight: 700 }}>{won ? 'W' : 'L'}</td>
                      <td className={`num ${won ? 'pos' : 'neg'}`} style={{ fontSize: 'var(--t-fs-xs)' }}>
                        {won ? '+' : '−'}{fmt.k(Math.abs(net))}
                      </td>
                      <td style={{ fontSize: 'var(--t-fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {onWallet
                          ? <span style={{ cursor: 'pointer' }} onClick={() => onWallet(h.victim)}>{vLabel}</span>
                          : vLabel}
                      </td>
                      <td className="num dim" style={{ fontSize: 'var(--t-fs-xs)' }}>{cmpl.toFixed(1)}%</td>
                      <td className="num pos" style={{ fontSize: 'var(--t-fs-xs)' }}>+{fmt.k(Number(h.kept))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager {...recentPager} />
        </Region>
      </GridCell>

      <GridCell id="hits-chart" span={spans['hits-chart']} height={heights['hits-chart']} onResize={(r) => resize('hits-chart', r)}>
        <Region
          title="hit volume"
          sub="last 24h · hourly"
          actions={
            <span style={{ fontSize: 'var(--t-fs-sm)', fontFamily: 'var(--t-font)' }}>
              <span className="k">win rate</span>{' '}
              <b className={summary.winRate >= 0.5 ? 'pos' : 'neg'}>{winRatePct}</b>{' '}
              <span className="dim">({summary.wins}/{summary.total})</span>
            </span>
          }
        >
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--t-rule)" vertical={false} />
              <XAxis dataKey="x" tick={CHART_AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="dirty" tick={CHART_AXIS} axisLine={false} tickLine={false} tickFormatter={fmt.k} />
              <YAxis yAxisId="count" orientation="right" allowDecimals={false} tick={CHART_AXIS} axisLine={false} tickLine={false} />
              <Tooltip content={<TmTooltip valueFmt={fmt.k} />} />
              <Line yAxisId="count" dataKey="n"      name="hits"   stroke="var(--t-warn)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line yAxisId="dirty" dataKey="burned" name="burned" stroke="var(--t-neg)"  strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line yAxisId="dirty" dataKey="stolen" name="stolen" stroke="var(--t-pos)"  strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ marginTop: 4, fontSize: 'var(--t-fs-sm)', color: 'var(--t-fg-soft)', display: 'flex', gap: 12, fontFamily: 'var(--t-font)' }}>
            <span><span style={{ color: 'var(--t-warn)' }}>█</span> hits</span>
            <span><span style={{ color: 'var(--t-neg)' }}>█</span> burned</span>
            <span><span style={{ color: 'var(--t-pos)' }}>█</span> stolen</span>
            <span className="dim">24h total: burned {fmt.k(Number(summary.burnedTotal || 0))} · stolen {fmt.k(Number(summary.stolenTotal || 0))} · {summary.total} hits</span>
          </div>
        </Region>
      </GridCell>
    </section>
  );
}
