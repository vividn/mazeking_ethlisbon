/**
 * Badge decoding must stay in lockstep with MazeKingNFT.sol's bitfield.
 * A drifted bit would silently show players the wrong achievement — worse
 * than showing none, because it looks authoritative.
 */
import { describe, it, expect } from 'vitest';
import {
  BADGE_REGISTERED,
  BADGE_ROBOT,
  BADGE_GOLD,
  BADGE_SILVER,
  BADGE_COPPER,
  BADGE_STONE,
  BADGE_BUG,
  decodeBadges,
  hasRobotCrown,
  hasBugCrown,
  bestBadge,
} from '../badges';

describe('badge bits', () => {
  it('match the contract constants', () => {
    // Mirrors MazeKingNFT.sol exactly.
    expect(BADGE_REGISTERED).toBe(1);
    expect(BADGE_ROBOT).toBe(2);
    expect(BADGE_GOLD).toBe(4);
    expect(BADGE_SILVER).toBe(8);
    expect(BADGE_COPPER).toBe(16);
    expect(BADGE_STONE).toBe(32);
    expect(BADGE_BUG).toBe(64);
  });
});

describe('decodeBadges', () => {
  it('returns nothing for an unregistered maze', () => {
    // The real-world default: optimalMoves unset => awarder awards nothing.
    expect(decodeBadges(0)).toEqual([]);
  });

  it('decodes the observed on-chain robot-crown mint (badges = 3)', () => {
    // 3 = REGISTERED | ROBOT — the exact value a live optimal mint produced.
    const keys = decodeBadges(3).map((b) => b.key);
    expect(keys).toContain('robot');
    expect(keys).toContain('registered');
    expect(keys).toHaveLength(2);
  });

  it('ignores reserved bits 7-31', () => {
    const keys = decodeBadges(BADGE_ROBOT | (1 << 9)).map((b) => b.key);
    expect(keys).toEqual(['robot']);
  });

  it('ranks the bug crown above the robot crown', () => {
    // Beating a proof outranks matching it, so it must lead the row.
    const keys = decodeBadges(BADGE_BUG | BADGE_ROBOT).map((b) => b.key);
    expect(keys[0]).toBe('bug');
  });
});

describe('hasBugCrown', () => {
  it('detects a solve that beat the published optimum', () => {
    expect(hasBugCrown(BADGE_BUG)).toBe(true);
    expect(hasBugCrown(BADGE_REGISTERED | BADGE_BUG)).toBe(true);
  });

  it('stays false for every honest solve', () => {
    // It should never fire in practice; that is the point of it.
    expect(hasBugCrown(BADGE_ROBOT)).toBe(false);
    expect(hasBugCrown(BADGE_GOLD | BADGE_REGISTERED)).toBe(false);
    expect(hasBugCrown(0)).toBe(false);
  });
});

describe('hasRobotCrown', () => {
  it('is true only when the ROBOT bit is set', () => {
    expect(hasRobotCrown(BADGE_ROBOT)).toBe(true);
    expect(hasRobotCrown(BADGE_REGISTERED | BADGE_ROBOT)).toBe(true);
    expect(hasRobotCrown(BADGE_GOLD)).toBe(false);
    expect(hasRobotCrown(0)).toBe(false);
  });
});

describe('bestBadge', () => {
  it('prefers the crown over medals', () => {
    expect(bestBadge(BADGE_ROBOT | BADGE_GOLD)?.key).toBe('robot');
  });

  it('ranks medals correctly', () => {
    expect(bestBadge(BADGE_SILVER | BADGE_COPPER)?.key).toBe('silver');
  });

  it('does not count REGISTERED as an achievement — it describes the maze, not the solve', () => {
    expect(bestBadge(BADGE_REGISTERED)).toBeNull();
  });

  it('is null when nothing was earned', () => {
    expect(bestBadge(0)).toBeNull();
  });
});
