export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getWhales, getLatestTokenInfo, getWalletDexSummary, getHolderCount } from '../../../lib/index.js';

const KNOWN_CONTRACTS = {
  '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1': 'DIRTY/USDm LP (Uni V3)',
};

let _cache = null, _cacheTs = 0;
const TTL = 120_000;

export async function GET() {
  try {
    if (_cache && Date.now() - _cacheTs < TTL) return NextResponse.json(_cache);

    const excluded = Object.keys(KNOWN_CONTRACTS);
    const [whales, tokenInfo] = await Promise.all([
      getWhales(200, excluded),
      getLatestTokenInfo(),
    ]);
    const { supply } = tokenInfo;
    whales.forEach((w, i) => { w.rank = i + 1; });

    const topAll = await getWhales(10, []);
    const topSum  = topAll.reduce((s, w) => s + w.balance, 0);
    const others  = supply != null ? Math.max(0, supply - topSum) : null;
    const concentration = topAll.map(w => ({
      address: w.address, label: KNOWN_CONTRACTS[w.address] ?? null,
      balance: w.balance, pct: supply ? (w.balance / supply) * 100 : 0,
      isContract: w.isContract,
    }));
    if (others != null) {
      concentration.push({ address: 'Others', label: 'Others', balance: others, pct: (others / supply) * 100, isContract: false });
    }

    const dexSummary = await getWalletDexSummary(whales.map(w => w.address));
    const holderCount = await getHolderCount();
    const result = { whales, concentration, supply, holderCount, knownContracts: KNOWN_CONTRACTS, dexSummary };
    _cache = result; _cacheTs = Date.now();
    return NextResponse.json(result);
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
