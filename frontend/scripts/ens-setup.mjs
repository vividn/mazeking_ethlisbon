/**
 * Point `mazeking.eth` at the deployed game.
 *
 * Sets, on the ENS public resolver (Ethereum mainnet):
 *   - a CHAIN-SPECIFIC address record (ENSIP-11) for the deployment chain
 *   - text records: url / description / avatar
 *
 * Run with the account that owns the name.
 *
 *   node scripts/ens-setup.mjs \
 *     --contract 0x... --chain-id 1101 \
 *     --url https://mazeking.example --avatar https://.../maze.svg \
 *     --key 0x... [--dry-run]
 *
 * ── Why NOT the plain addr() record ──────────────────────────────────────
 *
 * The obvious move is `setAddr(node, contract)`, which writes coinType 60 —
 * the *Ethereum mainnet* address. Do not do that with an L2 contract address.
 * Wallets resolving `mazeking.eth` on mainnet would offer to send funds to an
 * address that holds no contract on mainnet, and those funds are gone.
 *
 * ENSIP-11 exists for exactly this: coinType = 0x80000000 | chainId, so the
 * Polygon zkEVM (1101) record is 2147484749. Tools that understand
 * multichain resolution find the contract on the right chain; mainnet wallets
 * keep resolving coinType 60 to whatever you already had (your EOA), which is
 * the safe answer.
 *
 * This script refuses to touch coinType 60 unless --force-mainnet-addr is
 * passed AND the deployment chain really is mainnet.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  namehash,
  getAddress,
} from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

const REGISTRY_ABI = [
  {
    name: 'resolver',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
];

const RESOLVER_ABI = [
  {
    name: 'setAddr',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'coinType', type: 'uint256' },
      { name: 'a', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'addr',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'coinType', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes' }],
  },
  {
    name: 'setText',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'text',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'string' }],
  },
];

/**
 * ENSIP-11: a chain's coinType is 0x80000000 | chainId.
 *
 * Computed in BigInt deliberately. JavaScript's bitwise operators coerce to
 * SIGNED 32-bit ints, so `0x80000000 | 1101` is -2147482547, not 2147484749 —
 * a silently wrong record written to mainnet. Do not "simplify" this.
 */
export function coinTypeForChain(chainId) {
  if (chainId === 1) return 60n; // mainnet keeps the legacy ETH coinType
  return 0x80000000n | BigInt(chainId);
}

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const name = arg('--name', 'mazeking.eth');
  const contract = arg('--contract');
  const chainId = Number(arg('--chain-id', '1101'));
  const url = arg('--url');
  const description = arg(
    '--description',
    'Solve the maze, prove it, mint the crown.'
  );
  const avatar = arg('--avatar');
  const rpc = arg('--rpc', 'https://ethereum-rpc.publicnode.com');
  const key = arg('--key');
  const dryRun = process.argv.includes('--dry-run');
  const forceMainnetAddr = process.argv.includes('--force-mainnet-addr');

  if (!contract) throw new Error('--contract is required');
  const contractAddress = getAddress(contract);
  const node = namehash(name);
  const coinType = coinTypeForChain(chainId);

  if (coinType === 60n && !forceMainnetAddr) {
    throw new Error(
      'Refusing to write the mainnet addr() record (coinType 60) for a ' +
        'contract on chain 1 without --force-mainnet-addr. On any other ' +
        'chain this would point mainnet wallets at an address holding no ' +
        'contract, and funds sent there would be lost.'
    );
  }

  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(rpc),
  });

  const resolver = await publicClient.readContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'resolver',
    args: [node],
  });
  const owner = await publicClient.readContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'owner',
    args: [node],
  });

  console.log(`name:        ${name}`);
  console.log(`node:        ${node}`);
  console.log(`owner:       ${owner}`);
  console.log(`resolver:    ${resolver}`);
  console.log(`chainId:     ${chainId}`);
  console.log(`coinType:    ${coinType}  (ENSIP-11)`);
  console.log(`contract:    ${contractAddress}`);

  if (resolver === '0x0000000000000000000000000000000000000000') {
    throw new Error(
      `No resolver set for ${name}. Set one in the ENS app before running this.`
    );
  }

  const texts = Object.entries({ url, description, avatar }).filter(
    ([, v]) => v
  );

  if (dryRun) {
    console.log('\n--dry-run. Would write:');
    console.log(`  setAddr(node, ${coinType}, ${contractAddress})`);
    for (const [k, v] of texts) console.log(`  setText(node, "${k}", "${v}")`);
    return;
  }

  if (!key) throw new Error('--key is required (unless --dry-run)');
  const account = privateKeyToAccount(key);
  if (getAddress(account.address) !== getAddress(owner)) {
    throw new Error(
      `Signer ${account.address} does not own ${name} (owner is ${owner}). ` +
        `The resolver will reject these writes.`
    );
  }

  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http(rpc),
  });

  const send = async (functionName, args, label) => {
    const hash = await walletClient.writeContract({
      address: resolver,
      abi: RESOLVER_ABI,
      functionName,
      args,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${label}: ${receipt.status} (${hash})`);
  };

  console.log('\nwriting:');
  await send(
    'setAddr',
    [node, coinType, contractAddress],
    `addr[${coinType}]`
  );
  for (const [k, v] of texts) {
    await send('setText', [node, k, v], `text[${k}]`);
  }

  console.log(`\ndone — ${name} now resolves to the game on chain ${chainId}.`);
}

// Only run the CLI outside the test runner — `coinTypeForChain` is imported
// by ensCoinType.test.ts, and an unguarded main() would fire on import and
// exit the worker on the missing --contract.
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
