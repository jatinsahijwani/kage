#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

snarkjs zkey export solidityverifier build/withdraw_final.zkey ../contracts/src/generated/Verifier.sol

echo "verifier exported to contracts/src/generated/Verifier.sol"
