// CLI session patterns — three takes on "the dashboard is a terminal transcript".
// Variants: 'plain' (pure text), 'charts' (text + inline ASCII charts), 'split' (palette + output)

const { useState: useStateCLI } = React;

function asciiBars(rows, max, width = 32) {
  // rows: [{lbl, v}]
  return rows.map((r) => {
    const filled = Math.round((r.v / max) * width);
    return `${r.lbl.padEnd(8)} ${'█'.repeat(filled).padEnd(width)} ${r.v.toLocaleString().padStart(8)}`;
  }).join('\n');
}

function CLIDash({ variant = 'plain' }) {
  const D = window.OFFSHORE_DATA;
  const cls = `cli v-${variant}`;
  const burnTotals = D.burnedDaily.map((d) => d.protocolBurn + d.asset + d.levelUp + d.thirdEnt);
  const burnMax = Math.max(...burnTotals);
  const dawMax = Math.max(...D.dailyActiveWallets.map((d) => d.v));

  const head = (
    <div className="cli-head">
      <span><span className="dot" />offshore-cli &nbsp;<b>v0.2.1</b> · megaeth-mainnet · block <b>4,128,907</b></span>
      <span>session 14:23:08 UTC</span>
    </div>
  );

  if (variant === 'split') return <CLISplit D={D} cls={cls} head={head} dawMax={dawMax} />;
  return <CLITranscript D={D} cls={cls} head={head} variant={variant} burnTotals={burnTotals} burnMax={burnMax} dawMax={dawMax} />;
}

