'use client';
import { useState, useEffect } from 'react';
import { fmt } from './terminal.jsx';
import { fmtCountdownLocal } from './trade-helpers.jsx';

function Counter({ k, v, cls, tickKey }) {
  const [last, setLast] = useState(tickKey);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (tickKey !== last) {
      setPulse(true);
      setLast(tickKey);
      const t = setTimeout(() => setPulse(false), 600);
      return () => clearTimeout(t);
    }
  }, [tickKey, last]);
  return (
    <div className="tm-live-counter">
      <span className="k">{k}</span>
      <span className={`v ${cls || ''} ${pulse ? 'tick' : ''}`}>{v}</span>
    </div>
  );
}

export function LiveSidebar({ D, counters, ops, watch, trades, onWallet, aliases = {} }) {
  const [opsMatrix, setOpsMatrix] = useState(() => D.opsMatrix ?? null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const load = () => fetch('/api/ops-matrix').then(r => r.json()).then(setOpsMatrix).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const [poliziaList, setPoliziaList] = useState([]);
  const [poliziaTotal, setPoliziaTotal] = useState(0);
  const [splashing, setSplashing] = useState({});

  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/polizia', { cache: 'no-cache' });
        if (res.ok) {
          const { list, events, total } = await res.json();
          for (const ev of events) {
            if (ev.type === 'remove') {
              setSplashing(s => ({ ...s, [ev.id]: Date.now() }));
              setTimeout(() => setSplashing(s => { const n = { ...s }; delete n[ev.id]; return n; }), 700);
            }
          }
          setPoliziaList(list);
          if (total != null) setPoliziaTotal(total);
        }
      } catch {}
      if (live) setTimeout(poll, 5_000);
    };
    poll();
    return () => { live = false; };
  }, []);

  const WINDOWS = ['m1', 'm5', 'm15', 'm30', 'm60'];
  const WIN_LABELS = { m1: '1m', m5: '5m', m15: '15m', m30: '30m', m60: '60m' };
  const OPS_COLS = ['extortion', 'arms', 'drugs'];
  const OPS_LABELS = { extortion: 'ext', arms: 'arms', drugs: 'drug' };

  return (
    <div className="tm-live">
      <div className="tm-live-panel">
        <div className="tm-live-panel-h">
          <span><b>live</b> counters</span>
          <span className="rule" />
          <span className="v"><span className="tm-blink" style={{ color: 'var(--t-pos)' }}>●</span></span>
        </div>
        <Counter k="active players /24" v={counters.daw.toLocaleString()} />
        <Counter k="total players"    v={D.newParticipantsTotal.toLocaleString()} />
        <Counter k="finished ops/min"  v={Math.round(counters.opsMin).toLocaleString()}        tickKey={counters._bump} />
        <Counter k="finished ops/hour" v={Math.round(counters.opsMin * 60).toLocaleString()}    tickKey={counters._bump} />
        <Counter k="active ops"        v={counters.activeOps.toLocaleString()}                  tickKey={counters._bump} />
        <Counter k="$dirty"     v={`$${counters.dirty.toFixed(4)}`} cls="warn"   tickKey={counters._bump} />
        <Counter k="op cost"    v={`${counters.opCost.toFixed(2)} INF`}          tickKey={counters._bump} />
      </div>

      <div className="tm-live-panel">
        <div className="tm-live-panel-h">
          <span><b>polizia</b> imminent</span>
          <span className="rule" />
          <span className="v">{poliziaTotal}</span>
        </div>
        {poliziaList.flatMap((r) => {
          const liveBuffer = Math.round((counters.eth - r.liqPrice) * 100) / 100;
          if (liveBuffer < 0) return [];
          const endsIn = fmtCountdownLocal(r.endTime);
          const urgent = r.endTime > 0 && endsIn !== '—' && endsIn.length <= 5;
          const cls = urgent ? 'urgent' : 'safe';
          return [(
            <div key={r.id} className={`tm-watch ${cls}`} style={{ cursor: 'pointer' }} onClick={() => onWallet && onWallet(r.wallet)}>
              <span className="l">
                <span className="id">{aliases[r.wallet] || r.walletShort}</span>
                <span className="sub">liq {r.liqPrice.toLocaleString()}</span>
              </span>
              <span className="r">
                <span className={`buf ${liveBuffer < 1 ? 'tm-neg' : liveBuffer < 2 ? 'tm-warn' : 'tm-pos'}`}>+{liveBuffer.toFixed(2)}</span>
                <span className="ends">{endsIn}</span>
              </span>
            </div>
          )];
        })}
        {Object.keys(splashing).map(id => (
          <div key={`splash-${id}`} className="tm-watch underwater" style={{ animation: 'tm-splash-out 0.7s forwards' }}>
            <span className="l"><span className="id">{id}</span><span className="sub">liquidated</span></span>
            <span className="r"><span className="buf tm-neg">BUST</span></span>
          </div>
        ))}
      </div>

      <div className="tm-live-panel">
        <div className="tm-live-panel-h">
          <span><b>ops</b> feed</span>
          <span className="rule" />
          <span className="v">live</span>
        </div>
        <div className="tm-opfeed">
          {ops.slice(0, 6).map((o, i) => {
            const fadeCls = i >= 3 ? `fade${i >= 5 ? '-3' : i >= 4 ? '-2' : ''}` : '';
            return (
              <div key={`${o.time}-${i}`} className={`tm-opfeed-row ${fadeCls}`}>
                <span className="l">
                  <span className="t">{aliases[o.walletFull] || o.wallet}</span>
                  <span className="op">{o.op}</span>
                </span>
                <span className={`v ${[100, 115, 130].includes(o.dirty) ? 'pos' : 'neg'}`}>
                  {fmt.signed(o.dirty)}{o.count > 1 && <span style={{ opacity: 0.5, fontSize: '0.8em', marginLeft: 2 }}>{o.count}×</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="tm-live-panel">
        <div className="tm-live-panel-h">
          <span><b>crimes</b> matrix</span>
          <span className="rule" />
          <span className="v">60m</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--t-fs-xs)', fontFamily: 'var(--t-font)' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', color: 'var(--t-fg-mut)', fontWeight: 400, paddingBottom: 3 }}></th>
              {OPS_COLS.map(c => (
                <th key={c} style={{ textAlign: 'right', color: 'var(--t-fg-mut)', fontWeight: 400, paddingBottom: 3, letterSpacing: '0.06em' }}>{OPS_LABELS[c]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WINDOWS.map(w => (
              <tr key={w}>
                <td style={{ color: 'var(--t-fg-mut)', paddingRight: 6, paddingBottom: 1 }}>{WIN_LABELS[w]}</td>
                {OPS_COLS.map(c => {
                  const cell = opsMatrix?.[c]?.[w] ?? { ok: 0, bust: 0 };
                  const ok   = typeof cell === 'object' ? cell.ok   : cell;
                  const bust = typeof cell === 'object' ? cell.bust : 0;
                  return (
                    <td key={c} style={{ textAlign: 'right', paddingBottom: 1, whiteSpace: 'nowrap' }}>
                      <span style={{ color: ok > 0 ? 'var(--t-pos)' : 'var(--t-fg-mut)' }}>{ok}</span>
                      <span style={{ color: 'var(--t-fg-mut)', margin: '0 1px' }}>/</span>
                      <span style={{ color: bust > 0 ? 'var(--t-neg)' : 'var(--t-fg-mut)' }}>{bust}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tm-live-panel">
        <div className="tm-live-panel-h">
          <span><b>dirty</b> transactions</span>
          <span className="rule" />
          <span className="v">live</span>
        </div>
        <div className="tm-opfeed">
          {trades.filter(t => t.kind === 'buy' || t.kind === 'sell').slice(0, 6).map((t, i) => {
            const fadeCls = i >= 3 ? `fade${i >= 5 ? '-3' : i >= 4 ? '-2' : ''}` : '';
            return (
              <div key={`${t._ts}-${i}`} className={`tm-opfeed-row ${fadeCls}`} style={{ cursor: t.addrFull ? 'pointer' : 'default' }} onClick={() => t.addrFull && onWallet && onWallet(t.addrFull)}>
                <span className="l">
                  <span className={`op ${t.kind === 'buy' ? 'pos' : 'neg'}`}>{t.label}</span>
                  <span className="t">{t._amount != null ? Math.round(t._amount).toLocaleString() : t.amount}</span>
                </span>
                <span className={`v ${t.kind === 'buy' ? 'pos' : 'neg'}`}>${t._amount != null ? Math.round(t._amount * counters.dirty).toLocaleString() : '—'}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
