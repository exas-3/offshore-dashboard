// Pure classification logic. No I/O — easy to unit-test.
import { DEX_POOLS, FUNCTION_OP_TYPES } from './constants.js';

const ZERO        = '0x0000000000000000000000000000000000000000';
const LEVEL_COSTS = new Set([300, 800, 1500, 2500, 4000, 9000, 13500, 19500, 28500]);

// Protocol/team addresses — their burns stay as BURN, not THIRD_ENTERPRISE
const PROTOCOL = new Set(['0x5dc36d6dcd5a3792b3980de1f40c7c0970af3462']);

// txInput: raw hex input of the parent transaction (optional).
// Used to detect non-mission mints (e.g. scrapInventoryItem) by function selector.
export function classifyTransfer(from, to, amount, txInput = null) {
  const f = (from ?? '').toLowerCase();
  const t = (to   ?? '').toLowerCase();
  if (f === ZERO) {
    if (txInput) {
      const sel = txInput.slice(0, 10).toLowerCase();
      const knownOp = FUNCTION_OP_TYPES[sel];
      if (knownOp) return { kind: 'MINT', opType: knownOp };
    }
    if (amount > 0) return { kind: 'MINT', opType: 'PARTIAL' };  // overridden by factory context in poller
    return               { kind: 'MINT', opType: 'EXTORTION' }; // amount=0 = busted extortion
  }
  // DEX pool transfers take priority over amount-based spend rules.
  if (DEX_POOLS.includes(t)) return { kind: 'TRANSFER', opType: 'DEX_SELL' };
  if (DEX_POOLS.includes(f)) return { kind: 'TRANSFER', opType: 'DEX_BUY'  };
  // Selector-based SPEND classification (more reliable than amount heuristics).
  if (txInput) {
    const sel = txInput.slice(0, 10).toLowerCase();
    const knownOp = FUNCTION_OP_TYPES[sel];
    if (knownOp === 'BUY_ASSET') return { kind: 'SPEND', opType: 'BUY_ASSET' };
    if (knownOp === 'LEVEL_UP')  return { kind: 'SPEND', opType: 'LEVEL_UP'  };
  }
  if (amount > 0 && amount % 200 < 0.5 && amount <= 6000)
    return { kind: 'SPEND', opType: 'BUY_ASSET' };
  if (LEVEL_COSTS.has(Math.round(amount))) return { kind: 'SPEND', opType: 'LEVEL_UP' };
  // Third Enterprise purchase: known costs 35000 (original) → 28000 (current)
  // Catch-all: any burn to 0x0 above asset/level thresholds that isn't protocol
  if (t === ZERO && amount > 6000 && !PROTOCOL.has(f))
    return { kind: 'SPEND', opType: 'THIRD_ENTERPRISE' };
  if (t === ZERO) return { kind: 'BURN',     opType: 'BURN'     };
  return          { kind: 'TRANSFER', opType: 'TRANSFER' };
}
