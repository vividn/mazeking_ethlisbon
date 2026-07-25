# MazeKing Project Justfile
# Unified build system for Noir circuits, Foundry contracts, and React frontend

set shell := ["bash", "-c"]
set dotenv-load := true

# Project paths
project_root := justfile_directory()
maze_prover_dir := project_root / "maze_prover"
contracts_dir := project_root / "contracts"
frontend_dir := project_root / "frontend"
scripts_dir := project_root / "scripts"

# Generated artifacts paths
circuit_target := maze_prover_dir / "target"
circuit_json := circuit_target / "maze_prover.json"
frontend_circuit_dir := frontend_dir / "public/circuit"
frontend_circuit_json := frontend_circuit_dir / "maze_prover.json"
deployments_dir := contracts_dir / "deployments"
frontend_contracts_config := frontend_dir / "src/lib/contracts.generated.ts"

# Network configuration
anvil_port := "8545"
anvil_rpc := "http://127.0.0.1:" + anvil_port

# Tool paths (use from PATH as user specified)
# nargo is only needed for `nargo test` / `nargo fmt`; circuit *build* uses noir_wasm.
nargo := env_var_or_default("NARGO_PATH", "nargo")
forge := env_var_or_default("FORGE_PATH", "forge")
pnpm := env_var_or_default("PNPM_PATH", "pnpm")
node := env_var_or_default("NODE_PATH", "node")
tools_dir := project_root / "tools"

# Colors for output
RED := '\033[0;31m'
GREEN := '\033[0;32m'
YELLOW := '\033[1;33m'
BLUE := '\033[0;34m'
NC := '\033[0m'

# Default target - show help
default:
    @just --list

# === SETUP ===

# Install all dependencies
setup:
    @echo -e "{{BLUE}}[setup]{{NC}} Installing project dependencies..."
    @just _check-tools
    @echo -e "{{YELLOW}}[setup]{{NC}} Installing pnpm workspace dependencies..."
    cd {{project_root}} && {{pnpm}} install
    @echo -e "{{YELLOW}}[setup]{{NC}} Installing contract dependencies..."
    cd {{contracts_dir}} && {{forge}} install
    @echo -e "{{GREEN}}[setup]{{NC}} Setup complete!"

# Check if required tools are installed
_check-tools:
    #!/usr/bin/env bash
    set -euo pipefail
    echo -e "{{YELLOW}}[check]{{NC}} Checking required tools..."

    # Check node (required: WASM build pipeline runs on Node)
    if ! command -v {{node}} &> /dev/null; then
        echo -e "{{RED}}[check]{{NC}} Error: node not found in PATH"
        echo "Install Node.js >= 20 (https://nodejs.org)"
        exit 1
    fi
    echo -e "{{GREEN}}[check]{{NC}} Found node: $({{node}} --version)"

    # Check nargo (optional: only needed for `nargo test` / `nargo fmt`)
    if ! command -v {{nargo}} &> /dev/null; then
        echo -e "{{YELLOW}}[check]{{NC}} nargo not found — circuit build uses noir_wasm, but `nargo test`/`nargo fmt` will be unavailable."
        echo "Install with: curl -L https://raw.githubusercontent.com/noir-lang/noirup/refs/heads/main/install | bash && noirup"
    else
        echo -e "{{GREEN}}[check]{{NC}} Found nargo: $({{nargo}} --version)"
    fi

    # Check forge
    if ! command -v {{forge}} &> /dev/null; then
        echo -e "{{RED}}[check]{{NC}} Error: forge not found in PATH"
        echo "Install with: curl -L https://foundry.paradigm.xyz | bash && foundryup"
        exit 1
    fi
    echo -e "{{GREEN}}[check]{{NC}} Found forge: $({{forge}} --version | head -1)"

    # Check pnpm
    if ! command -v {{pnpm}} &> /dev/null; then
        echo -e "{{RED}}[check]{{NC}} Error: pnpm not found in PATH"
        echo "Install with: npm install -g pnpm"
        exit 1
    fi
    echo -e "{{GREEN}}[check]{{NC}} Found pnpm: $({{pnpm}} --version)"

# === CONSTANTS GENERATION ===

# Generate maze constants for all codebases from maze-config.json
generate-constants:
    @echo -e "{{BLUE}}[constants]{{NC}} Generating constants from maze-config.json..."
    node {{scripts_dir}}/generate-maze-constants.js
    @echo -e "{{GREEN}}[constants]{{NC}} Constants generation complete!"

