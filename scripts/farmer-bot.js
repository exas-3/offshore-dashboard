// Dirty farmer operation monitor — Telegram DM bot.
// Watches the top 6 wallets by DIRTY/INF ratio, sends a TG message whenever
// one of their companies starts an active operation.
//
// Config (add to .env):
//   TG_BOT_TOKEN=123456:ABC-...
//   TG_CHAT_ID=your_telegram_user_id
//
// Run: node scripts/farmer-bot.js

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ─── load .env ────────────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '..', '.env');
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const TG_TOKEN   = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const DB_URL     = process.env.DATABASE_URL;

if (!TG_TOKEN)   { console.error('[bot] TG_BOT_TOKEN not set in .env'); process.exit(1); }
if (!TG_CHAT_ID) { console.error('[bot] TG_CHAT_ID not set in .env');   process.exit(1); }
if (!DB_URL)     { console.error('[bot] DATABASE_URL not set in .env');  process.exit(1); }

// ─── DB ───────────────────────────────────────────────────────────────────────
import postgres from 'postgres';
const sql = postgres(DB_URL, {
  max: 3, idle_timeout: 30, connect_timeout: 10,
  ssl: DB_URL.includes('localhost') || DB_URL.includes('127.0.0.1')
    ? false : { rejectUnauthorized: false },
});

// ─── RPC ──────────────────────────────────────────────────────────────────────
import { getUserCompaniesBatch, getTradeStates } from '../server/etherscan.js';

// ─── Telegram ─────────────────────────────────────────────────────────────────
async function sendTg(text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) console.error('[TG] failed:', await res.text());
  } catch (e) {
    console.error('[TG] error:', e.message);
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function shortAddr(a) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }
function fmtD(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(1);
}
function utcTime() { return new Date().toISOString().slice(11, 19); }

// ─── DB query: top 6 by dirty/inf ratio ──────────────────────────────────────
const DIRTY_ADDR  = '0xc2f34f8849a8607fd73e06d6849bda07c2b7de38';
const INF_ADDR    = '0x403de0893f0bc66139592ba2fd254672f2db933a';
const TRANSFER_T0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_TOPIC  = '0x0000000000000000000000000000000000000000000000000000000000000000';
const DEPLOYER    = '0x0000000000000000000000005dc36d6dcd5a3792b3980de1f40c7c0970af3462';

async function getTop6ByRatio() {
  const rows = await sql`
    WITH dirty_minted AS (
      SELECT '0x' || right(topic2, 40) AS addr,
             SUM(hex_word(data, 0) / 1e18) AS dirty_farmed
      FROM idx_logs
      WHERE address = ${DIRTY_ADDR}
        AND topic0  = ${TRANSFER_T0}
        AND topic1  = ${ZERO_TOPIC}
        AND topic2 != ${DEPLOYER}
      GROUP BY topic2
    ),
    inf_burned AS (
      SELECT '0x' || right(topic1, 40) AS addr,
             SUM(hex_word(data, 0) / 1e18) AS inf_consumed
      FROM idx_logs
      WHERE address = ${INF_ADDR}
        AND topic0  = ${TRANSFER_T0}
        AND topic2  = ${ZERO_TOPIC}
      GROUP BY topic1
    )
    SELECT d.addr,
           ROUND(d.dirty_farmed::numeric, 2)              AS dirty_farmed,
           ROUND(COALESCE(i.inf_consumed, 0)::numeric, 2) AS inf_consumed,
           d.dirty_farmed / i.inf_consumed                AS ratio
    FROM dirty_minted d
    JOIN inf_burned i ON i.addr = d.addr
    WHERE i.inf_consumed > 0
    ORDER BY ratio DESC
    LIMIT 6`;
  return rows.map(r => ({
    addr:        r.addr,
    dirtyFarmed: Number(r.dirty_farmed),
    infConsumed: Number(r.inf_consumed),
    ratio:       Number(r.ratio),
  }));
}

// ─── state ────────────────────────────────────────────────────────────────────
// company address → { walletAddr, ratio, dirtyFarmed, infConsumed, prevActive }
const companyMap = new Map();
let farmers = [];
let firstPoll = true;
let lastRefresh = 0;
const REFRESH_INTERVAL = 5 * 60 * 1000; // refresh top-6 list every 5 min

