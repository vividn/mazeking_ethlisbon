# Running the registrar

The registrar is what makes badges reachable. This is how to operate it.

## Why it signs instead of transacting

Badges are graded against `optimalMoves[tokenId]`. Until something sets that
value, every medal is withheld — the robot crown included. Only the registrar
knows the true optimum, because computing it means a breadth-first search over
the product graph `(x, y, hasRobe, hasScepter)`; a naive start-to-goal shortest
path under-counts, since a maze requires collecting both the robe and the
scepter first, and an under-counted optimum hands out robot crowns to imperfect
solves.

The obvious design has the registrar send a transaction to register each maze.
That design has a nonce, and a nonce is a shared counter. Run the registrar as a
horizontally scaled serverless function and two concurrent invocations will
fetch the same nonce, sign two different transactions with it, and one of them
will be dropped. The usual answers — a lock, a queue, a single warm instance —
all amount to reintroducing the one server the architecture was meant to avoid.

So the registrar does not transact. It **signs a statement** and hands it to the
player, whose own mint carries it on chain:

```
MazeAttestation(bytes32 mazeHash, bytes32 layoutHash, uint32 optimalMoves)
```

Nothing is coordinated because nothing is sent. A hundred concurrent
invocations need no lock, no queue and no shared counter. The registrar spends
no gas, and its work cannot land after the mint it was meant to accompany —
because it is *part of* that mint.

## What the key can and cannot do

The signing key must hold `REGISTRAR_ROLE`, and **needs no balance at all** — it
never sends a transaction. That is worth stating plainly, because it bounds the
damage: a compromised registrar key can sign false statements about mazes. It
cannot move funds, mint tokens to itself, or change any contract parameter.

The realistic attack is a stolen key signing a *false* optimum — attesting that
a maze can be solved in one move, so every solver earns a robot crown. The
mitigations are that the role is revocable by the contract owner, and that the
consequence is cosmetic. Even so:

- keep it in a secret store, never in the repository;
- make it a **different key from the deployer**, which does hold funds;
- rotate it by granting the role to a new address and revoking the old one.

## The endpoint is public, and that is fine

CORS will not restrict who calls this function. CORS is enforced by browsers to
protect users from other origins; it does nothing against `curl`. Any deployed
endpoint is reachable by anyone.

This is not a problem here, and the reason is worth understanding rather than
patching around. An attestation is a **pure function of the seed**. Everything
in the response — the layout, its hash, the optimum — is derived from a public
input by code that ships in the client bundle. A caller learns nothing they
could not compute themselves, and `registerWithAttestation` is deliberately
permissionless to submit and idempotent, so registering a maze is not a scarce
action worth hoarding.

What the endpoint does spend is **compute**: every request runs maze generation
and a BFS. Rate-limit it for cost, not for safety.

## Building the deployment package

The handler is `frontend/scripts/attest-maze.ts`, which exports:

- `signAttestation(seed, opts)` — the library form;
- `handle(event)` — a function-style entry point taking `?seed=`;
- a CLI, when invoked with `--seed`.

It cannot be uploaded as-is. It is TypeScript, and it imports the game's own
generator, serializer and solver out of `src/lib` — which is the whole point,
since a registrar that derived mazes differently from the game would be worse
than no registrar, but it means a platform handed these files sees `.ts` and
relative imports it cannot resolve.

```sh
cd frontend
pnpm build:attestor
```

That writes `frontend/dist-attestor/`:

- `handler.mjs` — the entire import graph compiled into one ES module;
- `package.json` — declaring `viem` and `@aztec/bb.js`.

Dependencies stay external rather than being inlined. `@aztec/bb.js` carries a
WebAssembly module for the Pedersen hash that gives a maze its identity, and
inlining a package whose real payload is a `.wasm` asset is a good way to get a
bundle that builds cleanly and fails at runtime. Upload the directory and let
the platform install them.

Sanity-check the built artifact before uploading it — it should produce the
same maze hash as the CLI does:

```sh
cd frontend/dist-attestor
REGISTRAR_PRIVATE_KEY=0x... CHAIN_ID=11155111 NFT_ADDRESS=0x... \
  node --input-type=module -e "
    const { handle } = await import('./handler.mjs');
    console.log((await handle({queryStringParameters:{seed:'Zero Knowledge'}})).body);
  "
```

## Scaleway permissions

The application deploying this needs two permission sets, both scoped to the
project the function lives in:

- **`FunctionsFullAccess`** — namespace, deploy, environment variables and
  secrets.
- **`ContainerRegistryFullAccess`** — Scaleway builds the function into an
  image and pushes it to Container Registry, and namespace creation pulls from
  there. Without it the deploy fails during the build step, which reads like a
  broken build rather than a permissions problem.

`REGISTRAR_PRIVATE_KEY` belongs in the function's **secret** environment
variables, which the Functions API covers — no Secret Manager permission
needed.

## CI configuration

