// Bloomberg/data-mux patterns — 3 variants.
// Variant: 'amber' | 'green' | 'slate'

const { useState: useStateBB } = React;

function BloombergDash({ variant = 'amber' }) {
  const D = window.OFFSHORE_DATA;
  const cls = `bbg v-${variant}`;

  const burnTotals = D.burnedDaily.map((d) => d.protocolBurn + d.asset + d.levelUp + d.thirdEnt);
  const burnMax = Math.max(...burnTotals);

  return (
    <div className={cls}>
      <div className="bbg-status">
        <span className="bbg-status-cell"><em>OFFSHORE</em><b>&lt;HELP&gt;</b></span>
        <span className="bbg-status-cell"><em>DIRTY</em><b>0.0706</b><span className="neg">▼ 1.21%</span></span>
        <span className="bbg-status-cell"><em>OP COST</em><b>12.41 INF</b><span className="pos">▲ 0.18</span></span>
        <span className="bbg-status-cell"><em>BLOCK</em><b>4,128,907</b></span>
        <span className="bbg-status-cell"><em>TPS</em><b>982</b></span>
        <span className="bbg-status-cell"><em>GAS</em><b>0.001 gwei</b></span>
        <span className="bbg-status-cell"><em>HOLDERS</em><b>1,214</b><span className="pos">+12</span></span>
        <span className="bbg-status-cell"><em>STATUS</em><b className="bbg-blink" style={{ color: 'var(--pos)' }}>● LIVE</b></span>
      </div>

      <div className="bbg-cmdrow">
        <span className="bbg-tag bbg-tag-on">DASH</span>
        <span className="bbg-tag">VAULT</span>
        <span className="bbg-tag">OPS</span>
        <span className="bbg-tag">CO</span>
        <span className="bbg-tag">LB</span>
        <span>&gt;</span>
        <input defaultValue="OFFSHORE STATS --since 5/5 GO" />
        <span style={{ color: 'var(--fg-mut)' }}>13:42:08 UTC</span>
      </div>

      {/* Region 1: TOKEN ECONOMY */}
      <div className="bbg-region">
        <div className="bbg-region-head">
          <span>1) TOKEN ECONOMY</span>
          <span className="leader" />
          <span className="fkey">F2 · 1/4</span>
        </div>
        <div className="bbg-region-body">
          <div className="bbg-hero">
            <div>
              <div className="bbg-hero-k">$DIRTY SUPPLY</div>
              <div className="bbg-hero-v">10,360,024</div>
              <div className="bbg-hero-sub">total circulating</div>
            </div>
            <div>
              <div className="bbg-hero-k">BURNED / SUPPLY</div>
              <div className="bbg-hero-v hdr">1.52</div>
              <div className="bbg-hero-sub">15.73M burned all time</div>
            </div>
            <div>
              <div className="bbg-hero-k">TOTAL OPS</div>
              <div className="bbg-hero-v">27,826</div>
              <div className="bbg-hero-sub">23.62M $DIRTY emitted</div>
            </div>
            <div>
              <div className="bbg-hero-k">TOKEN HOLDERS</div>
              <div className="bbg-hero-v">1,214</div>
              <div className="bbg-hero-sub">2,131 unique wallets</div>
            </div>
          </div>
        </div>
      </div>

      <div className="bbg-region">
        <div className="bbg-region-head">
          <span>2) $DIRTY BURNED — DAILY</span>
          <span className="leader" />
          <span className="fkey">F3 · 2/4</span>
        </div>
        <div className="bbg-region-body">
          {D.burnedDaily.map((d, i) => {
            const total = burnTotals[i];
            return (
              <div className="bbg-bar-row" key={d.x}>
                <span className="lbl">{d.x}</span>
                <span className="track"><i style={{ width: `${(total / burnMax) * 100}%` }} /></span>
                <span className="num">{(total / 1000).toFixed(0)}k</span>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 18, padding: '8px 0 0', color: 'var(--fg-mut)', fontSize: 10 }}>
            <span>● PROTOCOL BURN</span><span>● ASSET PURCHASE</span><span>● LEVEL UP</span><span>● THIRD ENT</span>
          </div>
        </div>
      </div>

      <div className="bbg-grid-2">
        <div className="bbg-region" style={{ margin: '6px 4px 0 8px' }}>
          <div className="bbg-region-head">
            <span>3) INFLUENCE FLOW</span>
            <span className="leader" />
            <span className="fkey">F4</span>
          </div>
          <div className="bbg-region-body">
            <div className="bbg-kv"><div className="bbg-kv-k">PURCHASED</div><div className="bbg-kv-v">806,673</div></div>
            <div className="bbg-kv"><div className="bbg-kv-k">CONSUMED</div><div className="bbg-kv-v neg">1,946,376</div></div>
            <div className="bbg-kv"><div className="bbg-kv-k">REFUNDED</div><div className="bbg-kv-v pos">1,166,001</div></div>
            <div className="bbg-kv"><div className="bbg-kv-k">CIRCULATING</div><div className="bbg-kv-v">34,437</div></div>
            <div style={{ borderTop: '1px dotted var(--rule)', margin: '8px 0 6px' }} />
            <div className="bbg-kv"><div className="bbg-kv-k">NET FLOW (24H)</div><div className="bbg-kv-v neg">−245,800</div></div>
            <div className="bbg-kv"><div className="bbg-kv-k">REFUND RATE</div><div className="bbg-kv-v">60.0%</div></div>
            <div className="bbg-kv"><div className="bbg-kv-k">CONSUME RATE</div><div className="bbg-kv-v">100.5%</div></div>
          </div>
        </div>
        <div className="bbg-region" style={{ margin: '6px 8px 0 4px' }}>
          <div className="bbg-region-head">
            <span>4) PLAYER ACTIVITY</span>
            <span className="leader" />
            <span className="fkey">F5</span>
          </div>
          <div className="bbg-region-body">
            <div className="bbg-kv"><div className="bbg-kv-k">DAW PEAK</div><div className="bbg-kv-v">1,415</div></div>
            <div className="bbg-kv-sub">5/11 09:30 UTC</div>
            <div className="bbg-kv"><div className="bbg-kv-k">DAW CURRENT</div><div className="bbg-kv-v">930</div></div>
            <div className="bbg-kv"><div className="bbg-kv-k">NEW (24H)</div><div className="bbg-kv-v pos">+50</div></div>
            <div className="bbg-kv"><div className="bbg-kv-k">TOTAL PARTICIPANTS</div><div className="bbg-kv-v">2,131</div></div>
            <div style={{ borderTop: '1px dotted var(--rule)', margin: '8px 0 6px' }} />
            <div className="bbg-kv"><div className="bbg-kv-k">DIRTY EARNED 24H</div><div className="bbg-kv-v">2,800</div></div>
            <div className="bbg-kv"><div className="bbg-kv-k">DIRTY SPENT 24H</div><div className="bbg-kv-v">600</div></div>
            <div className="bbg-kv"><div className="bbg-kv-k">OPS RUN 24H</div><div className="bbg-kv-v">3,124</div></div>
          </div>
        </div>
      </div>

      <div className="bbg-region">
        <div className="bbg-region-head">
          <span>5) LIVE ON-CHAIN TRADES — TOP 8</span>
          <span className="leader" />
          <span className="fkey">F6 · LIVE</span>
        </div>
        <div className="bbg-region-body" style={{ padding: 0 }}>
          <table className="bbg-tab">
            <thead>
              <tr>
                <th>COMPANY</th>
                <th>AUTO</th>
                <th>ACT</th>
                <th>ENDS</th>
                <th className="num">LIQ PX</th>
                <th className="num">ETH PX</th>
                <th className="num">BUFFER</th>
                <th className="num">ENTRY</th>
              </tr>
            </thead>
            <tbody>
              {D.liveTrades.slice(0, 8).map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.auto ? 'ON' : <span style={{ color: 'var(--fg-mut)' }}>OFF</span>}</td>
                  <td className={r.active ? 'pos' : ''}>{r.active ? 'YES' : <span style={{ color: 'var(--fg-mut)' }}>NO</span>}</td>
                  <td>{r.endsIn}</td>
                  <td className="num">{r.liqPrice.toLocaleString()}</td>
                  <td className="num">${r.ethPrice.toFixed(2)}</td>
                  <td className={`num ${r.buffer >= 0 ? 'pos' : 'neg'}`}>{r.buffer >= 0 ? '+' : ''}{r.buffer.toFixed(2)}</td>
                  <td className="num">${r.entry.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bbg-region">
        <div className="bbg-region-head">
          <span>6) RECENT OPS</span>
          <span className="leader" />
          <span className="fkey">F7</span>
        </div>
        <div className="bbg-region-body" style={{ padding: 0 }}>
          <table className="bbg-tab">
            <thead>
              <tr>
                <th>TIME</th>
                <th>WALLET</th>
                <th>OP</th>
                <th>RESULT</th>
                <th className="num">DIRTY</th>
                <th className="num">INF COST</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['13:42:01', '0x75d6…d40b', 'EXFILTRATE',  'OK',   '+482', '12.41'],
                ['13:41:58', '0x39b5…f637', 'EXFILTRATE',  'OK',   '+312', '12.41'],
                ['13:41:54', '0x97fd…c6c9', 'LEVEL UP',    '—',    '−600', '0.00'],
                ['13:41:51', '0x2812…d2c4', 'EXFILTRATE',  'FAIL', '−32',  '12.41'],
                ['13:41:49', '0xa14e…03ab', 'SCRAP',       'OK',   '+12',  '0.00'],
                ['13:41:46', '0x6883…8806', 'EXFILTRATE',  'OK',   '+820', '12.42'],
                ['13:41:44', '0x4d2c…aa11', 'EXFILTRATE',  'OK',   '+208', '12.42'],
                ['13:41:42', '0xff09…71b2', 'BUY ASSET',   '—',    '−2,400','0.00'],
              ].map((r, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--fg-mut)' }}>{r[0]}</td>
                  <td>{r[1]}</td>
                  <td>{r[2]}</td>
                  <td className={r[3] === 'OK' ? 'pos' : r[3] === 'FAIL' ? 'neg' : ''}>{r[3]}</td>
                  <td className={`num ${r[4].startsWith('+') ? 'pos' : r[4].startsWith('−') ? 'neg' : ''}`}>{r[4]}</td>
                  <td className="num">{r[5]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bbg-fkeys">
        <span><b>F1</b> HELP</span>
        <span><b>F2</b> TOKEN</span>
        <span><b>F3</b> BURN</span>
        <span><b>F4</b> INFL</span>
        <span><b>F5</b> PLAYERS</span>
        <span><b>F6</b> TRADES</span>
        <span><b>F7</b> OPS</span>
        <span><b>F8</b> VAULT</span>
        <span><b>/</b> SEARCH</span>
        <span style={{ marginLeft: 'auto', color: 'var(--fg-soft)' }}>MEGADASH 0.2 · {variant.toUpperCase()}</span>
      </div>
    </div>
  );
}

window.BloombergDash = BloombergDash;
