'use client';

export const CHART_AXIS = { fill: 'var(--t-fg-mut)', fontSize: 10, fontFamily: 'var(--t-font)' };

export const OP_LABELS_SHORT = {
  DRUG_DEAL: 'drugs', ARMS_DEAL: 'arms', EXTORTION: 'extortion',
  THIRD_ENTERPRISE: '3rd ent.', PARTIAL: 'partial', FAIL: 'fail',
  LEVEL_UP: 'level up', BUY_ASSET: 'buy asset', SCRAP: 'scrap',
  DEX_BUY: 'dex buy', DEX_SELL: 'dex sell', BURN: 'burn',
};

export const EARN_OPS = new Set(['DRUG_DEAL','ARMS_DEAL','EXTORTION','THIRD_ENTERPRISE','PARTIAL','FAIL','SCRAP']);

export const TIERS = [
  'shanghai', 'panama', 'monaco', 'zurich', 'cayman',
  'panama', 'caribbean', 'caribbean', 'caribbean', 'caribbean',
];

export const LEADERBOARD = [
  { wallet: '0xa14e…03ab', ops: 1842, earned: '92.4k', net: '+74.2k', rank: 2,   spark: [22, 28, 26, 31, 36, 40, 38, 45, 50, 58, 62, 64] },
  { wallet: '0x77be…5ee2', ops: 1601, earned: '78.1k', net: '+61.8k', rank: -1,  spark: [18, 22, 25, 29, 32, 38, 41, 44, 47, 52, 55, 58] },
  { wallet: '0x39b5…f637', ops: 1423, earned: '64.0k', net: '+45.2k', rank: 0,   spark: [16, 19, 21, 24, 28, 32, 35, 38, 40, 42, 44, 46] },
  { wallet: '0x4d2c…aa11', ops: 1108, earned: '52.3k', net: '+38.1k', rank: 4,   spark: [14, 16, 18, 22, 26, 28, 31, 32, 34, 36, 38, 40] },
  { wallet: '0x6883…8806', ops: 998,  earned: '46.8k', net: '+34.0k', rank: -2,  spark: [12, 14, 17, 20, 22, 24, 26, 28, 30, 31, 33, 35] },
];

