/**
 * The seed string is hashed to produce the maze, so URL handling has to be
 * lossless. A seed that survives a round trip with different characters is a
 * different maze — and, for a registered seed, one that no longer matches the
 * on-chain registration.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SEED,
  seedToPath,
  seedFromLocation,
  isGamePath,
} from '../seedUrl';

describe('seedToPath', () => {
  it('keeps the default seed at the root', () => {
    expect(seedToPath(DEFAULT_SEED)).toBe('/');
  });

  it('uses /s/ for a named seed', () => {
    expect(seedToPath('SNARK')).toBe('/s/SNARK');
  });

  it('encodes spaces rather than dropping or replacing them', () => {
    // 'Zero Knowledge' is a registered maze; 'zero-knowledge' would be a
    // different string and therefore a different, unregistered maze.
    expect(seedToPath('Zero Knowledge')).toBe('/s/Zero%20Knowledge');
  });

  it('encodes characters that would otherwise change the path', () => {
    expect(seedToPath('a/b')).toBe('/s/a%2Fb');
    expect(seedToPath('a?b')).toBe('/s/a%3Fb');
    expect(seedToPath('a#b')).toBe('/s/a%23b');
  });
});

describe('seedFromLocation', () => {
  it('reads a seed from the canonical path', () => {
    expect(seedFromLocation('/s/SNARK', '')).toBe('SNARK');
  });

  it('decodes an encoded seed exactly', () => {
    expect(seedFromLocation('/s/Zero%20Knowledge', '')).toBe('Zero Knowledge');
  });

  it('still reads the legacy query form', () => {
    expect(seedFromLocation('/', '?seed=Zero%20Knowledge')).toBe(
      'Zero Knowledge'
    );
  });

  it('returns null at the root with no seed', () => {
    expect(seedFromLocation('/', '')).toBeNull();
    expect(seedFromLocation('/gallery', '')).toBeNull();
  });

  it('survives a malformed escape rather than throwing', () => {
    // '%zz' is not a valid escape; decodeURIComponent would throw.
    expect(seedFromLocation('/s/%zz', '')).toBe('%zz');
  });
});

describe('round trip', () => {
  it('preserves every seed exactly', () => {
    for (const seed of [
      'SNARK',
      'Zero Knowledge',
      'Merkle Tree',
      DEFAULT_SEED,
      'a/b?c#d',
      'emoji 🐈 seed',
      '  padded  ',
    ]) {
      const path = seedToPath(seed);
      const back = seedFromLocation(path, '');
      expect(back ?? DEFAULT_SEED).toBe(seed);
    }
  });
});

describe('isGamePath', () => {
  it('recognises the game routes', () => {
    expect(isGamePath('/')).toBe(true);
    expect(isGamePath('/s/SNARK')).toBe(true);
  });

  it('rejects the others', () => {
    expect(isGamePath('/gallery')).toBe(false);
    expect(isGamePath('/mazes')).toBe(false);
  });
});
