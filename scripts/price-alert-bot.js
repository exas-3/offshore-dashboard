// DIRTY/USDm price alert bot.
// While price < THRESHOLD, DM the price to TG every INTERVAL ms.
// Reuses fetchDirtyPrice() (reads Uniswap V3 pool slot0 directly).
//
// Run: node --env-file=.env scripts/price-alert-bot.js
//      (or)  node scripts/price-alert-bot.js   — script also parses .env manually.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fetchDirtyPrice } from '../server/etherscan.js';

const __dir   = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '..', '.env');
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const TG_TOKEN   = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
if (!TG_TOKEN)   { console.error('TG_BOT_TOKEN not set in .env'); process.exit(1); }
if (!TG_CHAT_ID) { console.error('TG_CHAT_ID not set in .env');   process.exit(1); }

const THRESHOLD = 0.033379;
const INTERVAL  = 5 * 60 * 1000; // 5 min

async function sendTg(text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) console.error('[TG] failed:', await res.text());
  } catch (e) {
    console.error('[TG] error:', e.message);
  }
}

function utcTime() { return new Date().toISOString().slice(11, 19); }

async function tick() {
  let price;
  try {
    price = await fetchDirtyPrice();
  } catch (e) {
    console.error(`[bot] ${utcTime()} fetchDirtyPrice failed:`, e.message);
    return;
  }
  const below = price < THRESHOLD;
  console.log(`[bot] ${utcTime()} price=${price.toFixed(8)} USDm  below=${below}`);
  if (!below) return;

  const delta = ((price - THRESHOLD) / THRESHOLD) * 100;
  const text = [
    `📉 <b>DIRTY/USDm below threshold</b>`,
    `🕐 ${utcTime()} UTC`,
    ``,
    `Price:     <b>${price.toFixed(8)}</b> USDm`,
    `Threshold: ${THRESHOLD}`,
    `Δ:         ${delta.toFixed(2)}%`,
  ].join('\n');
  await sendTg(text);
}

console.log(`[bot] price-alert-bot started — threshold ${THRESHOLD}, interval ${INTERVAL / 1000}s`);
await sendTg(`🤖 <b>Price alert started</b>\nWill DM every 5m while DIRTY/USDm &lt; ${THRESHOLD}.`);
await tick();
setInterval(tick, INTERVAL);