# Generate palette code (Sol + TS) from palette/paletteRecipe.json.
# Single source of truth for the canonical palette shared by MazeRenderer.sol
# and colorGenerator.ts. Idempotent — running twice produces no diff. See ma-fy3.
generate-palette:
    @echo -e "{{BLUE}}[palette]{{NC}} Generating palette artifacts from palette/paletteRecipe.json..."
    node {{scripts_dir}}/generate-palette.js
    @echo -e "{{GREEN}}[palette]{{NC}} Palette generation complete!"

# Regenerate cross-layer Pedersen fixtures (TS↔Noir byte-encoding gate).
# Reads maze_prover/test_data/layout_fixtures.json, codegens a Noir test
# that hashes each fixture, runs nargo to capture the hashes, and writes
# frontend/src/lib/__tests__/pedersen_fixtures.json. Idempotent — running
# twice produces no diff. See ma-bu3.
regen-pedersen-fixtures:
    @echo -e "{{BLUE}}[pedersen-fixtures]{{NC}} Regenerating cross-layer fixtures..."
    {{node}} {{scripts_dir}}/regen-pedersen-fixtures.js
    @echo -e "{{GREEN}}[pedersen-fixtures]{{NC}} Pedersen fixtures regenerated!"

# CI gate: regenerate palette artifacts and assert no diff. Catches both
# hand-edits to the generated files AND missed regen after recipe edits.
verify-palette:
    #!/usr/bin/env bash
    set -euo pipefail
    echo -e "{{BLUE}}[palette]{{NC}} Verifying palette artifacts are in sync with palette/paletteRecipe.json..."
    node {{scripts_dir}}/generate-palette.js
    if ! git diff --quiet -- contracts/src/MazePalette.sol frontend/src/lib/paletteRecipe.generated.ts palette/paletteRecipe.json; then
        echo -e "{{RED}}[palette]{{NC}} Generated palette artifacts are out of sync."
        echo -e "{{RED}}[palette]{{NC}} Either the recipe was edited without regen, or someone hand-edited a generated file."
        echo -e "{{YELLOW}}[palette]{{NC}} Run \`just generate-palette\` and commit the result."
        git --no-pager diff -- contracts/src/MazePalette.sol frontend/src/lib/paletteRecipe.generated.ts palette/paletteRecipe.json
        exit 1
    fi
    echo -e "{{GREEN}}[palette]{{NC}} Palette artifacts in sync."

# CI gate: verify circuit ↔ Solidity ↔ TS public-input shape agreement.
# The deployed verifier bakes the circuit's verification key into bytecode,
# so any silent ABI drift between maze_prover/src/main.nr,
# contracts/src/MazeConstants.sol, and frontend/src/lib/zkSerialize.ts will
# invalidate the verifier without warning. Run before forge test. See ma-3xv.
check-abi-drift:
    @echo -e "{{BLUE}}[abi-drift]{{NC}} Checking circuit ↔ Solidity ↔ TS ABI agreement..."
    node {{scripts_dir}}/check-abi-drift.js

# Self-test for check-abi-drift: artificially desyncs each source of truth
# and confirms the gate fires. Slow-ish (mutates files in-place with rollback).
test-abi-drift:
    @echo -e "{{BLUE}}[abi-drift]{{NC}} Running check-abi-drift self-tests..."
    bash {{scripts_dir}}/check-abi-drift.test.sh

# Codegen the TS ProverInput interface from the circuit's compiled ABI.
# Sibling to check-abi-drift (count-side gate) — this pins field shape, so
# adding/renaming a circuit param surfaces as a TypeScript error in
# `generateProverInput` instead of nargo's runtime "input not found". See
# bead ma-7qm + retro Appendix C.
generate-prover-input-types:
    @echo -e "{{BLUE}}[prover-input-types]{{NC}} Generating TS interface from circuit ABI..."
    {{node}} {{scripts_dir}}/generate-prover-input-types.js
    @echo -e "{{GREEN}}[prover-input-types]{{NC}} Generation complete!"

