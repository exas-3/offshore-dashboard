// Alchemy WebSocket subscription manager.
//
// Each call to addSubscription({ name, filter, onLog }) registers a live
// eth_subscribe('logs', filter) stream against an Alchemy WS endpoint
// (configured via the ALCHEMY_WS_URL env var). The manager:
//   - reconnects with exponential backoff on disconnect
//   - tracks the highest block seen per subscription
//   - gap-fills via eth_getLogs on every reconnect, from lastBlock+1 to head,
//     before resuming the live stream — so reconnect blips don't lose events
//   - swallows duplicate deliveries gracefully (handlers must be idempotent)
//
// Native global WebSocket (Node 22.4+) is used — no extra dep.

import { rpcPost } from './rpc-client.js';

const WS_URL = process.env.ALCHEMY_WS_URL || '';

export function createWsClient() {
  if (!WS_URL) {
    console.warn('[ws] ALCHEMY_WS_URL not set — subscriptions disabled, fall back to polling');
    return { addSubscription: () => {}, start: () => {} };
  }

  const subs = [];           // { name, filter, onLog, lastBlock, subId, pendingReqId }
  let ws = null;
  let connectAttempt = 0;
  let reconnectTimer = null;

  function scheduleReconnect() {
    const delay = Math.min(30_000, 1_000 * Math.pow(2, Math.min(connectAttempt, 5)));
    connectAttempt++;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
  }

  async function gapFill(sub) {
    if (sub.lastBlock <= 0) return;
    try {
      const head = parseInt(await rpcPost('eth_blockNumber', []), 16);
      if (head <= sub.lastBlock) return;
      const logs = await rpcPost('eth_getLogs', [{
        ...sub.filter,
        fromBlock: '0x' + (sub.lastBlock + 1).toString(16),
        toBlock:   '0x' + head.toString(16),
      }]);
      if (logs && logs.length) {
        console.log(`[ws] ${sub.name} gap-fill ${logs.length} logs (blocks ${sub.lastBlock + 1}..${head})`);
        for (const log of logs) await sub.onLog(log);
      }
      sub.lastBlock = head;
    } catch (err) {
      console.warn(`[ws] ${sub.name} gap-fill failed: ${err.message}`);
    }
  }

  function registerSub(sub) {
    sub.pendingReqId = Math.floor(Math.random() * 1e9);
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: sub.pendingReqId,
      method: 'eth_subscribe',
      params: ['logs', sub.filter],
    }));
  }

  function connect() {
    try { ws = new WebSocket(WS_URL); } catch (err) {
      console.error('[ws] connect threw:', err.message);
      scheduleReconnect();
      return;
    }
    ws.onopen = async () => {
      console.log('[ws] connected');
      connectAttempt = 0;
      // Gap-fill each sub BEFORE re-subscribing so we don't double-process
      // any events the live stream catches first.
      for (const sub of subs) {
        await gapFill(sub);
        registerSub(sub);
      }
    };
    ws.onmessage = async (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      // Subscription delivery
      if (msg.method === 'eth_subscription' && msg.params) {
        const log = msg.params.result;
        const sub = subs.find(s => s.subId === msg.params.subscription);
        if (sub && log) {
          const bn = parseInt(log.blockNumber, 16);
          if (bn > sub.lastBlock) sub.lastBlock = bn;
          try { await sub.onLog(log); } catch (err) {
            console.error(`[ws] ${sub.name} handler error:`, err.message);
          }
        }
        return;
      }
      // Response to eth_subscribe: id matches, result is the subscription id
      if (msg.id != null && msg.result) {
        const sub = subs.find(s => s.pendingReqId === msg.id);
        if (sub) {
          sub.subId = msg.result;
          console.log(`[ws] subscribed ${sub.name}  id=${msg.result.slice(0, 12)}…`);
        }
      }
    };
    ws.onclose = () => {
      console.warn('[ws] disconnected, scheduling reconnect');
      ws = null;
      // Clear subscription ids so re-register fires fresh on reconnect.
      for (const sub of subs) sub.subId = null;
      scheduleReconnect();
    };
    ws.onerror = (err) => {
      console.warn('[ws] error:', err?.message ?? '(no message)');
      // close fires after error in browser WS; do nothing extra here
    };
  }

  function addSubscription({ name, filter, onLog }) {
    subs.push({ name, filter, onLog, lastBlock: 0, subId: null, pendingReqId: null });
    if (ws?.readyState === 1 /* OPEN */) {
      registerSub(subs[subs.length - 1]);
    }
  }

  return {
    addSubscription,
    start() { connect(); },
  };
}

// Singleton client used by the poller process. Exposed as a getter so the
// connection isn't established until something actually subscribes.
let _client = null;
export function getWsClient() {
  if (!_client) _client = createWsClient();
  return _client;
}
