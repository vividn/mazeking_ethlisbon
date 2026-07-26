/**
 * Seed → maze derivation must be deterministic.
 *
 * This is the backbone of replay and competitive integrity: two players racing
 * the same seed must get byte-identical mazes, and the optimum used to award
 * the robot crown must be the same number every time it is computed. If this
 * drifts, leaderboards and badges silently become meaningless.
 *
 * It also guards the registrar CLI against the subtler failure: registering an
 * optimum computed from a *different* maze than the one players actually play.
 */
import { describe, it, expect } from 'vitest';
import { deriveMaze } from '../../../scripts/derive-maze';

const SEEDS = ['Zero Knowledge', 'Merkle Tree', 'SNARK'];

describe('registrar derivation', () => {
  it('is deterministic for the same seed', async () => {
    const a = await deriveMaze('Zero Knowledge');
    const b = await deriveMaze('Zero Knowledge');

    expect(b.mazeHash).toBe(a.mazeHash);
    expect(b.tokenId).toBe(a.tokenId);
    expect(b.optimalMoves).toBe(a.optimalMoves);
    expect(Array.from(b.layoutBytes)).toEqual(Array.from(a.layoutBytes));
  });

  it('gives distinct seeds distinct mazes', async () => {
    const derived = await Promise.all(SEEDS.map((s) => deriveMaze(s)));
    const hashes = new Set(derived.map((d) => d.mazeHash));
    expect(hashes.size).toBe(SEEDS.length);
  });

  it('always yields a solvable maze with a positive optimum', async () => {
    // optimalMoves === 0 is the exact condition that silently disables every
    // medal badge in DefaultBadgeAwarder (`if (optimal > 0)`), so a zero here
    // would ship a maze whose crown can never be won.
    for (const seed of SEEDS) {
      const d = await deriveMaze(seed);
      expect(d.optimalMoves).toBeGreaterThan(0);
    }
  });

  it('derives a tokenId that matches the mazeHash', async () => {
    const d = await deriveMaze('Merkle Tree');
    expect(d.tokenId).toBe(BigInt(d.mazeHash));
  });
});