# CI gate: regenerate ProverInput types and assert no diff. Catches both
# hand-edits to the generated file AND missed regen after circuit ABI
# changes. Mirrors verify-palette.
verify-prover-input-types:
    #!/usr/bin/env bash
    set -euo pipefail
    echo -e "{{BLUE}}[prover-input-types]{{NC}} Verifying generated TS interface is in sync with circuit ABI..."
    {{node}} {{scripts_dir}}/generate-prover-input-types.js
    if ! git diff --quiet -- frontend/src/lib/proverInput.generated.ts; then
        echo -e "{{RED}}[prover-input-types]{{NC}} frontend/src/lib/proverInput.generated.ts is out of sync with maze_prover/target/maze_prover.json."
        echo -e "{{RED}}[prover-input-types]{{NC}} Either the ABI changed without regen, or someone hand-edited the generated file."
        echo -e "{{YELLOW}}[prover-input-types]{{NC}} Run \`just generate-prover-input-types\` and commit the result."
        git --no-pager diff -- frontend/src/lib/proverInput.generated.ts
        exit 1
    fi
    echo -e "{{GREEN}}[prover-input-types]{{NC}} Generated interface in sync with circuit ABI."

# Self-test for generate-prover-input-types: mutate the ABI, confirm the
# verify gate fires; mutate the generated file by hand, same. Restores via
# trap.
test-prover-input-types:
    @echo -e "{{BLUE}}[prover-input-types]{{NC}} Running generate-prover-input-types self-tests..."
    bash {{scripts_dir}}/generate-prover-input-types.test.sh

# === CIRCUIT COMPILATION ===

# Compile Noir circuits via noir_wasm and sync to frontend (no native nargo)
compile-circuits:
    @echo -e "{{BLUE}}[circuits]{{NC}} Compiling maze_prover via noir_wasm..."
    {{node}} {{tools_dir}}/generate-verifier.mjs compile
    @echo -e "{{GREEN}}[circuits]{{NC}} Circuit compilation complete!"

_compile-circuit: compile-circuits

# Generate Solidity verifier (compiles circuit + writes MazeVerifier.sol via bb.js)
generate-verifier:
    @echo -e "{{BLUE}}[verifier]{{NC}} Generating verifier (noir_wasm + bb.js, no native deps)..."
    {{node}} {{tools_dir}}/generate-verifier.mjs all
    @echo -e "{{YELLOW}}[verifier]{{NC}} Normalizing with forge fmt..."
    cd {{contracts_dir}} && {{forge}} fmt src/generated/MazeVerifier.sol
    @echo -e "{{GREEN}}[verifier]{{NC}} Verifier generated!"

# === CONTRACT DEPLOYMENT ===

# Deploy contracts locally (starts Anvil if needed).
# Regenerates the Solidity verifier first so on-chain VK matches the
# current circuit source — see ma-6ff for the stale-verifier incident.
deploy-local: _ensure-anvil generate-verifier
    @echo -e "{{BLUE}}[deploy]{{NC}} Deploying to local network..."
    @just _deploy-contracts {{anvil_rpc}} "local"
    @just _generate-frontend-config 31337
    @echo -e "{{GREEN}}[deploy]{{NC}} Local deployment complete!"

# Deploy contracts to Sepolia testnet.
# Regenerates the Solidity verifier first — circuit and on-chain VK MUST
# stay in lockstep (ma-6ff). Skip with `SKIP_VERIFIER_GEN=1` when
# redeploying the same circuit.
deploy-sepolia:
    #!/usr/bin/env bash
    set -euo pipefail

    if [ -z "${SEPOLIA_RPC_URL:-}" ]; then
        echo -e "{{RED}}[deploy]{{NC}} Error: SEPOLIA_RPC_URL not set"
        echo "Set it in .env or export it"
        exit 1
    fi

    if [ -z "${PRIVATE_KEY:-}" ]; then
        echo -e "{{RED}}[deploy]{{NC}} Error: PRIVATE_KEY not set"
        echo "Set it in .env or export it"
        exit 1
    fi

    if [ "${SKIP_VERIFIER_GEN:-0}" != "1" ]; then
        just generate-verifier
    fi

    echo -e "{{BLUE}}[deploy]{{NC}} Deploying to Sepolia testnet..."
    just _deploy-contracts "$SEPOLIA_RPC_URL" "sepolia"
    just _generate-frontend-config 11155111
    echo -e "{{GREEN}}[deploy]{{NC}} Sepolia deployment complete!"

