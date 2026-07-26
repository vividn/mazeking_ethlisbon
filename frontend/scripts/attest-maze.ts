/**
 * Registrar attestation signer.
 *
 * Given a seed, derives the maze and returns an EIP-712 signature stating what
 * its layout and optimal solve are. The player carries that signature into
 * their own mint, which registers the maze in the same transaction.
 *
 * The reason for signing rather than transacting: this process never touches
 * the chain, so it has no nonce. That is what makes it safe to run as a
 * horizontally scaled serverless function — a hundred concurrent invocations
 * need no lock, no queue and no shared counter, because none of them sends
 * anything. It also spends no gas, and cannot land after the mint it is meant
 * to accompany.
 *
 * Usable as a library (`signAttestation`), as a function handler (`handle`), or
 * from the command line:
 *
 *   pnpm exec vite-node scripts/attest-maze.ts -- \
 *     --seed "Zero Knowledge" --chain-id 11155111 --contract 0x...
 *
 * REGISTRAR_PRIVATE_KEY comes from the environment. It must hold
 * REGISTRAR_ROLE on the contract, but needs no balance — it never sends a
 * transaction.
 *
 * It shares `deriveMaze` with the registrar CLI rather than reimplementing the
 * derivation. An attestation that disagreed with the game about what a seed
 * produces would be worse than no attestation at all.
 */
import { keccak256, getAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { deriveMaze, bytesToHex } from './derive-maze';

/** Mirrors ATTESTATION_TYPEHASH in MazeKingNFT.sol. */
const TYPES = {
  MazeAttestation: [
    { name: 'mazeHash', type: 'bytes32' },
    { name: 'layoutHash', type: 'bytes32' },
    { name: 'optimalMoves', type: 'uint32' },
  ],
} as const;

export interface AttestOptions {
  chainId: number | string;
  verifyingContract: string;
  privateKey: Hex;
}

/**
 * Derive a maze from its seed and sign a statement about it.
 *
 * The domain binds chainId and verifyingContract, so a signature made for one
 * deployment cannot be replayed onto another. Replay within a deployment is
 * harmless: registration is idempotent and every attested value is a pure
 * function of the seed.
 */
export async function signAttestation(seed: string, opts: AttestOptions) {
  const { chainId, verifyingContract, privateKey } = opts;
  if (!chainId) throw new Error('chainId is required');
  if (!verifyingContract) throw new Error('verifyingContract is required');
  if (!privateKey) throw new Error('REGISTRAR_PRIVATE_KEY is not set');

  const derived = await deriveMaze(seed);
  const layout = bytesToHex(derived.layoutBytes);
  const account = privateKeyToAccount(privateKey);

  const signature = await account.signTypedData({
    domain: {
      name: 'MazeKing',
      version: '1',
      chainId: Number(chainId),
      verifyingContract: getAddress(verifyingContract) as `0x${string}`,
    },
    types: TYPES,
    primaryType: 'MazeAttestation',
    message: {
      mazeHash: derived.mazeHash,
      layoutHash: keccak256(layout),
      optimalMoves: derived.optimalMoves,
    },
  });

  return {
    seed,
    mazeHash: derived.mazeHash,
    tokenId: derived.tokenId.toString(),
    layout,
    optimalMoves: derived.optimalMoves,
    signature,
    registrar: account.address,
  };
}

/**
 * Serverless entry point. Purely stateless: nothing here coordinates with any
 * other invocation, because there is nothing to coordinate.
 */
export async function handle(event: {
  queryStringParameters?: { seed?: string };
  body?: string | { seed?: string };
}) {
  const fromBody =
    typeof event?.body === 'string'
      ? (JSON.parse(event.body) as { seed?: string }).seed
      : event?.body?.seed;
  const seed = event?.queryStringParameters?.seed ?? fromBody;

  if (!seed || typeof seed !== 'string') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'seed is required' }),
    };
  }

  try {
    const result = await signAttestation(seed, {
      chainId: process.env.CHAIN_ID as string,
      verifyingContract: process.env.NFT_ADDRESS as string,
      privateKey: process.env.REGISTRAR_PRIVATE_KEY as Hex,
    });
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    // An unsolvable or oversized seed is a client error rather than an outage:
    // deriveMaze refuses to attest a maze nobody could ever mint.
    return {
      statusCode: 422,
      body: JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
    };
  }
}

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

// `signAttestation` is imported by tests and by any serverless wrapper, so the
// CLI only runs when someone actually passed a seed on the command line.
if (arg('--seed')) {
  signAttestation(arg('--seed') as string, {
    chainId: arg('--chain-id', process.env.CHAIN_ID) as string,
    verifyingContract: arg('--contract', process.env.NFT_ADDRESS) as string,
    privateKey: process.env.REGISTRAR_PRIVATE_KEY as Hex,
  })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
