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
  { nft: `0x${string}`; verifier: `0x${string}`; renderer?: `0x${string}`; badgeAwarder?: `0x${string}` }
> = {
  11155111: {
    nft: '0x11352976b12ffe1c4baF9058B89BD763a2A10776',
    verifier: '0x9365E391E2719fD144bFCd60eE895164dF91B80D',
    renderer: '0xe376aB06415fB6D991B91C0bc24E96a16F2c68b0',
    badgeAwarder: '0x819C4D50806739Dee848F4Af5952b1cC34b8DF40',
  },
};
