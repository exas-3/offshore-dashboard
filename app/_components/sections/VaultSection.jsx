'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Region, KV, KVSep, GridCell } from '../terminal.jsx';
import { CHART_AXIS, TmTooltip, fmtK, median } from '../trade-helpers.jsx';

export function VaultSection({ D, grid }) {
  const { spans, heights, resize } = grid;

  const lastCycle   = D.usdmPerCycle.at(-1);
  const lastRecip   = D.recipientsPerCycle.at(-1);
  // Median is computed off the per-DAY series (calendar-date totals) so it
  // tracks the same axis the bargraph shows. Weekday triples in Season 1
  // are summed into a single daily value before taking the median.
  const medUsdm     = Math.round(median((D.usdmPerDay || []).map(d => d.v)));
  const medNewRecip = Math.round(median((D.newRecipientsPerCycle || []).map(c => c.v)));

  return (
    <section id="sec-vault" className="tm-grid-12">
      <GridCell id="vault" span={spans['vault']} height={heights['vault']} onResize={(r) => resize('vault', r)}>
        <Region title="swiss vault distribution" sub="daily · USDm">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14, alignItems: 'flex-start' }}>
            <div>
              <KV k="total distributed" v={`${D.distributionTotals.totalLabel} USDm`} cls="hdr" />
              <KV k="cycles paid" v={String(D.distributionTotals.cyclesPaid)} />
              <KV k="unique recipients" v={D.distributionTotals.uniqueRecipients.toLocaleString()} />
              {lastCycle && <KV k="last cycle" v={`${fmtK(lastCycle.v)} USDm`} sub={`${lastRecip ? lastRecip.v : '—'} claimers · ${lastCycle.t}`} />}
              <KVSep />
              <KV k="median per day"       v={`${fmtK(medUsdm)} USDm`} />
              <KV k="new recipients / cycle" v={medNewRecip ? `~${medNewRecip}` : '—'} cls="dim" />
            </div>
            <div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={(D.usdmPerDay || []).map((d) => ({ label: d.t, usdm: d.v }))} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap="20%">
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
    </section>
  );
}
