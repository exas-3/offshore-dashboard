'use client';
import { Region, KV, KVSep, GridCell, LineChart } from '../terminal.jsx';
import { fmtK, median } from '../trade-helpers.jsx';

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
        <Region title="swiss vault distribution" sub="cumulative · USDm">
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
              <LineChart
                data={(() => {
                  let running = 0;
                  return (D.usdmPerDay || []).map((d) => {
                    running += Number(d.v) || 0;
                    return { t: d.t, v: running };
                  });
                })()}
                color="hdr"
                fill
                valueFmt={(v) => v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'k' : String(Math.round(v))}
              />
            </div>
          </div>
        </Region>
      </GridCell>
    </section>
  );
}
