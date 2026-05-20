// Fetch the Offshore Protocol game leaderboard from Supabase REST and bulk-
// upsert the (user_address → display_name) pairs into wallet_aliases.alias.
//
// The endpoint is the same one the in-game leaderboard hits. The publishable
// anon key is embedded in the game's frontend bundle and works without auth
// for the read-only leaderboard table (Supabase RLS allows public select).
//
// Idempotent — safe to re-run. Players who drop their display_name will be
// cleared from alias (set to NULL) so the table reflects the current
// authoritative state.
//
// Usage:  npm run fetch-game-leaderboard
import postgres from 'postgres';

const SUPABASE_URL = 'https://daefnwrkvsbmvvyoctin.supabase.co';
const ANON_KEY     = 'sb_publishable_ynP8CEqU5uSjVi_6R-WIRA_p_GZzZJv';
const PAGE_SIZE    = 1000;

const db = postgres(process.env.DATABASE_URL);

async function fetchPage(offset, limit) {
  const url = `${SUPABASE_URL}/rest/v1/leaderboard`
    + `?select=user_address,display_name`
    + `&order=rank_points.asc.nullslast`
    + `&offset=${offset}&limit=${limit}`;
  const res = await fetch(url, {
    headers: {
      apikey: ANON_KEY,
      'accept-profile': 'public',
    },
  });
  if (!res.ok) {
    throw new Error(`leaderboard fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function fetchAll() {
  const all = [];
  for (let off = 0; ; off += PAGE_SIZE) {
    const page = await fetchPage(off, PAGE_SIZE);
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

async function main() {
  console.log('[fetch-game-leaderboard] fetching all rows...');
  const rows = await fetchAll();
  console.log(`[fetch-game-leaderboard] ${rows.length} leaderboard rows fetched`);

  const named = rows.filter(r =>
    r.user_address && /^0x[0-9a-f]{40}$/i.test(r.user_address) &&
    r.display_name && r.display_name.trim().length > 0,
  );
  console.log(`[fetch-game-leaderboard] ${named.length} of them have a display_name`);

  if (named.length === 0) {
    await db.end();
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  // Upsert in chunks of 500 to keep individual statements small.
  let upserted = 0;
  for (let i = 0; i < named.length; i += 500) {
    const chunk = named.slice(i, i + 500);
    await db.begin(async (tx) => {
      for (const r of chunk) {
        await tx`
          INSERT INTO wallet_aliases (address, alias, checked_at)
          VALUES (${r.user_address.toLowerCase()}, ${r.display_name.trim()}, ${now})
          ON CONFLICT (address) DO UPDATE SET
            alias      = EXCLUDED.alias,
            checked_at = EXCLUDED.checked_at`;
      }
    });
    upserted += chunk.length;
    console.log(`[fetch-game-leaderboard]   upserted ${upserted}/${named.length}`);
  }

  console.log('[fetch-game-leaderboard] done.');
  await db.end();
}

main().catch(async (err) => {
  console.error(err);
  await db.end();
  process.exit(1);
});
