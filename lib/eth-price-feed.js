// Primary: WS on MegaETH → RedStone oracle AnswerUpdated events (zero polling cost).
// Fallback: HTTP polling via Alchemy mainnet → Chainlink ETH/USD (most reliable fallback).
// RedStone oracle on MegaETH
const WS_URL        = 'wss://mainnet.megaeth.com/rpc';
const WS_ORACLE     = '0xc555c100DB24dF36D406243642C169CC5A937f09';
// Chainlink ETH/USD on Ethereum mainnet via Alchemy (used only when WS is down)
const ALCHEMY_KEY   = '_6LklDOIdb-BwasmACeVlECBsojbFHB5';
const HTTP_RPC      = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;
const HTTP_ORACLE   = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
// AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)
const ANSWER_UPDATED = '0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f';

function createFeed() {
  const subs = new Set();
  let latest = null;
  let pollTimer = null;

  function publish(price) {
    if (!isFinite(price) || price <= 0) return;
    latest = price;
    for (const fn of subs) fn(price);
  }

  function parseAnswerUpdated(log) {
    // topic1 is int256 indexed current (8 decimals)
    const raw = BigInt(log.topics[1]);
    // int256: if high bit set, it's negative — treat as unsigned for price
    return Number(raw < 0n ? raw + 2n ** 256n : raw) / 1e8;
  }

  // ── HTTP fallback (Alchemy mainnet → Chainlink) ──────────────────────────────
  async function pollOnce() {
    try {
      const res = await fetch(HTTP_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: HTTP_ORACLE, data: '0xfeaf968c' }, 'latest'], id: 1 }),
      });
      if (res.ok) {
        const { result } = await res.json();
        const answer = BigInt('0x' + result.slice(66, 130));
        publish(Number(answer) / 1e8);
      }
    } catch { /* ignore */ }
  }

  function startPolling() {
    if (pollTimer) return;
    pollOnce();
    pollTimer = setInterval(pollOnce, 10_000);
  }

  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // ── WebSocket subscription ───────────────────────────────────────────────────
  function connectWs() {
    let ws;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      startPolling();
      return;
    }

    let subId = null;
    let pingInterval = null;

    ws.addEventListener('open', () => {
      stopPolling();
      ws.send(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_subscribe',
        params: ['logs', { address: WS_ORACLE, topics: [ANSWER_UPDATED] }],
      }));
      // keepalive
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'eth_blockNumber', params: [] }));
      }, 30_000);
    });

    ws.addEventListener('message', ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.id === 1 && msg.result) { subId = msg.result; return; }
        if (msg.method === 'eth_subscription' && msg.params?.subscription === subId) {
          publish(parseAnswerUpdated(msg.params.result));
        }
      } catch { /* ignore malformed */ }
    });

    ws.addEventListener('close', () => {
      clearInterval(pingInterval);
      subId = null;
      startPolling();
      // reconnect after 5s
      setTimeout(connectWs, 5_000);
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }

  // Heartbeat: re-broadcast cached price to SSE subscribers every 5s
  // regardless of oracle event frequency. No extra RPC calls.
  setInterval(() => { if (latest != null) for (const fn of subs) fn(latest); }, 5_000);

  // seed initial price via HTTP, then connect WS
  pollOnce().then(() => connectWs());

  return {
    getLatest:   () => latest,
    subscribe:   (fn) => subs.add(fn),
    unsubscribe: (fn) => subs.delete(fn),
  };
}

const FEED_KEY = '__ethPriceFeed_redstone_eth_usd';
if (!globalThis[FEED_KEY]) globalThis[FEED_KEY] = createFeed();
export const ethPriceFeed = globalThis[FEED_KEY];