export function fmtCountdownLocal(endTime) {
  if (!endTime) return '—';
  const diff = endTime - Math.floor(Date.now() / 1000);
  if (diff <= 0) return '—';
  if (diff < 60) return `${diff}s`;
  const m = Math.floor(diff / 60), s = diff % 60;
  if (diff < 3600) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${Math.floor(diff / 3600)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function computeWatch(raw, ethPrice) {
  const now = Math.floor(Date.now() / 1000);
  return raw
    .filter(c => c.active)
    .map(c => ({
      ...c,
      endsIn: fmtCountdownLocal(c.endTime),
      buffer: ethPrice > 0 ? Math.round((ethPrice - c.liqPrice) * 100) / 100 : c.buffer,
    }))
    .filter(c => c.buffer >= 0 && !(c.endTime > 0 && c.endTime <= now))
    .sort((a, b) => a.buffer - b.buffer)
    .slice(0, 5);
}

export function renderTradeRows(rows, range, ethPrice = 0, _tick = 0, onWallet, aliases = {}) {
  const now = Math.floor(Date.now() / 1000);
  const filtered = (range === 'active' ? rows.filter((r) => r.active)
                  : range === 'auto'   ? rows.filter((r) => r.auto)
                  : rows).filter((r) => r.endTime > now);
  const active = filtered.filter((r) => r.active);
  const idle   = filtered.filter((r) => !r.active);

  return [...active, ...idle].flatMap((r) => {
    const liveBuffer = ethPrice > 0 ? Math.round((ethPrice - r.liqPrice) * 100) / 100 : r.buffer;
    if (liveBuffer < 0) return [];
    const liveEndsIn = fmtCountdownLocal(r.endTime);
    return [(
      <tr key={r.id}>
        <td style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span className="tm-num" style={{ cursor: 'pointer', color: 'var(--t-hdr)' }} onClick={() => onWallet && onWallet(r.owner || r.id)}>{aliases[r.owner] || r.ownerShort || r.id}</span></td>
        <td style={{ width: 72, color: 'var(--t-fg-mut)', fontSize: 'var(--t-fs-xs)', whiteSpace: 'nowrap' }}>{r.opType || '—'}</td>
        <td style={{ width: 60, whiteSpace: 'nowrap' }} className={r.active ? 'warn' : 'dim'}>{liveEndsIn}</td>
        <td className={`num ${liveBuffer < 1 ? 'neg' : liveBuffer < 2 ? 'warn' : 'pos'}`} style={{ width: 52, maxWidth: 52 }}>+{liveBuffer.toFixed(2)}</td>
        <td className="num">{r.liqPrice.toLocaleString()}</td>
        <td><span className={`tm-pill ${r.auto ? 'on' : 'off'}`}>{r.auto ? 'on' : 'off'}</span></td>
      </tr>
    )];
  });
}

export function bufferHistory(r) {
  let seed = 0;
  for (const ch of r.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296);
  };
  const target = r.buffer;
  const start = target + (rng() * 30 + 10) * (target >= 0 ? -1 : 1);
  const out = [];
  let v = start;
  for (let i = 0; i < 12; i++) {
    const blend = i / 11;
    const noise = (rng() - 0.5) * 8;
    v = start * (1 - blend) + target * blend + noise;
    out.push(v);
  }
  out[out.length - 1] = target;
  return out;
}

// Dashboard-wide compact formatters. Live alongside the other trade-helpers
// because several sections share them (ticker, token KVs, vault KVs).
export function fmtK(n) {
  if (!n && n !== 0) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return Math.round(n).toLocaleString();
}

export function fmtSigned(n) {
  return n >= 0 ? `+${fmtK(n)}` : `−${fmtK(Math.abs(n))}`;
}

export function median(arr) {
  if (!arr || !arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function fmtLocal(ts) {
  const d = new Date(Number(ts) * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function fmtLocalHour(ts) {
  const d = new Date(Number(ts) * 1000);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h`;
}

export function localDates(arr, hourly = false) {
  if (!arr || !arr.length) return arr;
  return arr.map(d => {
    if (d.ts == null) return d;
    const lbl = hourly ? fmtLocalHour(d.ts) : fmtLocal(d.ts);
    return { ...d, x: lbl, label: lbl };
  });
}

export function TmTooltip({ active, payload, label, valueFmt = (v) => v >= 1000 ? (v/1000).toFixed(1)+'k' : String(Math.round(v)) }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--t-bg)', border: '1px solid var(--t-rule)', padding: '6px 10px', fontFamily: 'var(--t-font)', fontSize: 11 }}>
      <div style={{ color: 'var(--t-fg-mut)', marginBottom: 4 }}>{label}</div>
      {payload.filter(p => p.value).map(p => (
        <div key={p.dataKey} style={{ display: 'flex', gap: 12, justifyContent: 'space-between', color: p.fill }}>
          <span>{p.name}</span><span>{valueFmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function InfTooltip({ data, current, trend }) {
  const W = 260, H = 90;
  const PAD = { l: 36, r: 8, t: 8, b: 18 };
  const pw = W - PAD.l - PAD.r;
  const ph = H - PAD.t - PAD.b;
  const hasData = data && data.length >= 2;

  const min = hasData ? Math.min(...data.map(d => d.v)) : 0;
  const max = hasData ? Math.max(...data.map(d => d.v)) : 1;
  const rng = max - min || 1;
  const t0  = hasData ? data[0].t : 0;
  const t1  = hasData ? data[data.length - 1].t : 1;
  const trng = t1 - t0 || 1;

  const pts = hasData ? data.map(d => [
    PAD.l + ((d.t - t0) / trng) * pw,
    PAD.t + ph - ((d.v - min) / rng) * ph,
  ]) : [];

  const line = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const area = pts.length > 1
    ? `${line} L${pts[pts.length-1][0]},${PAD.t+ph} L${pts[0][0]},${PAD.t+ph}Z`
    : '';

  const xLabels = hasData ? (() => {
    const step = Math.max(1, Math.floor(data.length / 4));
    return [0, step, step * 2, step * 3, data.length - 1]
      .filter((v, i, a) => v < data.length && a.indexOf(v) === i)
      .map(i => ({
        x: PAD.l + ((data[i].t - t0) / trng) * pw,
        label: new Date(data[i].t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));
  })() : [];

  const ax = { fill: 'var(--t-fg-soft)', fontSize: 9, fontFamily: 'var(--t-font)', fontWeight: 400 };

  return (
    <div style={{
      background: 'var(--t-bg)', border: '1px solid var(--t-rule-hot)',
      padding: '8px 10px', width: W + 20,
      fontFamily: 'var(--t-font)', fontSize: 'var(--t-fs-sm)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
        <span style={{ color: 'var(--t-fg-mut)', fontSize: 'var(--t-fs-xs)', letterSpacing: '0.08em' }}>OP COST</span>
        <span style={{ color: 'var(--t-num)', fontWeight: 500 }}>{current.toFixed(2)} INF</span>
      </div>
      {trend != null && (
        <div style={{ color: trend >= 0 ? 'var(--t-pos)' : 'var(--t-neg)', fontSize: 'var(--t-fs-xs)', marginBottom: 6 }}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(2)}% vs 24h ago
        </div>
      )}
      {!hasData ? (
        <div style={{ color: 'var(--t-fg-mut)', fontSize: 'var(--t-fs-xs)', padding: '10px 0 4px' }}>collecting history…</div>
      ) : (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', fontFamily: 'var(--t-font)', fontWeight: 400 }}>
          <path d={area} fill="var(--t-fg)" opacity="0.1" />
          <path d={line} fill="none" stroke="var(--t-fg)" strokeWidth="1.5" />
          <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="3" fill="var(--t-fg)" />
          <line x1={PAD.l} x2={W-PAD.r} y1={PAD.t+ph} y2={PAD.t+ph} stroke="var(--t-rule)" strokeWidth="0.5" />
          <text x={PAD.l-3} y={PAD.t+4} textAnchor="end" {...ax}>{max.toFixed(2)}</text>
          <text x={PAD.l-3} y={PAD.t+ph+3} textAnchor="end" {...ax}>{min.toFixed(2)}</text>
          {xLabels.map((l, i) => (
            <text key={i} x={l.x} y={H-3} textAnchor="middle" {...ax}>{l.label}</text>
          ))}
        </svg>
      )}
    </div>
  );
}
