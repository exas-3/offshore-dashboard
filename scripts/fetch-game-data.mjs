// One-shot fetch of all publicly-readable game data from Supabase + the
// offshoreprotocol.fun API. Writes to:
//   - hits                (enriches existing rows with hit_type / completion_bps / *_wei)
//   - cycle_rewards       (new)
//   - game_locations      (new, reference data)
//   - game_items          (new, reference data)
//
// Idempotent. Safe to re-run.
//
// Usage:  npm run fetch-game-data
import postgres from 'postgres';

const SUPABASE_URL = 'https://daefnwrkvsbmvvyoctin.supabase.co';
const ANON_KEY     = 'sb_publishable_ynP8CEqU5uSjVi_6R-WIRA_p_GZzZJv';
const PAGE_SIZE    = 1000;

const db = postgres(process.env.DATABASE_URL);

async function fetchAll(table, columns = '*') {
  const all = [];
  for (let off = 0; ; off += PAGE_SIZE) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${columns}&offset=${off}&limit=${PAGE_SIZE}`;
    const res = await fetch(url, { headers: { apikey: ANON_KEY } });
    if (!res.ok) throw new Error(`${table} fetch ${res.status}: ${await res.text()}`);
    const page = await res.json();
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

async function syncHitEvents() {
  const rows = await fetchAll('hit_events',
    'tx_hash,hit_type,completion_bps,stack,attacker_payout,victim_payout,hit_cost');
  console.log(`[fetch-game-data] hit_events: ${rows.length} rows`);
  let updated = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await db.begin(async (tx) => {
      for (const r of chunk) {
        const n = await tx`
          UPDATE hits SET
            hit_type            = ${r.hit_type},
            completion_bps      = ${r.completion_bps},
            stack_wei           = ${r.stack},
            attacker_payout_wei = ${r.attacker_payout},
            victim_payout_wei   = ${r.victim_payout},
            hit_cost_wei        = ${r.hit_cost}
          WHERE tx_hash = ${(r.tx_hash || '').toLowerCase()}`;
        updated += n.count;
      }
    });
  }
  console.log(`[fetch-game-data] hits enriched: ${updated}/${rows.length} (others not yet in our on-chain index)`);
}

async function syncCycleRewards() {
  const rows = await fetchAll('cycle_user_results',
    'cycle_id,user_address,total_flux,reward_amount,loadout_count,created_at');
  console.log(`[fetch-game-data] cycle_user_results: ${rows.length} rows`);
  let written = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    await db.begin(async (tx) => {
      for (const r of chunk) {
        await tx`
          INSERT INTO cycle_rewards
            (cycle_id, user_address, total_flux, reward_amount_wei, loadout_count, created_at)
          VALUES
            (${r.cycle_id}, ${(r.user_address || '').toLowerCase()},
             ${r.total_flux}, ${r.reward_amount}, ${r.loadout_count ?? 0}, ${r.created_at})
          ON CONFLICT (cycle_id, user_address) DO UPDATE SET
            total_flux        = EXCLUDED.total_flux,
            reward_amount_wei = EXCLUDED.reward_amount_wei,
            loadout_count     = EXCLUDED.loadout_count`;
      }
    });
    written += chunk.length;
    if (written % 5000 === 0 || written === rows.length) {
      console.log(`[fetch-game-data]   cycle_rewards: ${written}/${rows.length}`);
    }
  }
}

async function syncLocations() {
  const rows = await fetchAll('locations');
  console.log(`[fetch-game-data] locations: ${rows.length} rows`);
  await db.begin(async (tx) => {
    for (const r of rows) {
      await tx`
        INSERT INTO game_locations
          (id, region, country, city, display_name, short_name, flag_emoji,
           latitude, longitude, description)
        VALUES (${r.id}, ${r.region}, ${r.country}, ${r.city},
                ${r.display_name}, ${r.short_name}, ${r.flag_emoji},
                ${r.latitude}, ${r.longitude}, ${r.description})
        ON CONFLICT (id) DO UPDATE SET
          region       = EXCLUDED.region,
          country      = EXCLUDED.country,
          city         = EXCLUDED.city,
          display_name = EXCLUDED.display_name,
          short_name   = EXCLUDED.short_name,
          flag_emoji   = EXCLUDED.flag_emoji,
          latitude     = EXCLUDED.latitude,
          longitude    = EXCLUDED.longitude,
          description  = EXCLUDED.description`;
    }
  });
}

async function syncItems() {
  const rows = await fetchAll('item_templates');
  console.log(`[fetch-game-data] item_templates: ${rows.length} rows`);
  await db.begin(async (tx) => {
    for (const r of rows) {
      await tx`
        INSERT INTO game_items
          (id, item_name, item_type_id, region, specific_location, latitude, longitude)
        VALUES (${r.id}, ${r.item_name}, ${r.item_type_id}, ${r.region},
                ${r.specific_location}, ${r.latitude}, ${r.longitude})
        ON CONFLICT (id) DO UPDATE SET
          item_name         = EXCLUDED.item_name,
          item_type_id      = EXCLUDED.item_type_id,
          region            = EXCLUDED.region,
          specific_location = EXCLUDED.specific_location,
          latitude          = EXCLUDED.latitude,
          longitude         = EXCLUDED.longitude`;
    }
  });
}

async function main() {
  console.log('[fetch-game-data] starting...');
  await syncLocations();
  await syncItems();
  await syncHitEvents();
  await syncCycleRewards();
  console.log('[fetch-game-data] done.');
  await db.end();
}

main().catch(async (err) => {
  console.error(err);
  await db.end();
  process.exit(1);
});
