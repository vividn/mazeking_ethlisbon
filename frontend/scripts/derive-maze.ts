/**
 * Seed -> maze derivation, shared by every registrar tool.
 *
 * This lives on its own rather than inside one of the CLIs because both the
 * register CLI and the attestation signer need it, and a script that imports
 * another script also runs that script's argument parsing. It is also the one
 * place where seed->layout consistency is decided, which is the backbone of
 * replay and competitive integrity, so it is worth being a named module rather
 * than a detail of whichever tool happened to define it first.
 *
 * It deliberately reuses the game's own generator, serializer and solver
 * instead of reimplementing them. A second implementation is a second chance
 * to drift, and a registry that disagrees with the game about what a seed
 * produces is worse than no registry at all.
 */
import type { Hex } from 'viem';
import { generateMaze } from '../src/lib/mazeGenerator';
import { isDebugSeedActive } from '../src/lib/debugSeed';
import { serializeForZk } from '../src/lib/zkSerialize';
import {
  serializeLayoutBytes,
  computeTokenIdFromMazeHash,
} from '../src/lib/tokenId';
import { computeMazeHash } from '../src/lib/mazeIdentity';
import { findOptimalPath } from '../src/lib/mazeSolver';

/** Hex encoding for the layout blob, which the contract takes as `bytes`. */
export function bytesToHex(bytes: Uint8Array): Hex {
  let hex = '0x';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex as Hex;
}

/**
 * Derive everything the registry needs from a seed alone. Pure and
 * deterministic: the same seed must always yield the same layout, hash and
 * optimum, or replay integrity is gone.
 *
 * The optimum is a BFS over the product graph (x, y, hasRobe, hasScepter) --
 * `findOptimalPath`. A naive start->goal shortest path would under-count,
 * because a maze requires collecting BOTH the robe and the scepter first, and
 * an under-counted optimum hands out robot crowns to imperfect solves.
 */
export async function deriveMaze(seed: string) {
  const { maze, kingPos, robePos, scepterPos, goalPos } = generateMaze(seed, {
    debug: isDebugSeedActive(seed),
  });

  const zk = serializeForZk(maze, kingPos, robePos, scepterPos, goalPos);
  const layoutBytes = serializeLayoutBytes(zk);
  const mazeHash = await computeMazeHash(layoutBytes);
  const tokenId = computeTokenIdFromMazeHash(mazeHash);

  const path = findOptimalPath(maze, kingPos, robePos, scepterPos, goalPos);
  if (!path) {
    throw new Error(
      `Seed "${seed}" generated an unsolvable maze — refusing to register it. ` +
        `Registering an unsolvable maze would mean nobody can ever mint it.`
    );
  }

  return {
    layoutBytes,
    mazeHash,
    tokenId,
    optimalMoves: path.length,
    width: zk.width,
    height: zk.height,
  };
}
