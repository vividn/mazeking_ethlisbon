# ETHLisbon sprint plan — mazeking to mainnet

**Window:** 2026-07-25 ~11:30 WEST → 2026-07-26 ~09:30 WEST (~22h)
**Authors:** Nate (steward) · ístina (implementation)
**Status:** living document — see *Status* below for current state

---

## Status — 2026-07-26 ~00:40 WEST

Sections 4 and 5 below describe the plan as written at the start of the sprint and are
retained for context. Current state:

**Achievements / badges — complete and verified on-chain.**
The badge system existed but could never fire: `DefaultBadgeAwarder` gates every medal on
`optimalMoves`, and nothing ever called `setOptimalMoves`. A registrar CLI now populates it,
and badges are surfaced in the collection UI. Confirmed on Sepolia rather than locally — the
same maze awarded `badges 0` before and `badges 3` (`REGISTERED | ROBOT`) after, from a real
Honk proof through the deployed verifier:
`0x82b9f755938cf0845d0efed01ee5c983307fbba489ad2010272fc2fff11eb8e9`

**Sender-binding — landed, with an opt-in escape hatch.**
`msg.sender` is a third public input, so a proof is no longer a replayable bearer credential.
Verifier size was unchanged at 23,311 B (the public-input count is a bytecode constant, not
something that unrolls), so no fallback design was needed. A `bearer` flag preserves
wallet-less "practice proofs": they commit to the zero sentinel and are mintable only through
the opt-in path, which cannot be used to launder a bound proof.

**Testnet deployment — live and exercised.**
Redeployed for the 3-public-input ABI; the previous deployment had no 5-arg `mintWithProof`
and would have broken on merge.

| | |
|---|---|
| NFT | `0x11352976b12ffe1c4baF9058B89BD763a2A10776` |
| Verifier | `0x9365E391E2719fD144bFCd60eE895164dF91B80D` |
| BadgeAwarder | `0x819C4D50806739Dee848F4Af5952b1cC34b8DF40` |
| Renderer | `0xe376aB06415fB6D991B91C0bc24E96a16F2c68b0` |

Three seeds are registered and badge-capable: `Zero Knowledge` (245), `SNARK` (115),
`Merkle Tree` (92) — each verified by reading `officialMazes`, `optimalMoves`,
`registrarApproved` and the stored layout back from chain.

**Remaining, in dependency order:**

1. Merge the open PRs: hosting pipeline, ENS records script, header wallet button, owner
   enumeration.
2. Redeploy after owner enumeration lands — it changes contract storage and adds functions,
   so `mazesOf` and `deployBlock` require a fresh deployment to take effect.
3. Production deployment to Polygon zkEVM. Precompiles are verified; cost measured at
   ~0.0001 ETH for the full deploy, so funding is not a constraint. Needs a funded deployer
   on that chain and an explorer API key for verification.
4. ENS records. `mazeking.eth` is held by an EOA; the script is written and dry-run against
   the live name, and needs a signature from the owning account.

**Still open, and genuinely undecided:** the `<seed>.mazeking.eth` wildcard resolver. ENS
resolution happens on Ethereum mainnet while the game will live on Polygon zkEVM, so an
on-chain resolver cannot read the maze registry directly. That forces a choice between a
CCIP-Read gateway (needs a host in the request path) and a small mainnet mirror of the seed
registry. §6 records the design constraints either way.

**Correction to §5.1's severity.** Finding A was graded HIGH on general bearer-credential
reasoning. For this game specifically that overstated it: the maze layout is public and
solving is polynomial, so an attacker wanting a robot crown can simply solve the maze rather
than steal a proof — proofs are not scarce. Sender-binding still earns its place as the
default, because it matters the moment anything scarce exists (paid mints, prizes,
first-solver rewards), but opt-in bearer proofs are a reasonable product choice rather than a
hole.

---

## 1. Goal

Ship mazeking as a finished ETHLisbon project: **new achievement/badge features**, a **live
mainnet deployment**, and a **creative ENS integration** for the judging track.

## 2. Decisions (locked)

