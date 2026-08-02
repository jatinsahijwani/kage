#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p build
circom withdraw.circom --r1cs --wasm --sym -o build

echo
echo "constraint count:"
snarkjs r1cs info build/withdraw.r1cs
