/**
 * The client side of attestations has one job that matters: never let a
 * registrar's answer turn a mint that would have worked into one that reverts.
 *
 * The contract verifies the signature against `keccak256(layout)` using the
 * layout the player submits. So an attestation describing a *different* layout
 * does not merely fail to award badges — it reverts the whole transaction. The
 * guard below is what keeps that failure proportionate, and it is exactly the
 * kind of check that rots silently, so it is tested directly.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { attestationMatchesLayout, fetchAttestation } from '../attestation';
import type { Attestation } from '../attestation';

const SIG = ('0x' + 'ab'.repeat(65)) as `0x${string}`;

function attestation(layout: string): Attestation {
  return { optimalMoves: 42, signature: SIG, layout: layout as `0x${string}` };
}

describe('attestationMatchesLayout', () => {
  it('accepts an attestation over the very bytes being minted', () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0xff, 0x10]);
    expect(attestationMatchesLayout(attestation('0x000fff10'), bytes)).toBe(
      true
    );
  });

  it('accepts regardless of hex case', () => {
    const bytes = new Uint8Array([0xab, 0xcd]);
    expect(attestationMatchesLayout(attestation('0xABCD'), bytes)).toBe(true);
  });

  it('rejects a single flipped byte', () => {
    // One byte of drift between registrar and game is the whole failure mode:
    // it would revert every mint rather than merely withhold a badge.
    const bytes = new Uint8Array([0x00, 0x0f, 0xff, 0x10]);
    expect(attestationMatchesLayout(attestation('0x000fff11'), bytes)).toBe(
      false
    );
  });

  it('rejects a truncated layout', () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0xff, 0x10]);
    expect(attestationMatchesLayout(attestation('0x000fff'), bytes)).toBe(
      false
    );
  });

  it('preserves leading zeros, which naive hex conversion drops', () => {
    const bytes = new Uint8Array([0x00, 0x01]);
    expect(attestationMatchesLayout(attestation('0x0001'), bytes)).toBe(true);
    expect(attestationMatchesLayout(attestation('0x01'), bytes)).toBe(false);
  });
});

describe('fetchAttestation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when no attestor is configured, rather than throwing', async () => {
    // VITE_ATTESTOR_URL is unset under test, which is also the local-dev case:
    // no registrar key to sign with, and minting must still work.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchAttestation('SNARK', 31337, '0xdead')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
