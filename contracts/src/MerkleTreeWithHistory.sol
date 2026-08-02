// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoseidonT3} from "./generated/PoseidonT3.sol";

/// Incremental Merkle tree with root history, hashed with Poseidon(2) to
/// match circuits/withdraw.circom exactly (see test/PoseidonParity.t.sol).
/// Tornado Cash's `MerkleTreeWithHistory` pattern, parameterized so a
/// single contract can hold one independent tree per denomination (see
/// `Tree storage` args below) instead of being a singleton.
abstract contract MerkleTreeWithHistory {
    uint32 public constant LEVELS = 20;
    uint32 public constant ROOT_HISTORY_SIZE = 30;
    uint256 public constant ZERO_VALUE = 0;

    struct Tree {
        mapping(uint256 => uint256) filledSubtrees;
        mapping(uint256 => uint256) roots;
        uint32 currentRootIndex;
        uint32 nextIndex;
    }

    uint256[LEVELS + 1] public zeros;

    constructor() {
        uint256 currentZero = ZERO_VALUE;
        zeros[0] = currentZero;
        for (uint32 i = 0; i < LEVELS; i++) {
            currentZero = hashLeftRight(currentZero, currentZero);
            zeros[i + 1] = currentZero;
        }
    }

    function hashLeftRight(uint256 left, uint256 right) public pure returns (uint256) {
        return PoseidonT3.hash([left, right]);
    }

    function _initTree(Tree storage tree) internal {
        for (uint32 i = 0; i < LEVELS; i++) {
            tree.filledSubtrees[i] = zeros[i];
        }
        tree.roots[0] = zeros[LEVELS];
    }

    function _insert(Tree storage tree, uint256 leaf) internal returns (uint32 index) {
        uint32 currentIndex = tree.nextIndex;
        require(currentIndex != uint32(2 ** LEVELS), "MerkleTree: tree is full");

        uint256 currentLevelHash = leaf;
        uint256 left;
        uint256 right;

        for (uint32 i = 0; i < LEVELS; i++) {
            if (currentIndex % 2 == 0) {
                left = currentLevelHash;
                right = zeros[i];
                tree.filledSubtrees[i] = currentLevelHash;
            } else {
                left = tree.filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = hashLeftRight(left, right);
            currentIndex /= 2;
        }

        uint32 newRootIndex = (tree.currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        tree.currentRootIndex = newRootIndex;
        tree.roots[newRootIndex] = currentLevelHash;
        index = tree.nextIndex;
        tree.nextIndex = index + 1;
    }

    function _isKnownRoot(Tree storage tree, uint256 root) internal view returns (bool) {
        if (root == 0) return false;
        uint32 i = tree.currentRootIndex;
        for (uint32 j = 0; j < ROOT_HISTORY_SIZE; j++) {
            if (tree.roots[i] == root) return true;
            if (i == 0) {
                i = ROOT_HISTORY_SIZE - 1;
            } else {
                i--;
            }
        }
        return false;
    }

    function _currentRoot(Tree storage tree) internal view returns (uint256) {
        return tree.roots[tree.currentRootIndex];
    }
}
