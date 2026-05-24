import {
  fetchStakingEvents, fetchStakingClaimEvents, fetchStakingRotationEvents,
  parseStakedLog, parseClaimLog, parseRotationLog,
  E_STAKED, E_STAKE_CLAIMED, E_ROTATION_ADV,
  STAKING,
} from '../etherscan.js';
import { getWsClient } from '../etherscan/ws-client.js';
import { bufferedFlush } from '../etherscan/buffered-flush.js';
import {
  getLastStakingBlock, setLastStakingBlock, upsertStakingDeposits,
  getLastStakingClaimBlock, setLastStakingClaimBlock, upsertStakingClaims,
  getLastStakingRotationBlock, setLastStakingRotationBlock, upsertStakingRotations,
} from '../../lib/index.js';
import { runBlockSync } from './_run.js';

const STAKING_START = 15_800_000;
const STAKING_ADDR  = STAKING.toLowerCase();

// ── Polling path factory (safety net) ─────────────────────────────────────
function makeStakingSync({ name, getLast, setLast, fetcher, upsert, ignoreFetchErr = false }) {
  return (latestBlock) => runBlockSync({
    name,
    getLast,
    setLast,
    fromStart: STAKING_START,
    latestBlock,
    async processBatch(start, end) {
      const events = ignoreFetchErr
        ? await fetcher(start, end).catch(() => [])
        : await fetcher(start, end);
      if (events.length === 0) return 0;
      await upsert(events);
      return events.length;
    },
  });
}

export const syncStaking          = makeStakingSync({ name: 'staking',           getLast: getLastStakingBlock,         setLast: setLastStakingBlock,         fetcher: fetchStakingEvents,         upsert: upsertStakingDeposits });
export const syncStakingClaims    = makeStakingSync({ name: 'staking claims',    getLast: getLastStakingClaimBlock,    setLast: setLastStakingClaimBlock,    fetcher: fetchStakingClaimEvents,    upsert: upsertStakingClaims });
export const syncStakingRotations = makeStakingSync({ name: 'staking rotations', getLast: getLastStakingRotationBlock, setLast: setLastStakingRotationBlock, fetcher: fetchStakingRotationEvents, upsert: upsertStakingRotations, ignoreFetchErr: true });

// ── WS paths ──────────────────────────────────────────────────────────────
// One subscription per event topic on the staking contract. All three
// buffers funnel through bufferedFlush; idempotent upserts handle any
// reconnect double-delivery.

function startWsSubscription({ label, topic, keyFn, parse, upsert }) {
  const buf = bufferedFlush({
    label:   `poller] ${label} (ws)`,
    flushMs: 1500,
    keyFn,
    onFlush: async (rows) => {
      await upsert(rows);
      console.log(`[poller] ${label} (ws): ${rows.length} rows`);
    },
  });
  const client = getWsClient();
  client.addSubscription({
    name:   label,
    filter: { address: STAKING_ADDR, topics: [topic] },
    onLog:  (raw) => {
      try { buf.push(parse(raw)); } catch (err) {
        console.warn(`[poller] ${label} (ws) parse failed:`, err.message);
      }
    },
  });
}

export function startStakingWs() {
  startWsSubscription({
    label:  'staking',
    topic:  E_STAKED,
    keyFn:  (r) => `${r.hash.toLowerCase()}:${r.logIndex}`,
    parse:  parseStakedLog,
    upsert: upsertStakingDeposits,
  });
  startWsSubscription({
    label:  'staking-claims',
    topic:  E_STAKE_CLAIMED,
    keyFn:  (r) => `${r.hash.toLowerCase()}:${r.logIndex}`,
    parse:  parseClaimLog,
    upsert: upsertStakingClaims,
  });
  startWsSubscription({
    label:  'staking-rotations',
    topic:  E_ROTATION_ADV,
    // No logIndex on rotation rows — dedupe by (hash, rotationId).
    keyFn:  (r) => `${r.hash?.toLowerCase() ?? ''}:${r.rotationId}`,
    parse:  parseRotationLog,
    upsert: upsertStakingRotations,
  });
}