# Deploy contracts to Base mainnet (chain 8453). Gas is paid in ETH.
# Invoke via `scripts/with-base.sh just deploy-base` so BASE_RPC_URL and
# PRIVATE_KEY are loaded from ~/.config/gt-mazeking/base.env. See DEPLOY.md.
# Regenerates the verifier first (ma-6ff); skip with SKIP_VERIFIER_GEN=1.
deploy-base:
    #!/usr/bin/env bash
    set -euo pipefail

    if [ -z "${BASE_RPC_URL:-}" ]; then
        echo -e "{{RED}}[deploy]{{NC}} Error: BASE_RPC_URL not set (run via scripts/with-base.sh)"
        exit 1
    fi

    if [ -z "${PRIVATE_KEY:-}" ]; then
        echo -e "{{RED}}[deploy]{{NC}} Error: PRIVATE_KEY not set (run via scripts/with-base.sh)"
        exit 1
    fi

    if [ "${SKIP_VERIFIER_GEN:-0}" != "1" ]; then
        just generate-verifier
    fi

    echo -e "{{BLUE}}[deploy]{{NC}} Deploying to Base mainnet..."
    just _deploy-contracts "$BASE_RPC_URL" "base"
    just _generate-frontend-config 8453
    echo -e "{{GREEN}}[deploy]{{NC}} Base deployment complete!"

# Deploy contracts to Polygon zkEVM mainnet (chain 1101). Gas is paid in ETH.
# Invoke via `scripts/with-polygon-zkevm.sh just deploy-polygon-zkevm` so
# POLYGON_ZKEVM_RPC_URL and PRIVATE_KEY are loaded from
# ~/.config/gt-mazeking/polygon-zkevm.env. See DEPLOY.md.
# Regenerates the verifier first (ma-6ff); skip with SKIP_VERIFIER_GEN=1.
deploy-polygon-zkevm:
    #!/usr/bin/env bash
    set -euo pipefail

    if [ -z "${POLYGON_ZKEVM_RPC_URL:-}" ]; then
        echo -e "{{RED}}[deploy]{{NC}} Error: POLYGON_ZKEVM_RPC_URL not set (run via scripts/with-polygon-zkevm.sh)"
        exit 1
    fi

    if [ -z "${PRIVATE_KEY:-}" ]; then
        echo -e "{{RED}}[deploy]{{NC}} Error: PRIVATE_KEY not set (run via scripts/with-polygon-zkevm.sh)"
        exit 1
    fi

    if [ "${SKIP_VERIFIER_GEN:-0}" != "1" ]; then
        just generate-verifier
    fi

    echo -e "{{BLUE}}[deploy]{{NC}} Deploying to Polygon zkEVM mainnet..."
    just _deploy-contracts "$POLYGON_ZKEVM_RPC_URL" "polygon-zkevm"
    just _generate-frontend-config 1101
    echo -e "{{GREEN}}[deploy]{{NC}} Polygon zkEVM deployment complete!"

# Internal: Deploy contracts to specified network
_deploy-contracts rpc_url network:
    #!/usr/bin/env bash
    set -euo pipefail
    echo -e "{{YELLOW}}[forge]{{NC}} Deploying contracts to {{network}}..."
    cd {{contracts_dir}}

    # Set default PRIVATE_KEY if using local Anvil
    if [ "{{network}}" = "local" ]; then
        export PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
    fi

    {{forge}} script script/Deploy.s.sol \
        --rpc-url {{rpc_url}} \
        --broadcast \
        --legacy

    echo -e "{{GREEN}}[forge]{{NC}} Deployment successful!"

# Internal: Ensure Anvil is running (start if needed)
_ensure-anvil:
    #!/usr/bin/env bash
    set -euo pipefail

    # Check if Anvil is already running
    if lsof -Pi :{{anvil_port}} -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "{{GREEN}}[anvil]{{NC}} Anvil already running on port {{anvil_port}}"
        {{scripts_dir}}/inject-multicall3.sh {{anvil_rpc}}
        exit 0
    fi

    echo -e "{{YELLOW}}[anvil]{{NC}} Starting Anvil on port {{anvil_port}}..."

    # Start Anvil in background
    anvil --port {{anvil_port}} > /tmp/anvil.log 2>&1 &
    ANVIL_PID=$!
    echo $ANVIL_PID > /tmp/anvil.pid

    # Wait for Anvil to be ready
    for i in {1..30}; do
        if lsof -Pi :{{anvil_port}} -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo -e "{{GREEN}}[anvil]{{NC}} Anvil started successfully (PID: $ANVIL_PID)"
            echo -e "{{BLUE}}[anvil]{{NC}} Logs: /tmp/anvil.log"
            {{scripts_dir}}/inject-multicall3.sh {{anvil_rpc}}
            exit 0
        fi
        sleep 0.5
    done

    echo -e "{{RED}}[anvil]{{NC}} Failed to start Anvil"
    exit 1