| Decision | Call | Consequence |
|---|---|---|
| **Chain** | **Polygon zkEVM mainnet (1101)** | Thematically apt (ZK app on a zkEVM). Precompiles verified — see §3. |
| **Network posture** | **Live mainnet**, not testnet demo | Makes the sender-binding fix *blocking* (§5.1). Needs funded deployer + explorer key. |
| **ZK framing** | Decorative, and **owned as a joke** | Layout is public and solving is polynomial; the game *winks* instead of pretending — a perfect score earns a **robot crown**, acknowledging you probably used a computer. Honest and funnier than a claim we can't defend. |
| **Working mode** | Hands-on (ístina implements) | PR per change; conventional-commit branches (`feat/`, `fix/`, `docs/`). |
| **ENS** | `mazeking.eth` — **owned by Nate** ✅ | Design in §6. |
| **Seed→layout consistency** | Non-negotiable | Replay/competitive integrity depends on it. Constrains the ENS design (§6). |

## 3. Verified ground truth

Checked against source and chain, not against memory or prior reports.

- **Circuit publics** are exactly `maze_hash: pub Field` and `move_count: pub u32`
  (`maze_prover/src/main.nr`). Layout, positions and moves are private witnesses, hash-bound —
  *"mutating any byte of the layout invalidates the proof."*
- **Badge machinery already exists and is wired.** `MazeKingNFT` carries a 32-bit badge bitfield,
  a pluggable `IBadgeAwarder`, and constants including `BADGE_ROBOT = 1 << 1 // Robot/Perfect`.
  `DefaultBadgeAwarder` is a real implementation (not a stub) and *is* invoked during mint.
- **…but the badges are dead in practice.** The awarder gates everything behind
  `if (optimal > 0)`, reading `optimalMoves[tokenId]` — and **`setOptimalMoves` is called from
  nowhere** in any script, tool, or doc. Today ROBOT / GOLD / SILVER / COPPER are unreachable;
  only REGISTERED / STONE can ever award.
- **Live Sepolia deployment** (`MazeKingNFT 0xb679…0320`):
  `badgeAwarder()` → `0xa7e9…674C` ✅ (awarder *is* set on-chain), but
  `totalSupply()` → **0** — the end-to-end path has never once run on the live contract.
- **Polygon zkEVM precompiles** — read-only probes against `https://zkevm-rpc.com`:
  `ecPairing (0x08)` → `0x…01` ✅ · `ecAdd (0x06)` ✅ · `ecMul (0x07)` ✅.
  The Honk verifier's bn254 math is supported on the target chain.
- **Multi-chain deploy plumbing exists but is unmerged** — `e8909a4` on `istina/gnosis-circles`
  (wagmi chains, `just deploy-polygon-zkevm`, `scripts/with-polygon-zkevm.sh`, per-chain
  deployment configs). It is a **port**, not a build. That commit also records the verifier at
  **23,311 / 24,576 bytes** — 95% of the EIP-170 limit. See §5.2.

## 4. Critical path

Ordered so the things that can kill the demo fail *early*, while there is still time to react.

1. **Spike: verifier size with 3 public inputs** (§5.2) — 30 min, decides the shape of step 2.
2. **Sender-binding fix** (Finding A) — bind `msg.sender` as a public input so a proof stops
   being a bearer credential. Spec'd ready. Blocking for mainnet.
3. **End-to-end mint on testnet** with the new circuit — generate → solve → prove → mint → badge.
   Nothing has ever minted on the live contract; this is the spine, and it must be proven before
   real money is spent.
4. **Populate `optimalMoves`** — light the fuse under the existing badge system so ROBOT and the
   medal tiers can fire. Requires the optimal solver in the registrar pipeline (§5.3).
5. **Surface badges in the frontend + `tokenURI`** — the robot crown art, badge display,
   metadata. This is the visible "new feature" for judging.
6. **ENS layer** (§6) — forward + reverse name, then the wildcard resolver if time allows.
7. **Polygon zkEVM mainnet deploy** — port the plumbing from `e8909a4`, fund deployer, deploy,
   verify, point `mazeking.eth` at it.

## 5. Risks

### 5.1 Finding A — proof not bound to minter *(HIGH, mainnet-blocking)*
The proof is verified but never bound to `msg.sender`. On a public mempool it is a **replayable
bearer credential**: an observer can lift a proof from calldata, front-run the mint, and take the
NFT and its badges permanently. Negligible on testnet (no value); live the moment we go to
mainnet. **Mitigation:** add `msg.sender` as a third public input; regenerate the verifier;
update the contract. Spec is written and the artifact chain is known
(maze-config → constants → `main.nr` → verifier → contract), with a build-time drift-check that
catches a half-applied change and a runtime length mismatch that reverts (fail-safe).

