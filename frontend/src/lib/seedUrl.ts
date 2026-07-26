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

/** The default maze, which lives at `/` rather than under `/s/`. */
export const DEFAULT_SEED = 'maze♚ ♚king';

/** Path for a seed. The default seed maps to `/`, keeping the root clean. */
export function seedToPath(seed: string): string {
  if (seed === DEFAULT_SEED) return '/';
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

/** True when a path shows the game, as opposed to gallery or collection. */
export function isGamePath(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/s/');
}
