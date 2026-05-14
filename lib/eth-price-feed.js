// ETH/USDm price from Kumbaya WETH/USDm pool (chain 4326).
// Pool: 0x587F6eeAfc7Ad567e96eD1B62775fA6402164b22-4326 — token1Price = USDm per WETH

const POOL_URL = 'https://exchange.kumbaya.xyz/api/v1/pools/0x587F6eeAfc7Ad567e96eD1B62775fA6402164b22-4326';
const POLL_MS  = 10_000;  // DEX API — poll every 10 s

function createFeed() {
  const subs   = new Set();
  let latest   = null;

  async function poll() {
    try {
      const res  = await fetch(POOL_URL);
      if (res.ok) {
        const data  = await res.json();
        const price = parseFloat(data.pool?.token1Price);
        if (isFinite(price) && price > 0) latest = price;
      }
    } catch { /* ignore transient errors */ }
    setTimeout(poll, POLL_MS);
  }

  poll();

  setInterval(() => {
    if (latest == null) return;
    for (const fn of subs) fn(latest);
  }, 5_000);

  return {
    getLatest:   () => latest,
    subscribe:   (fn) => subs.add(fn),
    unsubscribe: (fn) => subs.delete(fn),
  };
}

const FEED_KEY = `__ethPriceFeed_kumbaya_weth_usdm`;
if (!globalThis[FEED_KEY]) globalThis[FEED_KEY] = createFeed();
export const ethPriceFeed = globalThis[FEED_KEY];
