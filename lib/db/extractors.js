import { getDb, ZERO_ADDR, DEX_POOLS } from './connection.js';
const db = () => getDb();

// Addresses to hide from the extractor leaderboard — protocol-controlled
// wallets, bots, or addresses the user has explicitly excluded.
const EXTRACTOR_DENYLIST = [
  '0x5dc36d6dcd5a3792b3980de1f40c7c0970af3462',
  '0xd0d18801e55c24793d062989661ef219b8821e25',
  '0xd5b29bf41d5bb4fa6a2879c3608a03d63ccf8951',
  '0xfb52e4db4744498c3b690ec82d6e00d047a64056',
  '0x0ff7f5043dd39186c2df04f81cfa95672b8a3994', // dragonslayer42069.mega
];

// Top extractors leaderboard.
//
// Score formula:
//   base = V − 2S − B + (P_in − P_out)
//   score = base × (1.5 if S < 0.2 × E else 1)
//
//   E      = MINTs from game ops (DRUG_DEAL/ARMS_DEAL/EXTORTION) — used for
//            the boost threshold and shown for context
//   S      = SPEND + BURN ($dirty fed back to protocol: INF buys, level-up,
//            ENTERPRISE)
//   V      = DEX sell volume
//   B      = DEX buy volume
//   P_in   = P2P TRANSFER inflows (wallet-to-wallet receives)
//   P_out  = P2P TRANSFER outflows (wallet-to-wallet sends)
//
// Low-spend amplifier: wallets that have spent less than 20% of what they
// earned get a 1.5× multiplier on the final score — barely-reinvesting
// farmers who still extract are weighted heavier.
//
// Per-address (no identity/funder roll-up). Net P2P transfers (in − out)
// count toward the score so a wallet that receives DIRTY from elsewhere and
// dumps it on DEX is properly attributed.
//
// Earning (E) is tracked for context + threshold gate only — held-in-wallet
// mints don't push the score by themselves.
//
// Inclusion gate: E ≥ 5_000 OR (V − B) ≥ 5_000.
// Sort: score DESC. Limit: 100 (caller can override).
export async function getTopExtractors(limit = 100) {
  return db()`
    WITH per_wallet AS (
      -- earned: game-op mints
      SELECT to_addr AS addr, amount AS earned, 0 AS spent, 0 AS dex_sold,
             0 AS dex_bought, 0 AS xfer_in, 0 AS xfer_out
        FROM transfers
        WHERE kind = 'MINT'
          AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL')
          AND to_addr != ${ZERO_ADDR}
      UNION ALL
      -- spent: SPEND or BURN (INF buys, level-up, ENTERPRISE burns)
      SELECT from_addr, 0, amount, 0, 0, 0, 0
        FROM transfers
        WHERE kind IN ('SPEND','BURN')
          AND from_addr != ${ZERO_ADDR}
          AND from_addr != ALL(${DEX_POOLS})
      UNION ALL
      -- dex sold: TRANSFER to DEX pool
      SELECT from_addr, 0, 0, amount, 0, 0, 0
        FROM transfers
        WHERE kind = 'TRANSFER'
          AND (op_type = 'DEX_SELL' OR to_addr = ANY(${DEX_POOLS}))
          AND from_addr != ${ZERO_ADDR}
          AND from_addr != ALL(${DEX_POOLS})
      UNION ALL
      -- dex bought: TRANSFER from DEX pool
      SELECT to_addr, 0, 0, 0, amount, 0, 0
        FROM transfers
        WHERE kind = 'TRANSFER'
          AND (op_type = 'DEX_BUY' OR from_addr = ANY(${DEX_POOLS}))
          AND to_addr != ${ZERO_ADDR}
          AND to_addr != ALL(${DEX_POOLS})
      UNION ALL
      -- P2P transfer IN (excluding DEX pool flows already counted above)
      SELECT to_addr, 0, 0, 0, 0, amount, 0
        FROM transfers
        WHERE kind = 'TRANSFER'
          AND op_type = 'TRANSFER'
          AND to_addr != ${ZERO_ADDR}
          AND to_addr != ALL(${DEX_POOLS})
          AND from_addr != ALL(${DEX_POOLS})
      UNION ALL
      -- P2P transfer OUT
      SELECT from_addr, 0, 0, 0, 0, 0, amount
        FROM transfers
        WHERE kind = 'TRANSFER'
          AND op_type = 'TRANSFER'
          AND from_addr != ${ZERO_ADDR}
          AND from_addr != ALL(${DEX_POOLS})
          AND to_addr != ALL(${DEX_POOLS})
    ),
    agg AS (
      SELECT
        addr,
        SUM(earned)     AS earned,
        SUM(spent)      AS spent,
        SUM(dex_sold)   AS dex_sold,
        SUM(dex_bought) AS dex_bought,
        SUM(xfer_in)    AS xfer_in,
        SUM(xfer_out)   AS xfer_out
      FROM per_wallet
      GROUP BY addr
    )
    SELECT
      a.addr                                           AS address,
      a.earned,
      a.spent,
      a.dex_sold,
      a.dex_bought,
      (a.xfer_in - a.xfer_out)                         AS net_p2p,
      ((a.dex_sold - 2 * a.spent - a.dex_bought
        + (a.xfer_in - a.xfer_out))
        * CASE WHEN a.spent < 0.2 * a.earned THEN 1.5 ELSE 1 END) AS score,
      COALESCE(w.ens_alias, w.alias, w.debank_alias)   AS alias
    FROM agg a
    LEFT JOIN wallet_aliases w ON w.address = a.addr
    WHERE (a.earned >= 5000 OR (a.dex_sold - a.dex_bought) >= 5000)
      AND (a.earned > 0 OR a.spent > 0)
      AND a.addr != ALL(${EXTRACTOR_DENYLIST})
    ORDER BY score DESC
    LIMIT ${limit}`;
}
