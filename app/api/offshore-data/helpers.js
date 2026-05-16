export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// ── Cycle boundary helpers ─────────────────────────────────────────────────────
export const WEEKDAY_ANCHOR = 5400;
export const WEEKDAY_DUR    = 8 * 3600;
export const WEEKEND_ANCHOR = 9 * 3600 + 30 * 60;

export function isWeekendTs(ts) {
  const d = new Date(ts * 1000);
  const dow = d.getUTCDay();
  const s = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  if (dow === 6 && s >= WEEKEND_ANCHOR) return true;
  if (dow === 0) return true;
  if (dow === 1 && s < WEEKEND_ANCHOR) return true;
  return false;
}

export function getCycleStart(ts) {
  if (!isWeekendTs(ts)) {
    return Math.floor((ts - WEEKDAY_ANCHOR) / WEEKDAY_DUR) * WEEKDAY_DUR + WEEKDAY_ANCHOR;
  }
  const d = new Date(ts * 1000);
  const s = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  const dayStart = ts - s;
  return s >= WEEKEND_ANCHOR ? dayStart + WEEKEND_ANCHOR : dayStart - 86400 + WEEKEND_ANCHOR;
}

// ── Game quarter mapping ───────────────────────────────────────────────────────
// Anchor: cycle #20 (absolute sequence) = Q3 2013.
const ANCHOR_CYCLE = 20;
const ANCHOR_Q_IDX = 2013 * 4 + 2;

export function cycleQuarter(cycleNum) {
  const qIdx = ANCHOR_Q_IDX + (cycleNum - ANCHOR_CYCLE);
  const year = Math.floor(qIdx / 4);
  const q    = ((qIdx % 4) + 4) % 4;
  return `Q${q + 1} ${year}`;
}

// ── Format helpers ─────────────────────────────────────────────────────────────

export function fmtDate(ts) {
  const d = new Date(Number(ts) * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function fmtDateHour(ts) {
  const d = new Date(Number(ts) * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}h`;
}

export function fmtCycleTime(ts) {
  const d = new Date(Number(ts) * 1000);
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${M[d.getUTCMonth()]} ${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2,'0')}:${d.getUTCMinutes() < 30 ? '00' : '30'}`;
}

export function fmtM(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

export function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr ?? '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function liqPriceUsd(raw) {
  if (!raw || raw === '0') return 0;
  try { return Number(BigInt(raw) / 10n ** 12n) / 1e6; }
  catch { return 0; }
}

export function fmtCountdown(endTime) {
  if (!endTime) return '—';
  const diff = endTime - Math.floor(Date.now() / 1000);
  if (diff <= 0) return '—';
  if (diff < 60) return `${diff}s`;
  const m = Math.floor(diff / 60), s = diff % 60;
  if (diff < 3600) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${Math.floor(diff / 3600)}h ${String(m % 60).padStart(2,'0')}m`;
}

export function mapOpType(opType) {
  const m = {
    DRUG_DEAL: 'drugs', ARMS_DEAL: 'arms', EXTORTION: 'extortion',
    PARTIAL: 'op', FAIL: 'op', SCRAP: 'scrap', BUY_ASSET: 'buy-asset',
    LEVEL_UP: 'level-up', THIRD_ENTERPRISE: 'buy-asset',
  };
  return m[opType] ?? opType.toLowerCase().replace(/_/g, '-');
}
