// Single source of truth for on-chain addresses and protocol constants.
// Both lib/db and server/etherscan import from here.

export const ZERO_ADDR      = '0x0000000000000000000000000000000000000000';
export const PROTOCOL_ADDRS = ['0x5dc36d6dcd5a3792b3980de1f40c7c0970af3462'];

// Known DIRTY liquidity pool addresses (main + legacy V3).
// Stored lowercase; consumers compare lowercase too.
export const DEX_POOLS = [
  '0xf9f676066eb7baeeed93e859bc26a41663f277a8',  // main pool
  '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1',  // legacy V3 pool
];

// MegaETH: 1 sec/block. timestamp = block_number + GENESIS (RPC-verified).
export const GENESIS = 1_762_797_011;

export const DIRTY          = '0xC2f34f8849a8607FD73E06D6849bDA07C2b7DE38';
export const INFLUENCE      = '0x403De0893f0Bc66139592ba2FD254672f2dB933a';
export const USDM           = '0xFAfDdBb3FC7688494971A79cC65dca3EF82079E7';
export const VAULT          = '0x955a4adDC17114c36726C12AF9C73E23E497C2BD';
export const FACTORY        = '0x619814A203cA441611cEE02aBF31986Ca265dd35';
export const BATCH_RESOLVER = '0x6E43F31b2c160A3672C681114696667Ef219D4C3';
export const STAKING        = '0x3620bbEDED3BcF1b3409098Dc152b0EEcf66eA8e';
// Hits / "kill an opponent's trade" mechanic added in Season 2. Attacker burns
// DIRTY (cost reported in the event's word5) to end a victim's running trade
// early; receives 80% of victim's accumulated DIRTY, victim keeps 20%.
export const HITS           = '0x09026c8e4938ac1df0bbf4c65558acca9fa569ce';
// HitResolved on the HITS contract — t1=attacker, t2=victim, t3=company,
// data = [mode, completionBps, fullPayoutWei, stolenWei, keptWei, costWei]
export const E_HIT_RESOLVED = '0xe1ddc24613dddff071ce3918893996d48a03d570c28aa894ee27be0ae96eac97';

// Trade duration (seconds) per op_type. Read from company storage
// slots 4 (start) and 5 (end): slot5 − slot4 deterministically picks one.
// Used by the indexer, the dashboard's synthetic-row logic, and the
// recent-starts payload.
export const TRADE_DURATIONS = Object.freeze({
  EXTORTION: 300,
  ARMS_DEAL: 1800,
  DRUG_DEAL: 5400,
});
export const DURATION_TO_OP_TYPE = Object.freeze(
  Object.fromEntries(Object.entries(TRADE_DURATIONS).map(([k, v]) => [v, k]))
);
export function durationToOpType(seconds) {
  return DURATION_TO_OP_TYPE[seconds] ?? null;
}

// ── Loadout 4 / 4th-enterprise Dutch decay ────────────────────────────────────
// Anchor: 200,000 DIRTY at SEASON2_START (2026-05-18T09:30Z).
// Each subsequent 24h vault cycle multiplies the price by 0.8 indefinitely
// (no floor, no auction reset — single monotone decay since launch).
export const SEASON2_START         = 1779096600;   // 2026-05-18T09:30:00Z (also exported from app/api/offshore-data/helpers.js)
export const LOADOUT4_START_PRICE  = 200_000;
export const LOADOUT4_DECAY        = 0.8;
export const LOADOUT4_CYCLE        = 86400;        // seconds per Season 2 vault cycle

export function loadout4PriceAt(ts) {
  if (ts == null || ts < SEASON2_START) return null;
  const cyclesSince = Math.floor((Number(ts) - SEASON2_START) / LOADOUT4_CYCLE);
  return LOADOUT4_START_PRICE * Math.pow(LOADOUT4_DECAY, cyclesSince);
}
