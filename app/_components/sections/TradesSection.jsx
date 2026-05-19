'use client';
import { useState, useEffect, useMemo } from 'react';
import { Region, Seg, Sortable, GridCell, fmt } from '../terminal.jsx';
import { processTradeRows, renderTradeRow, usePagedRows, Pager } from '../trade-helpers.jsx';

export function TradesSection({ grid, liveTrades, ops, search, ethPrice, aliases, onWallet }) {
  const { spans, heights, resize } = grid;
  const [trxRange, setTrxRange] = useState('all');
  const [sortKey,  setSortKey]  = useState('buffer');
  const [sortDir,  setSortDir]  = useState('asc');
  const [focusPane] = useState(null);

  // 1s tick — only re-renders this section, keeping the live countdown/buffer fresh.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const tradesFiltered = useMemo(() => {
    let arr = liveTrades;
    if (search) arr = arr.filter((r) => r.id.toLowerCase().includes(search.toLowerCase()));
    arr = [...arr];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const x = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? x : -x;
    });
    return arr;
  }, [search, sortKey, sortDir, liveTrades]);

  function sortBy(k) {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  }

  // Process + paginate ongoing crimes (sorted/filtered before pagination so
  // total pages reflects the visible filtered set).
  const ongoingProcessed = useMemo(
    () => processTradeRows(tradesFiltered, trxRange, ethPrice),
    [tradesFiltered, trxRange, ethPrice, tick]
  );
  const ongoingPager = usePagedRows(ongoingProcessed);
  const opsPager     = usePagedRows(ops);

  return (
    <section id="sec-trades" className="tm-grid-12">
      <GridCell id="trades" span={spans['trades']} height={heights['trades']} onResize={(r) => resize('trades', r)}>
        <Region
          title="ongoing crimes"
          focus={focusPane === 'trades'}
          actions={<Seg value={trxRange} options={['all','active','auto']} onChange={setTrxRange} />}
        >
          <div className="tm-scroll-bl" style={{ maxHeight: 264, overflowY: 'auto', overflowX: 'hidden' }}>
            <table className="tm-tab tm-tab-bl" style={{ tableLayout: 'fixed', width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--t-bg)', zIndex: 1 }}>
                <tr>
                  <th style={{ width: 100, maxWidth: 100 }}><Sortable label="criminal" k="id"       sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th style={{ width: 72 }}><Sortable label="crime"   k="opType"   sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th style={{ width: 60 }}><Sortable label="ends"    k="endsIn"   sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th className="num" style={{ width: 52 }}><Sortable label="buffer"  k="buffer"   sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th className="num" style={{ width: 80 }}><Sortable label="busted price" k="liqPrice" sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th style={{ width: 40 }}><Sortable label="auto"     k="auto"     sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                </tr>
              </thead>
              <tbody>
                {ongoingPager.pageRows.map((r) => renderTradeRow(r, onWallet, aliases))}
              </tbody>
            </table>
          </div>
          <Pager {...ongoingPager} />
        </Region>
      </GridCell>

      <GridCell id="ops" span={spans['ops']} height={heights['ops']} onResize={(r) => resize('ops', r)}>
        <Region title="finished crimes" sub="live · last 250" focus={focusPane === 'ops'}>
          <div className="tm-scroll-bl" style={{ maxHeight: 264, overflowY: 'auto' }}>
            <table className="tm-tab tm-tab-bl">
              <thead style={{ position: 'sticky', top: 0, background: 'var(--t-bg)', zIndex: 1 }}>
                <tr>
                  <th>t</th>
                  <th>criminal</th>
                  <th>operation</th>
                  <th className="num">$dirty</th>
                </tr>
              </thead>
              <tbody>
                {opsPager.pageRows.map((o, i) => {
                  const success = o.result === 'completed' || o.result === 'ok';
                  const fail    = o.result === 'busted'    || o.result === 'fail';
                  return (
                  <tr key={`${o.hash || ''}-${opsPager.start + i}`}>
                    <td className="dim">{o.time}</td>
                    <td><span className="tm-num" style={{ cursor: 'pointer', color: 'var(--t-hdr)' }} onClick={() => onWallet(o.walletFull || o.wallet)}>{aliases[o.walletFull] || o.wallet}</span></td>
                    <td className={success ? 'pos' : fail ? 'neg' : ''}>{o.op}</td>
                    <td className={`num ${o.dirty > 0 ? 'pos' : o.dirty < 0 ? 'neg' : ''}`}>
                      {fmt.signed(o.dirty)}{o.count > 1 && <span className="dim" style={{ marginLeft: 4, fontSize: 'var(--t-fs-xs)' }}>{o.count}×</span>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager {...opsPager} />
        </Region>
      </GridCell>
    </section>
  );
}
