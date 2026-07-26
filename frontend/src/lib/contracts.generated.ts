/**
 * Public-network contract addresses.
 *
 * Written by the `deploy-*` recipes (Sepolia / Base / Polygon zkEVM) via
 * `scripts/generate-contracts-config.js`. Tracked in git so statichost.eu's
 * build picks up the live addresses; commit the diff after redeploying.
 *
 * Multi-chain: each non-local deploy merges its chain into this map and
 * preserves the others. Local anvil (31337) addresses live in the gitignored
 * sibling `contracts.local.ts`.
 */

export const CONTRACT_ADDRESSES: Record<
  number,
  { nft: `0x${string}`; verifier: `0x${string}`; renderer?: `0x${string}`; badgeAwarder?: `0x${string}`; deployBlock?: number }
> = {
  11155111: {
    nft: '0x573Db0e4F90C8b5477a5841B5d824556a0430B65',
    verifier: '0xdf4cC4a72D1100AF5926622d4dDBdA3F2A408fd4',
    renderer: '0xe5317DDC4Ac2A06454040361B99f8AB5bbD34752',
    badgeAwarder: '0x5156ad01725888E894A93639e709d5f1a3795465',
    deployBlock: 11353158,
  },
};
