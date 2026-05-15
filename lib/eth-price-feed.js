// ETH/USD price from RedStone on-chain oracle via MegaETH RPC.
const RPC    = 'https://mainnet.megaeth.com/rpc';
const ORACLE = '0xc555c100DB24dF36D406243642C169CC5A937f09';
const POLL_MS = 10_000;

function createFeed() {
  const subs = new Set();
  let latest = null;

  async function poll() {
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: ORACLE, data: '0xfeaf968c' }, 'latest'], id: 1 }),
      });
      if (res.ok) {
        const { result } = await res.json();
        const answer = BigInt('0x' + result.slice(66, 130));
        const price  = Number(answer) / 1e8;
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
