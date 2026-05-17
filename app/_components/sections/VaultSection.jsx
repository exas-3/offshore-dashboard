'use client';
import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Region, KV, KVSep, LineChart, GridCell } from '../terminal.jsx';
import { CHART_AXIS, TmTooltip, fmtK, median } from '../trade-helpers.jsx';

export function VaultSection({ D, grid, aliases, onWallet }) {
  const { spans, heights, resize } = grid;
  const [stakingData, setStakingData] = useState(null);

  useEffect(() => {
    const load = () => fetch('/api/staking').then(r => r.json()).then(setStakingData).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const lastCycle   = D.usdmPerCycle.at(-1);
  const lastRecip   = D.recipientsPerCycle.at(-1);
  const medUsdm     = Math.round(median(D.usdmPerCycle.map(c => c.v)));
  const medNewRecip = Math.round(median((D.newRecipientsPerCycle || []).map(c => c.v)));

  return (
    <section id="sec-vault" className="tm-grid-12">
      <GridCell id="vault" span={spans['vault']} height={heights['vault']} onResize={(r) => resize('vault', r)}>
        <Region title="swiss vault distribution" sub="cycles">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14, alignItems: 'flex-start' }}>
            <div>
              <KV k="total distributed" v={`${D.distributionTotals.totalLabel} USDm`} cls="hdr" />
              <KV k="cycles paid" v={String(D.distributionTotals.cyclesPaid)} />
              <KV k="unique recipients" v={D.distributionTotals.uniqueRecipients.toLocaleString()} />
              {lastCycle && <KV k="last cycle" v={`${fmtK(lastCycle.v)} USDm`} sub={`${lastRecip ? lastRecip.v : '—'} recipients · ${lastCycle.t}`} />}
              <KVSep />
              <KV k="median per cycle"     v={`${fmtK(medUsdm)} USDm`} />
              <KV k="new recipients / cycle" v={medNewRecip ? `~${medNewRecip}` : '—'} cls="dim" />
            </div>
            <div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={D.usdmPerCycle.map((d) => ({ label: d.t, usdm: d.v }))} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--t-rule)" vertical={false} />
                  <XAxis dataKey="label" tick={CHART_AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={CHART_AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? Math.round(v/1000)+'k' : String(Math.round(v))} />
                  <Tooltip content={<TmTooltip valueFmt={(v) => v >= 1000 ? (v/1000).toFixed(2)+'k' : String(Math.round(v))} />} />
                  <Bar dataKey="usdm" name="USDm" fill="var(--t-hdr)" maxBarSize={40} radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Region>
      </GridCell>

      <GridCell id="top-stakers" span={spans['top-stakers']} onResize={(r) => resize('top-stakers', r)}>
        <Region title={`all stakers${stakingData?.stats?.uniqueStakers ? ` · ${stakingData.stats.uniqueStakers.toLocaleString()} total` : ''}`} sub="by $dirty staked">
          {!stakingData?.top24h?.length ? (
            <span className="dim">no staking activity in the last 24h</span>
          ) : (
            <div className="tm-scroll-bl" style={{ maxHeight: 264, overflowY: 'auto' }}>
              <table className="tm-tab tm-tab-bl">
                <thead style={{ position: 'sticky', top: 0, background: 'var(--t-bg)', zIndex: 1 }}>
                  <tr>
                    <th>#</th>
                    <th>wallet</th>
                    <th className="num">$dirty staked</th>
                  </tr>
                </thead>
                <tbody>
                  {stakingData.top24h.map((s, i) => (
                    <tr key={s.user}>
                      <td className="dim">{i + 1}</td>
                      <td>
                        <span className="tm-num" style={{ cursor: 'pointer', color: 'var(--t-hdr)' }} onClick={() => onWallet && onWallet(s.user)}>
                          {s.alias || aliases[s.user] || `${s.user.slice(0, 6)}..${s.user.slice(-4)}`}
                        </span>
                      </td>
                      <td className="num pos">{s.total >= 1000 ? (s.total / 1000).toFixed(1) + 'k' : s.total.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Region>
      </GridCell>

      <GridCell id="staking-chart" span={spans['staking-chart']} onResize={(r) => resize('staking-chart', r)}>
        <Region
          title="faction staking"
          sub={stakingData?.stats
            ? `${(stakingData.stats.totalStaked / 1e3).toFixed(1)}k $dirty staked · ${stakingData.stats.uniqueStakers} stakers · rotation ${stakingData.stats.currentRotation}`
            : 'loading…'}
          fill
        >
          {stakingData?.dailyChart?.length > 0 ? (
            <LineChart
              data={stakingData.dailyChart.map(d => ({ x: d.label, v: d.total }))}
              color="pos"
              fill
              valueFmt={(v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v))}
            />
          ) : (
            <span className="dim">no data</span>
          )}
        </Region>
      </GridCell>
    </section>
  );
}
