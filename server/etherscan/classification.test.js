// Locks in the destination-first classifier + op-types module behaviour.
// Run via:  node --test server/etherscan/classification.test.js
//
// Why this file exists: every regression we hit in this area (the LP-vs-swap
// confusion, the PARTIAL/FAIL → 'op' label drift, the DEX_POOLS address typo)
// would have been caught by a 5-line assertion. Keep adding cases as bugs
// surface.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyTransfer } from './classification.js';
import { DEX_POOLS, STAKING } from './constants.js';
import {
  TRADE_DURATIONS,
  DURATION_TO_OP_TYPE,
  durationToOpType,
  mapOpType,
  resultFromAmount,
  EARN_OPS,
  COMPLETE_AMOUNTS,
} from './op-types.js';

const ZERO  = '0x0000000000000000000000000000000000000000';
const POOL  = DEX_POOLS[0];
const POOL2 = DEX_POOLS[1];
const STK   = STAKING.toLowerCase();
const USER  = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHOP  = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// ── classifyTransfer ─────────────────────────────────────────────────────

test('MINT with positive amount (no selector) → PARTIAL', () => {
  const r = classifyTransfer(ZERO, USER, 100);
  assert.equal(r.kind,   'MINT');
  assert.equal(r.opType, 'PARTIAL');
});

test('MINT with zero amount (no selector) → busted EXTORTION', () => {
  const r = classifyTransfer(ZERO, USER, 0);
  assert.equal(r.kind,   'MINT');
  assert.equal(r.opType, 'EXTORTION');
});

test('MINT with known selector overrides amount-based default', () => {
  // 0x046d03d1 = SCRAP
  const r = classifyTransfer(ZERO, USER, 100, '0x046d03d100');
  assert.equal(r.opType, 'SCRAP');
});

test('DEX_SELL — destination is a known pool', () => {
  const r = classifyTransfer(USER, POOL, 1000);
  assert.deepEqual(r, { kind: 'TRANSFER', opType: 'DEX_SELL' });
});

test('DEX_BUY — source is a known pool', () => {
  const r = classifyTransfer(POOL, USER, 1000);
  assert.deepEqual(r, { kind: 'TRANSFER', opType: 'DEX_BUY' });
});

test('Inter-pool hop still tags as DEX_SELL (to-side wins first check)', () => {
  // Both legs are pools — sell-check (to) fires first. The downstream
  // LP-detection pass demotes / promotes this in syncTransfers.
  const r = classifyTransfer(POOL2, POOL, 1000);
  assert.equal(r.opType, 'DEX_SELL');
});

test('STAKE_DEPOSIT — destination is the staking contract', () => {
  const r = classifyTransfer(USER, STK, 50);
  assert.equal(r.opType, 'STAKE_DEPOSIT');
});

test('STAKE_WITHDRAW — source is the staking contract', () => {
  const r = classifyTransfer(STK, USER, 50);
  assert.equal(r.opType, 'STAKE_WITHDRAW');
});

test('P2P transfer → TRANSFER/TRANSFER', () => {
  const r = classifyTransfer(USER, SHOP, 25);
  assert.deepEqual(r, { kind: 'TRANSFER', opType: 'TRANSFER' });
});

test('Burn to zero with LEVEL_UP selector → SPEND/LEVEL_UP', () => {
  const r = classifyTransfer(USER, ZERO, 300, '0x4ea1ecf900');
  assert.deepEqual(r, { kind: 'SPEND', opType: 'LEVEL_UP' });
});

test('Burn to zero without selector + matches LEVEL_COSTS → LEVEL_UP', () => {
  const r = classifyTransfer(USER, ZERO, 1500);
  assert.equal(r.opType, 'LEVEL_UP');
});

test('Burn to zero with small mod-200 amount → BUY_ASSET', () => {
  const r = classifyTransfer(USER, ZERO, 200);
  assert.equal(r.opType, 'BUY_ASSET');
});

test('Burn to zero with amount > 6000 → THIRD_ENTERPRISE', () => {
  const r = classifyTransfer(USER, ZERO, 10_000);
  assert.equal(r.opType, 'THIRD_ENTERPRISE');
});

test('Burn to zero from protocol address → BURN (not THIRD_ENTERPRISE)', () => {
  const protocolAddr = '0x5dc36d6dcd5a3792b3980de1f40c7c0970af3462';
  const r = classifyTransfer(protocolAddr, ZERO, 50_000);
  assert.deepEqual(r, { kind: 'BURN', opType: 'BURN' });
});

// ── op-types module ───────────────────────────────────────────────────────

test('TRADE_DURATIONS round-trip — duration → op_type', () => {
  assert.equal(durationToOpType(300),  'EXTORTION');
  assert.equal(durationToOpType(1800), 'ARMS_DEAL');
  assert.equal(durationToOpType(5400), 'DRUG_DEAL');
  assert.equal(durationToOpType(0),    null);
  assert.equal(durationToOpType(123),  null);
});

test('TRADE_DURATIONS is frozen (regression: drift caused 5 bugs)', () => {
  assert.throws(() => { TRADE_DURATIONS.NEW = 9999; });
});

test('mapOpType — canonical labels', () => {
  assert.equal(mapOpType('DRUG_DEAL'),       'drugs');
  assert.equal(mapOpType('ARMS_DEAL'),       'arms');
  assert.equal(mapOpType('EXTORTION'),       'extortion');
  assert.equal(mapOpType('LP_ADD'),          'lp add');
  assert.equal(mapOpType('LP_REMOVE'),       'lp remove');
  assert.equal(mapOpType('THIRD_ENTERPRISE'),'buy-asset');
});

test('mapOpType — PARTIAL/FAIL fall through, NOT collapsed to "op"', () => {
  // Regression: earlier they mapped to 'op', hiding leftover legacy rows.
  assert.equal(mapOpType('PARTIAL'), 'partial');
  assert.equal(mapOpType('FAIL'),    'fail');
});

test('mapOpType — unknown op_type lowercases + hyphenates', () => {
  assert.equal(mapOpType('SOME_NEW_OP'), 'some-new-op');
});

test('resultFromAmount — completion thresholds', () => {
  for (const ok of [100, 115, 130]) {
    assert.equal(resultFromAmount(ok), 'completed', `${ok} should be completed`);
  }
  for (const bust of [0, 6.34, 50, 200, 99]) {
    assert.equal(resultFromAmount(bust), 'busted', `${bust} should be busted`);
  }
});

test('EARN_OPS includes the four game-op + two legacy types, NOT scrap', () => {
  for (const op of ['DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL']) {
    assert.ok(EARN_OPS.has(op), `${op} missing from EARN_OPS`);
  }
  // Regression: SCRAP is a MINT but never busted — adding it caused every
  // scrap entry to render as a red ✗ in the ops feed.
  assert.equal(EARN_OPS.has('SCRAP'), false, 'SCRAP must NOT be in EARN_OPS');
});

test('COMPLETE_AMOUNTS — exactly the canonical three values', () => {
  assert.deepEqual([...COMPLETE_AMOUNTS].sort((a,b)=>a-b), [100, 115, 130]);
});

// ── DEX_POOLS sanity (regression: a 39-char address typo cost 32k rows) ──

test('DEX_POOLS — each entry is a valid 40-char hex address', () => {
  for (const p of DEX_POOLS) {
    assert.match(p, /^0x[0-9a-f]{40}$/, `${p} not 40-hex lowercase`);
  }
});

test('DEX_POOLS — no duplicates', () => {
  assert.equal(new Set(DEX_POOLS).size, DEX_POOLS.length);
});
