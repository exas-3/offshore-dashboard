// ETH price via RedStone oracle on MegaETH — same call the poller uses.
// Polls latestRoundData() every 30s. WS event subscription removed (oracle
// doesn't emit AnswerUpdated reliably on MegaETH).
const RPC_URL   = 'https://mainnet.megaeth.com/rpc';
const ORACLE    = '0xc555c100DB24dF36D406243642C169CC5A937f09';

function createFeed() {
  const subs = new Set();
  let latest = null;

  function publish(price) {
    if (!isFinite(price) || price <= 0) return;
    latest = price;
    for (const fn of subs) fn(price);
  }

  async function pollOnce() {
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: ORACLE, data: '0xfeaf968c' }, 'latest'], id: 1 }),
      });
      if (!res.ok) return;
      const { result } = await res.json();
      if (!result) return;
      const answer = BigInt('0x' + result.slice(66, 130));
      publish(Number(answer) / 1e8);
    } catch { /* ignore */ }
  }

  pollOnce();
  setInterval(pollOnce, 1_000);

  return {
    getLatest:   () => latest,
    subscribe:   (fn) => subs.add(fn),
    unsubscribe: (fn) => subs.delete(fn),
  };
}

const FEED_KEY = '__ethPriceFeed_redstone_megaeth';
if (!globalThis[FEED_KEY]) globalThis[FEED_KEY] = createFeed();
export const ethPriceFeed = globalThis[FEED_KEY];
