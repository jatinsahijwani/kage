// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PoseidonT3} from "../src/generated/PoseidonT3.sol";

// Confirms the on-chain PoseidonT3 hasher agrees exactly with the
// circomlib Poseidon(2) used inside withdraw.circom, using test vectors
// computed independently via circomlibjs (see circuits/ for how). If this
// ever fails, on-chain roots and circuit-computed roots would silently
// diverge and every proof would fail to verify against a real deposit.
contract PoseidonParityTest is Test {
    function test_matchesCircomlibVectorZeroZero() public pure {
        uint256 result = PoseidonT3.hash([uint256(0), uint256(0)]);
        assertEq(
            result,
            14744269619966411208579211824598458697587494354926760081771325075741142829156
        );
    }

    function test_matchesCircomlibVectorOneTwo() public pure {
        uint256 result = PoseidonT3.hash([uint256(1), uint256(2)]);
        assertEq(
            result,
            7853200120776062878684798364095072458815029376092732009249414926327459813530
        );
    }
}
