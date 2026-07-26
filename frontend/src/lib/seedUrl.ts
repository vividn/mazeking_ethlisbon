/**
 * Mapping between a maze seed and its URL.
 *
 * Canonical form is `/s/<seed>`, which is shorter to say aloud and to type
 * than a query string. The path segment is the seed *literally* — percent
 * decoded, nothing else. That matters: the seed string is hashed to produce
 * the maze, so `Zero Knowledge` and `zero-knowledge` are different mazes.
 * Prettifying the URL would silently point at a maze nobody registered.
 *
 * `?seed=` remains readable so links shared before this change keep working.
 */

/** The maze used when someone submits the name field empty. */
export const DEFAULT_SEED = 'maze♚ ♚king';

/**
 * Path for a seed. Every maze lives under `/s/`, including the default one:
 * `/` is the directions screen, not a game.
 */
export function seedToPath(seed: string): string {
  return `/s/${encodeURIComponent(seed)}`;
}

/**
 * Read the seed from a location, or null when it carries none.
 *
 * Accepts both the canonical `/s/<seed>` and the legacy `?seed=` so old links
 * survive. Returns the raw seed; callers sanitise, since the rules for what
 * characters a maze may contain live with the renderer.
 */
export function seedFromLocation(
  pathname: string,
  search: string
): string | null {
  const match = /^\/s\/(.+)$/.exec(pathname);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      // A malformed escape sequence is not worth failing over; treat the
      // segment as literal text and let sanitisation deal with it.
      return match[1];
    }
  }
  const legacy = new URLSearchParams(search).get('seed');
  return legacy ?? null;
}

/**
 * Path for replaying a specific minted maze.
 *
 * A replay is identified by token id rather than by a seed: the maze may have
 * been minted by someone else, and its seed is not always recoverable. Giving
 * it a real URL rather than holding it only in memory means it can be linked,
 * refreshed and reached with the back button, like everything else in the game.
 */
export function tokenPath(tokenId: bigint | string): string {
  return `/m/${tokenId.toString()}`;
}

/** The token id in a replay path, or null. */
export function tokenIdFromLocation(pathname: string): bigint | null {
  const match = /^\/m\/(\d+)$/.exec(pathname);
  if (!match) return null;
  try {
    return BigInt(match[1]);
  } catch {
    return null;
  }
}

/**
 * True when a path shows a maze. `/` is the directions screen.
 *
 * Both forms count: `/s/<seed>` for a maze grown from a name, `/m/<tokenId>`
 * for one replayed from the chain. Missing the second is what sent "play this
 * maze" back to the directions screen -- the game only renders on a game path.
 */
export function isGamePath(pathname: string): boolean {
  return pathname.startsWith('/s/') || pathname.startsWith('/m/');
}
