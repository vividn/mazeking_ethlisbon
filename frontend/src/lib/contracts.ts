/**
 * Contract configuration loader.
 *
 * Merges:
 *   - `contracts.generated.ts` (committed) — public networks (Sepolia, etc.)
 *   - `contracts.local.ts`     (gitignored, optional) — anvil chainId 31337
 *
 * The local file is written by `just deploy-local` and absent on fresh
 * clones / production builds. We use Vite's `import.meta.glob` so its
 * absence is a no-op rather than a build error.
 */

import { CONTRACT_ADDRESSES as PUBLIC_ADDRESSES } from './contracts.generated';

type AddressMap = Record<
  number,
  {
    nft: `0x${string}`;
    verifier: `0x${string}`;
    renderer?: `0x${string}`;
    badgeAwarder?: `0x${string}`;
    /** Block the contracts were deployed at, when the deploy recorded it. */
    deployBlock?: number;
  }
>;

const localModules = import.meta.glob<{ CONTRACT_ADDRESSES?: AddressMap }>(
  './contracts.local.ts',
  { eager: true }
);
const LOCAL_ADDRESSES: AddressMap =
  Object.values(localModules)[0]?.CONTRACT_ADDRESSES ?? {};

export const CONTRACT_ADDRESSES: AddressMap = {
  ...PUBLIC_ADDRESSES,
  ...LOCAL_ADDRESSES,
};

export type ContractType = 'nft' | 'verifier' | 'renderer' | 'badgeAwarder';

export function getContractAddress(
  chainId: number,
  contract: ContractType
): `0x${string}` | undefined {
  return CONTRACT_ADDRESSES[chainId]?.[contract];
}

/**
 * Block the contracts were deployed at, when the deploy recorded it.
 *
 * Used as the floor for transfer-log scans: nothing exists before deployment,
 * so this makes a scan both complete and as small as it can be — no archival
 * node, no fixed lookback window that silently drops older mints.
 */
export function getContractDeployBlock(chainId: number): number | undefined {
  return CONTRACT_ADDRESSES[chainId]?.deployBlock;
}

export function areContractsDeployed(chainId: number): boolean {
  const addrs = CONTRACT_ADDRESSES[chainId];
  return !!addrs?.nft && !!addrs?.verifier;
}
