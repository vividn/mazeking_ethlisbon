/**
 * Smoke tests for proverInput.generated.ts (codegen'd from circuit ABI).
 *
 * The TypeScript compiler enforces shape agreement at the type level
 * (see `generateProverInput` in `zkSerialize.ts`). These runtime checks
 * pin two further invariants:
 *
 *   1. The generated KEYS array is non-empty and contains the parameters
 *      that the circuit publishes (hash-as-public-input architecture).
 *   2. The runtime keys list matches the actual return shape of
 *      `generateProverInput` exactly — no missing, no extra. This catches
 *      a future regression where someone bypasses the codegen by editing
 *      `generateProverInput` directly without regenerating the type.
 *
 * Wider drift detection lives in:
 *   - scripts/check-abi-drift.js (count + cross-language)
 *   - just verify-prover-input-types (regen + git-diff)
 *   - the TS type system itself (compile-time field shape)
 */
import { describe, expect, it } from 'vitest';
import {
  PROVER_INPUT_KEYS,
  PROVER_PUBLIC_INPUT_KEYS,
  type ProverInputCircuit,
} from '../proverInput.generated';
import {
  createTestMaze,
  generateProverInput,
  serializeForZk,
} from '../zkSerialize';

describe('proverInput.generated.ts (codegen from circuit ABI)', () => {
  it('PROVER_INPUT_KEYS is non-empty and includes both hash-as-public-input fields', () => {
    expect(PROVER_INPUT_KEYS.length).toBeGreaterThan(0);
    expect(PROVER_INPUT_KEYS).toContain('maze_hash');
    expect(PROVER_INPUT_KEYS).toContain('move_count');
  });

  it('PROVER_PUBLIC_INPUT_KEYS is exactly [maze_hash, move_count, sender]', () => {
    // Hash-as-public-input architecture (ma-6cr.6). If this ever fails,
    // it's the same class of breakage as ma-3xv would catch on the count
    // side: the circuit's `pub` markers and the on-chain
    // PUBLIC_INPUTS_LENGTH must move together with this array.
    expect([...PROVER_PUBLIC_INPUT_KEYS]).toEqual([
      'maze_hash',
      'move_count',
      'sender',
    ]);
  });

  it('generateProverInput returns an object whose keys equal PROVER_INPUT_KEYS exactly', () => {
    // Build a minimal valid input. We don't care about the values — we're
    // asserting that every codegen'd key is populated and no stray keys
    // leaked in.
    const { maze, startPos, robePos, scepterPos, goalPos, solution } =
      createTestMaze();
    const zk = serializeForZk(maze, startPos, robePos, scepterPos, goalPos);
    const placeholderHash =
      '0x0000000000000000000000000000000000000000000000000000000000000000' as const;
    const placeholderSender =
      '0x00000000000000000000000000000000000000ff' as const;
    const input = generateProverInput(
      zk,
      solution,
      placeholderHash,
      placeholderSender
    );

    const actual = Object.keys(input).sort();
    const expected = [...PROVER_INPUT_KEYS].sort();
    expect(actual).toEqual(expected);
  });

  it('PROVER_INPUT_KEYS keys are typed as keyof ProverInputCircuit', () => {
    // Compile-time only: this would not type-check if the `as const
    // satisfies` clause in the generated file were broken or if a key
    // string were misspelled.
    const k: keyof ProverInputCircuit = PROVER_INPUT_KEYS[0];
    expect(k).toBe('maze_hash');
  });
});
