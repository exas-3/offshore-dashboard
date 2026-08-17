'use client';
import { useState, useEffect } from 'react';
import { Region, LineChart, GridCell } from '../terminal.jsx';
import { useAtParam } from '../hooks/use-virtual-clock.js';

export function StakingSection({ grid, aliases, onWallet }) {
  const { spans, heights, resize } = grid;
  const [stakingData, setStakingData] = useState(null);
  const at = useAtParam();

  useEffect(() => {
    const load = () => fetch(`/api/staking${at ? `?${at}` : ''}`).then(r => r.json()).then(setStakingData).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [at]);

  return (
    <section id="sec-staking" className="tm-grid-12">
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
