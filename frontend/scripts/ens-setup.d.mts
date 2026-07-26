/**
 * Types for the parts of `ens-setup.mjs` that are imported rather than run.
 *
 * The script is plain `.mjs` so it can be executed with bare `node`, without a
 * TypeScript runner in the deploy path. Its arithmetic is still worth testing,
 * and importing an untyped `.mjs` from a `.ts` test fails `tsc` — which runs
 * as part of `pnpm build`, so the gap breaks the build rather than just the
 * editor.
 */

/**
 * ENSIP-11 coin type for a chain: `0x80000000 | chainId`, except mainnet,
 * which keeps the legacy ETH coin type 60.
 *
 * Returns a bigint deliberately. JavaScript's bitwise operators coerce to
 * signed 32-bit, so the obvious spelling produces a negative number for every
 * chain id.
 */
export declare function coinTypeForChain(chainId: number): bigint;
