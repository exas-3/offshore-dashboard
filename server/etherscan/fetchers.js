import { DIRTY, INFLUENCE, USDM, VAULT, FACTORY, BATCH_RESOLVER, GENESIS } from './constants.js';
import { fromWei, rpcPost, rpcBatch } from './rpc-client.js';

const ZERO             = '0x0000000000000000000000000000000000000000';
const TRANSFER_TOPIC   = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SEL_TOTAL_SUPPLY = '0x18160ddd';

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
export async function getTradeStates(companyAddrs, timeoutMs = 20000) {
  if (!companyAddrs.length) return [];
  const n = companyAddrs.length;
  const addrData = companyAddrs.map(a => a.slice(2).toLowerCase().padStart(64, '0')).join('');
  const data = '0x82b2f8c6'
    + '0000000000000000000000000000000000000000000000000000000000000020'
    + n.toString(16).padStart(64, '0')
    + addrData;
  const result = await rpcPost('eth_call', [{ to: BATCH_RESOLVER, data }, 'latest'], timeoutMs);
  if (!result || result.length < 130) return [];
  const hex = result.slice(2);
  const arrLen = parseInt(hex.slice(64, 128), 16);
  const structs = [];
  for (let i = 0; i < arrLen; i++) {
    const b = 128 + i * 512;
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

// Batch-reads the current trade's start (slot 4) and end (slot 5) timestamps for each
// company. Duration = slot5 - slot4 uniquely identifies the trade type:
//   300s = EXTORTION (5min), 1800s = ARMS_DEAL (30min), 5400s = DRUG_DEAL (90min).
// Returns Map<companyAddrLower, 'DRUG_DEAL'|'ARMS_DEAL'|'EXTORTION'|null>.
// The on-chain `tradeType()` selector (0x6fd47b44) returns 2 for every company so
// it cannot be used; per-trade type lookups via storage slots are the reliable path.
export async function getCompanyTradeTypesFromStorage(companyAddrs, timeoutMs = 20000) {
  if (!companyAddrs.length) return new Map();
  const out = new Map();
  const CHUNK = 50;  // 2 calls per company → ~100 reqs/chunk
  for (let i = 0; i < companyAddrs.length; i += CHUNK) {
    const chunk = companyAddrs.slice(i, i + CHUNK);
    const reqs = [];
    chunk.forEach((addr, j) => {
      reqs.push({ method: 'eth_getStorageAt', params: [addr, '0x4', 'latest'], id: j * 2     });
      reqs.push({ method: 'eth_getStorageAt', params: [addr, '0x5', 'latest'], id: j * 2 + 1 });
    });
    const res = await rpcBatch(reqs, timeoutMs).catch(() => []);
    const byId = new Map();
    for (const r of (Array.isArray(res) ? res : [])) byId.set(r.id, r.result);
    for (let j = 0; j < chunk.length; j++) {
      const s4 = byId.get(j * 2);
      const s5 = byId.get(j * 2 + 1);
      if (!s4 || !s5) continue;
      try {
        const start = Number(BigInt(s4));
        const end   = Number(BigInt(s5));
        const dur   = end - start;
        const type  = dur === 300 ? 'EXTORTION' : dur === 1800 ? 'ARMS_DEAL' : dur === 5400 ? 'DRUG_DEAL' : null;
        if (type) out.set(chunk[j].toLowerCase(), type);
      } catch { /* skip */ }
    }
    if (i + CHUNK < companyAddrs.length) await new Promise(r => setTimeout(r, 150));
  }
  return out;
}

// Batch-reads company storage slot 0x2 (entry price, 18-decimal ETH/USD).
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
    const price = parseFloat(data.pool?.token1Price);
    if (!isFinite(price) || price <= 0) throw new Error('invalid price');
    return price;
  } finally {
    clearTimeout(timer);
  }
}

const ZERO_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000';

export async function fetchLatestInfCost() {
  const latestBlock = await getLatestBlock();
  const fromBlock = '0x' + Math.max(0, latestBlock - 500).toString(16);
  const logs = await rpcPost('eth_getLogs', [{
    address:   INFLUENCE,
    topics:    [TRANSFER_TOPIC, null, ZERO_TOPIC],
    fromBlock,
    toBlock:   'latest',
  }]);
  if (!logs.length) return null;
  const last = logs[logs.length - 1];
  return fromWei(BigInt(last.data).toString());
}

const STAKING_ADDR    = '0x3620bbeded3bcf1b3409098dc152b0eecf66ea8e';
const E_STAKED        = '0x1449c6dd7851abc30abf37f57715f492010519147cc2652fbc38202c18a6ee90';
const E_STAKE_CLAIMED = '0xd8cc75b8a0ba011aba2385703af6a0e5593ceae53e9951a7358f657ddf3f8dac';
const E_ROTATION_ADV  = '0xb34543600b07719e55a8a9e5f1e792c722675345036bea2c3058954db14066fc';

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

const REDSTONE_ORACLE = '0xc555c100DB24dF36D406243642C169CC5A937f09';

export async function fetchEthPrice() {
  const result = await rpcPost('eth_call', [{ to: REDSTONE_ORACLE, data: '0xfeaf968c' }, 'latest']);
  if (!result) throw new Error('empty oracle result');
  const answer = BigInt('0x' + result.slice(66, 130));
  const price  = Number(answer) / 1e8;
  if (!isFinite(price) || price <= 0) throw new Error('invalid ETH price');
  return price;
}
