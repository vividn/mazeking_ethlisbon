/**
 * Registrar CLI — register an official maze and light the badge fuse.
 *
 * Why this exists: MazeKingNFT already ships the whole badge system (bitfield,
 * pluggable IBadgeAwarder, ROBOT/GOLD/SILVER/COPPER constants) and calls the
 * awarder on every mint. But DefaultBadgeAwarder gates every medal behind
 * `if (optimalMoves[tokenId] > 0)`, and nothing in the repo ever called
 * `setOptimalMoves`. The result was a badge system that ran on every mint and
 * awarded nothing — verified on a live mint: badges 0, optimalMoves 0.
 *
 * This script computes the true optimum off-chain and registers it, which is
 * what makes the robot crown reachable.
 *
 * The optimum is a BFS over the product graph (x, y, hasRobe, hasScepter) —
 * `findOptimalPath`. A naive start→goal shortest path would under-count,
 * because a maze requires collecting BOTH the robe and the scepter first, and
 * an under-counted optimum hands out robot crowns to imperfect solves.
 *
 * It deliberately reuses the frontend's own generator/serializer/solver rather
 * than reimplementing them. Seed→layout consistency is the backbone of replay
 * and competitive integrity; a second implementation is a second chance to
 * drift.
 *
 * Usage:
 *   pnpm exec vite-node scripts/register-maze.ts -- \
 *     --seed "Zero Knowledge" --nft 0x... --rpc http://127.0.0.1:8545 \
 *     --key 0x... [--dry-run]
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { deriveMaze, bytesToHex } from './derive-maze';
import MazeKingNFTAbi from '../src/lib/abi/MazeKingNFT.json';

interface Args {
  seed: string;
  nft: Address;
  rpc: string;
  key?: Hex;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const seed = get('--seed');
  const nft = get('--nft');
  const rpc = get('--rpc') ?? 'http://127.0.0.1:8545';
  const key = get('--key');
  const dryRun = argv.includes('--dry-run');

  if (!seed) throw new Error('--seed is required');
  if (!dryRun && !nft) throw new Error('--nft is required (unless --dry-run)');
  if (!dryRun && !key) throw new Error('--key is required (unless --dry-run)');

  return {
    seed,
    nft: (nft ?? '0x') as Address,
    rpc,
    key: key as Hex | undefined,
    dryRun,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const derived = await deriveMaze(args.seed);

  console.log(`seed:         "${args.seed}"`);
  console.log(`dimensions:   ${derived.width}x${derived.height}`);
  console.log(`mazeHash:     ${derived.mazeHash}`);
  console.log(`tokenId:      ${derived.tokenId}`);
  console.log(`optimalMoves: ${derived.optimalMoves}`);

  if (args.dryRun) {
    console.log('\n--dry-run: nothing sent on-chain.');
    return;
  }

  const account = privateKeyToAccount(args.key!);
  const transport = http(args.rpc);
  const publicClient = createPublicClient({ transport });
  const walletClient = createWalletClient({ account, transport });
  const chainId = await publicClient.getChainId();

  console.log(`\nregistrar:    ${account.address}`);
  console.log(`nft:          ${args.nft}`);
  console.log(`chainId:      ${chainId}`);

  const send = async (functionName: string, params: unknown[]) => {
    const hash = await walletClient.writeContract({
      address: args.nft,
      abi: MazeKingNFTAbi,
      functionName,
      args: params,
      chain: null,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${functionName}: ${receipt.status} (${hash})`);
    return receipt;
  };

  // Idempotent: registerMaze reverts with "Already registered" on a repeat, so
  // check first and let re-runs be safe. Everything else is a plain overwrite.
  // officialMazes is keyed by keccak256(seed), not the raw string — passing
  // the string would silently always miss and make every re-run revert.
  const seedHash = keccak256(toBytes(args.seed));
  const existing = (await publicClient.readContract({
    address: args.nft,
    abi: MazeKingNFTAbi,
    functionName: 'officialMazes',
    args: [seedHash],
  })) as bigint;

  console.log('\nregistering:');
  if (existing && existing !== 0n) {
    console.log(`  registerMaze: skipped (seed already registered)`);
  } else {
    await send('registerMaze', [args.seed, derived.tokenId]);
  }

  // The layout must be registrar-authoritative — a minter supplying their own
  // layout bytes was the render-spoof closed in ma-cb4.
  await send('setLayout', [derived.tokenId, bytesToHex(derived.layoutBytes)]);

  // The fuse itself. Without this every medal badge is unreachable.
  await send('setOptimalMoves', [derived.tokenId, derived.optimalMoves]);

  // Gates BADGE_REGISTERED.
  await send('setRegistrarApproved', [derived.tokenId, true]);

  console.log('\ndone — this maze can now award badges, robot crown included.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
