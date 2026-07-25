import { useEffect, useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import type { Address, Hex, PublicClient } from 'viem';
import { hexToBytes, parseAbiItem } from 'viem';
import MazeKingNFTAbi from '../lib/abi/MazeKingNFT.json';
import { getContractAddress } from '../lib/contracts';

/**
 * How far back from the current block to scan for ERC1155 transfer logs.
 * Sepolia public RPCs typically cap eth_getLogs at ~10k blocks per call; we
 * chunk in 9_000-block slices and walk backwards. With ~12s blocks, 100k
 * blocks is roughly 14 days of history — comfortably covers the demo window
 * for a recently-deployed contract without paginating to genesis.
 */
const LOOKBACK_BLOCKS = 100_000n;
const CHUNK_SIZE = 9_000n;

const TRANSFER_SINGLE = parseAbiItem(
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)'
);
const TRANSFER_BATCH = parseAbiItem(
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)'
);

export interface OwnedMaze {
  tokenId: bigint;
  imageUrl: string | null;
  /**
   * Canonical layout bytes from `MazeKingNFT.layouts(tokenId)`. Decoded by
   * `mazeFromLayoutBytes` for replay; null when the chain returned no bytes
   * (pre-renderer mints, RPC failure). Replaces the prior `seed` localStorage
   * bridge — every owned token replays from on-chain bytes regardless of
   * which device was used to mint it.
   */
  layout: Uint8Array | null;
  /** Owner's best move count for this token; null when never solved. */
  minMoves: number | null;
  /**
   * Badge bitfield from `stats(tokenId, owner)` — see `lib/badges.ts`.
   *
   * Per-HOLDER, not per-token: two owners of the same maze can hold different
   * badges, which is why badges cannot live in the ERC-1155 `uri(tokenId)`
   * metadata (one URI is shared by every holder) and must be surfaced here.
   *
   * 0 is the normal state for a maze whose `optimalMoves` was never registered
   * — the awarder gates every medal on it.
   */
  badges: number;
}

interface State {
  loading: boolean;
  error: string | null;
  mazes: OwnedMaze[];
}

async function scanIncomingTokenIds(
  client: PublicClient,
  contract: Address,
  owner: Address
): Promise<bigint[]> {
  const head = await client.getBlockNumber();
  const oldest = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;

  const ids = new Set<string>();
  let to = head;
  while (to >= oldest) {
    const from =
      to >= CHUNK_SIZE && to - CHUNK_SIZE > oldest ? to - CHUNK_SIZE : oldest;

    const [singles, batches] = await Promise.all([
      client.getLogs({
        address: contract,
        event: TRANSFER_SINGLE,
        args: { to: owner },
        fromBlock: from,
        toBlock: to,
      }),
      client.getLogs({
        address: contract,
        event: TRANSFER_BATCH,
        args: { to: owner },
        fromBlock: from,
        toBlock: to,
      }),
    ]);

    for (const log of singles) {
      const id = log.args.id;
      if (id !== undefined) ids.add(id.toString());
    }
    for (const log of batches) {
      for (const id of log.args.ids ?? []) ids.add(id.toString());
    }

    if (from === oldest) break;
    to = from - 1n;
  }

  return Array.from(ids, (s) => BigInt(s));
}

/**
 * Decode a `data:application/json;base64,...` token URI into the SVG image
 * URL referenced inside it. The renderer emits `image` as a
 * `data:image/svg+xml;base64,...` URI which can be set directly as <img src>.
 */
function decodeImageFromTokenUri(tokenUri: string): string | null {
  if (!tokenUri.startsWith('data:application/json;base64,')) {
    // Fallback: assume it's already an image URL (e.g. ipfs gateway).
    return tokenUri || null;
  }
  try {
    const b64 = tokenUri.slice('data:application/json;base64,'.length);
    const json = atob(b64);
    const meta = JSON.parse(json);
    return typeof meta.image === 'string' ? meta.image : null;
  } catch {
    return null;
  }
}

