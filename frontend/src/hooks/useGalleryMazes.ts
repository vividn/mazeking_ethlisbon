import { useEffect, useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import type { Address, Hex, PublicClient } from 'viem';
import { hexToBytes, parseAbiItem } from 'viem';
import MazeKingNFTAbi from '../lib/abi/MazeKingNFT.json';
import { getContractAddress } from '../lib/contracts';

/**
 * How far back from the current block to scan event logs. Mirrors
 * useOwnedMazes — Sepolia public RPCs typically cap eth_getLogs at ~10k
 * blocks per call, so we walk in 9k slices.
 */
const LOOKBACK_BLOCKS = 100_000n;
const CHUNK_SIZE = 9_000n;

const MAZE_REGISTERED = parseAbiItem(
  'event MazeRegistered(bytes32 indexed seedHash, string seed, uint256 indexed tokenId)'
);
const PROOF_VERIFIED = parseAbiItem(
  'event ProofVerified(address indexed solver, uint256 indexed tokenId, uint16 moveCount)'
);
const TRANSFER_SINGLE = parseAbiItem(
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)'
);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export interface GalleryMaze {
  tokenId: bigint;
  /** null when only the mint event is known (registrar didn't publish a seed). */
  seed: string | null;
  imageUrl: string | null;
  /**
   * Canonical layout bytes from `MazeKingNFT.layouts(tokenId)`. Used by
   * `mazeFromLayoutBytes` to power replay for every gallery tile, including
   * tokens whose seed was never published. Null when the chain returned no
   * bytes (pre-renderer mints, RPC failure).
   */
  layout: Uint8Array | null;
  timesSolved: number;
  minMoves: number | null;
}

interface State {
  loading: boolean;
  error: string | null;
  mazes: GalleryMaze[];
}

interface MazeAggregate {
  timesSolved: number;
  minMoves: number | null;
}

/**
 * Every maze on chain, from the contract's own list.
 *
 * The gallery previously reconstructed this from event logs, which requires
 * wide eth_getLogs ranges. Providers cap those hard — Alchemy's free tier
 * allows 10 blocks per query — so a 100k-block scan is not slow, it is
 * rejected outright, and the page failed to load at all.
 *
 * Deployments predating `allMazes` fall back to the log scan.
 */
async function discoverAllMazeIds(
  client: PublicClient,
  contract: Address
): Promise<bigint[] | null> {
  try {
    const ids = (await client.readContract({
      address: contract,
      abi: MazeKingNFTAbi as never,
      functionName: 'allMazes',
    })) as readonly bigint[];
    return [...ids];
  } catch {
    return null;
  }
}

/**
 * Best-effort log reads. Seed strings and cross-solver totals exist only in
 * events, so on a provider with a narrow getLogs window they are simply
 * unavailable. That must degrade the gallery, not break it: tiles fall back to
 * a short token id and omit stats rather than the page failing.
 */
async function bestEffort<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (err) {
    console.warn('[gallery] optional log query unavailable:', err);
    return fallback;
  }
}

