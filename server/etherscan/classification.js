// Pure classification logic. No I/O — easy to unit-test.
//
// Design: destination-first. A Transfer event is classified by *where the tokens
// went* (DEX pool / staking / zero / other), not by the parent tx's selector.
// Selector is only consulted for MINT context and to disambiguate burns-to-zero.
//
// This avoids the prior bug where any DIRTY Transfer inside a `levelUp()` /
// `buyAsset()` tx was tagged as SPEND/LEVEL_UP|BUY_ASSET — including side-effect
// transfers to the staking contract or DEX pool that aren't burns at all.

import { DEX_POOLS, FUNCTION_OP_TYPES, STAKING } from './constants.js';

const ZERO         = '0x0000000000000000000000000000000000000000';
const STAKING_ADDR = STAKING.toLowerCase();
const LEVEL_COSTS  = new Set([300, 800, 1500, 2500, 4000, 9000, 13500, 19500, 28500]);

// Protocol/team addresses — their burns stay as BURN, not THIRD_ENTERPRISE
const PROTOCOL = new Set(['0x5dc36d6dcd5a3792b3980de1f40c7c0970af3462']);

export function classifyTransfer(from, to, amount, txInput = null) {
  const f = (from ?? '').toLowerCase();
  const t = (to   ?? '').toLowerCase();

  // ── MINTS — from the zero address ──────────────────────────────────────
  if (f === ZERO) {
    if (txInput) {
      const sel = txInput.slice(0, 10).toLowerCase();
      const knownOp = FUNCTION_OP_TYPES[sel];
      if (knownOp) return { kind: 'MINT', opType: knownOp };
    }
    if (amount > 0) return { kind: 'MINT', opType: 'PARTIAL' };  // overridden by factory ctx
    return               { kind: 'MINT', opType: 'EXTORTION' };  // amount=0 → busted extortion
  }

  // ── DEX swaps — one leg is a known liquidity pool ─────────────────────
  if (DEX_POOLS.includes(t)) return { kind: 'TRANSFER', opType: 'DEX_SELL' };
  if (DEX_POOLS.includes(f)) return { kind: 'TRANSFER', opType: 'DEX_BUY'  };

  // ── Staking — one leg is the staking contract ─────────────────────────
  if (t === STAKING_ADDR) return { kind: 'TRANSFER', opType: 'STAKE_DEPOSIT'  };
  if (f === STAKING_ADDR) return { kind: 'TRANSFER', opType: 'STAKE_WITHDRAW' };

  // ── Burns — destination is the zero address ───────────────────────────
  // Only here do we consult the tx selector. A Transfer in a levelUp() tx
  // that did NOT go to zero is not a level-up burn — it's something else
  // (DEX swap, staking deposit, P2P), handled above or below.
  if (t === ZERO) {
    if (txInput) {
      const sel = txInput.slice(0, 10).toLowerCase();
      const knownOp = FUNCTION_OP_TYPES[sel];
      if (knownOp === 'BUY_ASSET') return { kind: 'SPEND', opType: 'BUY_ASSET' };
      if (knownOp === 'LEVEL_UP')  return { kind: 'SPEND', opType: 'LEVEL_UP'  };
    }
    // Amount-based fallback for txs whose selector we don't recognise.
    if (amount > 0 && amount % 200 < 0.5 && amount <= 6000)
      return { kind: 'SPEND', opType: 'BUY_ASSET' };
    if (LEVEL_COSTS.has(Math.round(amount)))
      return { kind: 'SPEND', opType: 'LEVEL_UP' };
    if (amount > 6000 && !PROTOCOL.has(f))
      return { kind: 'SPEND', opType: 'THIRD_ENTERPRISE' };
    return { kind: 'BURN', opType: 'BURN' };
  }

  // ── Everything else: peer-to-peer transfer (player ↔ player, etc.) ────
  return { kind: 'TRANSFER', opType: 'TRANSFER' };
}