# Stop Anvil if running
stop-anvil:
    #!/usr/bin/env bash
    if [ -f /tmp/anvil.pid ]; then
        PID=$(cat /tmp/anvil.pid)
        if kill -0 $PID 2>/dev/null; then
            echo -e "{{YELLOW}}[anvil]{{NC}} Stopping Anvil (PID: $PID)..."
            kill $PID
            rm /tmp/anvil.pid
            echo -e "{{GREEN}}[anvil]{{NC}} Anvil stopped"
        else
            echo -e "{{YELLOW}}[anvil]{{NC}} Anvil not running (stale PID file)"
            rm /tmp/anvil.pid
        fi
    else
        echo -e "{{YELLOW}}[anvil]{{NC}} Anvil not running"
    fi

# Internal: Generate TypeScript config file for frontend
_generate-frontend-config chain_id:
    @echo -e "{{YELLOW}}[config]{{NC}} Generating frontend contracts config..."
    node {{scripts_dir}}/generate-contracts-config.js {{chain_id}}
    @echo -e "{{GREEN}}[config]{{NC}} Frontend config generated!"

# === SIDE-CONTRACT UPGRADES ===
#
# Upgrade individual side contracts (renderer, verifier, awarder) without
# redeploying MazeKingNFT itself. Each recipe deploys a fresh side contract,
# rehooks the NFT via setX(newAddress), runs an ABI sanity probe, and
# regenerates frontend/src/lib/contracts.generated.ts.
#
# Use `just deploy-sepolia` for full re-deploys (including NFT) — the upgrade
# recipes here are the "exception that proves the rule" for partial swaps.
# See DEPLOY.md for the decision matrix.
#
# Each `*` guard recipe is intentionally bare so an operator can't fat-finger
# Sepolia when they meant local — pick `-local` or `-sepolia` explicitly.
# Sepolia variants require env vars from `scripts/with-sepolia.sh`.

# --- Renderer ---
# `redeploy-svg-*` aliases predate the upgrade-* family (ma-96n); both names
# call into the same script and behave identically.

upgrade-renderer:
    @{{scripts_dir}}/redeploy-svg.sh

upgrade-renderer-local: _ensure-anvil
    @{{scripts_dir}}/redeploy-svg.sh local

upgrade-renderer-sepolia:
    @{{scripts_dir}}/redeploy-svg.sh sepolia

redeploy-svg: upgrade-renderer

redeploy-svg-local: upgrade-renderer-local

redeploy-svg-sepolia: upgrade-renderer-sepolia

# --- Verifier ---
# Regenerates the verifier from the circuit before deploy — keeps on-chain
# VK in lockstep with circuit source (ma-6ff).

upgrade-verifier:
    @{{scripts_dir}}/upgrade-verifier.sh

upgrade-verifier-local: _ensure-anvil
    @{{scripts_dir}}/upgrade-verifier.sh local

upgrade-verifier-sepolia:
    @{{scripts_dir}}/upgrade-verifier.sh sepolia

# --- Badge awarder ---

upgrade-awarder:
    @{{scripts_dir}}/upgrade-awarder.sh

upgrade-awarder-local: _ensure-anvil
    @{{scripts_dir}}/upgrade-awarder.sh local

upgrade-awarder-sepolia:
    @{{scripts_dir}}/upgrade-awarder.sh sepolia

# === DEVELOPMENT ===

# Start frontend development server
dev:
    @echo -e "{{BLUE}}[dev]{{NC}} Starting frontend dev server..."
    cd {{frontend_dir}} && {{pnpm}} dev

# Start full development environment (Anvil + Frontend)
dev-full:
    @echo -e "{{BLUE}}[dev-full]{{NC}} Starting full development environment..."
    @just _ensure-anvil
    @echo -e "{{YELLOW}}[dev-full]{{NC}} Starting frontend in 2 seconds..."
    @sleep 2
    @just dev

# === TESTING ===

# Run all tests (circuits, contracts, frontend)
test:
    @echo -e "{{BLUE}}[test]{{NC}} Running all tests..."
    @just test-circuits
    @just test-contracts
    @just test-frontend
    @echo -e "{{GREEN}}[test]{{NC}} All tests passed!"

# Run contract tests
test-contracts:
    @echo -e "{{YELLOW}}[test]{{NC}} Running contract tests..."
    cd {{contracts_dir}} && {{forge}} test -vv

# Run frontend tests
test-frontend:
    @echo -e "{{YELLOW}}[test]{{NC}} Running frontend tests..."
    cd {{frontend_dir}} && {{pnpm}} test:run

