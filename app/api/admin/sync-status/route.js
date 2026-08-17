export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getLastBlock, getLastInfluenceBlock, getLastVaultBlock } from '../../../../lib/index.js';
import { getLatestBlock, GENESIS } from '../../../../server/etherscan.js';
import { guardAdmin } from '../../../../lib/api-guard.js';

export async function GET(req) {
  const blocked = guardAdmin(req);
  if (blocked) return blocked;
  try {
    const [chainHead, dirtyBlock, influenceBlock, vaultBlock] = await Promise.all([
      getLatestBlock(),
      getLastBlock(),
      getLastInfluenceBlock(),
      getLastVaultBlock(),
    ]);

    const behind = (synced) => {
      const blocks = chainHead - synced;
      return { blocks, seconds: blocks, minutes: Math.round(blocks / 60), hours: +(blocks / 3600).toFixed(2) };
    };

    return NextResponse.json({
      chainHead,
      chainHeadTs: GENESIS + chainHead,
      dirty:     { synced: dirtyBlock,     behind: behind(dirtyBlock) },
      influence: { synced: influenceBlock, behind: behind(influenceBlock) },
      vault:     { synced: vaultBlock,     behind: behind(vaultBlock) },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
