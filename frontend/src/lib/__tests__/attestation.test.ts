/**
 * The signer and the contract must agree on the EIP-712 digest.
 *
 * They are written in different languages against the same spec, so agreement
 * is an assumption until tested. A mismatch would not fail loudly: signatures
 * would simply recover to some other address and every attestation would be
 * rejected as unauthorised, which reads like a permissions problem rather than
 * a hashing one.
 *
 * Gated behind an Anvil deployment, like the other on-chain tiers.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, http, keccak256, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import MazeKingNFTAbi from '../abi/MazeKingNFT.json';
import { signAttestation } from '../../../scripts/attest-maze';

const RPC = process.env.ANVIL_RPC ?? 'http://127.0.0.1:8545';
const RUN = process.env.RUN_ATTESTATION === '1';
// Anvil account #3 — a throwaway used only as a stand-in registrar.
const REGISTRAR_KEY =
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' as Hex;

describe.runIf(RUN)('registrar attestation', () => {
  let nft: Address;

  beforeAll(async () => {
    const deployment = JSON.parse(
      await readFile(
        resolve(__dirname, '../../../../contracts/deployments/31337.json'),
        'utf8'
      )
    );
    nft = deployment.nft as Address;
  });

  it('produces a digest the contract agrees with, recovering the signer', async () => {
    const client = createPublicClient({ chain: foundry, transport: http(RPC) });

    const attested = await signAttestation('Zero Knowledge', {
      chainId: 31337,
      verifyingContract: nft,
      privateKey: REGISTRAR_KEY,
    });

    // The contract's own view of the digest for these values.
    const onChainDigest = (await client.readContract({
      address: nft,
      abi: MazeKingNFTAbi,
      functionName: 'attestationDigest',
      args: [attested.mazeHash, keccak256(attested.layout), attested.optimalMoves],
    })) as Hex;

    // Recovering locally against that digest must return the signing account:
    // if the two implementations disagreed, this address would be a stranger.
    const recovered = await privateKeyToAccount(REGISTRAR_KEY).address;
    expect(attested.registrar).toBe(recovered);

    const { recoverAddress } = await import('viem');
    const recoveredFromChainDigest = await recoverAddress({
      hash: onChainDigest,
      signature: attested.signature,
    });
    expect(recoveredFromChainDigest.toLowerCase()).toBe(recovered.toLowerCase());
  }, 300_000);
});