### 5.2 Verifier may not fit EIP-170 after the fix *(HIGH, discovered late = fatal)*
The current verifier is **23,311 / 24,576 bytes** — ~1,265 bytes of headroom. Adding a public
input regenerates a *larger* Honk verifier. If it exceeds the limit, the contract is undeployable
and the whole mainnet plan stalls at the worst moment. **Mitigation:** measure first (step 1).
If it blows the limit, fallbacks in order of preference:
1. bind the sender inside an existing public input (e.g. commit to `hash(maze_hash, sender)`)
   so the public-input count stays at 2;
2. compiler/codegen tuning on the verifier;
3. split the verifier behind a library/delegate pattern.

### 5.3 Wrong `optimalMoves` ⇒ false crowns *(MEDIUM)*
The maze requires collecting **both the robe and the scepter** before the goal, so the true
optimum is a shortest path over the product graph `(x, y, has_robe, has_scepter)` — **not** a
naive start→goal shortest path, which would under-count and hand out robot crowns to imperfect
solves. Use the existing BFS solver over the product graph. Longer term the registrar's number
need not be trusted at all (a distance-labelling certificate proves optimality), but for a
22-hour sprint a registrar-set value with a correct solver is the pragmatic call — **named as a
shortcut, not mistaken for a proof.**

### 5.4 Key custody *(accepted for the sprint)*
All roles sit on one owner EOA and `setVerifier` is hot-swappable, so the owner can in principle
forge anything. Correct fix is multisig + timelock + immutable verifier. **Accepted knowingly**
for a hackathon deployment; documented rather than pretended away.

### 5.5 Operational
Funded deployer key on Polygon zkEVM (bridged ETH), a real RPC, and an explorer API key for
verification. All are lead-time items — start them early, not at hour 20.

## 6. ENS design

**Principle: ENS mirrors, ENS never rules.** If ENS were authoritative for a seed's layout, then
whoever controls the name could silently rewrite a maze *after* people had raced it — replay and
competitive integrity would die. The on-chain `maze_hash` stays canonical; ENS reflects it, and
anyone can resolve → recompute → compare.

1. **Forward record** — `mazeking.eth` → the contract. On an L2, use ENSIP-11 multichain address
   records so the name carries the right chain's address.
2. **Reverse / primary name** — set the contract's primary name so explorers and wallets render
   **`mazeking.eth` instead of `0x…`**. `MazeKingNFT` is `Ownable`, so the owner can set the
   contract's reverse record. *This is the integration judges actually see.*
3. **`<seed>.mazeking.eth` via ENSIP-10 wildcard resolution** — one resolver answers *all*
   subdomains by computing from the seed. Infinite mazes, zero per-maze gas, no registration —
   and consistency becomes **structural**: the mapping is a function, not a stored record, so it
   *cannot* drift. That is the replay requirement satisfied by construction rather than promise.
4. **`avatar` text record = the maze SVG** — so `zero-knowledge.mazeking.eth` *renders as its
   maze* inside ens.app and ENS-aware wallets. The demo moment.
5. **Badges × ENS** — award a subdomain as an achievement, tying the ENS track to the main feature.

**Two snags to settle:**
- Seeds are phrases (`"Zero Knowledge"`), so labels need ENSIP-15 normalization →
  `zero-knowledge.mazeking.eth`.
- Seeds and player names would collide in one flat namespace → separate them
  (`<seed>.maze.mazeking.eth`, `<name>.player.mazeking.eth`).

## 7. Open questions

- Is a **CCIP-Read gateway** acceptable for wildcard resolution (needs a host for the demo), or
  do we prefer a fully on-chain resolver? On-chain is trustless but must read maze state on the
  same chain as ENS (mainnet), while the game lives on Polygon zkEVM.
- Which **ETHLisbon sponsor tracks** are we targeting beyond ENS? It may affect chain choice.
- Robot crown: **art asset** — do we have one, or does it need making?

---

*Working principle for the sprint: ship the honest thing. Where we take a shortcut, name it as a
shortcut in this document rather than let it pass as a guarantee.*
