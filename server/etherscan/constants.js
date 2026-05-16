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
} from '../../lib/chain-constants.js';

// Function selector → op_type for operations that can be classified definitively from tx input.
// Server-only — not needed in lib/db.
export const FUNCTION_OP_TYPES = {
  '0x046d03d1': 'SCRAP',       // scrapInventoryItem(uint256) — in-game: Exfiltrate
  '0x1afc17b0': 'SCRAP',       // scrapInventoryItems(uint256[],uint256[])
  '0xca55c869': 'EXTORTION',   // extort
  '0xf4f98ad5': 'BUY_ASSET',   // buy asset
  '0x4ea1ecf9': 'LEVEL_UP',    // level up company
};
