export const DIRTY_CONTRACT = '0xC2f34f8849a8607FD73E06D6849bDA07C2b7DE38';

async function get(path) {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
  return res.json();
}

// Single call that fetches everything the dashboard needs
export async function fetchDashboard() {
  const [stats, txRes, emissionsRes, earnersRes] = await Promise.all([
    get('/stats'),
    get('/transfers?limit=60'),
    get('/emissions'),
    get('/earners?limit=100'),
  ]);

  return {
    supply:           stats.supply,
    holders:          stats.holders,
    ethPrice:         stats.ethPrice,
    opBreakdown:      stats.opBreakdown,
    opsTotal:         stats.opsTotal,
    dirtyMintedTotal: stats.dirtyMintedTotal,
    dirtySpentTotal:  stats.dirtySpentTotal,
    uniqueAddrs:      stats.uniqueAddrs,
    totalTxs:         stats.totalTxs,
    cycle:            stats.cycle,
    transfers:        txRes.transfers,
    dailyBuckets:      emissionsRes.dailyBuckets,
    hourlyBuckets:     emissionsRes.hourlyBuckets,
    dailyBurnBuckets:  emissionsRes.dailyBurnBuckets,
    hourlyBurnBuckets: emissionsRes.hourlyBurnBuckets,
    dailyFlowBuckets:  emissionsRes.dailyFlowBuckets,
    hourlyFlowBuckets: emissionsRes.hourlyFlowBuckets,
    dailySupply:       emissionsRes.dailySupply,
    hourlySupply:      emissionsRes.hourlySupply,
    dailyInfluence:     emissionsRes.dailyInfluence,
    hourlyInfluence:    emissionsRes.hourlyInfluence,
    influenceStats:     emissionsRes.influenceStats,
    dailyParticipants:  emissionsRes.dailyParticipants,
    hourlyParticipants: emissionsRes.hourlyParticipants,
    dailyActiveWallets:  emissionsRes.dailyActiveWallets,
    hourlyActiveWallets: emissionsRes.hourlyActiveWallets,
    dailyOpBreakdown:    emissionsRes.dailyOpBreakdown,
    hourlyOpBreakdown:   emissionsRes.hourlyOpBreakdown,
    missionStats:        emissionsRes.missionStats,
    earners:          earnersRes.earners,
  };
}

export async function fetchWhales() {
  return get('/whales?limit=200');
}

// Weekday: 8h cycles anchored at phase 4209s (ends 01:10, 09:10, 17:10 UTC)
// Weekend: 24h cycles anchored at 17:10:09 UTC (Fri 17:10:09 → Sun 17:10:09)
const WEEKDAY_PHASE  = 5400;                    // 01:30:00 UTC → fires 01:30 / 09:30 / 17:30
const WEEKEND_ANCHOR = 9 * 3600 + 30 * 60;     // 09:30:00 UTC — weekend/weekday boundary
const WEEKDAY_DUR    = 8  * 3600;
const WEEKEND_DUR    = 24 * 3600;

function isWeekendCycle(nowSec) {
  const d          = new Date(nowSec * 1000);
  const dow        = d.getUTCDay(); // 0=Sun … 6=Sat
  const secInDay   = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  if (dow === 6 && secInDay >= WEEKEND_ANCHOR) return true; // Sat after 09:30 UTC
  if (dow === 0) return true;                                // All Sunday
  if (dow === 1 && secInDay <  WEEKEND_ANCHOR) return true; // Mon before 09:30 UTC
  return false;
}

export function getVaultCycle() {
  const now     = Date.now() / 1000;
  const weekend = isWeekendCycle(now);
  const DUR     = weekend ? WEEKEND_DUR : WEEKDAY_DUR;
  const ANCHOR  = weekend ? WEEKEND_ANCHOR : WEEKDAY_PHASE;

  const start    = Math.floor((now - ANCHOR) / DUR) * DUR + ANCHOR;
  const elapsed   = now - start;
  const remaining = DUR - elapsed;
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = Math.floor(remaining % 60);
  return {
    progress:  elapsed / DUR,
    pct:       Math.round((elapsed / DUR) * 100),
    remaining,
    timeStr:   `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`,
    cycleNum:  Math.floor((now - WEEKDAY_PHASE) / WEEKDAY_DUR),
    isWeekend: weekend,
    duration:  DUR,
  };
}
