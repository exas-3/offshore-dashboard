// Status board patterns — airport / ticker / scoreboard.
// Variants: 'amber' (airport split-flap), 'ticker' (NASDAQ), 'score' (stadium)

function StatusBoardDash({ variant = 'amber' }) {
  const D = window.OFFSHORE_DATA;
  const cls = `sb v-${variant}`;
  const dawMax = Math.max(...D.dailyActiveWallets.map((d) => d.v));

  // Recent ops (more dramatic — fits the board aesthetic)
  const ops = [
    { time: '13:42:01', wallet: '0X75D6...D40B', op: 'EXFIL',  result: 'ok',   dirty: '+482',  inf: 12.41 },
    { time: '13:41:58', wallet: '0X39B5...F637', op: 'EXFIL',  result: 'ok',   dirty: '+312',  inf: 12.41 },
    { time: '13:41:54', wallet: '0X97FD...C6C9', op: 'LVL UP', result: 'idle', dirty: '−600',  inf: 0.00 },
    { time: '13:41:51', wallet: '0X2812...D2C4', op: 'EXFIL',  result: 'fail', dirty: '−32',   inf: 12.41 },
    { time: '13:41:49', wallet: '0XA14E...03AB', op: 'SCRAP',  result: 'ok',   dirty: '+12',   inf: 0.00 },
    { time: '13:41:46', wallet: '0X6883...8806', op: 'EXFIL',  result: 'ok',   dirty: '+820',  inf: 12.42 },
    { time: '13:41:44', wallet: '0X4D2C...AA11', op: 'EXFIL',  result: 'ok',   dirty: '+208',  inf: 12.42 },
    { time: '13:41:42', wallet: '0XFF09...71B2', op: 'BUY',    result: 'idle', dirty: '−2400', inf: 0.00 },
    { time: '13:41:39', wallet: '0X77BE...5EE2', op: 'EXFIL',  result: 'ok',   dirty: '+644',  inf: 12.42 },
    { time: '13:41:36', wallet: '0X2BBD...CB73', op: 'EXFIL',  result: 'ok',   dirty: '+120',  inf: 12.43 },
  ];

  return (
    <div className={cls}>
      <div className="sb-header">
        <div className="ttl">{variant === 'ticker' ? <>OFFSHORE · LIVE</> : <>OFFSHORE <em>// MEGAETH</em></>}</div>
        <div className="clock">
          {variant === 'amber' && <span className="sb-flip">13:42:08 UTC</span>}
          {variant === 'ticker' && <>NYSE 09:42 ET · UTC 13:42:08</>}
          {variant === 'score' && <span>13:42:08</span>}
        </div>
      </div>

      <div className="sb-stripe">
        <div><div className="k">$DIRTY</div><div className="v"><span className="sb-flip">$0.0706</span></div></div>
        <div><div className="k">OP COST</div><div className="v"><span className="sb-flip">12.41</span></div></div>
        <div><div className="k">DAW</div><div className="v"><span className="sb-flip">930</span></div></div>
        <div><div className="k">BURNED</div><div className="v"><span className="sb-flip">15.73M</span></div></div>
      </div>

      <div className="sb-board">
        <div className="sb-board-title">
          <span>{variant === 'ticker' ? 'live trades' : 'LIVE TRADES'}</span>
          <span className="fkey">{variant === 'ticker' ? '8 active · auto refresh 12s' : 'F6 · LIVE · 12s'}</span>
        </div>
        <div className="sb-rows">
          {D.liveTrades.slice(0, 8).map((r) => (
            <div className="sb-row" key={r.id}>
              <div className={`dot ${r.active ? 'on' : 'off'}`} />
              <div className="id">{r.id.toUpperCase()}</div>
              <div className={`col-r ${r.active ? '' : 'dim'}`}>{r.endsIn === '—' ? '——' : r.endsIn.toUpperCase()}</div>
              <div className="col-r">{r.liqPrice.toLocaleString()}</div>
              <div className={`col-r ${r.buffer >= 0 ? 'pos' : 'neg'}`}>{r.buffer >= 0 ? '+' : '−'}{Math.abs(r.buffer).toFixed(2)}</div>
              <div className="col-r">{r.auto ? '◉' : '○'}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="sb-board">
        <div className="sb-board-title">
          <span>{variant === 'ticker' ? 'recent ops' : 'RECENT OPS'}</span>
          <span className="fkey">{variant === 'ticker' ? `${ops.length} ops · live` : `F7 · ${ops.length}`}</span>
        </div>
        <div className="sb-rows">
          {ops.map((o, i) => (
            <div className="sb-row" key={i} style={{ gridTemplateColumns: '26px 1fr 100px 110px 90px 32px' }}>
              <div className={`dot ${o.result === 'ok' ? 'on' : o.result === 'fail' ? 'off' : 'off'}`} style={o.result === 'fail' ? { background: 'var(--neg)', boxShadow: '0 0 8px var(--neg)' } : {}} />
              <div className="id">{o.wallet} <span className="dim" style={{ marginLeft: 8 }}>{o.op}</span></div>
              <div className={`col-r ${o.result === 'ok' ? 'pos' : o.result === 'fail' ? 'neg' : 'dim'}`}>{o.result.toUpperCase()}</div>
              <div className={`col-r ${o.dirty.startsWith('+') ? 'pos' : 'neg'}`}>{o.dirty}</div>
              <div className="col-r dim">{o.inf.toFixed(2)} INF</div>
              <div className="col-r dim">{o.time}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="sb-board">
        <div className="sb-board-title">
          <span>{variant === 'ticker' ? 'daily active wallets · last 9d' : 'DAILY ACTIVE WALLETS'}</span>
          <span className="fkey">peak <span style={{ color: 'var(--fg)' }}>1,415</span> · {variant === 'ticker' ? 'live' : 'F5'}</span>
        </div>
        <div className="sb-bars">
          {D.dailyActiveWallets.map((d) => (
            <div className="sb-bars-row" key={d.x}>
              <span className="lbl">{d.x}</span>
              <span className="track"><i style={{ width: `${(d.v / dawMax) * 100}%` }} /></span>
              <span className="v">{d.v.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sb-board">
        <div className="sb-board-title">
          <span>{variant === 'ticker' ? 'top earners · all time' : 'TOP EARNERS'}</span>
          <span className="fkey">{variant === 'ticker' ? 'top 10' : 'F8 · TOP 10'}</span>
        </div>
        <div className="sb-rows">
          {[
            ['01', '0XA14E...03AB', 1842, '92.4K'],
            ['02', '0X77BE...5EE2', 1601, '78.1K'],
            ['03', '0X39B5...F637', 1423, '64.0K'],
            ['04', '0X4D2C...AA11', 1108, '52.3K'],
            ['05', '0X6883...8806', 998,  '46.8K'],
            ['06', '0X97FD...C6C9', 902,  '41.2K'],
            ['07', '0XFF09...71B2', 856,  '38.9K'],
            ['08', '0X75D6...D40B', 267,  '19.4K'],
          ].map((r) => (
            <div className="sb-row" key={r[0]} style={{ gridTemplateColumns: '50px 1fr 110px 110px' }}>
              <div className="id dim">{r[0]}</div>
              <div className="id">{r[1]}</div>
              <div className="col-r dim">{r[2].toLocaleString()} OPS</div>
              <div className="col-r pos">{r[3]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="sb-foot">
        <span>{variant === 'ticker' ? 'data · megaeth mainnet · refresh 12s' : 'MEGADASH · OFFSHORE · INDEXED@ 4,128,907'}</span>
        <span>{variant === 'ticker' ? 'q quit · / search · r refresh' : 'F1 HELP · F2 TOKEN · F3 OPS · F4 VAULT · F5 PLAYERS · F6 TRADES · F8 LEADERBOARD'}</span>
      </div>
    </div>
  );
}

window.StatusBoardDash = StatusBoardDash;