# Run circuit tests
test-circuits:
    @echo -e "{{YELLOW}}[test]{{NC}} Running circuit tests..."
    cd {{maze_prover_dir}} && {{nargo}} test

# Run the full-tier e2e test (solve → prove → off-chain verify).
# Slow (proof generation): intended for nightly / main-branch CI, not per-PR.
# The fast tier (solve → witness) runs as part of `test-frontend`.
test-e2e-full:
    @echo -e "{{YELLOW}}[test]{{NC}} Running full e2e (solve → prove → verify)..."
    cd {{frontend_dir}} && {{pnpm}} test:e2e-full

# Run the on-chain mint e2e (solve → prove → mintWithProof on anvil).
# Builds on `test-e2e-full` by also submitting the proof to a real
# `HonkVerifier` deployment, catching verifier-bytecode drift and ABI
# mismatches that the off-chain verify path can't see (see ma-cfg).
# Slow (deploy + proof generation): nightly / main-branch only. The
# `deploy-local` dependency regenerates the verifier from the current
# circuit, so verifier-VK drift surfaces here too.
test-e2e-mint: deploy-local
    @echo -e "{{YELLOW}}[test]{{NC}} Running e2e mint (solve → prove → mint on anvil)..."
    cd {{frontend_dir}} && {{pnpm}} test:e2e-mint

# === REGISTRAR ===

# Register an official maze and set its optimal move count.
#
# This is what makes badges reachable. DefaultBadgeAwarder gates every medal
# behind `optimalMoves[tokenId] > 0`, so an unregistered maze awards nothing —
# the ROBOT crown included. The optimum is a BFS over the product graph
# (x, y, hasRobe, hasScepter); a naive shortest path would under-count and
# hand out crowns for imperfect solves.
#
#   just register-maze "Zero Knowledge" 0xNFT https://rpc... 0xKEY
#   just register-maze-dry "Zero Knowledge"
register-maze seed nft rpc key:
    cd {{frontend_dir}} && {{pnpm}} exec vite-node scripts/register-maze.ts -- \
        --seed "{{seed}}" --nft "{{nft}}" --rpc "{{rpc}}" --key "{{key}}"

# Preview a seed's maze hash, tokenId and optimum without touching a chain.
register-maze-dry seed:
    cd {{frontend_dir}} && {{pnpm}} exec vite-node scripts/register-maze.ts -- \
        --seed "{{seed}}" --dry-run

# === FORMATTING ===

# Format all code
format:
    @echo -e "{{BLUE}}[format]{{NC}} Formatting all code..."
    @just format-contracts
    @just format-frontend
    @just format-circuits
    @echo -e "{{GREEN}}[format]{{NC}} Formatting complete!"

# Format contract code
format-contracts:
    @echo -e "{{YELLOW}}[format]{{NC}} Formatting Solidity contracts..."
    cd {{contracts_dir}} && {{forge}} fmt

# Format frontend code
format-frontend:
    @echo -e "{{YELLOW}}[format]{{NC}} Formatting TypeScript/React code..."
    cd {{frontend_dir}} && {{pnpm}} exec prettier --write "src/**/*.{ts,tsx,js,jsx,json,css}"

# Format circuit code
format-circuits:
    @echo -e "{{YELLOW}}[format]{{NC}} Formatting Noir circuits..."
    cd {{maze_prover_dir}} && {{nargo}} fmt

# === LINTING ===

# Lint all code
lint:
    @echo -e "{{BLUE}}[lint]{{NC}} Linting all code..."
    @just check-abi-drift
    @just verify-prover-input-types
    @just check-no-fr-tostring
    @just check-consensus-critical
    @just lint-contracts
    @just lint-frontend
    @echo -e "{{GREEN}}[lint]{{NC}} Linting complete!"

