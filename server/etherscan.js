// All on-chain data sourced from MegaETH RPC.
// ETH/USD price sourced from CoinGecko (no on-chain oracle available).

const COINGECKO = 'https://api.coingecko.com/api/v3';
const RPC       = 'https://mainnet.megaeth.com/rpc';

// Known DIRTY liquidity pool addresses (main + legacy).
export const DEX_POOLS = new Set([
  '0xf9f676066eb7baeed93e859bc26a41663f277a8',  // main pool
  '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1',  // legacy pool
]);

// Function selector → op_type for operations that can be classified definitively from tx input.
// Note: 0x372500ab (collectRewards) is shared by DRUG_DEAL/ARMS_DEAL/PARTIAL — still amount-based.
export const FUNCTION_OP_TYPES = {
  '0x046d03d1': 'SCRAP',       // scrapInventoryItem(uint256) — in-game: Exfiltrate
  '0x1afc17b0': 'SCRAP',       // scrapInventoryItems(uint256[],uint256[])
  '0xca55c869': 'EXTORTION',   // extort
  '0xf4f98ad5': 'BUY_ASSET',   // buy asset
  '0x4ea1ecf9': 'LEVEL_UP',    // level up company
};

export const DIRTY          = '0xC2f34f8849a8607FD73E06D6849bDA07C2b7DE38';
export const INFLUENCE      = '0x403De0893f0Bc66139592ba2FD254672f2dB933a';
export const USDM           = '0xFAfDdBb3FC7688494971A79cC65dca3EF82079E7';
export const VAULT          = '0x955a4adDC17114c36726C12AF9C73E23E497C2BD';
export const FACTORY        = '0x619814A203cA441611cEE02aBF31986Ca265dd35';
export const BATCH_RESOLVER = '0x6E43F31b2c160A3672C681114696667Ef219D4C3';

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

