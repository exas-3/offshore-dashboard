export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getCompanyStats, getCompanies, getLatestEthPrice } from '../../../lib/index.js';
import { getEntryPrices } from '../../../server/etherscan.js';

let _cache = null, _cacheTs = 0;
const TTL = 30_000;

export async function GET(req) {
  const filter = new URL(req.url).searchParams.get('filter') ?? 'all';
  try {
    if (!_cache || Date.now() - _cacheTs >= TTL) {
      const [stats, companies, ethPrice] = await Promise.all([
        getCompanyStats(),
        getCompanies('all', 1000),
        getLatestEthPrice(),
      ]);
      const activeAddrs = companies.filter(c => c.active).map(c => c.address);
      const entryPriceMap = activeAddrs.length ? await getEntryPrices(activeAddrs) : new Map();
      const companiesWithEntry = companies.map(c => ({
        ...c,
        entry_price: entryPriceMap.get(c.address) ?? 0,
      }));
      _cache = { stats: { ...stats, ethPrice }, companies: companiesWithEntry };
      _cacheTs = Date.now();
    }
    const { stats, companies } = _cache;
    const filtered = filter === 'all' ? companies : companies.filter(c => {
      if (filter === 'active')       return c.active;
      if (filter === 'autotrade')    return c.auto_trade;
      if (filter === 'liquidatable') return c.liquidatable;
      if (filter === 'completable')  return c.completable;
      return true;
    });
    return NextResponse.json({ stats, companies: filtered });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
