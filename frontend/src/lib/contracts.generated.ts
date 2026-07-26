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
    nft: '0xd8fc4A51464651f85Baa8CFcaCCc2ed3B7e72a34',
    verifier: '0xF7e8a976Ad6A1E7a94bCD0a158a2266D387586C0',
    renderer: '0xAB7b98Aaed4AE3b1e43D05A7Ae6D8186C5C2c1f7',
    badgeAwarder: '0xCF12095E2b3B1b0E5Dd080411D531037C1e84310',
    deployBlock: 11352158,
  },
};
