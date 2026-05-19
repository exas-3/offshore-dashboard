// Canonical op-type definitions. Imported by:
//   - server/etherscan/classification.js  (destination-first classifier)
//   - server/etherscan/fetchers.js        (storage-slot duration → type)
//   - server/syncs/*.js                   (sync handlers)
//   - app/api/offshore-data/route.js      (initial dashboard payload)
//   - app/api/offshore-data/live/route.js (live tick)
//
// Centralising these stopped the historical drift where PARTIAL/FAIL
// labels and trade durations were defined in 3-5 places independently.

// Storage slot 4 / slot 5 of a company contract hold trade start/end ts.
// (end − start) deterministically identifies the trade type. Lives in
// lib/chain-constants.js so client code (recent-activity synthesis) can
// import it too — re-exported here for server-side convenience.
export {
  TRADE_DURATIONS,
  DURATION_TO_OP_TYPE,
  durationToOpType,
} from '../../lib/chain-constants.js';

// Game-op MINTs that have a completed/busted outcome. SCRAP is a MINT
// too but it's never busted (you always get the scrap value) — so it's
// deliberately NOT here, otherwise the EARN_OPS-gated 'result' would
// mis-tag every scrap as 'busted'.
// FAIL is legacy classifier output and should not appear in fresh data;
// included so historical rows still count.
export const EARN_OPS = new Set(['DRUG_DEAL', 'ARMS_DEAL', 'EXTORTION', 'PARTIAL', 'FAIL', 'HIT', 'HIT_REFUND', 'HIT_COST', 'ENTERPRISE']);

// NOTE: COMPLETE_AMOUNTS / resultFromAmount were removed. Season 2 payouts
// scale 50–100 by Power Level and busts use progressive partial refunds,
// so amount alone can't distinguish completed from busted. The structural
// signal is now: transfers.js (DirtyPaid path) → 'completed';
// liquidations.js (TradeExited path) → 'busted'. API routes read the
// stored `result` column rather than recomputing.

// UI label: short, lowercase, hyphen-joined. PARTIAL / FAIL are
// deliberately not mapped — they're legacy fallbacks; surfacing them raw
// keeps any leftover rows visible (and reportable) instead of disguised
// behind a friendly "op" / "partial" label.
const OP_LABEL_MAP = Object.freeze({
  DRUG_DEAL:        'drugs',
  ARMS_DEAL:        'arms',
  EXTORTION:        'extortion',
  SCRAP:            'scrap',
  BUY_ASSET:        'buy-asset',
  LEVEL_UP:         'level-up',
  THIRD_ENTERPRISE: 'enterprise',  // legacy — kept for any rows that escaped the migration
  FOURTH_ENTERPRISE:'enterprise',  // legacy — same as above
  ENTERPRISE:       'enterprise',
  HIT:              'hit',
  HIT_COST:         'hit initiated',
  HIT_REFUND:       'hitted',
  LP_ADD:           'lp add',
  LP_REMOVE:        'lp remove',
});

export function mapOpType(opType) {
  if (!opType) return '';
  return OP_LABEL_MAP[opType] ?? opType.toLowerCase().replace(/_/g, '-');
}

// Bucket label for the ticker / toasts. 'op' / 'buy' / 'sell' / 'stake'.
// Drives the left-rail colour on toasts (overridden by result for ops).
export const tickerKind = Object.freeze({
  DEX_SELL:          'sell',
  DEX_BUY:           'buy',
  DRUG_DEAL:         'op',
  ARMS_DEAL:         'op',
  EXTORTION:         'op',
  SCRAP:             'op',
  BUY_ASSET:         'op',
  LEVEL_UP:          'op',
  THIRD_ENTERPRISE:  'op',
  FOURTH_ENTERPRISE: 'op',
  ENTERPRISE:        'op',
  HIT:               'hit',
  HIT_COST:          'hit',
  HIT_REFUND:        'hit',
  STAKE:             'stake',
});

// Display label (uppercase) used in the toast badge.
export const tickerLabel = Object.freeze({
  DEX_SELL:          'DEX SELL',
  DEX_BUY:           'DEX BUY',
  DRUG_DEAL:         'DRUG DEAL',
  ARMS_DEAL:         'ARMS DEAL',
  EXTORTION:         'EXTORTION',
  SCRAP:             'SCRAP',
  BUY_ASSET:         'BUY ASSET',
  LEVEL_UP:          'LEVEL UP',
  THIRD_ENTERPRISE:  'ENTERPRISE',
  FOURTH_ENTERPRISE: 'ENTERPRISE',
  ENTERPRISE:        'ENTERPRISE',
  HIT:               'HIT',
  HIT_COST:          'HIT INITIATED',
  HIT_REFUND:        'HITTED',
  STAKE:             'STAKE',
});

