// One-shot reclassification: fix DIRTY transfer rows that were tagged as
// SPEND/BUY_ASSET or SPEND/LEVEL_UP but whose destination wasn't the zero
// address. Those weren't burns — they were side-effect transfers inside game
// txs (staking deposits, DEX swaps, P2P sales).
//
// Also retro-tags existing TRANSFER rows that touch the staking contract with
// STAKE_DEPOSIT / STAKE_WITHDRAW op_types.
//
// Run on the prod DB after the classifier update has been deployed:
//   node --env-file=.env scripts/reclassify-misclassified-spends.mjs

import { getDb } from '../lib/db/connection.js';
import { DEX_POOLS, STAKING } from '../lib/chain-constants.js';

const db = getDb();
const ZERO    = '0x0000000000000000000000000000000000000000';
const STAKING_LC = STAKING.toLowerCase();

async function run() {
  console.log('[reclassify] starting…');

  // 1. SPEND → staking: was SPEND/LEVEL_UP (or BUY_ASSET); should be TRANSFER/STAKE_DEPOSIT.
  const r1 = await db`
    UPDATE transfers
    SET kind = 'TRANSFER', op_type = 'STAKE_DEPOSIT'
    WHERE kind = 'SPEND' AND to_addr = ${STAKING_LC}`;
  console.log(`  SPEND→staking      : ${r1.count} rows reclassified to TRANSFER/STAKE_DEPOSIT`);

  // 2. SPEND → DEX pool: should be TRANSFER/DEX_SELL.
  const r2 = await db`
    UPDATE transfers
    SET kind = 'TRANSFER', op_type = 'DEX_SELL'
    WHERE kind = 'SPEND' AND to_addr = ANY(${DEX_POOLS})`;
  console.log(`  SPEND→DEX pool     : ${r2.count} rows reclassified to TRANSFER/DEX_SELL`);

  // 3. SPEND → any other non-zero destination: P2P transfer.
  const r3 = await db`
    UPDATE transfers
    SET kind = 'TRANSFER', op_type = 'TRANSFER'
    WHERE kind = 'SPEND'
      AND to_addr != ${ZERO}
      AND to_addr != ${STAKING_LC}
      AND to_addr != ALL(${DEX_POOLS})`;
  console.log(`  SPEND→other        : ${r3.count} rows reclassified to TRANSFER/TRANSFER`);

  // 4. Existing TRANSFER rows touching the staking contract — retro-tag.
  const r4a = await db`
    UPDATE transfers
    SET op_type = 'STAKE_DEPOSIT'
    WHERE kind = 'TRANSFER' AND to_addr = ${STAKING_LC}
      AND op_type NOT IN ('STAKE_DEPOSIT','STAKE_WITHDRAW')`;
  const r4b = await db`
    UPDATE transfers
    SET op_type = 'STAKE_WITHDRAW'
    WHERE kind = 'TRANSFER' AND from_addr = ${STAKING_LC}
      AND op_type NOT IN ('STAKE_DEPOSIT','STAKE_WITHDRAW')`;
  console.log(`  TRANSFER↔staking   : ${r4a.count + r4b.count} rows retro-tagged (${r4a.count} deposits, ${r4b.count} withdraws)`);

  console.log('[reclassify] done.');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