# CI gate: forbid direct `.toString()` on Fr field elements in the frontend.
#
# Fr → hex through `.toString()` strips leading zeros for ~1-in-256 field
# elements (those whose high byte is < 0x10), which silently corrupts
# `bytes32` hex when fed to viem — mints fail in production for some mazes.
# See bead ma-dr5 + retro 2026-05-05 Appendix C.
#
# Always go through `frToBytes32` (frontend/src/lib/frToBytes32.ts), which
# wraps the only correct path: `Fr.toBuffer()` → per-byte hex with padStart.
#
# Match heuristic: any identifier ending in `Fr` or `fr` (case-insensitive last
# two letters) followed by `.toString(` — catches `Fr.toString()`,
# `fr.toString()`, `mazeFr.toString()`, `frHash`-style misses are accepted as
# the cost of a simple grep gate. The helper file itself is allowed to mention
# the footgun in comments.
check-no-fr-tostring:
    #!/usr/bin/env bash
    set -euo pipefail
    echo -e "{{BLUE}}[fr-tostring]{{NC}} Checking for direct .toString() on Fr in frontend/..."
    matches=$(grep -rEn \
        --include='*.ts' \
        --include='*.tsx' \
        --exclude='*.generated.ts' \
        --exclude='frToBytes32.ts' \
        --exclude='frToBytes32.test.ts' \
        '(^|[^A-Za-z0-9_])[Ff][rR]\.toString[[:space:]]*\(' \
        {{frontend_dir}}/src 2>/dev/null || true)
    if [ -n "$matches" ]; then
        echo "$matches"
        echo -e "{{RED}}[fr-tostring]{{NC}} Found direct Fr.toString() call(s) above."
        echo -e "{{YELLOW}}[fr-tostring]{{NC}} Use \`frToBytes32(fr)\` from frontend/src/lib/frToBytes32.ts instead."
        echo -e "{{YELLOW}}[fr-tostring]{{NC}} Why: Fr.toString() can drop leading zeros for ~1-in-256 hashes →"
        echo -e "{{YELLOW}}[fr-tostring]{{NC}}      viem zero-extends on the wrong end → bytes32 corruption → mint fails."
        exit 1
    fi
    echo -e "{{GREEN}}[fr-tostring]{{NC}} No direct Fr.toString() calls. ✓"

# CI gate: ensure consensus-critical files (those that feed mazeHash → tokenID)
# still bear the CONSENSUS-CRITICAL marker, and that any branch modifying one
# of them carries a `consensus-critical-change: <bead-id>` ack in a commit
# message. See scripts/check-consensus-critical.js and bead ma-5yi.
check-consensus-critical:
    @echo -e "{{BLUE}}[consensus]{{NC}} Checking consensus-critical markers + change ack..."
    {{node}} {{scripts_dir}}/check-consensus-critical.js

# Self-test for check-consensus-critical: artificially mutates a registered
# file and a marker, confirms the gate fires in each case. Restores via trap.
test-consensus-critical:
    @echo -e "{{BLUE}}[consensus]{{NC}} Running check-consensus-critical self-tests..."
    bash {{scripts_dir}}/check-consensus-critical.test.sh

# Lint contract code
lint-contracts:
    @echo -e "{{YELLOW}}[lint]{{NC}} Linting Solidity contracts..."
    cd {{contracts_dir}} && {{forge}} fmt --check

# Lint frontend code
lint-frontend:
    @echo -e "{{YELLOW}}[lint]{{NC}} Linting TypeScript/React code..."
    cd {{frontend_dir}} && {{pnpm}} exec eslint "src/**/*.{ts,tsx}"

# === CLEANING ===

# Clean all build artifacts
clean:
    @echo -e "{{BLUE}}[clean]{{NC}} Cleaning build artifacts..."
    @just clean-circuits
    @just clean-contracts
    @just clean-frontend
    @echo -e "{{GREEN}}[clean]{{NC}} Clean complete!"

# Clean circuit artifacts
clean-circuits:
    @echo -e "{{YELLOW}}[clean]{{NC}} Cleaning circuit artifacts..."
    rm -rf {{circuit_target}}
    rm -rf {{frontend_circuit_dir}}
    @echo -e "{{GREEN}}[clean]{{NC}} Circuit artifacts cleaned"

# Clean contract artifacts
clean-contracts:
    @echo -e "{{YELLOW}}[clean]{{NC}} Cleaning contract artifacts..."
    cd {{contracts_dir}} && {{forge}} clean
    rm -rf {{deployments_dir}}
    @echo -e "{{GREEN}}[clean]{{NC}} Contract artifacts cleaned"

# Clean frontend artifacts
clean-frontend:
    @echo -e "{{YELLOW}}[clean]{{NC}} Cleaning frontend artifacts..."
    rm -rf {{frontend_dir}}/dist
    rm -rf {{frontend_dir}}/node_modules/.vite
    @echo -e "{{GREEN}}[clean]{{NC}} Frontend artifacts cleaned"

# === RESET ===

