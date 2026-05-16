// All on-chain data sourced from MegaETH RPC.

const RPC = 'https://mainnet.megaeth.com/rpc';

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
    return               { kind: 'MINT', opType: 'EXTORTION' }; // amount=0 = busted extortion
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
// OpResult — emitted after every op; data word0 encodes op type: 80=EXTORTION, 250=ARMS_DEAL, 750=DRUG_DEAL
const E_D47 = '0xd47648dbe74844d41eea0e3e6bf1d3f6f03cd31691e10e6edc7376d52b934dbd';
// Company view function: tradeType() — returns 0=inactive, 1=DRUG_DEAL, 2=ARMS_DEAL
const SEL_TRADE_TYPE = '0x6fd47b44';

// Per-process cache: company address → trade type int (1 or 2). Immutable once set.
export const _companyTypeCache = new Map();

// Batch-fetch trade types for company addresses not yet in cache.
// blockMap: optional Map<addr, completionBlockNum> — if provided, calls at blockNum-1
// so the company is still in its active trade mode (not yet reset to 0 after completion).
// Only caches non-zero values so stale zero results don't mask future lookups.
const _inflight = new Map();
export async function getCompanyTradeTypes(addrs, blockMap = new Map()) {
  const needed = addrs.filter(a => !_companyTypeCache.get(a));
  if (needed.length === 0) return;
  const CHUNK = 50;
  for (let i = 0; i < needed.length; i += CHUNK) {
    const chunk = needed.slice(i, i + CHUNK);
    const reqs = chunk.map((a, j) => {
      const bn = blockMap.get(a);
      const blockTag = bn ? '0x' + (bn - 1).toString(16) : 'latest';
      return { method: 'eth_call', params: [{ to: a, data: SEL_TRADE_TYPE }, blockTag], id: j };
    });
    const results = await rpcBatch(reqs).catch(() => []);
    for (const r of (Array.isArray(results) ? results : [])) {
      const res = r?.result;
      const t = (res && res !== '0x') ? Number(BigInt(res)) : 0;
      if (t > 0 && r.id != null) _companyTypeCache.set(chunk[r.id], t);
    }
    if (i + CHUNK < needed.length) await new Promise(r => setTimeout(r, 150));
  }
}

// Fetch factory DirtyPaid + FullCompletion + TradeExited + OpResult events for a block range.
// Returns { companyMap: Map<"txHash:dirtyLogIndex", companyAddr>, fullTxs: Set<txHash>,
//           companyBlockMap: Map<companyAddr, completionBlockNum>,
//           d47Map: Map<"txHash:logIndex", opType> }
// companyMap key uses dirtyLogIndex = payoutLogIndex - 1 (E_PAYOUT always immediately follows DIRTY ERC20).
// This correctly handles batch txs where multiple companies complete in the same tx.
// d47Map key is the d47 event's own log index. Callers look up:
//   completed ops:  d47Map.get(txHash + ':' + (erc20LogIndex - 2))
//   busted ops:     d47Map.get(txHash + ':' + (exitedLogIndex + 1))
export async function fetchFactoryTradeContext(fromBlock, toBlock) {
  const fromHex = '0x' + fromBlock.toString(16);
  const toHex   = '0x' + toBlock.toString(16);
  const [payoutLogs, completeLogs, exitedLogs, d47Logs] = await Promise.all([
    rpcPost('eth_getLogs', [{ address: FACTORY_ADDR, topics: [E_PAYOUT],    fromBlock: fromHex, toBlock: toHex }]),
    rpcPost('eth_getLogs', [{ address: FACTORY_ADDR, topics: [E_COMPLETE],  fromBlock: fromHex, toBlock: toHex }]),
    rpcPost('eth_getLogs', [{ address: FACTORY_ADDR, topics: [E_EXITED],    fromBlock: fromHex, toBlock: toHex }]),
    rpcPost('eth_getLogs', [{ address: FACTORY_ADDR, topics: [E_D47],       fromBlock: fromHex, toBlock: toHex }]),
  ]);
  const companyMap      = new Map(); // "txHash:dirtyLogIndex" → companyAddr
  const companyBlockMap = new Map(); // companyAddr → completionBlockNum
  const payoutTxs       = new Set(); // txHashes that have E_PAYOUT (for filtering E_EXITED)
  for (const l of payoutLogs ?? []) {
    const txHash      = l.transactionHash.toLowerCase();
    const company     = ('0x' + l.topics[1].slice(26)).toLowerCase();
    const dirtyLogIdx = parseInt(l.logIndex, 16) - 1; // DIRTY ERC20 is always at payoutLogIndex - 1
    companyMap.set(txHash + ':' + dirtyLogIdx, company);
    payoutTxs.add(txHash);
    const bn = parseInt(l.blockNumber, 16);
    if (bn > (companyBlockMap.get(company) ?? 0)) companyBlockMap.set(company, bn);
  }
  // For busted ops (E_EXITED without E_PAYOUT): add to companyBlockMap for getCompanyTradeTypes.
  for (const l of exitedLogs ?? []) {
    const txHash = l.transactionHash.toLowerCase();
    if (!payoutTxs.has(txHash)) {
      const company = ('0x' + l.topics[1].slice(26)).toLowerCase();
      const bn = parseInt(l.blockNumber, 16);
      if (bn > (companyBlockMap.get(company) ?? 0)) companyBlockMap.set(company, bn);
    }
  }
  const fullTxs = new Set((completeLogs ?? []).map(l => l.transactionHash.toLowerCase()));
  // Build d47Map: "txHash:ownLogIndex" → opType string
  const d47Map = new Map();
  for (const l of d47Logs ?? []) {
    const raw   = l.data.slice(2); // strip 0x, first 32-byte word
    const word0 = parseInt(raw.slice(60, 64), 16); // last 2 bytes encode the op type
    const opType = word0 === 750 ? 'DRUG_DEAL' : word0 === 250 ? 'ARMS_DEAL' : word0 === 80 ? 'EXTORTION' : null;
    if (opType) d47Map.set(l.transactionHash.toLowerCase() + ':' + parseInt(l.logIndex, 16), opType);
  }
  return { companyMap, fullTxs, companyBlockMap, d47Map };
}

