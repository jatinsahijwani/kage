// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Matches the calldata layout snarkjs generates for a Groth16 verifier
/// with 6 public signals (see src/generated/Verifier.sol, generated from
/// circuits/withdraw.circom — do not hand-edit either).
interface IVerifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[6] calldata pubSignals
    ) external view returns (bool);
}
