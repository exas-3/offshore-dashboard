// Recompute behavioral labels for every wallet that has on-chain activity.
//
// For each address with non-trivial activity (earned ≥ 5k OR (V−B) ≥ 5k),
// compute the same score the extractors leaderboard uses and classify into:
//   extractor    score >  +50_000   → "drains value"
//   contributor  score <  −50_000   → "puts value back"
//   neutral      otherwise          → mostly recycling
//
// Writes label / label_score / label_computed_at into wallet_aliases.
// Idempotent — safe to re-run. Wallets that no longer qualify keep their old
// labels (we never NULL them out automatically).
//
// Usage:  npm run label-wallets
import postgres from 'postgres';
import { LABEL_THRESHOLD, classifyScore } from '../lib/db/extractors.js';

const db = postgres(process.env.DATABASE_URL);

async function main() {
  console.log('[label-wallets] LABEL_THRESHOLD =', LABEL_THRESHOLD);
  console.log('[label-wallets] aggregating per-wallet scores...');

  // Reuse the canonical query from lib/db/extractors.js by inlining the
  // import-bound function — easier than threading getDb() through both
  // postgres-js connections.
  const rows = await db`
    WITH per_wallet AS (
      SELECT to_addr AS addr, amount AS earned, 0 AS spent, 0 AS dex_sold,
             0 AS dex_bought, 0 AS xfer_in, 0 AS xfer_out
        FROM transfers
        WHERE kind='MINT'
          AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL')
          AND to_addr != '0x0000000000000000000000000000000000000000'
      UNION ALL
      SELECT from_addr, 0, amount, 0, 0, 0, 0
        FROM transfers
        WHERE kind IN ('SPEND','BURN')
          AND from_addr != '0x0000000000000000000000000000000000000000'
          AND from_addr NOT IN ('0xf9f676066eb7baeeed93e859bc26a41663f277a8',
                                '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1')
      UNION ALL
      SELECT from_addr, 0, 0, amount, 0, 0, 0
        FROM transfers
        WHERE kind='TRANSFER'
          AND (op_type='DEX_SELL'
               OR to_addr IN ('0xf9f676066eb7baeeed93e859bc26a41663f277a8',
                              '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1'))
          AND from_addr != '0x0000000000000000000000000000000000000000'
          AND from_addr NOT IN ('0xf9f676066eb7baeeed93e859bc26a41663f277a8',
                                '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1')
      UNION ALL
      SELECT to_addr, 0, 0, 0, amount, 0, 0
        FROM transfers
        WHERE kind='TRANSFER'
          AND (op_type='DEX_BUY'
               OR from_addr IN ('0xf9f676066eb7baeeed93e859bc26a41663f277a8',
                                '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1'))
          AND to_addr != '0x0000000000000000000000000000000000000000'
          AND to_addr NOT IN ('0xf9f676066eb7baeeed93e859bc26a41663f277a8',
                              '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1')
      UNION ALL
      SELECT to_addr, 0, 0, 0, 0, amount, 0
        FROM transfers
        WHERE kind='TRANSFER' AND op_type='TRANSFER'
          AND to_addr != '0x0000000000000000000000000000000000000000'
          AND to_addr NOT IN ('0xf9f676066eb7baeeed93e859bc26a41663f277a8',
                              '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1')
          AND from_addr NOT IN ('0xf9f676066eb7baeeed93e859bc26a41663f277a8',
                                '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1')
      UNION ALL
      SELECT from_addr, 0, 0, 0, 0, 0, amount
        FROM transfers
        WHERE kind='TRANSFER' AND op_type='TRANSFER'
          AND from_addr != '0x0000000000000000000000000000000000000000'
          AND from_addr NOT IN ('0xf9f676066eb7baeeed93e859bc26a41663f277a8',
                                '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1')
          AND to_addr NOT IN ('0xf9f676066eb7baeeed93e859bc26a41663f277a8',
                              '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1')
    ),
    agg AS (
      SELECT addr,
        SUM(earned) AS earned, SUM(spent) AS spent,
        SUM(dex_sold) AS dex_sold, SUM(dex_bought) AS dex_bought,
        SUM(xfer_in) AS xfer_in, SUM(xfer_out) AS xfer_out
      FROM per_wallet GROUP BY addr
    )
    SELECT a.addr AS address,
      ((a.dex_sold - 2 * a.spent - a.dex_bought + (a.xfer_in - a.xfer_out))
       * CASE WHEN a.spent < 0.2 * a.earned THEN 2.5 ELSE 1 END) AS score
    FROM agg a
    WHERE (a.earned >= 5000 OR (a.dex_sold - a.dex_bought) >= 5000)
      AND (a.earned > 0 OR a.spent > 0)`;

  console.log(`[label-wallets] ${rows.length} wallets qualify for labeling`);

  // Classify and tally.
  const tally = { extractor: 0, neutral: 0, contributor: 0 };
  const payload = rows.map(r => {
    const score = Number(r.score) || 0;
    const label = classifyScore(score);
    tally[label] = (tally[label] || 0) + 1;
    return { address: r.address.toLowerCase(), score, label };
  });

  const now = Math.floor(Date.now() / 1000);

  // Bulk upsert via INSERT…ON CONFLICT in batches of 500.
  let written = 0;
  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500);
    await db.begin(async (tx) => {
      for (const r of chunk) {
        await tx`
          INSERT INTO wallet_aliases (address, checked_at, label, label_score, label_computed_at)
          VALUES (${r.address}, ${now}, ${r.label}, ${r.score}, ${now})
          ON CONFLICT (address) DO UPDATE SET
            label             = EXCLUDED.label,
            label_score       = EXCLUDED.label_score,
            label_computed_at = EXCLUDED.label_computed_at`;
      }
    });
    written += chunk.length;
    console.log(`[label-wallets]   wrote ${written}/${payload.length}`);
  }

  console.log('[label-wallets] tally:');
  for (const [k, n] of Object.entries(tally)) console.log(`  ${k.padEnd(12)} ${n}`);
  console.log('[label-wallets] done.');
  await db.end();
}

main().catch(async (err) => {
  console.error(err);
  await db.end();
  process.exit(1);
});