`.github/workflows/deploy-attestor.yml` builds and deploys the function on
pushes that touch it. Everything below is **environment-scoped to
`workflow_env`**, and a job that does not declare `environment: workflow_env`
sees empty strings with no warning at all — the failure looks like a missing
value rather than a permissions problem.

Secrets:

| Secret | Why it is a secret |
| --- | --- |
| `REGISTRAR_PRIVATE_KEY` | The signing key. Never a `VITE_*` value — those are inlined into the bundle. |
| `SCW_ACCESS_KEY_ID` / `SCW_SECRET_ACCESS_KEY` | Scaleway API key for the deploying application. |

Variables (all public by nature):

| Variable | Meaning |
| --- | --- |
| `REGISTRAR_ADDRESS` | The signer's address. Only needed to grant the role, but worth recording so it is greppable when checking which key is live. |
| `NFT_ADDRESS` | The deployment the function signs for. |
| `CHAIN_ID` | Likewise. |
| `SCW_PROJECT_ID` / `SCW_ORGANIZATION_ID` | Scaleway target. |
| `SCW_REGION` | Defaults to `fr-par`. |
| `SCW_FUNCTION_NAMESPACE` | Defaults to `mazeking`. |
| `SCW_FUNCTION_RUNTIME` | Defaults to `node22`. Scaleway retires runtimes, and creating a function on a retired one fails outright rather than falling back. |
| `VITE_ATTESTOR_URL` | The deployed function's URL, read by the **frontend** deploy. |

The workflow exercises the built artifact before shipping it — it runs the
handler under plain `node`, from a standalone `npm install` of the generated
`package.json`, and fails if it does not return a signature. A bundler that
silently altered the maze derivation would break seed→layout consistency
without breaking the build, so the artifact is checked rather than trusted.

It then calls the *deployed* function and fails if that does not sign either.
A function that deploys and answers 500 is worse than one that fails to deploy:
the client treats every attestor failure as "mint unattested", so a broken
attestor surfaces only as badges quietly never being awarded.

## Environment

| Variable | Meaning |
| --- | --- |
| `REGISTRAR_PRIVATE_KEY` | Signing key. Must hold `REGISTRAR_ROLE`; needs no balance. |
| `CHAIN_ID` | Chain the signature is for. Bound into the EIP-712 domain. |
| `NFT_ADDRESS` | MazeKingNFT address. Also bound into the domain. |

Because the domain binds both `chainId` and `verifyingContract`, a signature
made for one deployment is meaningless on another. A Sepolia attestation cannot
be replayed onto mainnet. Deploy one function instance per chain.

The client passes the chain and contract it wants a signature for, and the
function **refuses with 409 rather than obliging**. Signing against a
caller-supplied domain would let anyone obtain attestations valid on other
MazeKing deployments this key happens to hold the registrar role on. The
function signs only for the deployment it was configured with; the parameters
exist so a client pointed at the wrong instance gets a clear answer instead of
a signature that silently fails on chain.

Responses carry `Access-Control-Allow-Origin: *`. That is deliberate rather
than lazy: as above, the response contains nothing a narrower origin list would
protect.

Grant the role once, from the contract owner:

```sh
cast send $NFT "grantRole(bytes32,address)" \
  $(cast call $NFT "REGISTRAR_ROLE()(bytes32)" --rpc-url $RPC) \
  $REGISTRAR_ADDRESS --rpc-url $RPC --private-key $OWNER_KEY
```

Then point the frontend at it by setting `VITE_ATTESTOR_URL` to the function's
URL. Leaving it unset — the default, and the usual case in local development —
means minting proceeds exactly as before: unattested, and without badges.

## Checking it by hand

```sh
cd frontend
REGISTRAR_PRIVATE_KEY=0x... pnpm exec vite-node scripts/attest-maze.ts -- \
  --seed "Zero Knowledge" --chain-id 11155111 --contract 0x...
```

That prints the maze hash, layout, optimum and signature. Any account at all can
submit it — the signature is the authority, not the sender:

```sh
cast send $NFT "registerWithAttestation(bytes32,bytes,uint32,bytes)" \
  $MAZE_HASH $LAYOUT $OPTIMAL $SIGNATURE --rpc-url $RPC --private-key $ANY_KEY
```

`optimalMoves(tokenId)` should then return the attested value, and
`registrarApproved(tokenId)` should be true.

## What happens when it is down

Every failure path in the client returns null and mints unattested. No attestor
configured, endpoint unreachable, non-200 answer, unexpected response shape —
all of them fall back to the pre-existing behaviour.

One case deserves its own mention. The contract verifies the signature against
`keccak256(layout)` using the layout the *player* submits, so an attestation
describing a different layout does not merely fail to award a badge — it reverts
the entire mint. A registrar that had drifted from the game by a single byte
would therefore stop every mint rather than quietly withhold medals. The client
compares the two layouts locally before sending anything and drops the
attestation if they disagree, which keeps the consequence proportionate and
makes the drift visible in the console instead of appearing as an unexplained
revert.
