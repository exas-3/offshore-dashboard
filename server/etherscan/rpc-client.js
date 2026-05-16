const RPC = 'https://mainnet.megaeth.com/rpc';

export function fromWei(value, decimals = 18) {
  if (!value || value === '0') return 0;
  const s = String(value);
  if (s.length <= decimals) return parseFloat('0.' + s.padStart(decimals, '0'));
  return parseFloat(
    s.slice(0, s.length - decimals) + '.' + s.slice(s.length - decimals, s.length - decimals + 6)
  );
}

export async function rpcPost(method, params, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(RPC, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal:  ctrl.signal,
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function rpcBatch(requests, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(RPC, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(requests.map((r, i) => ({ jsonrpc: '2.0', ...r, id: i }))),
      signal:  ctrl.signal,
    });
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}
