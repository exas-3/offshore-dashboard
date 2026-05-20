import { getDb } from '../../../lib/index.js';
import PageClient from '../../_components/page-client.jsx';

export const revalidate = 300;

const HEX40 = /^0x[a-f0-9]{40}$/;

function normAddr(raw) {
  const a = (raw || '').toLowerCase();
  return HEX40.test(a) ? a : null;
}

function fmtAddr(a) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }

function fmtDirty(wei) {
  if (wei == null) return null;
  const n = Number(wei) / 1e18;
  if (!Number.isFinite(n)) return null;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(0);
}

async function lookup(address) {
  try {
    const db = getDb();
    const [row] = await db`
      WITH e AS (
        SELECT COALESCE(SUM(amount), 0) AS earned, COUNT(*) AS ops
        FROM transfers WHERE kind='MINT' AND to_addr = ${address}
      ),
      a AS (
        SELECT COALESCE(w.alias, w.ens_alias, w.debank_alias) AS name
        FROM wallet_aliases w WHERE w.address = ${address}
      ),
      c AS (
        SELECT COUNT(*)::int AS companies,
               SUM(CASE WHEN active THEN 1 ELSE 0 END)::int AS active
        FROM companies WHERE owner = ${address}
      )
      SELECT e.earned, e.ops, a.name, c.companies, c.active
      FROM e LEFT JOIN a ON true LEFT JOIN c ON true`;
    return row || null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }) {
  const { address: raw } = await params;
  const address = normAddr(raw);
  if (!address) {
    return {
      title: 'Criminal',
      description: 'Wallet profile on the Offshore Protocol dashboard.',
      robots: { index: false, follow: false },
    };
  }

  const info = await lookup(address);
  const name = info?.name || fmtAddr(address);
  const earned = fmtDirty(info?.earned);
  const ops = info?.ops ? Number(info.ops) : null;
  const companies = info?.companies ? Number(info.companies) : 0;
  const active = info?.active ? Number(info.active) : 0;

  const bits = [];
  if (earned) bits.push(`${earned} DIRTY earned`);
  if (ops) bits.push(`${ops.toLocaleString()} ops`);
  if (companies) bits.push(`${companies} companies${active ? ` (${active} active)` : ''}`);

  const description = bits.length
    ? `${name} — ${bits.join(' · ')}. Offshore Protocol wallet profile on MegaETH.`
    : `Wallet profile for ${name} on the Offshore Protocol — earnings, ops, and companies on MegaETH.`;

  return {
    title: `${name} — Criminal`,
    description,
    alternates: { canonical: `/criminal/${address}` },
    openGraph: {
      title: `${name} — Offshore Criminal`,
      description,
      url: `/criminal/${address}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${name} — Offshore Criminal`,
      description,
    },
  };
}

export default async function CriminalAddressPage({ params }) {
  const { address: raw } = await params;
  const address = normAddr(raw) || (raw || '').toLowerCase();
  return <PageClient initialAddress={address} />;
}
