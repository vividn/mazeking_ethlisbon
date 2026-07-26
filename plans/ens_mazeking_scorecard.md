# ENS scorecard for every maze

Using ENSIP-10 wildcard resolution, `<seed>.mazeking.eth` resolves to a live
scorecard for that maze — rendered by eth.xyz with no work on its part, because
everything it needs arrives as ordinary ENS text records.

```
avatar        the maze drawn on chain: data:image/svg+xml;base64,...
description   the name, and its shortest possible route
url           mazeking.io/s/<seed>
name          the seed, byte for byte
first_place   solver, moves, timestamp
second_place  ...
third_place   ...
```

`mazeking.eth` itself resolves to the deployed contract.

## The principle the design is built on

**ENS mirrors the maze registry. It is never authoritative for it.**

A maze's layout is fixed by its seed and committed on chain. If a name could
carry a layout, whoever held the name could rewrite a maze — and every replay
and every score against it would silently become meaningless. Replay integrity
is the competitive premise of the game, so it cannot be something ENS is trusted
not to break.

The consequence: **subname records are not stored. They are derived at read
time.** There is no per-seed storage in the resolver, so there is nothing for a
name owner — including the resolver's own admin — to tamper with. The property
is structural rather than a matter of policy, which is the only kind worth
relying on.

A test asserts the consequence directly: an admin who repoints the apex `url`
record cannot change where any seed resolves.

## What had to be true, and was not

Three gaps stood between the original sketch and something that works.

**1. There is no on-chain path from a name to a maze.** `tokenId` is
`uint256(mazeHash)`, and `mazeHash` is a *Pedersen hash computed off chain* by
bb.js. A resolver handed the label `snark` has nothing to look it up by. Solved
by binding the seed inside the registrar's signed attestation, which populates
`officialMazes[keccak256(seed)]` during the player's own mint. The registrar is
thereby asserting the one claim nobody else can check cheaply: that this seed
really does grow this maze.

**2. There was no leaderboard.** `stats[tokenId][address]` is per-user, with no
enumeration of solvers, so a top-three could not be computed from it at all.
Solved with three fixed slots per maze, updated at mint.

**3. A mainnet resolver cannot read a contract on another chain.** This is the
one that would have sunk the whole thing late. `backend.lookup(label, key)` is a
`view` call into another contract, and the EVM can only call contracts on its own
chain. ENS *pointing at* an L2 contract works fine — ENSIP-11 address records are
just stored bytes — but a resolver *computing records from* L2 state does not.

## Why mainnet, and not zkEVM plus CCIP-Read

Measured at 0.051 gwei on 2026-07-26:

| | gas | cost |
| --- | --- | --- |
| Full deploy (NFT + verifier + renderer + awarder) | ~9.7M | ~0.0005 ETH |
| Per mint (proof verification) | ~0.5M | ~0.00003 ETH |

At that price the L2 argument evaporates. Even a 50× gas spike leaves the whole
deploy under 0.03 ETH.

The alternative was CCIP-Read (ERC-3668): NFT on zkEVM, resolver on mainnet, a
gateway signing bridged reads. It is the technically deeper answer and it is what
real L2 ENS resolvers use. It was rejected for two reasons, in order of weight:

1. **It adds a live service that must stay up during judging.** Gateway down
   means blank scorecard.
2. **A computed view of live state is a stronger claim than a cached copy.**
   With everything on one chain there is nothing between the name and the truth,
   and no staleness is possible even in principle.

Not a dead end: the resolver is chain-agnostic, so CCIP-Read can be layered on
later without changing anything about the name.

A third option — a mainnet *mirror* of scorecard data, with the NFT on zkEVM —
was dropped outright. It still writes mainnet, so it saves almost nothing at
current gas, and it reintroduces the staleness that mainnet-native avoids.

## Caveats

**ENSIP-15 normalisation constrains which seeds can have names.** Labels are
normalised before resolution — lowercased, no spaces. The default seed
`maze♚ ♚king` contains a space and therefore can *never* arrive as a label.
Seeds intended to have ENS names must be ENS-safe. The resolver deliberately does
no normalisation of its own: the seed string is hashed to produce the maze, so
normalising in the resolver would name a different maze than the one resolved.

**Setting a wildcard resolver on the apex displaces the apex's existing
resolver.** ENSIP-10 requires the resolver to be set on the *parent* name, so
pointing `mazeking.eth` at `MazeKingResolver` means the ENS public resolver's
records — including the ones `scripts/ens-setup.mjs` writes in #7 — stop being
consulted. `MazeKingResolver` therefore serves the apex too, from its own
admin-settable storage. Missing this would have silently blanked the name's
records the moment the wildcard was switched on.

