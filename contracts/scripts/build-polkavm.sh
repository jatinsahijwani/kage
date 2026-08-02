#!/usr/bin/env bash
# Best-effort compilation of the deployable contracts to PolkaVM bytecode
# via resolc (Parity's Solidity-to-PolkaVM compiler for pallet-revive).
# Foundry/forge remains the primary dev+test toolchain (see ../foundry.toml);
# this is a separate build path exercised specifically to confirm the
# contracts are deployable on Kusama Asset Hub. See docs/BENCHMARKS.md for
# the resulting bytecode sizes and docs/THREAT_MODEL.md for what this does
# and doesn't prove (no live deployment was attempted in this repo).
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=build/polkavm
mkdir -p "$OUT"

RESOLC=node_modules/.bin/resolc
if [ ! -x "$RESOLC" ]; then
  RESOLC="node node_modules/@parity/resolc/dist/bin.js"
fi

for contract in src/MockERC20.sol src/generated/Verifier.sol src/KageShieldedPool.sol; do
  echo "compiling $contract..."
  $RESOLC --bin --abi "$contract" -o "$OUT"
done

echo
echo "PolkaVM bytecode sizes:"
find "$OUT" -name "*.polkavm" -exec sh -c 'printf "%8d  %s\n" "$(wc -c < "$1")" "$1"' _ {} \;
