/**
 * ENSIP-11 coinType arithmetic.
 *
 * This exists because the obvious implementation is silently wrong:
 * JavaScript's bitwise operators coerce to SIGNED 32-bit integers, so
 * `0x80000000 | 1101` evaluates to -2147482547 rather than 2147484749. That
 * number would have been written straight to a mainnet ENS record, where a
 * wrong coinType means the name simply fails to resolve on the target chain —
 * with no error anywhere to explain why.
 */
import { describe, it, expect } from 'vitest';
import { coinTypeForChain } from '../../../scripts/ens-setup.mjs';

describe('coinTypeForChain (ENSIP-11)', () => {
  it('keeps the legacy ETH coinType for mainnet', () => {
    expect(coinTypeForChain(1)).toBe(60n);
  });

  it('computes Polygon zkEVM correctly', () => {
    // 0x80000000 + 1101
    expect(coinTypeForChain(1101)).toBe(2147484749n);
  });

  it('computes Base correctly', () => {
    expect(coinTypeForChain(8453)).toBe(2147492101n);
  });

  it('handles chain ids above the 32-bit signed boundary', () => {
    // Sepolia's id is large enough that naive arithmetic overflows twice over.
    expect(coinTypeForChain(11155111)).toBe(2158638759n);
  });

  it('never returns a negative coinType — the bug this guards', () => {
    for (const id of [1101, 8453, 137, 10, 42161, 11155111]) {
      expect(coinTypeForChain(id)).toBeGreaterThan(0n);
    }
  });
});
