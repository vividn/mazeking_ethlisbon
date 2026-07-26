import { useEffect, useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import MazeKingNFTAbi from '../lib/abi/MazeKingNFT.json';
import { getContractAddress } from '../lib/contracts';
import { tokenIdFromLocation } from '../lib/seedUrl';
import type { ReplayPayload } from '../components/Game';

/**
 * Load a replay named by the URL.
 *
 * `/m/<tokenId>` is reached two ways: from the gallery, which already holds the
 * layout, and by someone opening the link cold — pasted, bookmarked, or simply
 * refreshed. The second case has no state to fall back on, and without this the
 * page would render whatever the default seed produces under a URL claiming to
 * be a particular maze. A shareable link that shows the wrong maze is worse than
 * no shareable link.
 *
 * Returns null while loading, when the path names no token, or when the token
 * cannot be read. Callers keep whatever they already had.
 */
export function useReplayFromPath(
  pathname: string,
  alreadyLoaded: boolean
): ReplayPayload | null {
  const { chain } = useAccount();
  const publicClient = usePublicClient();
  const [replay, setReplay] = useState<ReplayPayload | null>(null);

  const tokenId = tokenIdFromLocation(pathname);
  const nft = chain ? getContractAddress(chain.id, 'nft') : undefined;

  useEffect(() => {
    let cancelled = false;

    // Nothing to do when the gallery already handed us the layout: refetching
    // it would replace an identical value and reset the game underneath the
    // player.
    if (alreadyLoaded || tokenId === null || !nft || !publicClient) return;

    void (async () => {
      try {
        const layoutHex = (await publicClient.readContract({
          address: nft,
          abi: MazeKingNFTAbi,
          functionName: 'layouts',
          args: [tokenId],
        })) as `0x${string}`;

        if (cancelled || !layoutHex || layoutHex.length <= 2) return;

        setReplay({
          layout: Uint8Array.from(
            (layoutHex.slice(2).match(/../g) ?? []).map((h) => parseInt(h, 16))
          ),
          tokenId,
          // The seed is not recoverable from a token id -- the id is a hash of
          // the layout, not of the name. The maze is shown without one.
          seed: null,
        });
      } catch {
        // Leave it null. Showing a maze we could not read would be showing a
        // different maze than the link names.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tokenId, nft, publicClient, alreadyLoaded]);

  return replay;
}
