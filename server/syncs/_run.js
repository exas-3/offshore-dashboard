import { getLatestBlock } from '../etherscan.js';

const inflight = new Set();

// Shared block-range sync loop: re-entrancy guard, retry/backoff, meta cursor.
// processBatch(start, end) does fetch + upsert for one batch and returns rows written.
export async function runBlockSync({
  name,
  getLast,
  setLast,
  fromStart,
  batch    = 20_000,
  sleepMs  = 1200,
  retries  = 4,
  processBatch,
}) {
  if (inflight.has(name)) return 0;
  inflight.add(name);
  try {
    const fromBlock   = Math.max(await getLast() + 1, fromStart);
    const latestBlock = await getLatestBlock();
    if (fromBlock > latestBlock) return 0;

    let total = 0;
    for (let start = fromBlock; start <= latestBlock; start += batch) {
      const end = Math.min(start + batch - 1, latestBlock);
      let attempt = 0;
      while (attempt < retries) {
        try {
          total += (await processBatch(start, end)) ?? 0;
          break;
        } catch (err) {
          attempt++;
          if (attempt >= retries) throw err;
          await new Promise(r => setTimeout(r, 2000 * attempt));
          console.log(`[poller] ${name} retry ${attempt}: ${err.message}`);
        }
      }
      if (sleepMs > 0) await new Promise(r => setTimeout(r, sleepMs));
    }

    await setLast(latestBlock);
    if (total > 0) console.log(`[poller] ${name} +${total} | block ${latestBlock}`);
    return total;
  } catch (err) {
    console.error(`[poller] ${name} sync error:`, err.message);
    return 0;
  } finally {
    inflight.delete(name);
  }
}