// txInput: raw hex input of the parent transaction (optional).
// Used to detect non-mission mints (e.g. scrapInventoryItem) by function selector.
export function classifyTransfer(from, to, amount, txInput = null) {
  const f = (from ?? '').toLowerCase();
  const t = (to   ?? '').toLowerCase();
  if (f === ZERO) {
    if (txInput) {
      const sel = txInput.slice(0, 10).toLowerCase();
      const knownOp = FUNCTION_OP_TYPES[sel];
      if (knownOp) return { kind: 'MINT', opType: knownOp };
    }
    if (amount > 0) return { kind: 'MINT', opType: 'PARTIAL' };  // overridden by factory context in poller
    return               { kind: 'MINT', opType: 'FAIL'     };
  }
  // DEX pool transfers take priority over amount-based spend rules.
  if (DEX_POOLS.has(t)) return { kind: 'TRANSFER', opType: 'DEX_SELL' };
  if (DEX_POOLS.has(f)) return { kind: 'TRANSFER', opType: 'DEX_BUY'  };
  // Selector-based SPEND classification (more reliable than amount heuristics).
  if (txInput) {
    const sel = txInput.slice(0, 10).toLowerCase();
    const knownOp = FUNCTION_OP_TYPES[sel];
    if (knownOp === 'BUY_ASSET') return { kind: 'SPEND', opType: 'BUY_ASSET' };
    if (knownOp === 'LEVEL_UP')  return { kind: 'SPEND', opType: 'LEVEL_UP'  };
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

// Batch-fetch transaction input data for a list of tx hashes.
// Returns Map<hash lowercase, inputHex>
export async function fetchTxInputs(hashes, timeoutMs = 20000) {
  if (!hashes.length) return new Map();
  const CHUNK = 100;
  const out = new Map();
  for (let i = 0; i < hashes.length; i += CHUNK) {
    const chunk = hashes.slice(i, i + CHUNK);
    const reqs  = chunk.map((h, j) => ({
      method: 'eth_getTransactionByHash',
      params: [h],
      id: j,
    }));
    const results = await rpcBatch(reqs, timeoutMs);
    for (const r of results) {
      const tx = r.result;
      if (tx?.input) out.set(chunk[r.id].toLowerCase(), tx.input);
    }
    if (i + CHUNK < hashes.length) await new Promise(res => setTimeout(res, 300));
  }
  return out;
}

// ─── factory trade classification ────────────────────────────────────────────

const FACTORY_ADDR = '0x619814A203cA441611cEE02aBF31986Ca265dd35';
// TradeExited — present in both partial success AND liquidations
const E_EXITED = '0xf20fbbc5dd518513b4b0381c1904c0751ca7493753ec53a73e651e8b79ee61ff';
// DirtyPaid — present only in successful trades; topic1=company, topic2=player
const E_PAYOUT = '0xa082f97b8bead66307ae367bd14b2366e03c2e963493a9f269501d884cd1a502';
// FullCompletion — present only on full 8h cycle completion (not partial collects)
const E_COMPLETE = '0x55458b8d3210ff0a2d3612a4b3639021fd38d66d563562a98ca8b7d5e7930f70';
// Company view function: tradeType() — returns 0=inactive, 1=DRUG_DEAL, 2=ARMS_DEAL
const SEL_TRADE_TYPE = '0x6fd47b44';

// Per-process cache: company address → trade type int (1 or 2). Immutable once set.
export const _companyTypeCache = new Map();

// Batch-fetch trade types for company addresses not yet in cache.
// Uses a small in-flight dedup so concurrent calls for same addr don't duplicate.
const _inflight = new Map();
export async function getCompanyTradeTypes(addrs) {
  const needed = addrs.filter(a => !_companyTypeCache.has(a));
  if (needed.length === 0) return;
  const CHUNK = 50;
  for (let i = 0; i < needed.length; i += CHUNK) {
    const chunk = needed.slice(i, i + CHUNK);
    const reqs = chunk.map((a, j) => ({ method: 'eth_call', params: [{ to: a, data: SEL_TRADE_TYPE }, 'latest'], id: j }));
    const results = await rpcBatch(reqs).catch(() => []);
    for (let j = 0; j < chunk.length; j++) {
      const res = results[j]?.result;
      const t = (res && res !== '0x') ? Number(BigInt(res)) : 0;
      _companyTypeCache.set(chunk[j], t);
    }
    if (i + CHUNK < needed.length) await new Promise(r => setTimeout(r, 150));
  }
}

// Fetch factory DirtyPaid + FullCompletion events for a block range.
// Returns { companyMap: Map<txHash, companyAddr>, fullTxs: Set<txHash> }
export async function fetchFactoryTradeContext(fromBlock, toBlock) {
  const fromHex = '0x' + fromBlock.toString(16);
  const toHex   = '0x' + toBlock.toString(16);
  const [payoutLogs, completeLogs] = await Promise.all([
    rpcPost('eth_getLogs', [{ address: FACTORY_ADDR, topics: [E_PAYOUT], fromBlock: fromHex, toBlock: toHex }]),
    rpcPost('eth_getLogs', [{ address: FACTORY_ADDR, topics: [E_COMPLETE], fromBlock: fromHex, toBlock: toHex }]),
  ]);
  const companyMap = new Map();
  for (const l of payoutLogs ?? []) {
    const txHash = l.transactionHash.toLowerCase();
    const company = ('0x' + l.topics[1].slice(26)).toLowerCase();
    companyMap.set(txHash, company);
  }
  const fullTxs = new Set((completeLogs ?? []).map(l => l.transactionHash.toLowerCase()));
  return { companyMap, fullTxs };
}

// Fetches liquidated trade events from the factory contract for a block range.
// Returns [{hash, logIndex, blockNum, timestamp, companyAddr}] — only trades with no DIRTY payout.
export async function fetchLiquidationEvents(fromBlock, toBlock) {
  const [exitedLogs, payoutLogs] = await Promise.all([
    rpcPost('eth_getLogs', [{
      address: FACTORY_ADDR,
      topics:  [E_EXITED],
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock:   '0x' + toBlock.toString(16),
    }]),
    rpcPost('eth_getLogs', [{
      address: FACTORY_ADDR,
      topics:  [E_PAYOUT],
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock:   '0x' + toBlock.toString(16),
    }]),
  ]);
  const payoutTxs = new Set(payoutLogs.map(l => l.transactionHash.toLowerCase()));
  return exitedLogs
    .filter(l => !payoutTxs.has(l.transactionHash.toLowerCase()))
    .map(l => ({
      hash:        l.transactionHash.toLowerCase(),
      logIndex:    parseInt(l.logIndex, 16),
      blockNum:    parseInt(l.blockNumber, 16),
      timestamp:   parseInt(l.blockNumber, 16) + GENESIS,
      companyAddr: ('0x' + l.topics[1].slice(26)).toLowerCase(),
    }));
}

// ─── block / logs ─────────────────────────────────────────────────────────────

export async function getLatestBlock() {
  return parseInt(await rpcPost('eth_blockNumber', []), 16);
}

let _tpsCache = null, _tpsCacheTs = 0;
export async function fetchTps(numBlocks = 6) {
  if (_tpsCache !== null && Date.now() - _tpsCacheTs < 1000) return _tpsCache;
  const latestHex = await rpcPost('eth_blockNumber', []);
  const latest = parseInt(latestHex, 16);
  const reqs = Array.from({ length: numBlocks }, (_, i) => ({
    method: 'eth_getBlockByNumber',
    params: [`0x${(latest - i).toString(16)}`, false],
  }));
  const results = await rpcBatch(reqs);
  const counts = results.map(r => r?.result?.transactions?.length ?? 0);
  _tpsCache = Math.round(counts.reduce((s, c) => s + c, 0) / counts.length);
  _tpsCacheTs = Date.now();
  return _tpsCache;
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

export async function fetchTokenBalance(tokenAddr, walletAddr) {
  const result = await rpcPost('eth_call', [
    { to: tokenAddr, data: '0x70a08231000000000000000000000000' + walletAddr.slice(2).toLowerCase() },
    'latest',
  ]);
  return fromWei(BigInt(result).toString());
}

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

// ─── companies ────────────────────────────────────────────────────────────────

// getUserCompanies(address) => address[]  selector: 0x068e4f69
export async function getUserCompaniesBatch(walletAddrs, timeoutMs = 20000) {
  if (!walletAddrs.length) return {};
  const SEL = '068e4f69';
  const reqs = walletAddrs.map((addr, i) => ({
    method: 'eth_call',
    params: [{ to: FACTORY, data: '0x' + SEL + addr.slice(2).toLowerCase().padStart(64, '0') }, 'latest'],
    id: i,
  }));
  const responses = await rpcBatch(reqs, timeoutMs);
  const out = {};
  for (const r of responses) {
    const wallet = walletAddrs[r.id];
    if (r.error || !r.result || r.result.length < 130) { out[wallet] = []; continue; }
    const hex = r.result.slice(2);
    const len = parseInt(hex.slice(64, 128), 16);
    const addrs = [];
    for (let i = 0; i < len; i++) {
      addrs.push(('0x' + hex.slice(128 + i * 64 + 24, 128 + (i + 1) * 64)).toLowerCase());
    }
    out[wallet] = addrs;
  }
  return out;
}

// getTradeStates(address[]) => TradeState[]  selector: 0x82b2f8c6
// TradeState: company, active, completable, liquidatable, endTime, liqPrice, autoTradeEnabled, cooldownEnd
export async function getTradeStates(companyAddrs, timeoutMs = 20000) {
  if (!companyAddrs.length) return [];
  const n = companyAddrs.length;
  const addrData = companyAddrs.map(a => a.slice(2).toLowerCase().padStart(64, '0')).join('');
  const data = '0x82b2f8c6'
    + '0000000000000000000000000000000000000000000000000000000000000020'  // offset=32
    + n.toString(16).padStart(64, '0')                                     // length
    + addrData;
  const result = await rpcPost('eth_call', [{ to: BATCH_RESOLVER, data }, 'latest'], timeoutMs);
  if (!result || result.length < 130) return [];
  const hex = result.slice(2);
  const arrLen = parseInt(hex.slice(64, 128), 16);
  const structs = [];
  for (let i = 0; i < arrLen; i++) {
    const b = 128 + i * 512; // 8 fields × 64 hex chars
    structs.push({
      company:         ('0x' + hex.slice(b + 24, b + 64)).toLowerCase(),
      active:          parseInt(hex.slice(b + 64,  b + 128), 16) !== 0,
      completable:     parseInt(hex.slice(b + 128, b + 192), 16) !== 0,
      liquidatable:    parseInt(hex.slice(b + 192, b + 256), 16) !== 0,
      endTime:         parseInt(hex.slice(b + 256, b + 320), 16),
      liqPrice:        BigInt('0x' + hex.slice(b + 320, b + 384)).toString(),
      autoTradeEnabled:parseInt(hex.slice(b + 384, b + 448), 16) !== 0,
      cooldownEnd:     parseInt(hex.slice(b + 448, b + 512), 16),
    });
  }
  return structs;
}

// Batch-reads company storage slot 0x2 (entry price, 18-decimal ETH/USD).
// Returns Map<address lowercase, entryPriceUsd: number>
export async function getEntryPrices(companyAddrs) {
  if (!companyAddrs.length) return new Map();
  const CHUNK = 100;
  const out = new Map();
  for (let i = 0; i < companyAddrs.length; i += CHUNK) {
    const chunk = companyAddrs.slice(i, i + CHUNK);
    const reqs  = chunk.map((addr, j) => ({
      method: 'eth_getStorageAt',
      params: [addr, '0x2', 'latest'],
      id: j,
    }));
    const responses = await rpcBatch(reqs);
    if (!Array.isArray(responses)) continue;
    for (const r of responses) {
      const addr = chunk[r.id];
      if (r.error || !r.result) { out.set(addr, 0); continue; }
      try {
        out.set(addr, Number(BigInt(r.result)) / 1e18);
      } catch {
        out.set(addr, 0);
      }
    }
  }
  return out;
}

// ─── DIRTY price — Kumbaya exchange API ──────────────────────────────────────

const KUMBAYA_POOL_ID = '0x6bD9eeF21c2419FeffafbF4850153A3b3A74A5E1-4326';

export async function fetchDirtyPrice() {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      `https://exchange.kumbaya.xyz/api/v1/pools/${KUMBAYA_POOL_ID}`,
      { signal: ctrl.signal }
    );
    if (!res.ok) throw new Error(`Kumbaya HTTP ${res.status}`);
    const data = await res.json();
    // token1Price = USDm per DIRTY = USD price of 1 DIRTY
    const price = parseFloat(data.pool?.token1Price);
    if (!isFinite(price) || price <= 0) throw new Error('invalid price');
    return price;
  } finally {
    clearTimeout(timer);
  }
}

// ─── INF cost per op — latest INF burn from a trade-start tx ────────────────
const ZERO_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000';

export async function fetchLatestInfCost() {
  const latestBlock = await getLatestBlock();
  // Scan the last ~500 blocks (~8 min on MegaETH) for an INF burn
  const fromBlock = '0x' + Math.max(0, latestBlock - 500).toString(16);
  const logs = await rpcPost('eth_getLogs', [{
    address:   INFLUENCE,
    topics:    [TRANSFER_TOPIC, null, ZERO_TOPIC],
    fromBlock,
    toBlock:   'latest',
  }]);
  if (!logs.length) return null;
  // Most recent log is last; return its amount in INF (18 decimals)
  const last = logs[logs.length - 1];
  return fromWei(BigInt(last.data).toString());
}

// ─── ETH price — Kumbaya WETH/USDm pool (chain 4326) ────────────────────────
const KUMBAYA_ETH_POOL_ID = '0x587F6eeAfc7Ad567e96eD1B62775fA6402164b22-4326';

export async function fetchEthPrice() {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      `https://exchange.kumbaya.xyz/api/v1/pools/${KUMBAYA_ETH_POOL_ID}`,
      { signal: ctrl.signal }
    );
    if (!res.ok) throw new Error(`Kumbaya HTTP ${res.status}`);
    const data = await res.json();
    // token1Price = USDm per WETH = ETH price in USDm
    const price = parseFloat(data.pool?.token1Price);
    if (!isFinite(price) || price <= 0) throw new Error('invalid ETH price');
    return price;
  } finally {
    clearTimeout(timer);
  }
}
