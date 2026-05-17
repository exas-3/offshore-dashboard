// Canonical on-chain addresses live in lib/chain-constants.js — re-export so
// existing server/etherscan/* consumers don't break.
export {
  DEX_POOLS,
  GENESIS,
  DIRTY,
  INFLUENCE,
  USDM,
  VAULT,
  FACTORY,
  BATCH_RESOLVER,
  STAKING,
} from '../../lib/chain-constants.js';

// Function selector → op_type for operations that can be classified definitively from tx input.
// Server-only — not needed in lib/db.
//
// NOTE: `0xca55c869` was previously mapped to EXTORTION because it looks like
// "extort()". Empirically it's a universal claim function on BATCH_RESOLVER
// used to collect payouts of *all* trade types — drug/arms/extortion. Keeping
// it here would mis-tag every drug/arms claim as EXTORTION. Trade type for
// game MINTs is resolved via the factory's D47 (OpResult) event instead;
// see server/etherscan/factory-events.js::fetchFactoryTradeContext.
export const FUNCTION_OP_TYPES = {
  '0x046d03d1': 'SCRAP',       // scrapInventoryItem(uint256) — in-game: Exfiltrate
  '0x1afc17b0': 'SCRAP',       // scrapInventoryItems(uint256[],uint256[])
  '0xf4f98ad5': 'BUY_ASSET',   // buy asset
  '0x4ea1ecf9': 'LEVEL_UP',    // level up company
};
