import { useAccount, useConfig, usePublicClient } from 'wagmi';
import { areContractsDeployed, getContractAddress } from '../lib/contracts';

/**
 * The chain to read public data from, with or without a wallet.
 *
 * Reading the chain and writing to it need different answers. A mint has to go
 * to whatever chain the wallet is on -- anything else would be minting on a
 * chain the user did not choose. But the gallery, a maze's scorecard and a
 * registered layout are public facts, and requiring a wallet to see them means
 * someone opening the site to look at it is shown an empty page and told there
 * is nothing there.
 *
 * That is what happened: every public read went through `useAccount().chain`,
 * which is undefined until a wallet connects, so the gallery reported "No mazes
 * yet" to anyone who had not connected one.
 *
 * So: the connected chain when there is one, and otherwise the first configured
 * chain that actually has contracts deployed on it.
 */
export function useReadChain() {
  const { chain: connected } = useAccount();
  const config = useConfig();

  const fallback = config.chains.find((c) => areContractsDeployed(c.id));
  const chain = connected ?? fallback;

  // Ask for a client on that specific chain rather than the ambient one. With
  // no wallet, the ambient client follows the config's first chain, which is
  // not necessarily the one we settled on above.
  const publicClient = usePublicClient({ chainId: chain?.id });

  return {
    chain,
    publicClient,
    nft: chain ? getContractAddress(chain.id, 'nft') : undefined,
    /** True when this is a fallback rather than the user's own wallet chain. */
    isFallback: !connected && Boolean(fallback),
  };
}
