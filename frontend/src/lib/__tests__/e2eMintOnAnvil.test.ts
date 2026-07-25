/**
 * End-to-end mint regression: real proof + real on-chain verifier.
 *
 * What this catches that the lower tiers do not:
 *   - `e2eSolveProve` fast tier stops at witness generation (no proof).
 *   - `e2eSolveProve` full tier stops at off-chain UltraHonk verifyProof.
 *     Neither covers verifier-bytecode drift, mintWithProof ABI/calldata
 *     mismatches, or the layout/mazeHash binding that the NFT contract
 *     trusts on first mint.
 *   - The Solidity-side `MazeKingNFTTest` uses a `MockVerifier` that
 *     always returns true, so it never exercises the real verifier.
 *
 * This test bridges the gap: it generates a real Honk proof off-chain and
 * submits it to the actual deployed `HonkVerifier` via `mintWithProof`.
 * If the on-chain VK has drifted from the circuit, or if proof byte
 * encoding diverges between bb.js and the generated Solidity verifier,
 * this test fails — exactly the class of bug that bit us in ma-6ff.
 *
 * Slow (deploys contracts + generates real proof, ~tens of seconds):
 * targeted at nightly / main-branch CI, not per-PR.
 *
 * Run via `just test-e2e-mint`, which orchestrates anvil + verifier
 * regen + deploy and then sets `RUN_E2E_MINT=1` for this file.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { Noir, type CompiledCircuit, type InputMap } from '@noir-lang/noir_js';
import { UltraHonkBackend } from '@aztec/bb.js';
import { findOptimalPath } from '../mazeSolver';
import {
  createTestMaze,
  generateProverInput,
  serializeForZk,
  UNBOUND_SENDER,
} from '../zkSerialize';
import { computeMazeHash } from '../mazeIdentity';
import { serializeLayoutBytes } from '../tokenId';
import MazeKingNFTAbi from '../abi/MazeKingNFT.json';

const PROJECT_ROOT = resolve(__dirname, '../../../..');
const DEPLOYMENT_PATH = resolve(
  PROJECT_ROOT,
  'contracts/deployments/31337.json'
);
const CIRCUIT_PATH = resolve(
  PROJECT_ROOT,
  'maze_prover/target/maze_prover.json'
);

const ANVIL_RPC = process.env.ANVIL_RPC ?? 'http://127.0.0.1:8545';
// Anvil's well-known account #0. Public dev key — never used outside local
// chains. The `just deploy-local` recipe defaults to this same key, so the
// account that minted the NFT here is also the deployer/owner.
const DEPLOYER_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

// Anvil account #1 — a different account from the deployer, used to prove
// that an unbound proof really is spendable by anyone holding it.
const BEARER_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

const RUN_MINT = process.env.RUN_E2E_MINT === '1';

function bytesToHex(bytes: Uint8Array): Hex {
  let hex = '0x';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex as Hex;
}

describe.runIf(RUN_MINT)(
  'e2e solve → prove → mint on anvil (RUN_E2E_MINT=1)',
  () => {
    let circuit: CompiledCircuit;
    let nftAddress: Address;
    let verifierAddress: Address;

    beforeAll(async () => {
      let deploymentRaw: string;
      try {
        deploymentRaw = await readFile(DEPLOYMENT_PATH, 'utf8');
      } catch (err) {
        throw new Error(
          `Missing ${DEPLOYMENT_PATH}. Run \`just deploy-local\` (or ` +
            `\`just test-e2e-mint\`) first to deploy contracts to anvil. ` +
            `Underlying error: ${(err as Error).message}`
        );
      }
      const deployment = JSON.parse(deploymentRaw);
      nftAddress = deployment.nft as Address;
      verifierAddress = deployment.verifier as Address;

      const circuitRaw = await readFile(CIRCUIT_PATH, 'utf8');
      circuit = JSON.parse(circuitRaw) as CompiledCircuit;
    });

    it('proves the test maze and mints with tokenId == uint256(mazeHash)', async () => {
      const { maze, startPos, robePos, scepterPos, goalPos } = createTestMaze();
      const path = findOptimalPath(
        maze,
        startPos,
        robePos,
        scepterPos,
        goalPos
      );
      expect(path).not.toBeNull();

      // 1. Build prover input (same path as the frontend uses).
      //    The account is derived first because the proof is bound to the
      //    address that will submit the mint — proving for one address and
      //    minting from another is exactly what the binding rejects.
      const account = privateKeyToAccount(DEPLOYER_PRIVATE_KEY);
      const zk = serializeForZk(maze, startPos, robePos, scepterPos, goalPos);
      const layoutBytes = serializeLayoutBytes(zk);
      const mazeHash = await computeMazeHash(layoutBytes);
      const proverInput = generateProverInput(
        zk,
        path!,
        mazeHash,
        account.address
      );

      // 2. Witness + proof. `keccak: true` matches the deployed verifier
      //    (HonkVerifier with keccak transcript) — same flag the frontend
      //    uses in proofService.ts.
      const noir = new Noir(circuit);
      const { witness } = await noir.execute(
        proverInput as unknown as InputMap
      );

      const backend = new UltraHonkBackend(circuit.bytecode);
      let proofBytes: Uint8Array;
      try {
        const result = await backend.generateProof(witness, { keccak: true });
        proofBytes = result.proof;
      } finally {
        await backend.destroy();
      }

      // 3. Wire viem against anvil.
      const transport = http(ANVIL_RPC);
      const publicClient = createPublicClient({ chain: foundry, transport });
      const walletClient = createWalletClient({
        account,
        chain: foundry,
        transport,
      });

      // Sanity: the NFT we're about to call points at the verifier we
      // deployed. Catches stale deployments/31337.json from a previous run
      // where redeploy reused only one of the contract addresses.
      const verifierFromNft = (await publicClient.readContract({
        address: nftAddress,
        abi: MazeKingNFTAbi,
        functionName: 'verifierContract',
      })) as Address;
      expect(verifierFromNft.toLowerCase()).toBe(verifierAddress.toLowerCase());

      const proofHex = bytesToHex(proofBytes);
      const layoutHex = bytesToHex(layoutBytes);
      const moveCount = proverInput.move_count;
      const expectedTokenId = BigInt(mazeHash);

      // 4. Mint. If the verifier rejects the proof or the calldata shape
      //    drifts, this throws here — surfacing the real revert reason
      //    rather than masking it as a gas-estimation failure.
      const txHash = await walletClient.writeContract({
        address: nftAddress,
        abi: MazeKingNFTAbi,
        functionName: 'mintWithProof',
        // false = bound proof: publicInputs[2] carries this account.
        args: [proofHex, mazeHash, layoutHex, moveCount, false],
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      expect(receipt.status).toBe('success');

      // 5. Assert the contract state is what the bead description requires.
      const balance = (await publicClient.readContract({
        address: nftAddress,
        abi: MazeKingNFTAbi,
        functionName: 'balanceOf',
        args: [account.address, expectedTokenId],
      })) as bigint;
      expect(balance).toBe(1n);

      const stats = (await publicClient.readContract({
        address: nftAddress,
        abi: MazeKingNFTAbi,
        functionName: 'stats',
        args: [expectedTokenId, account.address],
      })) as readonly [number, number, number, bigint];
      const [minMoves, timesSolved] = stats;
      expect(minMoves).toBe(moveCount);
      expect(timesSolved).toBe(1);

      // The NFT stores the canonical layout on first mint — verifying it
      // round-trips exactly catches any silent re-encoding by viem on the
      // way in.
      const storedLayout = (await publicClient.readContract({
        address: nftAddress,
        abi: MazeKingNFTAbi,
        functionName: 'layouts',
        args: [expectedTokenId],
      })) as Hex;
      expect(storedLayout.toLowerCase()).toBe(layoutHex.toLowerCase());
    }, 600_000);

    // The "practice proof" path: a player solves without a wallet connected,
    // so the proof commits to UNBOUND_SENDER instead of an address. It must
    // still verify against the real on-chain verifier when submitted with
    // bearer = true — and, being unbound, it must work from an account that
    // had nothing to do with producing it.
    it('mints a wallet-less practice proof via the bearer path', async () => {
      const { maze, startPos, robePos, scepterPos, goalPos } = createTestMaze();
      const path = findOptimalPath(
        maze,
        startPos,
        robePos,
        scepterPos,
        goalPos
      );
      expect(path).not.toBeNull();

      const zk = serializeForZk(maze, startPos, robePos, scepterPos, goalPos);
      const layoutBytes = serializeLayoutBytes(zk);
      const mazeHash = await computeMazeHash(layoutBytes);
      // No address — exactly what the UI does before a wallet connects.
      const proverInput = generateProverInput(
        zk,
        path!,
        mazeHash,
        UNBOUND_SENDER
      );

      const noir = new Noir(circuit);
      const { witness } = await noir.execute(
        proverInput as unknown as InputMap
      );
      const backend = new UltraHonkBackend(circuit.bytecode);
      let proofBytes: Uint8Array;
      try {
        const result = await backend.generateProof(witness, { keccak: true });
        proofBytes = result.proof;
      } finally {
        await backend.destroy();
      }

      // Deliberately submit from a DIFFERENT account than any notion of an
      // author: an unbound proof belongs to whoever holds it.
      const bearerAccount = privateKeyToAccount(BEARER_PRIVATE_KEY);
      const transport = http(ANVIL_RPC);
      const publicClient = createPublicClient({ chain: foundry, transport });
      const walletClient = createWalletClient({
        account: bearerAccount,
        chain: foundry,
        transport,
      });

      const txHash = await walletClient.writeContract({
        address: nftAddress,
        abi: MazeKingNFTAbi,
        functionName: 'mintWithProof',
        args: [
          bytesToHex(proofBytes),
          mazeHash,
          bytesToHex(layoutBytes),
          proverInput.move_count,
          true, // bearer
        ],
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      expect(receipt.status).toBe('success');
      expect(
        (await publicClient.readContract({
          address: nftAddress,
          abi: MazeKingNFTAbi,
          functionName: 'balanceOf',
          args: [bearerAccount.address, BigInt(mazeHash)],
        })) as bigint
      ).toBe(1n);
    }, 600_000);
  }
);
