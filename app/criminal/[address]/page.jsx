'use client';
import { use } from 'react';
import Page from '../../page.jsx';

// /criminal/0x... — same dashboard as / but with the criminal rail pre-opened
// on the given address. Bookmarkable / shareable view of a wallet.
export default function CriminalAddressPage({ params }) {
  const { address } = use(params);
  return <Page initialAddress={(address || '').toLowerCase()} />;
}
