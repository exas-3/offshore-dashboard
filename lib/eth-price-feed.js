// ETH price via RedStone oracle on MegaETH.
//
// Read path: eth_call(latestRoundData) on the Chainlink-compatible adapter
// at 0xc555c100…7f09. The oracle DOES NOT emit any event when its value
// updates (verified empirically — 0 logs in any 5k-block window), so a
// topic-based WS subscription has nothing to listen to.
//
// Trigger path: when ALCHEMY_WS_URL is set, subscribe to eth_subscribe
// 'newHeads' — one re-read per new block (~1s on MegaETH), timing-locked
// to actual block production. The 5s setInterval below stays as the
// safety net during WS reconnects.
//
// Without ALCHEMY_WS_URL: pure timer polling at 1s (unchanged behaviour).

import { DEMO_MODE } from './demo-clock.js';

const RPC_URL  = 'https://mainnet.megaeth.com/rpc';
const ORACLE   = '0xc555c100DB24dF36D406243642C169CC5A937f09';
const WS_URL   = process.env.ALCHEMY_WS_URL || '';

function createFeed() {
  // Demo mode serves recorded data only — no RPC polling, no WS. The stub
  // must be returned before any timer starts (this module fires at import).
  if (DEMO_MODE) {
    return { getLatest: () => null, subscribe: () => {}, unsubscribe: () => {} };
  }
  const subs = new Set();
  let latest = null;
  let inflight = false;

  function publish(price) {
    if (!isFinite(price) || price <= 0) return;
    latest = price;
    for (const fn of subs) fn(price);
  }

  async function readOracle() {
    if (inflight) return; // don't pile reads if a block burst arrives
    inflight = true;
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
    } catch { /* ignore */ } finally {
      inflight = false;
    }
  }

  // Safety-net polling at 1s — matches the prior interval. With WS up
  // and firing newHeads, this is mostly a no-op (inflight gate skips
  // overlapping reads). When WS is down, it's the only source.
  readOracle();
  setInterval(readOracle, 1_000);

  // Newheads-driven reads via WS. Self-contained connection — the
  // poller's ws-client.js doesn't support newHeads and re-using it
  // would mean the dashboard process needs a WS connection too. Cheap
  // connection, one frame per block.
  if (WS_URL && typeof WebSocket !== 'undefined') {
    let ws = null;
    let reconnectAttempt = 0;
    let pendingReconnect = null;
    let subAcked = false;
    let lastFrameAt = 0;

    function scheduleReconnect() {
      if (pendingReconnect) return;
      const delay = Math.min(30_000, 1_000 * Math.pow(2, Math.min(reconnectAttempt, 5)));
      reconnectAttempt++;
      pendingReconnect = setTimeout(() => { pendingReconnect = null; connect(); }, delay);
    }

    function connect() {
      try { ws = new WebSocket(WS_URL); } catch (err) {
        console.error('[eth-price-feed] ws connect threw:', err.message);
        scheduleReconnect(); return;
      }
      ws.onopen = () => {
        reconnectAttempt = 0;
        subAcked = false;
        console.log('[eth-price-feed] ws connected, subscribing newHeads');
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }));
      };
      ws.onmessage = (event) => {
        let msg; try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.id === 1) {
          if (msg.result) {
            subAcked = true;
            console.log(`[eth-price-feed] newHeads subscribed  id=${msg.result.slice(0, 12)}…`);
          } else if (msg.error) {
            console.warn(`[eth-price-feed] newHeads subscribe failed: ${msg.error.message ?? JSON.stringify(msg.error)}`);
          }
          return;
        }
        // 'newHeads' delivery — fire one fresh oracle read.
        if (msg.method === 'eth_subscription' && msg.params?.result) {
          lastFrameAt = Date.now();
          readOracle().catch(() => {});
        }
      };
      ws.onclose = () => {
        console.warn('[eth-price-feed] ws closed; reconnecting');
        ws = null;
        scheduleReconnect();
      };
      ws.onerror = (err) => {
        console.warn('[eth-price-feed] ws error:', err?.message ?? '(no message)');
      };
    }

    connect();

    // Health check: if we've been "subscribed" but no frames for >15s,
    // force-reconnect. Alchemy occasionally goes quiet without closing.
    setInterval(() => {
      if (!subAcked || !ws) return;
      if (lastFrameAt && Date.now() - lastFrameAt > 15_000) {
        console.warn('[eth-price-feed] no newHeads in 15s, forcing reconnect');
        try { ws.close(); } catch {}
      }
    }, 5_000);
  }

  return {
    getLatest:   () => latest,
    subscribe:   (fn) => subs.add(fn),
    unsubscribe: (fn) => subs.delete(fn),
  };
}

const FEED_KEY = '__ethPriceFeed_redstone_megaeth';
if (!globalThis[FEED_KEY]) globalThis[FEED_KEY] = createFeed();
export const ethPriceFeed = globalThis[FEED_KEY];
