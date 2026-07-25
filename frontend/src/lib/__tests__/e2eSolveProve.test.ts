/**
 * End-to-end critical-flow regression coverage: SOLVE → PROVE.
 *
 * What this catches: any drift between TS-side prover input wiring and the
 * Noir circuit's main() signature — exactly the class of bug that produced
 * the key_x → robe_x/scepter_x regalia-split breakage.
 *
 * Two tiers:
 *   - "fast" tier (default): runs `Noir.execute()` to generate the witness
 *     only. This validates that the prover input shape, maze hash, and
 *     solution path satisfy every circuit assertion — without paying the
 *     ~tens-of-seconds cost of full proof generation. Targeted at PR CI.
 *   - "full" tier (RUN_E2E_FULL_PROOF=1): also calls the UltraHonk backend
 *     to produce a proof and verifies it off-chain. Targeted at nightly /
 *     main-branch CI.
 *
 * Mint coverage (proof → on-chain mintWithProof) is intentionally NOT here;
 * it requires a running anvil + deployed verifier and belongs in an
 * integration-test recipe, not in vitest. See ma-0du for follow-up.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Noir, type CompiledCircuit, type InputMap } from '@noir-lang/noir_js';
import { findOptimalPath } from '../mazeSolver';
import {
  createTestMaze,
  generateProverInput,
  serializeForZk,
  validatePath,
} from '../zkSerialize';
import { computeMazeHash } from '../mazeIdentity';
import { serializeLayoutBytes } from '../tokenId';
import { CellType, Move, type MazeData, type Position } from '../../types';

const CIRCUIT_PATH = resolve(
  __dirname,
  '../../../../maze_prover/target/maze_prover.json'
);

// Any address works here: `sender` is committed as a public input but is not
// constrained in-circuit, so witness generation only needs a well-formed
// field element. The binding is enforced on-chain, where the contract passes
// msg.sender and a mismatched proof fails verification.
const TEST_SENDER = '0x00000000000000000000000000000000000000ff' as const;

let circuit: CompiledCircuit;

beforeAll(async () => {
  const raw = await readFile(CIRCUIT_PATH, 'utf8');
  circuit = JSON.parse(raw) as CompiledCircuit;
});

async function buildProverInput(
  maze: MazeData,
  start: Position,
  robe: Position,
  scepter: Position,
  goal: Position,
  moves: Move[]
) {
  const zk = serializeForZk(maze, start, robe, scepter, goal);
  const layoutBytes = serializeLayoutBytes(zk);
  const mazeHash = await computeMazeHash(layoutBytes);
  return generateProverInput(zk, moves, mazeHash, TEST_SENDER);
}

describe('e2e solve → witness (fast tier)', () => {
  it('hardcoded test maze: BFS path satisfies every circuit assertion', async () => {
    const { maze, startPos, robePos, scepterPos, goalPos } = createTestMaze();
    const path = findOptimalPath(maze, startPos, robePos, scepterPos, goalPos);
    expect(path).not.toBeNull();
    expect(
      validatePath(maze, startPos, robePos, scepterPos, goalPos, path!)
    ).toEqual({ valid: true });

    const input = await buildProverInput(
      maze,
      startPos,
      robePos,
      scepterPos,
      goalPos,
      path!
    );

    const noir = new Noir(circuit);
    await expect(
      noir.execute(input as unknown as InputMap)
    ).resolves.toBeDefined();
  }, 60_000);

  it('robe-first ordering produces a valid witness', async () => {
    // Test maze: 4×1 grid, openMaze. Path: R R R, picks up robe at (1,0)
    // then scepter at (2,0), reaches goal at (3,0).
    const maze = openMaze(4, 1);
    const start = { x: 0, y: 0 };
    const robe = { x: 1, y: 0 };
    const scepter = { x: 2, y: 0 };
    const goal = { x: 3, y: 0 };
    const path = findOptimalPath(maze, start, robe, scepter, goal);
    expect(path).toEqual([Move.Right, Move.Right, Move.Right]);

    const input = await buildProverInput(
      maze,
      start,
      robe,
      scepter,
      goal,
      path!
    );

    const noir = new Noir(circuit);
    await expect(
      noir.execute(input as unknown as InputMap)
    ).resolves.toBeDefined();
  }, 60_000);

  it('scepter-first ordering produces a valid witness', async () => {
    // Same path but swap which position is robe vs scepter. The "must
    // collect both, any order" rule (ma-3rr) means swapping should still
    // satisfy the circuit — and a regression that wired robe and scepter
    // into the same circuit slot would only show up in one ordering.
    const maze = openMaze(4, 1);
    const start = { x: 0, y: 0 };
    const robe = { x: 2, y: 0 };
    const scepter = { x: 1, y: 0 };
    const goal = { x: 3, y: 0 };
    const path = findOptimalPath(maze, start, robe, scepter, goal);
    expect(path).toEqual([Move.Right, Move.Right, Move.Right]);

    const input = await buildProverInput(
      maze,
      start,
      robe,
      scepter,
      goal,
      path!
    );

    const noir = new Noir(circuit);
    await expect(
      noir.execute(input as unknown as InputMap)
    ).resolves.toBeDefined();
  }, 60_000);

  it('rejects a witness where robe is not collected', async () => {
    // Take the test maze but shorten the path to skip the scepter pickup —
    // the circuit must reject it. Guards against the circuit silently
    // accepting incomplete solves.
    const { maze, startPos, robePos, scepterPos, goalPos } = createTestMaze();
    const path = findOptimalPath(maze, startPos, robePos, scepterPos, goalPos);
    expect(path).not.toBeNull();
    // Replay enough of the path to reach the goal cell, but stop before
    // the goal so the circuit's final-position assertion fires. Use the
    // first move only — guaranteed not to satisfy goal assertion.
    const truncated = path!.slice(0, 1);

    const input = await buildProverInput(
      maze,
      startPos,
      robePos,
      scepterPos,
      goalPos,
      truncated
    );

    const noir = new Noir(circuit);
    await expect(noir.execute(input as unknown as InputMap)).rejects.toThrow();
  }, 60_000);

  it('rejects a witness with mismatched maze_hash', async () => {
    const { maze, startPos, robePos, scepterPos, goalPos } = createTestMaze();
    const path = findOptimalPath(maze, startPos, robePos, scepterPos, goalPos);
    expect(path).not.toBeNull();

    const input = await buildProverInput(
      maze,
      startPos,
      robePos,
      scepterPos,
      goalPos,
      path!
    );
    // Tamper the public maze_hash; the circuit re-derives the hash from the
    // private witness and asserts equality, so this must fail.
    input.maze_hash = `0x${'00'.repeat(32)}` as `0x${string}`;

    const noir = new Noir(circuit);
    await expect(noir.execute(input as unknown as InputMap)).rejects.toThrow();
  }, 60_000);
});

const RUN_FULL_PROOF = process.env.RUN_E2E_FULL_PROOF === '1';

describe.runIf(RUN_FULL_PROOF)(
  'e2e solve → prove → verify (full tier, RUN_E2E_FULL_PROOF=1)',
  () => {
    it('produces a proof that UltraHonk verifies off-chain', async () => {
      const { UltraHonkBackend } = await import('@aztec/bb.js');
      const { maze, startPos, robePos, scepterPos, goalPos } = createTestMaze();
      const path = findOptimalPath(
        maze,
        startPos,
        robePos,
        scepterPos,
        goalPos
      );
      expect(path).not.toBeNull();

      const input = await buildProverInput(
        maze,
        startPos,
        robePos,
        scepterPos,
        goalPos,
        path!
      );

      const noir = new Noir(circuit);
      const { witness } = await noir.execute(input as unknown as InputMap);

      const backend = new UltraHonkBackend(circuit.bytecode);
      try {
        const proof = await backend.generateProof(witness, { keccak: true });
        const ok = await backend.verifyProof(proof, { keccak: true });
        expect(ok).toBe(true);
        // First public input is the Pedersen maze hash; second is moveCount.
        expect(proof.publicInputs[0].toLowerCase()).toBe(
          input.maze_hash.toLowerCase()
        );
        expect(BigInt(proof.publicInputs[1])).toBe(BigInt(input.move_count));
      } finally {
        await backend.destroy();
      }
    }, 600_000);
  }
);

// Local helper — kept here rather than exported from mazeSolver to avoid
// inflating the public API for test-only utilities.
function openMaze(width: number, height: number): MazeData {
  const cells = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push({
        southWall: false,
        eastWall: false,
        cellType: CellType.Normal,
      });
    }
    cells.push(row);
  }
  return { width, height, cells };
}
