// Single source of truth for on-chain addresses and protocol constants.
// Both lib/db and server/etherscan import from here.

export const ZERO_ADDR      = '0x0000000000000000000000000000000000000000';
export const PROTOCOL_ADDRS = ['0x5dc36d6dcd5a3792b3980de1f40c7c0970af3462'];

// Known DIRTY liquidity pool addresses (main + legacy V3).
// Stored lowercase; consumers compare lowercase too.
export const DEX_POOLS = [
  '0xf9f676066eb7baeeed93e859bc26a41663f277a8',  // main pool
  '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1',  // legacy V3 pool
];

// MegaETH: 1 sec/block. timestamp = block_number + GENESIS (RPC-verified).
export const GENESIS = 1_762_797_011;

export const DIRTY          = '0xC2f34f8849a8607FD73E06D6849bDA07C2b7DE38';
export const INFLUENCE      = '0x403De0893f0Bc66139592ba2FD254672f2dB933a';
export const USDM           = '0xFAfDdBb3FC7688494971A79cC65dca3EF82079E7';
export const VAULT          = '0x955a4adDC17114c36726C12AF9C73E23E497C2BD';
export const FACTORY        = '0x619814A203cA441611cEE02aBF31986Ca265dd35';
export const BATCH_RESOLVER = '0x6E43F31b2c160A3672C681114696667Ef219D4C3';
export const STAKING        = '0x3620bbEDED3BcF1b3409098Dc152b0EEcf66eA8e';