export function useOwnedMazes(
  enabled: boolean = true
): State & { refresh: () => void } {
  const { address, chain } = useAccount();
  const publicClient = usePublicClient();
  const [state, setState] = useState<State>({
    loading: false,
    error: null,
    mazes: [],
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // Gating on `enabled` (re-runs when it flips false→true) means the post-
    // mint UI sees fresh logs every time the sidebar opens. Without this, the
    // hook would be mounted once at app start, populate state with whatever
    // existed pre-mint, and never re-fetch when the user opens the sidebar
    // after a successful mint — which is exactly the bug ma-dn4 fixes.
    if (!enabled) return;
    let cancelled = false;

    async function run() {
      if (!address || !chain || !publicClient) {
        setState({ loading: false, error: null, mazes: [] });
        return;
      }
      const contractAddress = getContractAddress(chain.id, 'nft');
      if (!contractAddress) {
        setState({
          loading: false,
          error: `Contracts not deployed on ${chain.name}`,
          mazes: [],
        });
        return;
      }

      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        const tokenIds = await scanIncomingTokenIds(
          publicClient,
          contractAddress,
          address
        );
        if (cancelled) return;

        if (tokenIds.length === 0) {
          setState({ loading: false, error: null, mazes: [] });
          return;
        }

        // Filter to actually-held tokens (could've been transferred away),
        // and fetch each tokenURI in parallel.
        const balances = await publicClient.multicall({
          contracts: tokenIds.map((id) => ({
            address: contractAddress,
            abi: MazeKingNFTAbi as never,
            functionName: 'balanceOf',
            args: [address, id],
          })),
          allowFailure: true,
        });
        if (cancelled) return;

        const heldIds = tokenIds.filter((_, i) => {
          const r = balances[i];
          return r && r.status === 'success' && (r.result as bigint) > 0n;
        });

        if (heldIds.length === 0) {
          setState({ loading: false, error: null, mazes: [] });
          return;
        }

        const [uris, statsResults, layoutResults] = await Promise.all([
          publicClient.multicall({
            contracts: heldIds.map((id) => ({
              address: contractAddress,
              abi: MazeKingNFTAbi as never,
              functionName: 'uri',
              args: [id],
            })),
            allowFailure: true,
          }),
          publicClient.multicall({
            contracts: heldIds.map((id) => ({
              address: contractAddress,
              abi: MazeKingNFTAbi as never,
              functionName: 'stats',
              args: [id, address],
            })),
            allowFailure: true,
          }),
          publicClient.multicall({
            contracts: heldIds.map((id) => ({
              address: contractAddress,
              abi: MazeKingNFTAbi as never,
              functionName: 'layouts',
              args: [id],
            })),
            allowFailure: true,
          }),
        ]);
        if (cancelled) return;

        const mazes: OwnedMaze[] = heldIds.map((tokenId, i) => {
          const r = uris[i];
          const tokenUri =
            r && r.status === 'success' ? (r.result as string) : '';
          // stats() returns a tuple [minMoves, timesSolved, badges, usdcDonated].
          // timesSolved == 0 means the user has no recorded solve, so minMoves
          // is meaningless (defaults to 0); surface as null instead.
          const s = statsResults[i];
          let minMoves: number | null = null;
          let badges = 0;
          if (s && s.status === 'success') {
            const tuple = s.result as readonly [bigint, bigint, bigint, bigint];
            const timesSolved = Number(tuple[1] ?? 0n);
            if (timesSolved > 0) minMoves = Number(tuple[0]);
            badges = Number(tuple[2] ?? 0n);
          }
          const l = layoutResults[i];
          const layout =
            l && l.status === 'success' && (l.result as Hex).length > 2
              ? hexToBytes(l.result as Hex)
              : null;
          return {
            tokenId,
            imageUrl: decodeImageFromTokenUri(tokenUri),
            layout,
            minMoves,
            badges,
          };
        });

        setState({ loading: false, error: null, mazes });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load mazes',
          mazes: [],
        });
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [enabled, address, chain, publicClient, tick]);

  return { ...state, refresh: () => setTick((t) => t + 1) };
}
