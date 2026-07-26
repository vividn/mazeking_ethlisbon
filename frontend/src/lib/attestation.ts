/**
 * Fetching a registrar attestation for the maze being minted.
 *
 * Badges are graded against `optimalMoves[tokenId]`, and until something sets
 * that value every medal is withheld — the robot crown included. Historically
 * only the registrar's own transaction could set it, so a maze nobody had
 * pre-registered awarded nothing.
 *
 * An attestation removes that ordering problem. The registrar signs a statement
 * about a maze; the player carries the signature into their own mint, which
 * registers the maze in the same transaction that mints it. The registrar never
 * transacts, so it needs no gas, no nonce and no turn.
 *
 * Everything here is best effort. If no attestor is configured, or it is down,
 * or it answers with something unexpected, minting proceeds exactly as it did
 * before: unattested, and without badges. A missing medal is a much smaller
 * failure than a mint that cannot go through.
 */
import type { Hex } from 'viem';

/**
 * Where to ask. Unset in local development, where there is usually no registrar
 * key to sign with; set in production to the deployed function's URL.
 */
const ATTESTOR_URL = import.meta.env.VITE_ATTESTOR_URL as string | undefined;

export interface Attestation {
  /** The optimum the registrar is willing to sign for, in moves. */
  optimalMoves: number;
  /** EIP-712 signature over (mazeHash, keccak256(layout), optimalMoves). */
  signature: Hex;
  /** The layout the registrar signed over, for the agreement check below. */
  layout: Hex;
}

function isHex(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value);
}

/**
 * Ask the registrar to attest the maze grown from `seed`.
 *
 * Returns null whenever an attestation cannot be had or cannot be trusted;
 * callers mint unattested in that case.
 *
 * `chainId` and `nft` are forwarded because the EIP-712 domain binds both. A
 * signature made for one deployment is meaningless on another, which is the
 * property that stops a Sepolia attestation being replayed onto mainnet.
 */
export async function fetchAttestation(
  seed: string,
  chainId: number,
  nft: string,
  signal?: AbortSignal
): Promise<Attestation | null> {
  if (!ATTESTOR_URL) return null;

  try {
    const url = new URL(ATTESTOR_URL);
    url.searchParams.set('seed', seed);
    url.searchParams.set('chainId', String(chainId));
    url.searchParams.set('contract', nft);

    const res = await fetch(url, { signal });
    if (!res.ok) {
      console.warn(`attestor answered ${res.status}; minting unattested`);
      return null;
    }

    const body: unknown = await res.json();
    const { optimalMoves, signature, layout } = (body ?? {}) as Record<
      string,
      unknown
    >;

    if (
      typeof optimalMoves !== 'number' ||
      !Number.isInteger(optimalMoves) ||
      optimalMoves <= 0 ||
      !isHex(signature) ||
      !isHex(layout)
    ) {
      console.warn(
        'attestor answered in an unexpected shape; minting unattested'
      );
      return null;
    }

    return { optimalMoves, signature, layout };
  } catch (err) {
    console.warn('could not reach the attestor; minting unattested:', err);
    return null;
  }
}

/**
 * Whether an attestation describes the maze actually being minted.
 *
 * The contract checks the signature against `keccak256(layout)` using the
 * layout passed to `mintWithProof`, so an attestation over some *other* layout
 * makes the whole transaction revert. That failure would be correct but
 * catastrophic in the wrong direction: a registrar that had drifted from the
 * game by one byte would stop every mint rather than merely withholding
 * badges.
 *
 * Comparing the two layouts locally, before sending anything, keeps the
 * consequences proportionate. Disagreement means we drop the attestation and
 * mint without it, and the drift is visible in the console rather than as an
 * unexplained revert.
 */
export function attestationMatchesLayout(
  attestation: Attestation,
  layout: Uint8Array
): boolean {
  const ours = Array.from(layout)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return attestation.layout.slice(2).toLowerCase() === ours;
}
