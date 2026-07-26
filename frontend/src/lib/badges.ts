/**
 * Badge definitions — mirrors the bitfield in MazeKingNFT.sol.
 *
 * These bits MUST stay in lockstep with the contract constants:
 *   BADGE_REGISTERED = 1 << 0
 *   BADGE_ROBOT      = 1 << 1
 *   BADGE_GOLD       = 1 << 2
 *   BADGE_SILVER     = 1 << 3
 *   BADGE_COPPER     = 1 << 4
 *   BADGE_STONE      = 1 << 5
 *   BADGE_BUG        = 1 << 6
 * Bits 7-31 are reserved on-chain for future achievements.
 *
 * Awarding happens in DefaultBadgeAwarder and is gated on the registrar having
 * set `optimalMoves` for the maze — an unregistered maze awards no medals at
 * all. See `scripts/register-maze.ts`.
 */

export const BADGE_REGISTERED = 1 << 0;
export const BADGE_ROBOT = 1 << 1;
export const BADGE_GOLD = 1 << 2;
export const BADGE_SILVER = 1 << 3;
export const BADGE_COPPER = 1 << 4;
export const BADGE_STONE = 1 << 5;
/**
 * Solved in fewer moves than the maze's proven optimum — which cannot happen.
 * The optimum is a breadth-first search over the product graph, so nothing
 * shorter exists. If this bit is ever set, the optimum was wrong and the mint
 * is a bug report. Unearnable by design.
 */
export const BADGE_BUG = 1 << 6;

export interface BadgeDef {
  bit: number;
  key: string;
  label: string;
  /** Placeholder art. Swap for real assets when they exist. */
  glyph: string;
  description: string;
}

/**
 * Ordered best-to-worst so a badge row reads as a ranking.
 * REGISTERED is a property of the maze rather than of the solve, so it sits
 * apart at the end.
 */
export const BADGE_DEFS: BadgeDef[] = [
  {
    // Above the robot crown deliberately: beating a proof outranks matching it.
    bit: BADGE_BUG,
    key: 'bug',
    label: 'Bug Crown',
    glyph: '🐛👑',
    description:
      'Solved in fewer moves than we proved possible. Either you broke the ' +
      'maze or we broke the maths. Either way, this one is yours.',
  },
  {
    bit: BADGE_ROBOT,
    key: 'robot',
    label: 'Robot Crown',
    glyph: '🤖👑',
    description:
      'Solved in exactly the optimal number of moves. Probably a robot',
  },
  {
    bit: BADGE_GOLD,
    key: 'gold',
    label: 'Gold',
    glyph: '🥇',
    description: 'Within 5% of the optimal route.',
  },
  {
    bit: BADGE_SILVER,
    key: 'silver',
    label: 'Silver',
    glyph: '🥈',
    description: 'Within 15% of the optimal route.',
  },
  {
    bit: BADGE_COPPER,
    key: 'copper',
    label: 'Copper',
    glyph: '🥉',
    description: 'Within 25% of the optimal route.',
  },
  {
    bit: BADGE_STONE,
    key: 'stone',
    label: 'Stone',
    glyph: '🪨',
    description: 'Took the maximum possible number of moves. Scenic route.',
  },
  {
    bit: BADGE_REGISTERED,
    key: 'registered',
    label: 'Official Maze',
    glyph: '📜',
    description: 'This maze is officially registered by the registrar.',
  },
];

/** Decode a badge bitfield into its definitions, best-first. */
export function decodeBadges(badges: number): BadgeDef[] {
  return BADGE_DEFS.filter((d) => (badges & d.bit) !== 0);
}

/** True if the solve earned the tongue-in-cheek perfect-score crown. */
export function hasRobotCrown(badges: number): boolean {
  return (badges & BADGE_ROBOT) !== 0;
}

/**
 * True if the solve beat the optimum we published for this maze.
 *
 * Should always be false. It is worth surfacing rather than hiding: a solve
 * that disproves our own claim is the most interesting thing the contract can
 * record.
 */
export function hasBugCrown(badges: number): boolean {
  return (badges & BADGE_BUG) !== 0;
}

/**
 * The single badge that best represents a solve, for compact UI (a card
 * corner, a list row). Returns null when nothing was earned — which is the
 * normal state for a maze whose optimum was never registered.
 */
export function bestBadge(badges: number): BadgeDef | null {
  const earned = decodeBadges(badges).filter((d) => d.bit !== BADGE_REGISTERED);
  return earned.length > 0 ? earned[0] : null;
}
