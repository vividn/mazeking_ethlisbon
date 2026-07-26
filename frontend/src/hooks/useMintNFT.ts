import { useCallback, useState } from 'react';
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  usePublicClient,
} from 'wagmi';
import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  TimeoutError,
  UserRejectedRequestError,
} from 'viem';
import MazeKingNFTAbi from '../lib/abi/MazeKingNFT.json';
import { getContractAddress } from '../lib/contracts';
import {
  fetchAttestation,
  attestationMatchesLayout,
  type Attestation,
} from '../lib/attestation';

/**
 * Hook to mint an NFT under the hash-as-public-input architecture
 * (ma-6cr.6). The on-chain signature is now:
 *
 *   mintWithProof(bytes proof, bytes32 mazeHash, bytes layout, uint16 moveCount,
 *                 bool bearer, uint32 attestedOptimalMoves, bytes attestation)
 *
 * `mazeHash` is the Pedersen hash of the canonical layout (computed via
 * bb.js — that wiring lives in ma-6cr.8). `layout` is the canonical bytes
 * the same hash is computed over.
 *
 * The last two arguments carry a registrar attestation when one is available,
 * which registers the maze in the same transaction and so lets it award
 * badges. Passing an empty signature skips registration, which is what happens
 * whenever no attestor is configured or reachable.
 */
export function useMintNFT() {
  const { address, chain } = useAccount();
  const publicClient = usePublicClient();
  const [simulateError, setSimulateError] = useState<unknown>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const {
    data: hash,
    writeContract,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash });

  // Single error surface across simulate / write / receipt phases so the UI
  // doesn't have to know which step blew up. ma-q7n.
  const error = simulateError ?? writeError ?? receiptError ?? null;

  const reset = useCallback(() => {
    setSimulateError(null);
    setIsSimulating(false);
    resetWrite();
  }, [resetWrite]);

  const mintWithProof = async (
    proof: Uint8Array,
    mazeHash: `0x${string}`,
    layout: Uint8Array,
    moveCount: number,
    /**
     * True when the proof was produced unbound (no wallet connected). The
     * contract then verifies against the zero sentinel instead of msg.sender,
     * which makes the proof copyable — opt-in only.
     */
    bearer: boolean = false,
    /**
     * The seed this maze grew from. Only used to ask the registrar for an
     * attestation; the maze's identity on chain is still its hash, never its
     * seed.
     */
    seed?: string,
    /**
     * An attestation already obtained by the UI, e.g. via an explicit
     * "register this maze" action. Passing it here avoids asking the registrar
     * twice for the same signature.
     */
    prefetched?: Attestation | null
  ) => {
    setSimulateError(null);

    if (!chain) {
      const err = new Error('No chain connected');
      setSimulateError(err);
      throw err;
    }

    const nftAddress = getContractAddress(chain.id, 'nft');
    if (!nftAddress) {
      const err = new Error(
        `Contract not deployed on ${chain.name}. Please deploy contracts first.`
      );
      setSimulateError(err);
      throw err;
    }

    // Ask for an attestation before simulating, so a maze nobody pre-registered
    // can still be registered by this very transaction and award its badges.
    // Every failure path here returns null and mints unattested.
    let attestation: Attestation | null = prefetched ?? null;
    if (!attestation && seed) {
      attestation = await fetchAttestation(seed, chain.id, nftAddress);
      if (attestation && !attestationMatchesLayout(attestation, layout)) {
        console.warn(
          'registrar attested a different layout for this seed; minting unattested'
        );
        attestation = null;
      }
    }
    const attestedOptimalMoves = attestation?.optimalMoves ?? 0;
    const attestationSig = attestation?.signature ?? '0x';

    const proofHex = `0x${Array.from(proof)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}` as `0x${string}`;
    const layoutHex = `0x${Array.from(layout)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}` as `0x${string}`;

    console.log('Minting NFT with proof:', {
      nftAddress,
      proofLength: proof.length,
      layoutLength: layout.length,
      mazeHash,
      moveCount,
      chainId: chain.id,
      chainName: chain.name,
    });

    // Pre-flight simulate so a verifier revert (stale on-chain VK,
    // proof/witness mismatch, etc.) surfaces with its real reason instead
    // of being masked as `IntrinsicGasTooHighError` ("gas limit too high")
    // by Alchemy's estimateGas-on-revert behaviour. See ma-6ff.
    if (publicClient) {
      setIsSimulating(true);
      try {
        await publicClient.simulateContract({
          account: address,
          address: nftAddress,
          abi: MazeKingNFTAbi,
          functionName: 'mintWithProof',
          args: [
            proofHex,
            mazeHash,
            layoutHex,
            moveCount,
            bearer,
            attestedOptimalMoves,
            attestationSig,
          ],
        });
      } catch (simErr) {
        const reason =
          simErr instanceof BaseError ? simErr.shortMessage : String(simErr);
        console.error('mintWithProof simulate failed:', reason, simErr);
        // Surface to the UI via the unified `error` field — without this
        // the simulate revert was logged-only and the mint button just sat
        // there. ma-q7n.
        setSimulateError(simErr);
        throw simErr;
      } finally {
        setIsSimulating(false);
      }
    }

    await writeContract({
      address: nftAddress,
      abi: MazeKingNFTAbi,
      functionName: 'mintWithProof',
      args: [
        proofHex,
        mazeHash,
        layoutHex,
        moveCount,
        bearer,
        attestedOptimalMoves,
        attestationSig,
      ],
    });
  };

  return {
    mintWithProof,
    hash,
    isPending: isWritePending || isSimulating,
    isConfirming,
    isSuccess,
    error,
    errorMessage: formatMintError(error),
    reset,
  };
}

/**
 * Categorize a mint-flow error into a short, user-facing string. Falls back
 * to a generic "see console" message so the UI is never silent. ma-q7n.
 */
export function formatMintError(err: unknown): string | null {
  if (!err) return null;

  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) {
      return 'Wallet rejected the transaction.';
    }
    const reverted = err.walk(
      (e) => e instanceof ContractFunctionRevertedError
    ) as ContractFunctionRevertedError | null;
    if (reverted) {
      const reason =
        reverted.reason ??
        reverted.shortMessage ??
        reverted.message ??
        'unknown reason';
      return `Transaction reverted: ${reason}`;
    }
    if (err.walk((e) => e instanceof TimeoutError)) {
      return 'Transaction timed out waiting for confirmation. Try again.';
    }
    if (err.walk((e) => e instanceof HttpRequestError)) {
      return 'Network error: failed to reach RPC. Try again.';
    }
    return err.shortMessage || err.message || 'Mint failed — see console.';
  }

  // Plain Error / string fallthrough — usually our own throws or fetch failures
  // that don't surface as BaseError (e.g. CORS rejecting a wagmi-internal RPC
  // request before viem wraps it).
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /network|fetch|cors|failed to fetch|connection refused|econn/i.test(msg)
  ) {
    return 'Network error: failed to reach RPC. Try again.';
  }
  return msg ? `Mint failed — ${msg}` : 'Mint failed — see console.';
}
