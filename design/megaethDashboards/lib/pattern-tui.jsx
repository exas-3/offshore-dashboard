// TUI/ASCII patterns — k9s/lazygit/htop feel.
// Variant: 'mono' (single color), 'twoc' (two-color), 'rainbow' (per-pane accent)

function blockBar(value, max, width = 22) {
  // Returns string of block chars using fractional last char.
  const filled = Math.max(0, Math.min(1, value / max)) * width;
  const whole = Math.floor(filled);
  const frac = filled - whole;
  const partials = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
  const pIdx = Math.min(7, Math.round(frac * 8));
  return '█'.repeat(whole) + partials[pIdx] + ' '.repeat(Math.max(0, width - whole - (pIdx ? 1 : 0)));
}

function braille(value, max) {
  // Returns a single braille char approximating value/max across 4 levels.
  const chars = ['⠀','⡀','⡄','⡆','⡇','⣇','⣧','⣷','⣿'];
  const v = Math.max(0, Math.min(1, value / max));
  return chars[Math.round(v * (chars.length - 1))];
}

function TUIDash({ variant = 'mono' }) {
  const D = window.OFFSHORE_DATA;
  const cls = `tui v-${variant}`;
  const burnTotals = D.burnedDaily.map((d) => d.protocolBurn + d.asset + d.levelUp + d.thirdEnt);
  const burnMax = Math.max(...burnTotals);
  const dawMax = Math.max(...D.dailyActiveWallets.map((d) => d.v));

  const focusColors = {
    rainbow: { token: 'violet', burn: 'amber', players: 'cyan', trades: 'rose' },
    mono: {}, twoc: {},
  };
  const c = focusColors[variant] || {};

  return (
    <div className={cls}>
      <div className="tui-topbar">
        <span className="prompt">~/</span>
        <span className="accent"><b>offshore</b></span>
        <span style={{ color: 'var(--dim)' }}>·</span>
        <b>dashboard</b>
        <span style={{ color: 'var(--dim)' }}>(megaeth-mainnet)</span>
        <span style={{ marginLeft: 'auto', color: 'var(--dim)' }}>v0.2.1</span>
        <span style={{ color: 'var(--dim)' }}>· block <b>4128907</b></span>
        <span className="accent">● live</span>
      </div>

      <div className="tui-tabs">
        <button className="on"><span className="num">[1]</span>dashboard</button>
        <button><span className="num">[2]</span>token</button>
        <button><span className="num">[3]</span>players</button>
        <button><span className="num">[4]</span>vault</button>
        <button><span className="num">[5]</span>companies</button>
        <button><span className="num">[6]</span>leaderboard</button>
        <span style={{ marginLeft: 'auto', alignSelf: 'center', color: 'var(--dim)', padding: '0 8px', fontSize: 11 }}>filter / · ? help</span>
      </div>

      <div className="tui-pane" data-c={c.token} data-focus={variant === 'rainbow' ? 'true' : undefined}>
        <div className="tui-pane-title">┤ <b>token-economy</b> <em>· $DIRTY</em> ├</div>
        <div className="tui-pane-body">
          <div className="tui-kvgrid">
            <div>
              <div className="k">$dirty supply</div>
              <div className="v a">10,360,024</div>
              <div className="s">circulating</div>
            </div>
            <div>
              <div className="k">burned/supply</div>
              <div className="v w">1.52×</div>
              <div className="s">15.73M burned</div>
            </div>
            <div>
              <div className="k">total ops</div>
              <div className="v">27,826</div>
              <div className="s">23.62M emitted</div>
            </div>
            <div>
              <div className="k">holders</div>
              <div className="v">1,214</div>
              <div className="s">2,131 wallets</div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ color: 'var(--dim)', fontSize: 11, padding: '0 0 4px' }}>
              ── burned daily ──
            </div>
            <div className="tui-bars">
              {D.burnedDaily.map((d, i) => (
                <div className="tui-bars-row" key={d.x}>
                  <span className="x">{d.x}</span>
                  <span className="glyphs">{blockBar(burnTotals[i], burnMax, 38)}</span>
                  <span className="v">{(burnTotals[i]/1000).toFixed(0)}k</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        <div className="tui-pane" data-c={c.players}>
          <div className="tui-pane-title">┤ <b>players</b> <em>· daily active</em> ├</div>
          <div className="tui-pane-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 0 8px' }}>
              <span style={{ color: 'var(--dim)', fontSize: 11 }}>peak 1,415 · current 930</span>
              <span style={{ color: 'var(--accent)', fontSize: 11 }}>+50 new (24h)</span>
            </div>
            <div className="tui-bars">
              {D.dailyActiveWallets.map((d) => (
                <div className="tui-bars-row" key={d.x}>
                  <span className="x">{d.x}</span>
                  <span className="glyphs">{blockBar(d.v, dawMax, 26)}</span>
                  <span className="v">{d.v.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="tui-pane" data-c={c.burn}>
          <div className="tui-pane-title">┤ <b>influence-flow</b> <em>· all time</em> ├</div>
          <div className="tui-pane-body">
            <table className="tui-tab">
              <thead>
                <tr><th>kind</th><th className="num">amount</th><th>·</th></tr>
              </thead>
              <tbody>
                <tr><td>purchased</td><td className="num a">806,673</td><td className="dim">⠀⠀⡀⡄⡆⡇⣇⣧⣷⣿</td></tr>
                <tr><td>consumed</td><td className="num r">1,946,376</td><td className="dim">⠀⡀⡄⡇⣇⣷⣿⣿⣿⣿</td></tr>
                <tr><td>refunded</td><td className="num w">1,166,001</td><td className="dim">⠀⡀⡄⡆⡇⣇⣷⣿⣿⣿</td></tr>
                <tr><td>circulating</td><td className="num">34,437</td><td className="dim">⠀⠀⠀⡀⡀⡀⡄⡄⡆⡆</td></tr>
              </tbody>
            </table>
            <div style={{ marginTop: 10, color: 'var(--dim)', fontSize: 11 }}>
              consume rate ··· <span style={{ color: 'var(--bad)' }}>100.5% / 24h</span><br/>
              refund rate ···· <span style={{ color: 'var(--warn)' }}>60.0%</span><br/>
              net flow ······· <span style={{ color: 'var(--bad)' }}>−245,800</span>
            </div>
          </div>
        </div>
      </div>

      <div className="tui-section-bar">recent trades · live</div>
      <div className="tui-pane" data-c={c.trades}>
        <div className="tui-pane-body" style={{ padding: '8px 4px' }}>
          <table className="tui-tab">
            <thead>
              <tr>
                <th>company</th>
                <th>auto</th>
                <th>active</th>
                <th>ends</th>
                <th className="num">liq px</th>
                <th className="num">eth px</th>
                <th className="num">buffer</th>
                <th className="num">entry</th>
              </tr>
            </thead>
            <tbody>
              {D.liveTrades.slice(0, 8).map((r, i) => (
                <tr key={r.id} className={i === 3 ? 'sel' : ''}>
                  <td>{r.id}</td>
                  <td className={r.auto ? 'a' : 'dim'}>{r.auto ? '●' : '○'}</td>
                  <td className={r.active ? 'a' : 'dim'}>{r.active ? '●' : '○'}</td>
                  <td className={r.active ? 'w' : 'dim'}>{r.endsIn}</td>
                  <td className="num">{r.liqPrice.toLocaleString()}</td>
                  <td className="num dim">${r.ethPrice.toFixed(2)}</td>
                  <td className={`num ${r.buffer >= 0 ? 'a' : 'r'}`}>{r.buffer >= 0 ? '+' : ''}{r.buffer.toFixed(2)}</td>
                  <td className="num">${r.entry.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tui-section-bar">ops · last 12</div>
      <div className="tui-pane" data-c={c.players}>
        <div className="tui-pane-body" style={{ padding: '8px 4px' }}>
          <table className="tui-tab">
            <thead>
              <tr>
                <th>t</th>
                <th>wallet</th>
                <th>op</th>
                <th>result</th>
                <th className="num">dirty</th>
                <th className="num">inf</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['13:42:01', '0x75d6…d40b', 'exfiltrate',  'ok',   '+482', '12.41'],
                ['13:41:58', '0x39b5…f637', 'exfiltrate',  'ok',   '+312', '12.41'],
                ['13:41:54', '0x97fd…c6c9', 'level-up',    '—',    '−600', '0.00'],
                ['13:41:51', '0x2812…d2c4', 'exfiltrate',  'fail', '−32',  '12.41'],
                ['13:41:49', '0xa14e…03ab', 'scrap',       'ok',   '+12',  '0.00'],
                ['13:41:46', '0x6883…8806', 'exfiltrate',  'ok',   '+820', '12.42'],
                ['13:41:44', '0x4d2c…aa11', 'exfiltrate',  'ok',   '+208', '12.42'],
                ['13:41:42', '0xff09…71b2', 'buy-asset',   '—',    '−2,400','0.00'],
                ['13:41:39', '0x77be…5ee2', 'exfiltrate',  'ok',   '+644', '12.42'],
                ['13:41:36', '0x2bbd…cb73', 'exfiltrate',  'ok',   '+120', '12.43'],
                ['13:41:34', '0x6883…8806', 'level-up',    '—',    '−300', '0.00'],
                ['13:41:30', '0xa14e…03ab', 'exfiltrate',  'fail', '−14',  '12.43'],
              ].map((r, i) => (
                <tr key={i}>
                  <td className="dim">{r[0]}</td>
                  <td>{r[1]}</td>
                  <td>{r[2]}</td>
                  <td className={r[3] === 'ok' ? 'a' : r[3] === 'fail' ? 'r' : 'dim'}>{r[3]}</td>
                  <td className={`num ${r[4].startsWith('+') ? 'a' : r[4].startsWith('−') ? 'r' : ''}`}>{r[4]}</td>
                  <td className="num dim">{r[5]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tui-foot">
        <span><span className="kbd">?</span> help</span>
        <span><span className="kbd">/</span> filter</span>
        <span><span className="kbd">:</span> command</span>
        <span><span className="kbd">↑↓</span> nav</span>
        <span><span className="kbd">tab</span> next pane</span>
        <span><span className="kbd">r</span> refresh</span>
        <span style={{ marginLeft: 'auto' }}>variant: <span className="kbd">{variant}</span></span>
      </div>
    </div>
  );
}

window.TUIDash = TUIDash;
