// Links game wallets to the identity wallet that funded them.
// Step 1: ENS-check all potential funder wallets not yet checked.
// Step 2: For each game wallet without a direct alias, find the funder
//         (wallet that sent the most direct DIRTY transfers) that has any alias.
// Safe to re-run: skips already-checked ENS, uses ON CONFLICT DO UPDATE.
import postgres from 'postgres';

const db = postgres(process.env.DATABASE_URL);

const DEX_MAIN = '0xf9f676066eb7baeeed93e859bc26a41663f277a8';
const DEX_V3   = '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1';
const ZERO     = '0x0000000000000000000000000000000000000000';
const VAULT    = '0x955a4addc17114c36726c12af9c73e23e497c2bd';
const STAKING  = '0x3620bbeded3bcf1b3409098dc152b0eecf66ea8e';
const FACTORY  = '0x619814a203ca441611cee02abf31986ca265dd35';

const EXCLUDE = [DEX_MAIN, DEX_V3, ZERO, VAULT, STAKING, FACTORY];
const DELAY_MS = 300;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function resolveEns(address) {
  const res = await fetch(`https://api.ensideas.com/ens/resolve/${address}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.name || null;
}

async function main() {
  // ── Step 1: ENS-check funder candidates not yet checked ──────────────────
  const candidates = await db`
    SELECT DISTINCT t.from_addr AS address
    FROM transfers t
    WHERE t.kind = 'TRANSFER'
      AND t.op_type = 'TRANSFER'
      AND t.from_addr != ALL(${EXCLUDE})
      AND t.to_addr   != ALL(${EXCLUDE})
      AND t.from_addr NOT IN (
        SELECT address FROM wallet_aliases WHERE ens_checked_at IS NOT NULL
      )
  `;

  console.log(`${candidates.length} funder candidates not yet ENS-checked`);
  let ensFound = 0, ensEmpty = 0, ensErrors = 0;
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < candidates.length; i++) {
    const address = candidates[i].address;
    try {
      const name = await resolveEns(address);
      await db`
        INSERT INTO wallet_aliases (address, ens_alias, ens_checked_at, checked_at)
        VALUES (${address}, ${name}, ${now}, ${now})
        ON CONFLICT (address) DO UPDATE
          SET ens_alias = EXCLUDED.ens_alias, ens_checked_at = EXCLUDED.ens_checked_at
      `;
      if (name) { ensFound++; process.stdout.write(`[ENS ${i+1}/${candidates.length}] ${address} → ${name}\n`); }
      else       { ensEmpty++; }
    } catch (err) {
      ensErrors++;
      process.stdout.write(`[ENS ${i+1}/${candidates.length}] ERROR ${address}: ${err.message}\n`);
    }
    if (i < candidates.length - 1) await sleep(DELAY_MS);
  }

  if (candidates.length > 0) {
    console.log(`ENS step done: found=${ensFound} empty=${ensEmpty} errors=${ensErrors}`);
  }

  // ── Step 2: Populate funded_by ────────────────────────────────────────────
  const rows = await db`
    WITH direct_aliased AS (
      SELECT address FROM wallet_aliases
      WHERE ens_alias IS NOT NULL
         OR (alias IS NOT NULL AND alias != '')
         OR debank_alias IS NOT NULL
    ),
    funder_counts AS (
      SELECT t.to_addr AS wallet, t.from_addr AS funder, COUNT(*) AS cnt
      FROM transfers t
      JOIN wallet_aliases wa ON wa.address = t.from_addr
        AND (wa.ens_alias IS NOT NULL OR (wa.alias IS NOT NULL AND wa.alias != '') OR wa.debank_alias IS NOT NULL)
      WHERE t.kind = 'TRANSFER'
        AND t.op_type = 'TRANSFER'
        AND t.from_addr != ALL(${EXCLUDE})
        AND t.to_addr   != ALL(${EXCLUDE})
        AND t.to_addr NOT IN (SELECT address FROM direct_aliased)
      GROUP BY t.to_addr, t.from_addr
    ),
    best_funder AS (
      SELECT DISTINCT ON (wallet) wallet, funder
      FROM funder_counts
      ORDER BY wallet, cnt DESC
    )
    SELECT bf.wallet, bf.funder,
           COALESCE(wa.ens_alias, wa.alias, wa.debank_alias) AS funder_alias
    FROM best_funder bf
    JOIN wallet_aliases wa ON wa.address = bf.funder
  `;

  console.log(`\nFound ${rows.length} wallet→funder relationships`);
  let updated = 0;
  for (const r of rows) {
    await db`
      INSERT INTO wallet_aliases (address, funded_by, checked_at)
      VALUES (${r.wallet}, ${r.funder}, ${Math.floor(Date.now() / 1000)})
      ON CONFLICT (address) DO UPDATE SET funded_by = EXCLUDED.funded_by
    `;
    console.log(`  ${r.wallet} → ${r.funder_alias} (${r.funder})`);
    updated++;
  }

  console.log(`\nDone. Updated ${updated} wallets.`);
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
