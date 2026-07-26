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
  tokenPath,
  tokenIdFromLocation,
} from '../seedUrl';

describe('seedToPath', () => {
  it('gives the default seed a path too, since / is the directions screen', () => {
    expect(seedToPath(DEFAULT_SEED)).toBe(
      `/s/${encodeURIComponent(DEFAULT_SEED)}`
    );
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
      expect(seedFromLocation(path, '')).toBe(seed);
    }
  });
});

describe('isGamePath', () => {
  it('recognises maze paths', () => {
    expect(isGamePath('/s/SNARK')).toBe(true);
  });

  it('recognises replay paths', () => {
    // Omitting this is what sent "play this maze" to the directions screen:
    // the game only renders on a game path, and a replay had none.
    expect(isGamePath('/m/12345')).toBe(true);
  });

  it('rejects the directions screen and the other pages', () => {
    expect(isGamePath('/')).toBe(false);
    expect(isGamePath('/gallery')).toBe(false);
    expect(isGamePath('/mazes')).toBe(false);
  });
});

describe('replay paths', () => {
  it('round trips a token id', () => {
    const id =
      961392101917757583158880915683360621570775338810754963585134247041933107395n;
    expect(tokenIdFromLocation(tokenPath(id))).toBe(id);
  });

  it('keeps full precision on ids far beyond Number.MAX_SAFE_INTEGER', () => {
    // Token ids are 256-bit hashes. Anything that round-trips through a
    // JavaScript number silently names a different maze.
    const id = 2n ** 255n + 7n;
    expect(tokenIdFromLocation(tokenPath(id))).toBe(id);
  });

  it('is not a seed path', () => {
    expect(seedFromLocation('/m/123', '')).toBeNull();
  });

  it('returns null for anything that is not a replay path', () => {
    expect(tokenIdFromLocation('/s/SNARK')).toBeNull();
    expect(tokenIdFromLocation('/m/')).toBeNull();
    expect(tokenIdFromLocation('/m/notanumber')).toBeNull();
    expect(tokenIdFromLocation('/m/12/34')).toBeNull();
    expect(tokenIdFromLocation('/')).toBeNull();
  });
});
