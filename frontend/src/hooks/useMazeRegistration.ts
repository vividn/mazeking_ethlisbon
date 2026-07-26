import { useCallback, useEffect, useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import MazeKingNFTAbi from '../lib/abi/MazeKingNFT.json';
import { getContractAddress } from '../lib/contracts';
import { fetchAttestation, type Attestation } from '../lib/attestation';

/**
 * Whether this maze is registered, and a way to get it registered.
 *
 * Registration is what makes badges reachable: they are graded against
 * `optimalMoves[tokenId]`, and a maze nobody has registered awards nothing at
 * all — not even the robot crown for a flawless solve. That is invisible from
 * the game, which is why it is worth surfacing rather than leaving to chance.
 *
 * `register` does not send a transaction. It asks the registrar to sign a
 * statement about the maze and holds the signature; the player's own mint
 * carries it on chain. So registering costs nothing, needs no wallet, and
 * cannot be left half-done — there is no pending transaction to strand.
 */
export type RegistrationStatus =
  | 'unknown' // not looked up yet, or no maze hash to look up
  | 'registered' // already on chain
  | 'unregistered' // known absent; offer to register
  | 'signing' // asking the registrar
  | 'signed' // attestation in hand, will ride along with the mint
  | 'unavailable'; // no registrar reachable, or it declined

export function useMazeRegistration(
  mazeHash: `0x${string}` | null | undefined,
  seed?: string | null
) {
  const { chain } = useAccount();
  const publicClient = usePublicClient();
  const [status, setStatus] = useState<RegistrationStatus>('unknown');
  const [attestation, setAttestation] = useState<Attestation | null>(null);
  const [optimalMoves, setOptimalMoves] = useState<number | null>(null);

  const nftAddress = chain ? getContractAddress(chain.id, 'nft') : undefined;

  // Look up the on-chain state whenever the maze or the chain changes. A maze
  // registered on Sepolia is not registered on another chain, so this must not
  // be cached across a chain switch.
  useEffect(() => {
    let cancelled = false;
    setAttestation(null);
    setOptimalMoves(null);

    if (!mazeHash || !nftAddress || !publicClient) {
      setStatus('unknown');
      return;
    }

    setStatus('unknown');
    void (async () => {
      try {
        const optimal = (await publicClient.readContract({
          address: nftAddress,
          abi: MazeKingNFTAbi,
          functionName: 'optimalMoves',
          args: [BigInt(mazeHash)],
        })) as number | bigint;

        if (cancelled) return;
        const value = Number(optimal);
        setOptimalMoves(value > 0 ? value : null);
        setStatus(value > 0 ? 'registered' : 'unregistered');
      } catch {
        // A read failure is not evidence of anything. Claiming "unregistered"
        // here would invite a pointless signing round trip, and claiming
        // "registered" would hide the button that fixes it.
        if (!cancelled) setStatus('unknown');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mazeHash, nftAddress, publicClient]);

  const register = useCallback(async () => {
    if (!seed || !chain || !nftAddress) {
      setStatus('unavailable');
      return;
    }
    setStatus('signing');
    const result = await fetchAttestation(seed, chain.id, nftAddress);
    if (!result) {
      setStatus('unavailable');
      return;
    }
    setAttestation(result);
    setOptimalMoves(result.optimalMoves);
    setStatus('signed');
  }, [seed, chain, nftAddress]);

  return { status, attestation, optimalMoves, register };
}
