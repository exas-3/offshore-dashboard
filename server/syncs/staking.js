import {
  fetchStakingEvents, fetchStakingClaimEvents, fetchStakingRotationEvents,
} from '../etherscan.js';
import {
  getLastStakingBlock, setLastStakingBlock, upsertStakingDeposits,
  getLastStakingClaimBlock, setLastStakingClaimBlock, upsertStakingClaims,
  getLastStakingRotationBlock, setLastStakingRotationBlock, upsertStakingRotations,
} from '../../lib/index.js';
import { runBlockSync } from './_run.js';

const STAKING_START = 15_800_000;

function makeStakingSync({ name, getLast, setLast, fetcher, upsert, ignoreFetchErr = false }) {
  return () => runBlockSync({
    name,
    getLast,
    setLast,
    fromStart: STAKING_START,
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