async function scanRegisteredMazes(
  client: PublicClient,
  contract: Address
): Promise<Array<{ tokenId: bigint; seed: string }>> {
  const head = await client.getBlockNumber();
  const oldest = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
  const seen = new Map<string, { tokenId: bigint; seed: string }>();

  let to = head;
  while (to >= oldest) {
    const from =
      to >= CHUNK_SIZE && to - CHUNK_SIZE > oldest ? to - CHUNK_SIZE : oldest;
    const logs = await client.getLogs({
      address: contract,
      event: MAZE_REGISTERED,
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const tokenId = log.args.tokenId;
      const seed = log.args.seed;
      if (tokenId !== undefined && typeof seed === 'string') {
        seen.set(tokenId.toString(), { tokenId, seed });
      }
    }
    if (from === oldest) break;
    to = from - 1n;
  }

  return Array.from(seen.values());
}

// TODO(post-registrar): once the registrar UI ships and creators publish seeds
// via MazeRegistered, this mint-fallback can be dropped (or kept behind a
// "show all mints" toggle). Until then, Gallery would otherwise be empty —
// MazeRegistered is registrar-only and emits zero events for ordinary mints.
async function scanMintedTokenIds(
  client: PublicClient,
  contract: Address
): Promise<bigint[]> {
  const head = await client.getBlockNumber();
  const oldest = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
  const ids = new Set<string>();

  let to = head;
  while (to >= oldest) {
    const from =
      to >= CHUNK_SIZE && to - CHUNK_SIZE > oldest ? to - CHUNK_SIZE : oldest;
    const logs = await client.getLogs({
      address: contract,
      event: TRANSFER_SINGLE,
      args: { from: ZERO_ADDRESS },
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const id = log.args.id;
      if (id !== undefined) ids.add(id.toString());
    }
    if (from === oldest) break;
    to = from - 1n;
  }

  return Array.from(ids, (s) => BigInt(s));
}

async function scanProofStats(
  client: PublicClient,
  contract: Address
): Promise<Map<string, MazeAggregate>> {
  const head = await client.getBlockNumber();
  const oldest = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
  const stats = new Map<string, MazeAggregate>();

  let to = head;
  while (to >= oldest) {
    const from =
      to >= CHUNK_SIZE && to - CHUNK_SIZE > oldest ? to - CHUNK_SIZE : oldest;
    const logs = await client.getLogs({
      address: contract,
      event: PROOF_VERIFIED,
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const tokenId = log.args.tokenId;
      const moveCount = log.args.moveCount;
      if (tokenId === undefined || moveCount === undefined) continue;
      const key = tokenId.toString();
      const cur = stats.get(key);
      const moves = Number(moveCount);
      if (cur) {
        cur.timesSolved += 1;
        cur.minMoves =
          cur.minMoves === null ? moves : Math.min(cur.minMoves, moves);
      } else {
        stats.set(key, { timesSolved: 1, minMoves: moves });
      }
    }
    if (from === oldest) break;
    to = from - 1n;
  }

  return stats;
}

function decodeImageFromTokenUri(tokenUri: string): string | null {
  if (!tokenUri.startsWith('data:application/json;base64,')) {
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

export function useGalleryMazes(
  enabled: boolean
): State & { refresh: () => void } {
  const { chain } = useAccount();
  const publicClient = usePublicClient();
  const [state, setState] = useState<State>({
    loading: false,
    error: null,
    mazes: [],
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function run() {
      if (!chain || !publicClient) {
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
        // The token list comes from the contract when it can. Only the
        // extras — seed strings and cross-solver totals — still need logs, and
        // those are optional.
        const enumerated = await discoverAllMazeIds(
          publicClient,
          contractAddress
        );
        if (cancelled) return;

        const [registered, mintedIds, proofStats] = await Promise.all([
          bestEffort(
            () => scanRegisteredMazes(publicClient, contractAddress),
            [] as Array<{ tokenId: bigint; seed: string }>
          ),
          enumerated
            ? Promise.resolve(enumerated)
            : bestEffort(
                () => scanMintedTokenIds(publicClient, contractAddress),
                [] as bigint[]
              ),
          bestEffort(
            () => scanProofStats(publicClient, contractAddress),
            new Map<string, MazeAggregate>()
          ),
        ]);
        if (cancelled) return;

        // Merge: registered tokens win (they have a seed string); fall back
        // to minted token ids for the rest. Same tokenId in both lists is
        // deduped via the registered map. Replay no longer depends on knowing
        // a seed — every tile fetches its on-chain layout below.
        const registeredById = new Map(
          registered.map((r) => [r.tokenId.toString(), r.seed])
        );

        const mergedIds: bigint[] = [
          ...registered.map((r) => r.tokenId),
          ...mintedIds.filter((id) => !registeredById.has(id.toString())),
        ];

        if (mergedIds.length === 0) {
          setState({ loading: false, error: null, mazes: [] });
          return;
        }

        const tokenIds = mergedIds;

        const [disqResults, uriResults, layoutResults] = await Promise.all([
          publicClient.multicall({
            contracts: tokenIds.map((id) => ({
              address: contractAddress,
              abi: MazeKingNFTAbi as never,
              functionName: 'disqualified',
              args: [id],
            })),
            allowFailure: true,
          }),
          publicClient.multicall({
            contracts: tokenIds.map((id) => ({
              address: contractAddress,
              abi: MazeKingNFTAbi as never,
              functionName: 'uri',
              args: [id],
            })),
            allowFailure: true,
          }),
          publicClient.multicall({
            contracts: tokenIds.map((id) => ({
              address: contractAddress,
              abi: MazeKingNFTAbi as never,
              functionName: 'layouts',
              args: [id],
            })),
            allowFailure: true,
          }),
        ]);
        if (cancelled) return;

        const mazes: GalleryMaze[] = [];
        for (let i = 0; i < tokenIds.length; i++) {
          const dq = disqResults[i];
          if (dq && dq.status === 'success' && dq.result === true) continue;

          const u = uriResults[i];
          const tokenUri =
            u && u.status === 'success' ? (u.result as string) : '';
          const l = layoutResults[i];
          const layout =
            l && l.status === 'success' && (l.result as Hex).length > 2
              ? hexToBytes(l.result as Hex)
              : null;
          const agg = proofStats.get(tokenIds[i].toString());
          mazes.push({
            tokenId: tokenIds[i],
            seed: registeredById.get(tokenIds[i].toString()) ?? null,
            imageUrl: decodeImageFromTokenUri(tokenUri),
            layout,
            timesSolved: agg?.timesSolved ?? 0,
            minMoves: agg?.minMoves ?? null,
          });
        }

        setState({ loading: false, error: null, mazes });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load gallery',
          mazes: [],
        });
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [enabled, chain, publicClient, tick]);

  return { ...state, refresh: () => setTick((t) => t + 1) };
}