// Fetches exited trade events from the factory for a block range, excluding full successes (E_PAYOUT).
// Covers early exits and busted ops. E_EXITED structure:
//   topic1 = company address, topic2 = player address, data = DIRTY amount in wei
// Returns [{hash, logIndex, blockNum, timestamp, companyAddr, playerAddr, dirtyAmount}]
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
      playerAddr:  l.topics[2] ? ('0x' + l.topics[2].slice(26)).toLowerCase() : null,
      dirtyAmount: l.data && l.data !== '0x' ? fromWei(BigInt(l.data).toString()) : 0,
    }));
}

// ─── block / logs ─────────────────────────────────────────────────────────────

let _latestBlock = 0, _latestBlockTs = 0;
export async function getLatestBlock() {
  if (Date.now() - _latestBlockTs < 1_000) return _latestBlock;
  _latestBlock = parseInt(await rpcPost('eth_blockNumber', []), 16);
  _latestBlockTs = Date.now();
  return _latestBlock;
}

let _tpsCache = null, _tpsCacheTs = 0;
export async function fetchTps(numBlocks = 6) {
  if (_tpsCache !== null && Date.now() - _tpsCacheTs < 1000) return _tpsCache;
  const latest = await getLatestBlock();
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

// ─── FactionStaking deposits / claims / rotations ─────────────────────────────
const STAKING_ADDR      = '0x3620bbeded3bcf1b3409098dc152b0eecf66ea8e';
const E_STAKED          = '0x1449c6dd7851abc30abf37f57715f492010519147cc2652fbc38202c18a6ee90';
const E_STAKE_CLAIMED   = '0xd8cc75b8a0ba011aba2385703af6a0e5593ceae53e9951a7358f657ddf3f8dac';
const E_ROTATION_ADV    = '0xb34543600b07719e55a8a9e5f1e792c722675345036bea2c3058954db14066fc';

export async function fetchStakingEvents(fromBlock, toBlock) {
  const logs = await rpcPost('eth_getLogs', [{
    address:   STAKING_ADDR,
    topics:    [E_STAKED],
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock:   '0x' + toBlock.toString(16),
  }]);
  return (logs || []).map(l => ({
    hash:       l.transactionHash,
    logIndex:   parseInt(l.logIndex, 16),
    blockNum:   parseInt(l.blockNumber, 16),
    timestamp:  parseInt(l.blockNumber, 16) + GENESIS,
    userAddr:   ('0x' + l.topics[1].slice(26)).toLowerCase(),
    rotationId: parseInt(l.topics[2], 16),
    amount:     Number(BigInt(l.data)) / 1e18,
  }));
}

export async function fetchStakingClaimEvents(fromBlock, toBlock) {
  const logs = await rpcPost('eth_getLogs', [{
    address:   STAKING_ADDR,
    topics:    [E_STAKE_CLAIMED],
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock:   '0x' + toBlock.toString(16),
  }]);
  return (logs || []).map(l => ({
    hash:       l.transactionHash,
    logIndex:   parseInt(l.logIndex, 16),
    blockNum:   parseInt(l.blockNumber, 16),
    timestamp:  parseInt(l.blockNumber, 16) + GENESIS,
    userAddr:   ('0x' + l.topics[1].slice(26)).toLowerCase(),
    rotationId: parseInt(l.topics[2], 16),
    amount:     Number(BigInt(l.data)) / 1e18,
  }));
}

export async function fetchStakingRotationEvents(fromBlock, toBlock) {
  const logs = await rpcPost('eth_getLogs', [{
    address:   STAKING_ADDR,
    topics:    [E_ROTATION_ADV],
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock:   '0x' + toBlock.toString(16),
  }]);
  return (logs || []).map(l => ({
    hash:       l.transactionHash,
    blockNum:   parseInt(l.blockNumber, 16),
    rotationId: parseInt(l.topics[1], 16),
    endTime:    Number(BigInt(l.data)),
  }));
}

// ─── ETH price — RedStone oracle REST API ────────────────────────────────────
const REDSTONE_ORACLE = '0xc555c100DB24dF36D406243642C169CC5A937f09';

export async function fetchEthPrice() {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: REDSTONE_ORACLE, data: '0xfeaf968c' }, 'latest'], id: 1 }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const { result } = await res.json();
    const answer = BigInt('0x' + result.slice(66, 130));
    const price  = Number(answer) / 1e8;
    if (!isFinite(price) || price <= 0) throw new Error('invalid ETH price');
    return price;
  } finally {
    clearTimeout(timer);
  }
}