# Full reset: clean + reinstall dependencies
reset: clean
    @echo -e "{{BLUE}}[reset]{{NC}} Performing full reset..."
    @echo -e "{{YELLOW}}[reset]{{NC}} Removing node_modules..."
    rm -rf {{frontend_dir}}/node_modules
    @echo -e "{{YELLOW}}[reset]{{NC}} Removing contract cache..."
    rm -rf {{contracts_dir}}/cache
    rm -rf {{contracts_dir}}/out
    @just setup
    @echo -e "{{GREEN}}[reset]{{NC}} Reset complete!"

# === LOGS & MONITORING ===

# Show Anvil logs
logs-anvil:
    @if [ -f /tmp/anvil.log ]; then tail -f /tmp/anvil.log; else echo "No Anvil logs found. Start Anvil with: just _ensure-anvil"; fi

# === INTEGRATION TESTING ===

# Run full integration test flow
integration-test: _ensure-anvil
    @echo -e "{{BLUE}}[integration]{{NC}} Running integration test..."
    @just compile-circuits
    @just deploy-local
    @echo -e "{{YELLOW}}[integration]{{NC}} Running end-to-end tests..."
    {{scripts_dir}}/integration-test.sh
    @echo -e "{{GREEN}}[integration]{{NC}} Integration test complete!"

# === BUILD ===

# Build everything for production
build:
    @echo -e "{{BLUE}}[build]{{NC}} Building for production..."
    @just compile-circuits
    @just _build-contracts
    @just _build-frontend
    @echo -e "{{GREEN}}[build]{{NC}} Build complete!"

# Build contracts
_build-contracts:
    @echo -e "{{YELLOW}}[build]{{NC}} Building contracts..."
    cd {{contracts_dir}} && {{forge}} build

# Build frontend
_build-frontend:
    @echo -e "{{YELLOW}}[build]{{NC}} Building frontend..."
    cd {{frontend_dir}} && {{pnpm}} build

# === STATUS ===

# Show project status
status:
    @echo -e "{{BLUE}}[status]{{NC}} Project Status"
    @echo ""
    @just _status-tools
    @echo ""
    @just _status-anvil
    @echo ""
    @just _status-artifacts

# Check tool versions
_status-tools:
    #!/usr/bin/env bash
    echo -e "{{YELLOW}}Tools:{{NC}}"
    echo "  node:   $({{node}} --version 2>/dev/null || echo 'not found')"
    echo "  nargo:  $({{nargo}} --version 2>/dev/null || echo 'not found (optional — only for nargo test/fmt)')"
    echo "  forge:  $({{forge}} --version 2>/dev/null | head -1 || echo 'not found')"
    echo "  pnpm:   $({{pnpm}} --version 2>/dev/null || echo 'not found')"

# Check Anvil status
_status-anvil:
    #!/usr/bin/env bash
    echo -e "{{YELLOW}}Anvil:{{NC}}"
    if lsof -Pi :{{anvil_port}} -sTCP:LISTEN -t >/dev/null 2>&1; then
        if [ -f /tmp/anvil.pid ]; then
            PID=$(cat /tmp/anvil.pid)
            echo -e "  {{GREEN}}Running{{NC}} (PID: $PID, Port: {{anvil_port}})"
        else
            echo -e "  {{GREEN}}Running{{NC}} (Port: {{anvil_port}})"
        fi
    else
        echo -e "  {{RED}}Not running{{NC}}"
    fi

# Check artifact status
_status-artifacts:
    #!/usr/bin/env bash
    echo -e "{{YELLOW}}Artifacts:{{NC}}"

    # Circuit
    if [ -f "{{circuit_json}}" ]; then
        echo -e "  Circuit:    {{GREEN}}✓{{NC}} compiled"
    else
        echo -e "  Circuit:    {{RED}}✗{{NC}} not compiled"
    fi

    # Frontend circuit
    if [ -f "{{frontend_circuit_json}}" ]; then
        echo -e "  Frontend:   {{GREEN}}✓{{NC}} circuit synced"
    else
        echo -e "  Frontend:   {{RED}}✗{{NC}} circuit not synced"
    fi

    # Deployments
    local_deploy="{{deployments_dir}}/31337.json"
    if [ -f "$local_deploy" ]; then
        echo -e "  Local:      {{GREEN}}✓{{NC}} deployed"
    else
        echo -e "  Local:      {{RED}}✗{{NC}} not deployed"
    fi

    sepolia_deploy="{{deployments_dir}}/11155111.json"
    if [ -f "$sepolia_deploy" ]; then
        echo -e "  Sepolia:    {{GREEN}}✓{{NC}} deployed"
    else
        echo -e "  Sepolia:    {{RED}}✗{{NC}} not deployed"
    fi
