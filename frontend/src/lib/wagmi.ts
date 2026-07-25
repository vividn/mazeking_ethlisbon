import { createConfig, http } from 'wagmi';
import { polygonZkEvm, sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { defineChain } from 'viem';

// Anvil uses chain ID 31337 by default (not 1337 like wagmi's localhost).
// `contracts.multicall3` points at the canonical Multicall3 address; Anvil
// 1.6/1.7 doesn't predeploy it, so `just _ensure-anvil` etches a copy via
// anvil_setCode (see scripts/inject-multicall3.sh).
const anvil = defineChain({
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 0,
    },
  },
});

/**
 * Wagmi configuration for MazeKing dApp.
 * Supports Anvil (localhost), Sepolia testnet, and Polygon zkEVM mainnet.
 *
 * The first chain in the array is wagmi's default for new connections.
 * Dev: Anvil first (rapid local iteration).
 * Prod: Polygon zkEVM first — the production deployment target. Sepolia stays
 * in the list so the existing testnet deployment remains reachable.
 */
const chainsByMode = import.meta.env.DEV
  ? ([anvil, sepolia, polygonZkEvm] as const)
  : ([polygonZkEvm, sepolia, anvil] as const);

/**
 * RPC endpoint selection.
 *
 * Precedence per chain: an explicit VITE_<CHAIN>_RPC_URL, else an endpoint
 * derived from VITE_ALCHEMY_KEY, else a public fallback.
 *
 * VITE_ALCHEMY_KEY covers every chain at once, so there is a single value to
 * rotate and no way for one chain to end up on a stale key while another is
 * current.
 *
 * IMPORTANT: this key is NOT secret. Vite inlines every VITE_* value into the
 * bundle, so it ships in the deployed JavaScript and anyone can read it. What
 * protects it is Alchemy's origin allowlist, not concealment — which is why it
 * belongs in a GitHub Actions *variable* rather than a secret. Two consequences
 * worth knowing:
 *   - A key restricted to the production domain will NOT work from localhost.
 *     Allowlist localhost, or use a separate unrestricted key for dev.
 *   - Origin allowlists are checked from browser-sent headers, which non-browser
 *     clients can spoof. Treat it as protection against casual reuse, not as a
 *     boundary — pair it with a compute-unit cap so a leak is bounded in cost.
 *
 * Alchemy's `demo` key is deliberately never used as a fallback: it blocks CORS
 * from non-Alchemy origins, so it can only fail in a browser dApp.
 */
const ALCHEMY_KEY = import.meta.env.VITE_ALCHEMY_KEY;

/** Alchemy endpoint for a network subdomain, or undefined when no key is set. */
const alchemyRpc = (network: string): string | undefined =>
  ALCHEMY_KEY ? `https://${network}.g.alchemy.com/v2/${ALCHEMY_KEY}` : undefined;

const PUBLIC_SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const sepoliaRpcUrl =
  import.meta.env.VITE_SEPOLIA_RPC_URL ||
  alchemyRpc('eth-sepolia') ||
  PUBLIC_SEPOLIA_RPC;

const PUBLIC_POLYGON_ZKEVM_RPC = 'https://zkevm-rpc.com';
const polygonZkEvmRpcUrl =
  import.meta.env.VITE_POLYGON_ZKEVM_RPC_URL ||
  alchemyRpc('polygonzkevm-mainnet') ||
  PUBLIC_POLYGON_ZKEVM_RPC;

if (!import.meta.env.DEV && !ALCHEMY_KEY) {
  // One signal rather than one per chain: with no key set, every network is on
  // a shared public endpoint. The dApp still boots so gameplay is not dead,
  // but a production deploy should not be discovering this under load.
  // eslint-disable-next-line no-console
  console.error(
    '[mazeking] VITE_ALCHEMY_KEY is not set and no per-chain RPC overrides ' +
      'were provided; falling back to shared public RPCs. Set a dedicated key ' +
      'in the deploy environment for rate limits and reliability.'
  );
}

export const config = createConfig({
  chains: chainsByMode,
  connectors: [injected()],
  transports: {
    [anvil.id]: http('http://127.0.0.1:8545'),
    [sepolia.id]: http(sepoliaRpcUrl),
    [polygonZkEvm.id]: http(polygonZkEvmRpcUrl),
  },
  ssr: false,
});

export { anvil };

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
