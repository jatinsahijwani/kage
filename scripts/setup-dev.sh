#!/usr/bin/env bash
# One-shot local dev bootstrap: install all workspace dependencies, compile
# the circuit, run its (demo-only) trusted setup, export the Solidity
# verifier + matching test fixture, and build the contracts. After this,
# `npm run demo` runs the full deposit -> relayed-withdrawal flow end to end.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== checking toolchain =="
for bin in node npm circom snarkjs forge anvil; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "missing required tool: $bin" >&2
    exit 1
  fi
done

echo "== installing npm workspace dependencies =="
npm install

echo "== compiling circuit =="
(cd circuits && bash scripts/compile.sh)

echo "== running trusted setup (demo-only, see docs/THREAT_MODEL.md) =="
(cd circuits && bash scripts/setup.sh)

echo "== exporting Solidity verifier =="
(cd circuits && bash scripts/export-verifier.sh)

echo "== installing contracts dependencies (forge libs + npm) =="
if [ ! -d contracts/lib/forge-std/src ]; then
  GIT_CONFIG_GLOBAL=/dev/null git clone --depth 1 https://github.com/foundry-rs/forge-std.git contracts/lib/forge-std
fi
if [ ! -d contracts/lib/openzeppelin-contracts/contracts ]; then
  GIT_CONFIG_GLOBAL=/dev/null git clone --depth 1 --branch v5.1.0 \
    https://github.com/OpenZeppelin/openzeppelin-contracts.git contracts/lib/openzeppelin-contracts
fi
(cd contracts && npm install)

echo "== building contracts (needed before the fixture generator can read compiled artifacts) =="
(cd contracts && forge build)

echo "== regenerating the withdrawal proof fixture to match this verifier =="
(cd circuits && node scripts/gen-contract-fixtures.mjs)

echo "== running contract tests =="
(cd contracts && forge test)

echo
echo "setup complete. Try:"
echo "  npm run demo            # full deposit -> relayed withdraw flow on a local anvil chain"
echo "  npm run bench -w bench  # regenerate docs/BENCHMARKS.md numbers"
