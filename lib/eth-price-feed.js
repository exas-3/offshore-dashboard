// ETH/USD price from RedStone oracle REST API.
const REDSTONE_URL = 'https://api.redstone.finance/prices/?symbol=ETH&provider=redstone&limit=1';
const POLL_MS = 10_000;

function createFeed() {
  const subs = new Set();
  let latest = null;

  async function poll() {
    try {
      const res = await fetch(REDSTONE_URL);
      if (res.ok) {
        const data = await res.json();
        const price = parseFloat(data[0]?.value);
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

const FEED_KEY = `__ethPriceFeed_redstone_eth_usd`;
if (!globalThis[FEED_KEY]) globalThis[FEED_KEY] = createFeed();
export const ethPriceFeed = globalThis[FEED_KEY];
