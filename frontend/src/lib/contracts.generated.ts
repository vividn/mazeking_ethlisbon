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
    nft: '0x386B5eBc88693648c584D28694236238b1876426',
    verifier: '0x286D34F93DD87506726155f20208f823211b4A28',
    renderer: '0x154c13e304C94452dD9c00AC799707305C15121A',
    badgeAwarder: '0x5ee3fa7914e9a43de13E7438cDf2ecF8C4fd6bCc',
    deployBlock: 11351745,
  },
};
