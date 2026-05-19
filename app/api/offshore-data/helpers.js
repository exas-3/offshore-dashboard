export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// ── Cycle boundary helpers ─────────────────────────────────────────────────────
// Season 2 (from 2026-05-18 09:30 UTC onwards) runs one 24h vault cycle per
// day, anchored at 09:30 UTC. Before that, Season 1 used 3×8h weekday cycles
// (01:30 / 09:30 / 17:30 UTC) and a single 24h weekend cycle (Sat 09:30 → Mon
// 09:30). getCycleStart branches on the cutover so historical buckets stay
// stable while current data uses the new rule.
export const SEASON2_START   = 1779096600;          // 2026-05-18T09:30:00Z
export const CYCLE_ANCHOR    = 9 * 3600 + 30 * 60;  // 09:30 UTC in seconds
const S1_WEEKDAY_DUR         = 8 * 3600;
const S1_WEEKDAY_ANCHOR      = 5400;                // 01:30 UTC

// Legacy aliases — kept so any straggling importer doesn't break. Prefer
// CYCLE_ANCHOR for new code.
export const WEEKDAY_ANCHOR = S1_WEEKDAY_ANCHOR;
export const WEEKDAY_DUR    = S1_WEEKDAY_DUR;
export const WEEKEND_ANCHOR = CYCLE_ANCHOR;

function isS1WeekendTs(ts) {
  const d = new Date(ts * 1000);
  const dow = d.getUTCDay();
  const s = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  if (dow === 6 && s >= CYCLE_ANCHOR) return true;
  if (dow === 0) return true;
  if (dow === 1 && s < CYCLE_ANCHOR) return true;
  return false;
}

export function isWeekendTs(ts) {
  // Retained for back-compat. Season 2 has no weekday/weekend split — every
  // day is a single 24h cycle — so always returns true post-cutover.
  return ts >= SEASON2_START ? true : isS1WeekendTs(ts);
}

export function getCycleStart(ts) {
  // Season 2: single 24h cycle anchored at 09:30 UTC.
  if (ts >= SEASON2_START) {
    const d = new Date(ts * 1000);
    const s = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
    const dayStart = ts - s;
    return s >= CYCLE_ANCHOR ? dayStart + CYCLE_ANCHOR : dayStart - 86400 + CYCLE_ANCHOR;
  }
  // Season 1: 3×8h weekday cycles (01:30 / 09:30 / 17:30), 1×24h weekend cycle.
  if (!isS1WeekendTs(ts)) {
    return Math.floor((ts - S1_WEEKDAY_ANCHOR) / S1_WEEKDAY_DUR) * S1_WEEKDAY_DUR + S1_WEEKDAY_ANCHOR;
  }
  const d = new Date(ts * 1000);
  const s = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  const dayStart = ts - s;
  return s >= CYCLE_ANCHOR ? dayStart + CYCLE_ANCHOR : dayStart - 86400 + CYCLE_ANCHOR;
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

// DEPRECATED: kept for back-compat with any leftover imports. The
// canonical mapOpType now lives in server/etherscan/op-types.js. Both
// implementations stayed in sync, but new code should import from the
// server module so we don't drift again.
export function mapOpType(opType) {
  const m = {
    DRUG_DEAL: 'drugs', ARMS_DEAL: 'arms', EXTORTION: 'extortion',
    SCRAP: 'scrap', BUY_ASSET: 'buy-asset',
    LEVEL_UP: 'level-up', ENTERPRISE: 'enterprise', THIRD_ENTERPRISE: 'enterprise', FOURTH_ENTERPRISE: 'enterprise',
    LP_ADD: 'lp add', LP_REMOVE: 'lp remove',
  };
  return m[opType] ?? opType.toLowerCase().replace(/_/g, '-');
}
