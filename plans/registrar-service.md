# Registrar service — automatic maze registration

**Status:** design, not yet built
**Problem it solves:** badges are unreachable on any maze nobody registered by hand

---

## Why a registrar exists at all

`DefaultBadgeAwarder` gates every medal on `optimalMoves[tokenId] > 0`. That number cannot
come from the player: it is the thing their score is measured against, so a client-supplied
optimum would let anyone mint themselves a robot crown. It also cannot be computed on chain
— the optimum is a BFS over the product graph `(x, y, hasRobe, hasScepter)`, which is far
past what is reasonable in Solidity.

So a trusted party computes it off chain. Today that party is a human running
`just register-maze`, which means **only the three seeds registered by hand can award
badges.** Every other maze a player invents is unregistered, and its badges silently cannot
fire — the exact failure this project already fixed once at the contract level.

The registrar service closes that: any maze a player actually plays becomes registrable
automatically.

## What registration involves

Four registrar-only calls, all derivable from the seed alone:

| call | value |
|---|---|
| `registerMaze(seed, tokenId)` | binds the seed string to its maze |
| `setLayout(tokenId, layout)` | registrar-authoritative layout, closing the render-spoof |
| `setOptimalMoves(tokenId, moves)` | the number badges are graded against |
| `setRegistrarApproved(tokenId, true)` | gates `BADGE_REGISTERED` |

`frontend/scripts/register-maze.ts` already performs all four and reuses the game's own
generator, serializer and solver — so seed→layout can never drift from what players see.
The service is that script, triggered automatically.

---

## The nonce problem, and why it is the wrong problem

The obvious design is: a serverless function receives "player started proving seed X" and
sends the four transactions. That runs straight into the standard hazard — serverless
scales horizontally, every concurrent invocation reads the same
`getTransactionCount(registrar, 'pending')`, and all but one transaction is rejected as a
duplicate nonce. Retries make it worse, because a dropped transaction leaves a **nonce gap**
that stalls everything queued behind it.

Every fix for this is a way of pretending one key is not one key.

**The better move is to stop sending transactions from the function.**

### Recommended: the registrar signs, the player submits

The registrar's role is to *attest* that a maze has a given layout and optimum. That is a
statement, and a statement can be signed rather than transacted.

1. The function computes layout + optimum from the seed, and returns an EIP-712 signature
   over `(mazeHash, layoutHash, optimalMoves)`.
2. The client passes that signature to `mintWithProof`, alongside the proof it already sends.
3. The contract `ecrecover`s it and requires the signer to hold `REGISTRAR_ROLE`, then
   applies the layout and optimum in the same transaction as the mint.

What this buys:

- **No registrar nonce, because no registrar transaction.** The nonce used is the player's
  own, and players do not collide with each other.
- **Perfectly horizontal.** Signing is pure computation; a thousand concurrent invocations
  need no coordination, no lock, no queue.
- **No registrar gas.** Registration costs the registrar nothing; it rides along with a
  transaction the player was already paying for.
- **No timing dependency.** The design below of "start early because proving is slow"
  becomes unnecessary — the signature can be fetched while proving, or after, and a slow
  cold start can never cause a mint to land before its registration.
- **The trust boundary is unchanged.** The optimum is still asserted by the registrar key
  and nothing else; only its transport changes.

Costs: a contract change and therefore a redeploy, plus signature-domain care (bind the
chain id and contract address in the EIP-712 domain so a signature cannot be replayed on
another deployment). Replay *within* a deployment is harmless — registration is idempotent
and the values are a pure function of the seed.

### If transactions must be sent anyway

Should the signing route be rejected, these are the mitigations, best first:

1. **A single serializer.** Functions enqueue registration requests onto a FIFO queue
   (Scaleway Messaging & Queuing); one consumer drains it and submits sequentially, owning
   the nonce alone. This is the standard answer and the only one that stays correct under
   load.
2. **Concurrency capped at 1.** Scaleway functions allow a max-instances setting; setting it
   to 1 serialises invocations. Simple and adequate at hackathon traffic, but it converts a
   scaling problem into a latency problem, and cold starts queue behind each other.
3. **Nonce allocation from an atomic counter.** Redis `INCR` hands out unique nonces. Works
   until a transaction is dropped, at which point the gap stalls every later nonce and needs
   explicit recovery. Do not choose this without a gap-healing path.

Whichever is used, two properties are needed regardless:

- **Idempotence.** `registerMaze` reverts with `Already registered`, and popular seeds will
  be triggered by many players at once. Check before sending, and treat that revert as
  success rather than as an error.
- **Rate limiting and validation.** The endpoint spends the registrar's gas on request. It
  must reject seeds that generate unsolvable or oversized mazes — the register script
  already refuses unsolvable ones — and bound how often it will act.

---

## Trigger

Registering on "player started generating a proof" is a good signal: proving takes tens of
seconds, so registration has time to confirm first, and it only fires for mazes someone
actually played rather than every seed idly typed.

Under the signing design the trigger matters much less, since the signature is carried by
the mint itself and cannot arrive late. The same endpoint can then also be called
speculatively — for instance when a seed is first rendered — without risking a wasted
transaction, because signing costs nothing.

---

## Open questions

- Should registration be limited to mazes that have been *solved*, rather than merely
  started? It bounds spend, at the cost of the first solver of a maze not earning
  `BADGE_REGISTERED` on their own solve.
- Should the registrar key be distinct from the deployer key? It currently is not. Splitting
  them limits the blast radius of a service compromise to registration rather than to
  ownership.
- Is `Scaleway Functions` or `Scaleway Containers` the better host, given the service needs
  the project's own generator and solver code?
