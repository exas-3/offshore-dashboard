'use client';
// Direct link to a player profile: /players/0x...
import { useParams } from 'next/navigation';
import PlayersPage from '../../../src/views/PlayersPage';

export default function PlayerAddressPage() {
  const { address } = useParams();
  // PlayersPage handles the address prop to show the detail view directly
  return <PlayersPage initialAddress={address} />;
}
