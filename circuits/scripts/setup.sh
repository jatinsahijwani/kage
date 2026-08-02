#!/usr/bin/env bash
# Groth16 trusted setup for withdraw.circom.
#
# Phase 1 (Powers of Tau) reuses the public, widely-used Hermez/iden3
# "Perpetual Powers of Tau" ceremony output rather than generating a fresh
# one locally. Phase 2 (circuit-specific) is a SINGLE local contribution
# made by this script — that is a demo-only contribution, not a real
# multi-party ceremony, and the resulting .zkey must not be trusted for
# anything holding real value. See docs/THREAT_MODEL.md.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p build
PTAU=build/pot15_final.ptau

if [ ! -f "$PTAU" ]; then
  echo "downloading powers of tau (2^15, enough for ~11.5k constraints)..."
  curl -L -o "$PTAU" https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau
fi

snarkjs groth16 setup build/withdraw.r1cs "$PTAU" build/withdraw_0000.zkey

echo "kage-demo-contribution-$(date +%s)-$RANDOM" | \
  snarkjs zkey contribute build/withdraw_0000.zkey build/withdraw_final.zkey \
    --name="kage demo contribution (not a real ceremony)" -v

snarkjs zkey export verificationkey build/withdraw_final.zkey build/verification_key.json

echo
echo "trusted setup complete (demo-only, see docs/THREAT_MODEL.md)"