async function refreshFarmers() {
  console.log(`[bot] ${utcTime()} Refreshing top-6 farmer list…`);
  try {
    const top6 = await getTop6ByRatio();
    farmers = top6;

    console.log('[bot] Top 6 by DIRTY/INF:');
    top6.forEach((f, i) => {
      console.log(`  #${i + 1} ${f.addr}  ratio=${f.ratio.toFixed(2)}  (${fmtD(f.dirtyFarmed)} / ${fmtD(f.infConsumed)})`);
    });

    const wallets   = top6.map(f => f.addr);
    const coMap     = await getUserCompaniesBatch(wallets);

    // Remove stale entries for wallets that are still tracked
    for (const [co, s] of companyMap) {
      if (wallets.includes(s.walletAddr)) companyMap.delete(co);
    }

    for (const f of top6) {
      const cos = coMap[f.addr] ?? [];
      for (const co of cos) {
        if (!companyMap.has(co)) {
          companyMap.set(co, { walletAddr: f.addr, ratio: f.ratio, dirtyFarmed: f.dirtyFarmed, infConsumed: f.infConsumed, prevActive: false });
        } else {
          const s = companyMap.get(co);
          s.walletAddr  = f.addr;
          s.ratio        = f.ratio;
          s.dirtyFarmed  = f.dirtyFarmed;
          s.infConsumed  = f.infConsumed;
        }
      }
      console.log(`  ${shortAddr(f.addr)} — ${cos.length} companies`);
    }

    lastRefresh = Date.now();
    console.log(`[bot] Tracking ${companyMap.size} companies total`);
  } catch (e) {
    console.error('[bot] refreshFarmers error:', e.message);
  }
}

// ─── poll ─────────────────────────────────────────────────────────────────────
let polling = false;

async function poll() {
  if (polling) return; // skip if previous poll still running
  polling = true;

  // Refresh farmer list if due
  if (Date.now() - lastRefresh >= REFRESH_INTERVAL) {
    await refreshFarmers();
    // After a refresh, skip this poll tick to reset prevActive from fresh state
    firstPoll = true;
    polling = false;
    return;
  }

  const companies = [...companyMap.keys()];
  if (!companies.length) { polling = false; return; }

  let states;
  try {
    states = await getTradeStates(companies);
  } catch (e) {
    console.error(`[bot] ${utcTime()} getTradeStates error:`, e.message);
    polling = false;
    return;
  }

  for (const s of states) {
    const entry = companyMap.get(s.company);
    if (!entry) continue;

    // Detect active transition (false → true)
    if (!firstPoll && s.active && !entry.prevActive) {
      const rank = farmers.findIndex(f => f.addr === entry.walletAddr) + 1;
      const text = [
        `🚜 <b>Farmer started an op</b>`,
        `🕐 ${utcTime()} UTC`,
        ``,
        `👤 Wallet: <code>${entry.walletAddr}</code>`,
        `🏭 Company: <code>${s.company}</code>`,
        `📊 DIRTY/INF: <b>${entry.ratio.toFixed(2)}</b>  (#${rank} farmer)`,
        `📈 ${fmtD(entry.dirtyFarmed)} DIRTY farmed / ${fmtD(entry.infConsumed)} INF consumed`,
      ].join('\n');

      console.log(`[bot] ${utcTime()} ALERT: ${shortAddr(entry.walletAddr)} company ${shortAddr(s.company)} active`);
      await sendTg(text);
    }

    entry.prevActive = s.active;
  }

  if (firstPoll) {
    const activeCount = states.filter(s => s.active).length;
    console.log(`[bot] ${utcTime()} First poll done — ${states.length} companies checked, ${activeCount} currently active`);
    firstPoll = false;
  }

  polling = false;
}

// ─── start ────────────────────────────────────────────────────────────────────
console.log('[bot] Starting dirty-farmer operation monitor…');
await sendTg('🤖 <b>Farmer monitor started</b>\nWatching top-6 wallets by DIRTY/INF ratio.');
await refreshFarmers();

setInterval(poll, 1000);
