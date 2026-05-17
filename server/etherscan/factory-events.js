// Factory & per-company event readers, plus the per-process company-type cache.
// These are RPC-backed and pulled out of classification.js so that classification
// stays pure and testable.

import { FACTORY, GENESIS } from './constants.js';
import { fromWei, rpcPost, rpcBatch } from './rpc-client.js';

const FACTORY_ADDR   = FACTORY.toLowerCase();
export const E_EXITED = '0xf20fbbc5dd518513b4b0381c1904c0751ca7493753ec53a73e651e8b79ee61ff';
const E_PAYOUT       = '0xa082f97b8bead66307ae367bd14b2366e03c2e963493a9f269501d884cd1a502';
const E_COMPLETE     = '0x55458b8d3210ff0a2d3612a4b3639021fd38d66d563562a98ca8b7d5e7930f70';
const E_D47          = '0xd47648dbe74844d41eea0e3e6bf1d3f6f03cd31691e10e6edc7376d52b934dbd';
// Trade-start event: emitted on factory at the moment a player starts a new
// trade on a company. topic1 = company, topic2 = player, data = stake (uint256).
// The event doesn't carry the trade type itself; we read the company's
// storage slots 4/5 right after the event fires to resolve duration → type.
export const E_TRADE_STARTED = '0x767d03cd29c82cd4501c62502b07069d2c1158df0c0ed0f73b8565cb1bfadc19';
const SEL_TRADE_TYPE = '0x6fd47b44';

// Fetch every (company, player) pair that had a TradeStarted event in the
// given block range. Returns Map<companyAddrLower, playerAddrLower>. Player
// == company owner for this protocol, so this is also the canonical owner
// signal for the light upsert path.
export async function fetchStartedCompanies(fromBlock, toBlock) {
  const logs = await rpcPost('eth_getLogs', [{
    address: FACTORY_ADDR,
    topics:  [E_TRADE_STARTED],
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock:   '0x' + toBlock.toString(16),
  }]);
  const out = new Map();
  for (const l of logs ?? []) {
    const t1 = l.topics?.[1], t2 = l.topics?.[2];
    if (!t1 || !t2) continue;
    const company = ('0x' + t1.slice(26)).toLowerCase();
    const player  = ('0x' + t2.slice(26)).toLowerCase();
    if (!out.has(company)) out.set(company, player);
  }
  return out;
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

// ── Company-type cache ────────────────────────────────────────────────────────
// Per-process: company address → trade type int (1=DRUG_DEAL, 2=ARMS_DEAL, 3=EXTORTION).
// Immutable once set. The cache is keyed by lowercase address.

const _cache = new Map();

export function getCompanyType(addr) {
  return _cache.get(addr) ?? 0;
}

// Populate the cache for any addresses not yet known.
// blockMap: optional Map<addr, completionBlockNum> — if provided, calls at blockNum-1
// so the company is still in its active trade mode (not yet reset to 0 after completion).
export async function getCompanyTradeTypes(addrs, blockMap = new Map()) {
  const needed = addrs.filter(a => !_cache.get(a));
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
      if (t > 0 && r.id != null) _cache.set(chunk[r.id], t);
    }
    if (i + CHUNK < needed.length) await new Promise(r => setTimeout(r, 150));
  }
}

// Fetch factory DirtyPaid + FullCompletion + TradeExited + OpResult events for a block range.
// Returns { companyMap, fullTxs, companyBlockMap, d47Map } describing the per-trade context.
export async function fetchFactoryTradeContext(fromBlock, toBlock) {
  const fromHex = '0x' + fromBlock.toString(16);
  const toHex   = '0x' + toBlock.toString(16);
  const [payoutLogs, completeLogs, exitedLogs, d47Logs] = await Promise.all([
    rpcPost('eth_getLogs', [{ address: FACTORY_ADDR, topics: [E_PAYOUT],   fromBlock: fromHex, toBlock: toHex }]),
    rpcPost('eth_getLogs', [{ address: FACTORY_ADDR, topics: [E_COMPLETE], fromBlock: fromHex, toBlock: toHex }]),
    rpcPost('eth_getLogs', [{ address: FACTORY_ADDR, topics: [E_EXITED],   fromBlock: fromHex, toBlock: toHex }]),
    rpcPost('eth_getLogs', [{ address: FACTORY_ADDR, topics: [E_D47],      fromBlock: fromHex, toBlock: toHex }]),
  ]);
  const companyMap      = new Map();
  const companyBlockMap = new Map();
  const payoutTxs       = new Set();
  for (const l of payoutLogs ?? []) {
    const txHash      = l.transactionHash.toLowerCase();
    const company     = ('0x' + l.topics[1].slice(26)).toLowerCase();
    const dirtyLogIdx = parseInt(l.logIndex, 16) - 1;
    companyMap.set(txHash + ':' + dirtyLogIdx, company);
    payoutTxs.add(txHash);
    const bn = parseInt(l.blockNumber, 16);
    if (bn > (companyBlockMap.get(company) ?? 0)) companyBlockMap.set(company, bn);
  }
  for (const l of exitedLogs ?? []) {
    const txHash = l.transactionHash.toLowerCase();
    if (!payoutTxs.has(txHash)) {
      const company = ('0x' + l.topics[1].slice(26)).toLowerCase();
      const bn = parseInt(l.blockNumber, 16);
      if (bn > (companyBlockMap.get(company) ?? 0)) companyBlockMap.set(company, bn);
    }
  }
  const fullTxs = new Set((completeLogs ?? []).map(l => l.transactionHash.toLowerCase()));
  // d47Map keyed by (txHash:logIndex) for syncTransfers; d47TxMap keyed by txHash alone
  // for callers like syncLiquidations that don't have a specific log_index to anchor on.
  const d47Map   = new Map();
  const d47TxMap = new Map();
  for (const l of d47Logs ?? []) {
    const raw   = l.data.slice(2);
    const word0 = parseInt(raw.slice(60, 64), 16);
    const opType = word0 === 750 ? 'DRUG_DEAL' : word0 === 250 ? 'ARMS_DEAL' : word0 === 80 ? 'EXTORTION' : null;
    if (opType) {
      const txh = l.transactionHash.toLowerCase();
      d47Map.set(txh + ':' + parseInt(l.logIndex, 16), opType);
      if (!d47TxMap.has(txh)) d47TxMap.set(txh, opType);
    }
  }
  return { companyMap, fullTxs, companyBlockMap, d47Map, d47TxMap };
}

// Fetches exited trade events from the factory for a block range, excluding full successes.
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
