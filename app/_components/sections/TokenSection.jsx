'use client';
import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Region, KV, KVSep, StackedBarRow, MultiSpark, LineChart, Seg, GridCell, fmt,
} from '../terminal.jsx';
import {
  CHART_AXIS, TmTooltip, localDates, fmtLocal, fmtLocalHour,
  fmtK,
} from '../trade-helpers.jsx';

export function TokenSection({ D, grid }) {
  const [econGran, setEconGran] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth <= 720 ? 'daily' : 'hourly'
  );
  const [infGran, setInfGran] = useState('hourly');

  const inf = D.influenceFlow.totals;
  const infMinted      = (inf.purchased || 0) + (inf.refunded || 0);
  // Refunded INF corresponds to busted ops (the INF cost is returned when an
  // op fails), so win rate = 1 - refund_rate.
  const infWinRate = infMinted > 0 ? ((infMinted - inf.refunded) / infMinted * 100).toFixed(1) + '%' : '—';
  const lastInfDay = D.influenceFlow.days.at(-1) || {};

  const idleCount     = Math.max(0, D.companies.totalCompanies - D.companies.activeTrades);
  const expiredCount  = Math.max(0, idleCount - Math.round(idleCount * 0.6));
  const trueIdleCount = idleCount - expiredCount;

  const { spans, heights, resize } = grid;

  return (
    <section id="sec-token" className="tm-grid-12">
      <GridCell id="emissions" span={spans['emissions']} height={heights['emissions']} onResize={(r) => resize('emissions', r)}>
        <Region
          title="emissions vs burn"
          sub={econGran}
          actions={<Seg value={econGran} options={['daily','hourly']} onChange={setEconGran} />}
        >
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={localDates(econGran === 'daily' ? (D.emissionsVsBurnDaily || D.emissionsVsBurn) : D.emissionsVsBurn, econGran === 'hourly')} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--t-rule)" vertical={false} />
              <XAxis dataKey="x" tick={CHART_AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={CHART_AXIS} axisLine={false} tickLine={false} tickFormatter={fmt.k} />
              <Tooltip content={<TmTooltip valueFmt={fmt.k} />} />
              <Bar dataKey="minted"       name="minted"   stackId="a" fill="var(--t-fg)"   maxBarSize={40} />
              <Bar dataKey="protocolMint" name="protocol" stackId="a" fill="var(--t-warn)" maxBarSize={40} />
              <Bar dataKey="spent"        name="spent"    fill="var(--t-neg)"              maxBarSize={40} radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ marginTop: 4, fontSize: 'var(--t-fs-sm)', color: 'var(--t-fg-soft)', display: 'flex', gap: 12, fontFamily: 'var(--t-font)' }}>
            <span><span style={{ color: 'var(--t-fg)' }}>█</span> minted</span>
            <span><span style={{ color: 'var(--t-warn)' }}>█</span> protocol</span>
            <span><span style={{ color: 'var(--t-neg)' }}>█</span> burned</span>
          </div>
        </Region>
      </GridCell>

      <GridCell id="burned" span={spans['burned']} height={heights['burned']} onResize={(r) => resize('burned', r)}>
        <Region title="$dirty burned" sub="daily · all">
          <StackedBarRow
            hideNum
            data={localDates(D.burnedDaily)}
            series={[
              { key: 'protocolBurn', label: 'protocol burn',  color: 'neg',  colorVar: 'neg' },
              { key: 'asset',        label: 'asset purchase', color: 'fg',   colorVar: 'fg' },
              { key: 'levelUp',      label: 'level up',       color: 'hdr',  colorVar: 'hdr' },
              { key: 'thirdEnt',     label: 'third ent',      color: 'warn', colorVar: 'warn' },
            ]}
          />
          <div style={{ marginTop: 4, fontSize: 'var(--t-fs-sm)', color: 'var(--t-fg-soft)', display: 'flex', gap: 12, fontFamily: 'var(--t-font)' }}>
            <span><span style={{ color: 'var(--t-neg)' }}>█</span> protocol</span>
            <span><span style={{ color: 'var(--t-fg)' }}>█</span> asset</span>
            <span><span style={{ color: 'var(--t-hdr)' }}>█</span> level-up</span>
            <span><span style={{ color: 'var(--t-warn)' }}>█</span> 3rd enterprise</span>
          </div>
        </Region>
      </GridCell>

      <GridCell id="supply" span={spans['supply']} height={heights['supply']} onResize={(r) => resize('supply', r)}>
        <Region title="$dirty valuation" sub="hourly · USDm">
          <LineChart
            data={localDates(D.marketCapChart || [], true)}
            color="warn"
            fill
            valueFmt={(v) => v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'k' : String(Math.round(v))}
            extraRows={(d) => d.price != null ? [{ k: 'price', v: `$${Number(d.price).toFixed(4)}` }] : []}
          />
        </Region>
      </GridCell>

      <GridCell id="company-state" span={spans['company-state']} height={heights['company-state']} onResize={(r) => resize('company-state', r)}>
        <Region title="company state" sub={`${D.companies.totalCompanies.toLocaleString()} total`}>
          <StackedBarRow
            hideNum
            data={[
              { x: 'active',   manual: Math.max(0, D.companies.activeTrades - D.companies.autoTradeOn), auto: D.companies.autoTradeOn },
              { x: 'inactive', expired: expiredCount, idle: trueIdleCount },
            ]}
            series={[
              { key: 'manual',  color: 'pos',  label: 'active'  },
              { key: 'auto',    color: 'fg',   label: 'auto-on' },
              { key: 'expired', color: 'neg',  label: 'expired' },
              { key: 'idle',    color: 'warn', label: 'idle'    },
            ]}
            valueFmt={(v) => String(Math.round(v))}
          />
          <div style={{ marginTop: 4, fontSize: 'var(--t-fs-sm)', color: 'var(--t-fg-soft)', display: 'flex', gap: 12, fontFamily: 'var(--t-font)' }}>
            <span><span style={{ color: 'var(--t-pos)' }}>█</span> active</span>
            <span><span style={{ color: 'var(--t-fg)' }}>█</span> auto-on</span>
            <span><span style={{ color: 'var(--t-neg)' }}>█</span> expired</span>
            <span><span style={{ color: 'var(--t-warn)' }}>█</span> idle</span>
          </div>
          <KVSep />
          <KV k="active trades"  v={D.companies.activeTrades.toLocaleString()} cls="pos" />
          <KV k="auto-trade on"  v={D.companies.autoTradeOn.toLocaleString()} sub={D.companies.autoTradeShareLabel} />
          <KV k="unique owners"  v={D.companies.uniqueOwners.toLocaleString()} />
          {D.leaderboard && D.leaderboard[0] && <KV k="largest co" v={D.leaderboard[0].wallet} cls="dim" sub={`${D.leaderboard[0].ops.toLocaleString()} ops · ${D.leaderboard[0].earned} earned`} />}
        </Region>
      </GridCell>

      <GridCell id="circ-supply" span={spans['circ-supply']} onResize={(r) => resize('circ-supply', r)}>
        <Region title="circulating supply" sub="hourly · $DIRTY">
          <LineChart
            data={localDates((D.marketCapChart || []).map(r => ({ ...r, v: r.supply })), true)}
            color="fg"
            fill
            valueFmt={(v) => v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'k' : String(Math.round(v))}
          />
        </Region>
      </GridCell>

      <GridCell id="dirty-price" span={spans['dirty-price']} onResize={(r) => resize('dirty-price', r)}>
        <Region title="$dirty price" sub="hourly · USDm">
          {(() => {
            const prices = (D.marketCapChart || []).map(r => r.price).filter(Boolean);
            const dataMin = prices.length ? Math.min(...prices) : 0;
            const dataMax = prices.length ? Math.max(...prices) : 1;
            return (
              <LineChart
                data={localDates((D.marketCapChart || []).map(r => ({ ...r, v: r.price })), true)}
                color="pos"
                fill
                yMin={dataMin * 0.95}
                yMax={dataMax}
                valueFmt={(v) => '$' + Number(v).toFixed(4)}
              />
            );
          })()}
        </Region>
      </GridCell>

      <GridCell id="influence-totals" span={spans['influence-totals']} height={heights['influence-totals']} onResize={(r) => resize('influence-totals', r)}>
        <Region title="influence flow" sub="all time">
          <KV k="purchased"   v={inf.purchased.toLocaleString()}   cls="pos" />
          <KV k="consumed"    v={inf.consumed.toLocaleString()}    cls="neg" />
          <KV k="refunded"    v={inf.refunded.toLocaleString()} />
          <KV k="circulating" v={inf.circulating.toLocaleString()} />
          <KVSep />
          <KV k="win rate"           v={infWinRate} cls="pos" />
        </Region>
      </GridCell>

      <GridCell id="influence-daily" span={spans['influence-daily']} height={heights['influence-daily']} onResize={(r) => resize('influence-daily', r)}>
        <Region title="influence flow" sub={infGran === 'hourly' ? 'last 24h · hourly' : 'last 9d · daily'}
          actions={<Seg value={infGran} options={['daily','hourly']} onChange={setInfGran} />}
          fill
        >
          {(() => {
            const src = infGran === 'hourly' ? (D.influenceFlow.hours || []) : D.influenceFlow.days;
            return (
              <MultiSpark
                labels={src.map(d => d.ts ? (infGran === 'hourly' ? fmtLocalHour(d.ts) : fmtLocal(d.ts)) : (d.x || ''))}
                series={[
                  { label: 'purchased', color: 'var(--t-pos)', data: src.map(d => d.purchased || 0) },
                  { label: 'consumed',  color: 'var(--t-neg)', data: src.map(d => d.consumed  || 0) },
                  { label: 'refunded',  color: 'var(--t-fg)',  data: src.map(d => d.refunded  || 0) },
                ]}
              />
            );
          })()}
        </Region>
      </GridCell>
    </section>
  );
}