**Apex records are stored; seed records are not.** Apex records describe the
project rather than any maze, so they carry no replay risk. The asymmetry is
deliberate.

**Coin type 60 vs ENSIP-11.** A mainnet address record pointing at a contract
that exists only on an L2 invites transfers to an address holding no contract on
mainnet, and those funds are unrecoverable. Now that the deployment is mainnet,
coin type 60 becomes the correct record — but the guard stays, so pointing at an
L2 in future still requires being explicit.

**An unregistered name resolves to empty records**, not to an empty scorecard.
Presenting a blank profile as though the maze existed would be a confident lie,
which is the failure this design exists to avoid.

**eth.xyz rendering is unverified.** The records are standard, so it should work,
but it has not been tested against a live name.

## Implementation status

Done and tested:

- `MazeKingResolver` — ENSIP-10 wildcard, apex + seed records, malformed DNS
  names rejected rather than resolved, unimplemented profiles reverting rather
  than answering empty. (#22)
- Seed bound into the attestation; `officialMazes` populated at mint. (#23)
- Podium: three slots, one per solver, ties to whoever arrived first. (#23)
- Registrar signs rather than transacts, so registration needs no nonce and no
  gas. (#20)
- `/admin` wiring checklist, signed from the owner's wallet. (#24)
- Registered layout overrides a locally generated one. (#25)
- 123 contract tests, including the scorecard exercised against the real NFT and
  renderer rather than a stub.

Remaining, all requiring the name owner's wallet:

1. Deploy to Sepolia with the final bytecode and rehearse the whole flow:
   register, solve, prove, mint, badge, resolve.
2. Deploy to mainnet from a throwaway key, passing `vividn.eth` as `_owner` so it
   holds every role from block one and no key of consequence touches a script.
3. Grant `REGISTRAR_ROLE` to the attestor address, via `/admin`.
4. Point `mazeking.eth`'s resolver at `MazeKingResolver`, and set the apex
   records. Only the name owner can do this.
5. Verify `eth.xyz/<seed>.mazeking.eth` renders.

## Future: migrating to a v2 without an upgradeable contract

Worth recording because it is what makes deploying today safe.

A v2 can read v1 directly — same chain, permanent state — and let holders claim:

```solidity
function claimLegacy(uint256 tokenId) external {
    require(IERC1155(V1).balanceOf(msg.sender, tokenId) > 0, "not a holder");
    require(!claimed[msg.sender][tokenId], "already claimed");
    claimed[msg.sender][tokenId] = true;
    _mint(msg.sender, tokenId, 1, "");
}
```

This pattern normally needs a snapshot or a Merkle root, because holders can
transfer between the snapshot and the claim. **Here they cannot** — tokens are
non-transferable and non-burnable, so a v1 balance is frozen the moment it is
minted. The check is trustless, permissionless, needs no owner action, and the
user pays their own gas. Stats and podium can be carried across the same way.

Two conditions: `claimLegacy` must be written into v2 *before* deploying it, and
token ids must stay stable across versions — which they do, since `tokenId` is
derived from the layout rather than from a counter.

### Achievements that need their own ZK proof

`IBadgeAwarder.awardBadges` is **not** declared `view` — only
`DefaultBadgeAwarder`'s implementation is — so the NFT emits a real call and a
future awarder may write state. That makes the awarder a much larger extension
point than it appears.

An achievement requiring a new circuit (say, tracing out all the letters) is
therefore reachable without touching `MazeKingNFT`:

1. Deploy an achievement contract with its own verifier for the new circuit.
   `prove(proof, tokenId, ...)` verifies and records the result.
2. Deploy a new awarder that reads that contract and ORs in the extra bit, and
   point the NFT at it with `setBadgeAwarder`.

One caveat: `awardBadges` runs only during a mint, so the bit reaches
`stats.badges` only when the achievement is proved *before* minting. Someone who
minted earlier and proves later does not get it retroactively — though
re-submitting a proof for that maze re-runs the awarder, so it is recoverable
rather than lost.

Given that, the achievement contract should be the source of truth for extended
badges, with the frontend and the ENS scorecard reading both it and the NFT's
bitfield. Each achievement then carries its own circuit, its own verifier and its
own rules, and adding one never touches the NFT or the maze token — strictly more
extensible than packing everything into 32 bits.

Badges specifically need no migration at all. `DefaultBadgeAwarder` sits behind
`IBadgeAwarder` and is swapped with `setBadgeAwarder`, and the NFT ORs in the
awarder's return value without validating which bits it sets. New badges on bits
7–31 are one deploy and one transaction, with no change to the NFT.
