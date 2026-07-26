import { useEffect, useState } from 'react';
import { keccak256, toBytes } from 'viem';
import { useReadChain } from './useReadChain';
import MazeKingNFTAbi from '../lib/abi/MazeKingNFT.json';

/**
 * Check the maze we generated against the one the chain says this name means.
 *
 * These should never differ. The layout is a pure function of the seed, and
 * that determinism is what makes replay and competition mean anything. But
 * "should never" is a claim about our own code, and the cost of it being wrong
 * is severe and silent: a player would solve a maze nobody else can see, prove
 * it, and mint a token under a different id than the registered one. Their
 * score would land on a maze that is not the one on the leaderboard.
 *
 * So the registered layout is treated as authoritative and the local one as a
 * guess that is almost always right. The game starts immediately from the local
 * generation rather than waiting on a network read — a blank screen while an
 * RPC answers would be a certain cost paid against a hypothetical problem — and
 * this reconciles in the background.
 *
 * Returns the official bytes only when they disagree, so callers can treat a
 * non-null result as "something is wrong, and here is the truth".
 */
export type LayoutCheck =
  | { state: 'checking' }
  | { state: 'unregistered' } // no official maze under this name
  | { state: 'agrees' } // the normal case
  | { state: 'differs'; official: Uint8Array; tokenId: bigint };

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function useOfficialLayout(
  seed: string | null | undefined,
  localLayout: Uint8Array | null | undefined
): LayoutCheck {
  const { publicClient, nft } = useReadChain();
  const [result, setResult] = useState<LayoutCheck>({ state: 'checking' });

  useEffect(() => {
    let cancelled = false;
    setResult({ state: 'checking' });

    if (!seed || !localLayout || !nft || !publicClient) return;

    void (async () => {
      try {
        const tokenId = (await publicClient.readContract({
          address: nft,
          abi: MazeKingNFTAbi,
          functionName: 'officialMazes',
          args: [keccak256(toBytes(seed))],
        })) as bigint;

        if (cancelled) return;
        if (!tokenId) {
          setResult({ state: 'unregistered' });
          return;
        }

        const official = (await publicClient.readContract({
          address: nft,
          abi: MazeKingNFTAbi,
          functionName: 'layouts',
          args: [tokenId],
        })) as `0x${string}`;

        if (cancelled) return;
        const bytes = Uint8Array.from(
          (official.slice(2).match(/../g) ?? []).map((h) => parseInt(h, 16))
        );

        if (bytes.length === 0) {
          // Registered by name but no layout stored yet. Nothing to compare
          // against, so the local generation stands.
          setResult({ state: 'unregistered' });
          return;
        }

        setResult(
          sameBytes(bytes, localLayout)
            ? { state: 'agrees' }
            : { state: 'differs', official: bytes, tokenId }
        );
      } catch {
        // An unreachable node is not evidence of disagreement. Reporting one
        // would tell a player their maze is wrong on the strength of a dropped
        // request, which is worse than not checking at all.
        if (!cancelled) setResult({ state: 'checking' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [seed, localLayout, nft, publicClient]);

  return result;
}
