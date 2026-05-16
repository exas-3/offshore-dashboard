'use client';
import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Region, Heatmap, LineChart, GridCell } from '../terminal.jsx';
import { CHART_AXIS, TmTooltip, fmtLocal } from '../trade-helpers.jsx';

export function PlayersSection({ D, grid }) {
  const { spans, heights, resize } = grid;

  const participantsChart = useMemo(() => {
    const players = D.totalPlayersChart || [];
    return D.dailyActiveWallets.map((d, i) => ({
      x: d.ts ? fmtLocal(d.ts) : d.x,
      daw: d.v,
      players: players[i]?.v ?? 0,
    }));
  }, [D]);

  return (
    <section id="sec-players" className="tm-grid-12">
      <GridCell id="heatmap" span={spans['heatmap']} height={heights['heatmap']} onResize={(r) => resize('heatmap', r)}>
        <Region title="ops activity heatmap" sub="last 7d · local">
          <Heatmap grid={D.heatmap} days={D.heatmapDayTs ? D.heatmapDayTs.map(fmtLocal) : D.heatmapDays} />
        </Region>
      </GridCell>

      <GridCell id="daw" span={spans['daw']} onResize={(r) => resize('daw', r)}>
        <Region title="daily active wallets" sub={`peak ${D.dailyActiveWalletsPeak.toLocaleString()}`}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={participantsChart.map(d => ({ x: d.x, v: d.daw }))} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--t-rule)" vertical={false} />
              <XAxis dataKey="x" tick={CHART_AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={CHART_AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => String(Math.round(v))} />
              <Tooltip content={<TmTooltip valueFmt={(v) => String(Math.round(v))} />} />
              <Bar dataKey="v" name="active wallets" fill="var(--t-fg)" maxBarSize={40} radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </Region>
      </GridCell>

      <GridCell id="total-players" span={spans['total-players']} onResize={(r) => resize('total-players', r)}>
        <Region title="total players" sub={`${D.newParticipantsTotal.toLocaleString()} all time`}>
          <LineChart
            data={(D.totalPlayersChart || []).map(r => ({ x: r.x, v: r.v }))}
            color="pos"
            fill
            valueFmt={(v) => v >= 1000 ? (v/1000).toFixed(1)+'k' : String(Math.round(v))}
          />
        </Region>
      </GridCell>
    </section>
  );
}
