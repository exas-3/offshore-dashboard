// All on-chain data sourced from MegaETH RPC.
// ETH/USD price sourced from CoinGecko (no on-chain oracle available).

const COINGECKO = 'https://api.coingecko.com/api/v3';
const RPC       = 'https://mainnet.megaeth.com/rpc';

export const DIRTY     = '0xC2f34f8849a8607FD73E06D6849bDA07C2b7DE38';
export const INFLUENCE = '0x403De0893f0Bc66139592ba2FD254672f2dB933a';
export const USDM      = '0xFAfDdBb3FC7688494971A79cC65dca3EF82079E7';
export const VAULT     = '0x955a4adDC17114c36726C12AF9C73E23E497C2BD';

// MegaETH: 1 sec/block. timestamp = block_number + GENESIS (RPC-verified).
export const GENESIS = 1_762_797_011;

const ZERO        = '0x0000000000000000000000000000000000000000';
const LEVEL_COSTS = new Set([300, 800, 1500, 2500, 4000, 9000, 13500, 19500, 28500]);

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SEL_TOTAL_SUPPLY = '0x18160ddd';

// ─── helpers ─────────────────────────────────────────────────────────────────

export function fromWei(value, decimals = 18) {
  if (!value || value === '0') return 0;
  const s = String(value);
  if (s.length <= decimals) return parseFloat('0.' + s.padStart(decimals, '0'));
  return parseFloat(
    s.slice(0, s.length - decimals) + '.' + s.slice(s.length - decimals, s.length - decimals + 6)
  );
}

async function rpcPost(method, params, timeoutMs = 8000) {
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

async function rpcBatch(requests, timeoutMs = 8000) {
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

// ─── classification ───────────────────────────────────────────────────────────

// Protocol/team addresses — their burns stay as BURN, not THIRD_ENTERPRISE
const PROTOCOL = new Set(['0x5dc36d6dcd5a3792b3980de1f40c7c0970af3462']);

export function classifyTransfer(from, to, amount) {
  const f = (from ?? '').toLowerCase();
  const t = (to   ?? '').toLowerCase();
  if (f === ZERO) {
    const r = Math.round(amount);
    if (r === 100) return { kind: 'MINT', opType: 'DRUG_DEAL'  };
    if (r === 115) return { kind: 'MINT', opType: 'ARMS_DEAL'  };
    if (r === 130) return { kind: 'MINT', opType: 'EXTORTION'  };
    if (amount > 0) return { kind: 'MINT', opType: 'PARTIAL'  };
    return               { kind: 'MINT', opType: 'FAIL'      };
  }
  if (amount > 0 && amount % 200 < 0.5 && amount <= 6000)
    return { kind: 'SPEND', opType: 'BUY_ASSET' };
  if (LEVEL_COSTS.has(Math.round(amount))) return { kind: 'SPEND', opType: 'LEVEL_UP' };
  // Third Enterprise purchase: known costs 35000 (original) → 28000 (current)
  // Catch-all: any burn to 0x0 above asset/level thresholds that isn't protocol
  if (t === ZERO && amount > 6000 && !PROTOCOL.has(f))
    return { kind: 'SPEND', opType: 'THIRD_ENTERPRISE' };
  if (t === ZERO) return { kind: 'BURN',     opType: 'BURN'     };
  return          { kind: 'TRANSFER', opType: 'TRANSFER' };
}

// ─── block / logs ─────────────────────────────────────────────────────────────

export async function getLatestBlock() {
  return parseInt(await rpcPost('eth_blockNumber', []), 16);
}

// ERC-20 Transfer logs for [fromBlock, toBlock].
// timestamp = blockNum + GENESIS (exact, no interpolation needed).
export async function fetchTransferLogs(tokenAddress, fromBlock, toBlock) {
  const logs = await rpcPost('eth_getLogs', [{
    address:   tokenAddress,
    topics:    [TRANSFER_TOPIC],
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock:   '0x' + toBlock.toString(16),
  }]);

  return logs.map(log => {
    const blockNum = parseInt(log.blockNumber, 16);
    const logIndex = parseInt(log.logIndex, 16);
    const from     = ('0x' + log.topics[1].slice(26)).toLowerCase();
    const to       = ('0x' + log.topics[2].slice(26)).toLowerCase();
    const amount   = fromWei(BigInt(log.data).toString());
    const kind     = from === ZERO ? 'MINT' : to === ZERO ? 'BURN' : 'TRANSFER';
    return {
      hash:      log.transactionHash,
      logIndex,
      blockNum,
      timestamp: blockNum + GENESIS,
      fromAddr:  from,
      toAddr:    to,
      amount,
      kind,
    };
  });
}

// ─── contract calls ───────────────────────────────────────────────────────────

export async function fetchVaultBalance() {
  const result = await rpcPost('eth_call', [
    { to: USDM, data: '0x70a08231000000000000000000000000' + VAULT.slice(2) },
    'latest',
  ]);
  return fromWei(BigInt(result).toString());
}

export async function fetchSupply(contractAddr) {
  const result = await rpcPost('eth_call', [{ to: contractAddr, data: SEL_TOTAL_SUPPLY }, 'latest']);
  return fromWei(BigInt(result).toString());
}

export async function fetchSupplyAtBlock(blockNum) {
  const result = await rpcPost('eth_call', [
    { to: DIRTY, data: SEL_TOTAL_SUPPLY },
    '0x' + blockNum.toString(16),
  ]);
  return fromWei(BigInt(result).toString());
}

// Returns a Map<address, isContract: boolean> for the given addresses.
export async function checkIsContract(addresses) {
  if (addresses.length === 0) return new Map();
  const reqs = addresses.map((addr, i) => ({
    method: 'eth_getCode',
    params: [addr, 'latest'],
    id: i,
  }));
  const responses = await rpcBatch(reqs);
  const out = new Map();
  for (const r of responses) {
    out.set(addresses[r.id], r.result !== '0x' && r.result !== '0x0');
  }
  return out;
}

// ─── ETH price (CoinGecko — no on-chain oracle available) ────────────────────

export async function fetchEthPrice() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${COINGECKO}/simple/price?ids=ethereum&vs_currencies=usd`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const d = await res.json();
    return d.ethereum.usd;
  } finally {
    clearTimeout(timer);
  }
}