function CLITranscript({ D, cls, head, variant, burnTotals, burnMax, dawMax }) {
  return (
    <div className={cls}>
      {head}
      <div className="cli-body">
        <Comment text="# offshore protocol · MegaETH analytics — daily snapshot" />
        <Comment text={`# data window: 5/5 → 5/13 2026`} />

        <Cmd text={<>offshore stats <Flag>--token</Flag> <Flag>--summary</Flag></>} />
        <KV k="$dirty supply" v="10,360,024" sub="total circulating" />
        <KV k="burned / supply" v="1.52" sub="15.73M burned all time" />
        <KV k="total ops" v="27,826" sub="23.62M $DIRTY emitted" />
        <KV k="holders" v="1,214" sub="2,131 unique wallets" />
        <KV k="op cost (last)" v="12.41 INF" />
        <KV k="$DIRTY price" v="$0.0706" subClass="neg" sub="−1.21% / 24h" />

        <Cmd text={<>offshore burn <Flag>--daily</Flag> <Flag>--since</Flag> <Str>5/5</Str></>} />
        {variant === 'charts' ? (
          <pre className="cli-asciibars">{asciiBars(D.burnedDaily.map((d, i) => ({ lbl: d.x, v: burnTotals[i] })), burnMax, 38)}</pre>
        ) : (
          <Lines>
            {D.burnedDaily.map((d, i) => (
              <Line key={d.x}><K>{d.x}</K> <V>{burnTotals[i].toLocaleString()}</V> <span className="cli-line c">$dirty</span></Line>
            ))}
          </Lines>
        )}

        <Cmd text={<>offshore influence <Flag>--all-time</Flag></>} />
        <Lines>
          <Line><K>purchased</K> <V cls="pos">806,673</V></Line>
          <Line><K>consumed</K> <V cls="neg">1,946,376</V></Line>
          <Line><K>refunded</K> <V>1,166,001</V></Line>
          <Line><K>circulating</K> <V>34,437</V></Line>
          <Line dim>──</Line>
          <Line><K>consume rate (24h)</K> <V cls="neg">100.5%</V></Line>
          <Line><K>refund rate</K>        <V>60.0%</V></Line>
          <Line><K>net flow (24h)</K>     <V cls="neg">−245,800</V></Line>
        </Lines>

        <Cmd text={<>offshore players <Flag>--daw</Flag> <Flag>--bars</Flag></>} />
        {variant === 'charts' ? (
          <pre className="cli-asciibars">{asciiBars(D.dailyActiveWallets.map((d) => ({ lbl: d.x, v: d.v })), dawMax, 30)}</pre>
        ) : (
          <Lines>
            {D.dailyActiveWallets.map((d) => <Line key={d.x}><K>{d.x}</K> <V>{d.v.toLocaleString()}</V> wallets</Line>)}
          </Lines>
        )}

        <Cmd text={<>offshore trades <Flag>--live</Flag> <Flag>--top</Flag>=<Str>8</Str> <Flag>--sort</Flag>=<Str>buffer</Str></>} />
        <table className="cli-table">
          <thead>
            <tr>
              <th>company</th>
              <th>auto</th>
              <th>active</th>
              <th>ends</th>
              <th className="num">liq px</th>
              <th className="num">eth px</th>
              <th className="num">buffer</th>
            </tr>
          </thead>
          <tbody>
            {D.liveTrades.slice(0, 8).map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td className={r.auto ? '' : 'dim'}>{r.auto ? 'on' : 'off'}</td>
                <td className={r.active ? 'pos' : 'dim'}>{r.active ? 'yes' : 'no'}</td>
                <td className={r.active ? '' : 'dim'}>{r.endsIn}</td>
                <td className="num">{r.liqPrice.toLocaleString()}</td>
                <td className="num dim">{r.ethPrice.toFixed(2)}</td>
                <td className={`num ${r.buffer >= 0 ? 'pos' : 'neg'}`}>{r.buffer >= 0 ? '+' : ''}{r.buffer.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <Cmd text={<>offshore ops <Flag>--tail</Flag>=<Str>10</Str></>} />
        <Lines>
          {[
            ['13:42:01', '0x75d6…d40b', 'exfiltrate',  'ok',   '+482'],
            ['13:41:58', '0x39b5…f637', 'exfiltrate',  'ok',   '+312'],
            ['13:41:54', '0x97fd…c6c9', 'level-up',    '—',    '−600'],
            ['13:41:51', '0x2812…d2c4', 'exfiltrate',  'fail', '−32'],
            ['13:41:49', '0xa14e…03ab', 'scrap',       'ok',   '+12'],
            ['13:41:46', '0x6883…8806', 'exfiltrate',  'ok',   '+820'],
            ['13:41:44', '0x4d2c…aa11', 'exfiltrate',  'ok',   '+208'],
            ['13:41:42', '0xff09…71b2', 'buy-asset',   '—',    '−2400'],
            ['13:41:39', '0x77be…5ee2', 'exfiltrate',  'ok',   '+644'],
            ['13:41:36', '0x2bbd…cb73', 'exfiltrate',  'ok',   '+120'],
          ].map((r, i) => (
            <Line key={i}>
              <span className="cli-line c">{r[0]}</span>{' '}
              <span>{r[1]}</span>{' '}
              <span>{r[2].padEnd(11)}</span>
              <span className={r[3] === 'ok' ? 'cli-line out' : r[3] === 'fail' ? '' : ''}>
                <span style={{ color: r[3] === 'ok' ? 'var(--pos)' : r[3] === 'fail' ? 'var(--neg)' : 'var(--dim)' }}>{r[3].padEnd(5)}</span>
              </span>
              <span style={{ color: r[4].startsWith('+') ? 'var(--pos)' : r[4].startsWith('−') ? 'var(--neg)' : 'var(--fg)' }}>{r[4]}</span>
            </Line>
          ))}
        </Lines>

        <div className="cli-line cmd"><span className="p">$</span><span className="blink">▊</span></div>
      </div>

      <div className="cli-foot">
        <span>↑ history</span>
        <span>tab complete</span>
        <span>ctrl-c quit</span>
        <span style={{ marginLeft: 'auto' }}>variant · <b style={{ color: 'var(--prompt)' }}>{variant}</b></span>
      </div>
    </div>
  );
}

function CLISplit({ D, cls, head, dawMax }) {
  const cmds = [
    { id: 'stats',     cmd: <>stats <span className="f">--token</span></>, label: 'token stats' },
    { id: 'burn',      cmd: <>burn <span className="f">--daily</span></>, label: 'burn — daily' },
    { id: 'influence', cmd: <>influence <span className="f">--all</span></>, label: 'influence flow' },
    { id: 'players',   cmd: <>players <span className="f">--daw</span></>, label: 'players — DAW' },
    { id: 'trades',    cmd: <>trades <span className="f">--live</span></>, label: 'live trades' },
    { id: 'ops',       cmd: <>ops <span className="f">--tail</span>=<span className="s">10</span></>, label: 'recent ops' },
    { id: 'vault',     cmd: <>vault <span className="f">--cycles</span></>, label: 'swiss vault cycles' },
    { id: 'wallet',    cmd: <>wallet <span className="s">0x75d6…d40b</span></>, label: 'wallet inspector' },
    { id: 'lb',        cmd: <>leaderboard <span className="f">--top</span>=<span className="s">25</span></>, label: 'top earners' },
  ];
  const [active, setActive] = useStateCLI('stats');
  return (
    <div className={cls}>
      <aside className="cli-side">
        <div className="lbl">queries</div>
        {cmds.map((c) => (
          <button key={c.id} className={`cmd-btn ${active === c.id ? 'on' : ''}`} onClick={() => setActive(c.id)}>
            <span className="p" style={{ color: 'var(--prompt)' }}>$</span>{' '}offshore {c.cmd}
          </button>
        ))}
        <div className="lbl">flags</div>
        <button className="cmd-btn"><span className="f">--since</span>=<span className="s">5/5</span></button>
        <button className="cmd-btn"><span className="f">--format</span>=<span className="s">ascii</span></button>
        <button className="cmd-btn"><span className="f">--watch</span></button>
        <button className="cmd-btn"><span className="f">--no-colors</span></button>

        <div className="lbl">session</div>
        <div style={{ color: 'var(--dim)', fontSize: 11, lineHeight: 1.5, padding: '2px 6px' }}>
          rpc · <b style={{ color: 'var(--fg)' }}>mainnet.megaeth</b><br/>
          history · 142 cmds<br/>
          uptime · 02:14:08
        </div>
      </aside>
      <main className="cli-main">
        {head}
        <div className="cli-body" style={{ padding: 0 }}>
          {active === 'stats' && (
            <>
              <Cmd text={<>offshore stats <Flag>--token</Flag></>} />
              <Lines>
                <Line><K>$dirty supply</K> <V>10,360,024</V></Line>
                <Line><K>burned / supply</K> <V>1.52</V></Line>
                <Line><K>total ops</K> <V>27,826</V></Line>
                <Line><K>holders</K> <V>1,214</V></Line>
                <Line><K>op cost</K> <V>12.41 INF</V></Line>
                <Line><K>$dirty price</K> <V cls="neg">$0.0706 (−1.21%)</V></Line>
              </Lines>
            </>
          )}
          {active === 'burn' && (
            <>
              <Cmd text={<>offshore burn <Flag>--daily</Flag></>} />
              <Lines>
                {D.burnedDaily.map((d, i) => {
                  const total = d.protocolBurn + d.asset + d.levelUp + d.thirdEnt;
                  return <Line key={d.x}><K>{d.x}</K> <V>{total.toLocaleString()}</V></Line>;
                })}
              </Lines>
            </>
          )}
          {active === 'influence' && (
            <>
              <Cmd text={<>offshore influence <Flag>--all</Flag></>} />
              <Lines>
                <Line><K>purchased</K> <V cls="pos">806,673</V></Line>
                <Line><K>consumed</K> <V cls="neg">1,946,376</V></Line>
                <Line><K>refunded</K> <V>1,166,001</V></Line>
                <Line><K>circulating</K> <V>34,437</V></Line>
              </Lines>
            </>
          )}
          {active === 'players' && (
            <>
              <Cmd text={<>offshore players <Flag>--daw</Flag></>} />
              <Lines>
                {D.dailyActiveWallets.map((d) => <Line key={d.x}><K>{d.x}</K> <V>{d.v.toLocaleString()}</V> wallets</Line>)}
              </Lines>
            </>
          )}
          {active === 'trades' && (
            <>
              <Cmd text={<>offshore trades <Flag>--live</Flag></>} />
              <table className="cli-table">
                <thead><tr><th>company</th><th>active</th><th>ends</th><th className="num">liq</th><th className="num">buffer</th></tr></thead>
                <tbody>
                  {D.liveTrades.slice(0, 8).map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td className={r.active ? 'pos' : 'dim'}>{r.active ? 'yes' : 'no'}</td>
                      <td>{r.endsIn}</td>
                      <td className="num">{r.liqPrice.toLocaleString()}</td>
                      <td className={`num ${r.buffer >= 0 ? 'pos' : 'neg'}`}>{r.buffer >= 0 ? '+' : ''}{r.buffer.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {active === 'ops' && (
            <>
              <Cmd text={<>offshore ops <Flag>--tail</Flag>=<Str>10</Str></>} />
              <Lines>
                {[
                  ['13:42:01', '0x75d6…d40b', 'exfiltrate',  'ok',   '+482'],
                  ['13:41:58', '0x39b5…f637', 'exfiltrate',  'ok',   '+312'],
                  ['13:41:54', '0x97fd…c6c9', 'level-up',    '—',    '−600'],
                  ['13:41:51', '0x2812…d2c4', 'exfiltrate',  'fail', '−32'],
                  ['13:41:46', '0x6883…8806', 'exfiltrate',  'ok',   '+820'],
                ].map((r, i) => (
                  <Line key={i}>
                    <span className="c">{r[0]}</span> {r[1]} {r[2].padEnd(11)}{' '}
                    <span style={{ color: r[3] === 'ok' ? 'var(--pos)' : 'var(--neg)' }}>{r[3]}</span>{' '}
                    <span style={{ color: r[4].startsWith('+') ? 'var(--pos)' : 'var(--neg)' }}>{r[4]}</span>
                  </Line>
                ))}
              </Lines>
            </>
          )}
          {active === 'vault' && (
            <>
              <Cmd text={<>offshore vault <Flag>--cycles</Flag></>} />
              <Lines>
                <Line><K>total distributed</K> <V>658.9k USDm</V></Line>
                <Line><K>cycles paid</K> <V>17</V></Line>
                <Line><K>unique recipients</K> <V>1,289</V></Line>
                <Line><K>last cycle</K> <V>9.5k USDm · 540 recipients</V></Line>
              </Lines>
            </>
          )}
          {active === 'wallet' && (
            <>
              <Cmd text={<>offshore wallet <Str>0x75d6…d40b</Str></>} />
              <Lines>
                <Line><K>total ops</K> <V>267</V></Line>
                <Line><K>dirty earned</K> <V cls="pos">19.4k</V></Line>
                <Line><K>dirty spent</K> <V cls="neg">8.6k</V></Line>
                <Line><K>balance</K> <V>4.5k</V></Line>
                <Line><K>vault claimed</K> <V>$209.63 (9 payouts)</V></Line>
              </Lines>
            </>
          )}
          {active === 'lb' && (
            <>
              <Cmd text={<>offshore leaderboard <Flag>--top</Flag>=<Str>10</Str></>} />
              <table className="cli-table">
                <thead><tr><th>#</th><th>wallet</th><th className="num">ops</th><th className="num">$dirty</th></tr></thead>
                <tbody>
                  {[
                    ['1', '0xa14e…03ab', 1842, '92.4k'],
                    ['2', '0x77be…5ee2', 1601, '78.1k'],
                    ['3', '0x39b5…f637', 1423, '64.0k'],
                    ['4', '0x4d2c…aa11', 1108, '52.3k'],
                    ['5', '0x6883…8806', 998,  '46.8k'],
                    ['6', '0x97fd…c6c9', 902,  '41.2k'],
                    ['7', '0xff09…71b2', 856,  '38.9k'],
                    ['8', '0x75d6…d40b', 267,  '19.4k'],
                    ['9', '0x2bbd…cb73', 240,  '14.6k'],
                    ['10','0x2812…d2c4', 198,  '11.2k'],
                  ].map((r) => (
                    <tr key={r[0]}>
                      <td className="dim">{r[0]}</td>
                      <td>{r[1]}</td>
                      <td className="num">{r[2].toLocaleString()}</td>
                      <td className="num pos">{r[3]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="cli-line cmd"><span className="p">$</span><span className="blink">▊</span></div>
        </div>
      </main>
    </div>
  );
}

// helpers
function Cmd({ text }) { return <div className="cli-line cmd"><span className="p">$</span>{text}</div>; }
function Comment({ text }) { return <div className="cli-line c" style={{ color: 'var(--comment)' }}>{text}</div>; }
function KV({ k, v, sub, subClass }) {
  return (
    <div className="cli-line out" style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr', gap: 8 }}>
      <span className="k">{k}</span><span className="v">{v}</span>
      <span className={`c ${subClass || ''}`} style={{ color: subClass === 'neg' ? 'var(--neg)' : 'var(--comment)' }}>{sub || ''}</span>
    </div>
  );
}
function Lines({ children }) { return <div className="cli-out-block">{children}</div>; }
function Line({ children, dim }) {
  return <div className={`cli-line out ${dim ? 'dim' : ''}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>{children}</div>;
}
function K({ children }) { return <span className="k" style={{ width: 200, display: 'inline-block' }}>{children}</span>; }
function V({ children, cls }) { return <span className={`v ${cls || ''}`}>{children}</span>; }
function Flag({ children }) { return <span className="f">{children}</span>; }
function Str({ children }) { return <span className="s">{children}</span>; }

window.CLIDash = CLIDash;
