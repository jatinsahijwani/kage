// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleTreeWithHistory} from "./MerkleTreeWithHistory.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";

/// Fixed-denomination shielded pool for a single ERC20 asset.
///
/// One tree per allowed denomination, so each denomination's anonymity set
/// is independently countable. The amount a note is worth is baked into
/// its commitment (Poseidon(nullifier, secret, amount)) and constrained to
/// the allow-list *inside withdraw.circom* — that circuit-level constraint
/// is the real guarantee; the `denominationAllowed` checks here are cheap
/// defense-in-depth, not the primary control.
contract KageShieldedPool is MerkleTreeWithHistory {
    using SafeERC20 for IERC20;

    // BN254 scalar field size used by the circuit — commitments and
    // nullifier hashes must be canonical field elements or a proof could
    // never be constructed for them (and worse, could be ambiguous).
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IVerifier public immutable verifier;
    IERC20 public immutable token;

    mapping(uint256 => bool) public denominationAllowed;
    uint256[] public denominations;

    mapping(uint256 => Tree) private trees;
    mapping(uint256 => uint256) public leafCount;
    mapping(uint256 => bool) public nullifierSpent;

    event Deposit(
        uint256 indexed denomination,
        uint256 indexed commitment,
        uint32 leafIndex,
        uint256 root,
        uint256 timestamp
    );
    event Withdrawal(
        uint256 indexed denomination,
        address recipient,
        address indexed relayer,
        uint256 fee,
        uint256 nullifierHash
    );

    constructor(IVerifier _verifier, IERC20 _token, uint256[] memory _denominations) {
        require(_denominations.length > 0, "Pool: no denominations");
        verifier = _verifier;
        token = _token;
        for (uint256 i = 0; i < _denominations.length; i++) {
            uint256 denomination = _denominations[i];
            require(denomination > 0, "Pool: zero denomination");
            require(!denominationAllowed[denomination], "Pool: duplicate denomination");
            denominationAllowed[denomination] = true;
            denominations.push(denomination);
            _initTree(trees[denomination]);
        }
    }

    function deposit(uint256 denomination, uint256 commitment) external {
        require(denominationAllowed[denomination], "Pool: denomination not allowed");
        require(commitment < FIELD_SIZE, "Pool: commitment not in field");

        Tree storage tree = trees[denomination];
        uint32 leafIndex = _insert(tree, commitment);
        leafCount[denomination] += 1;

        token.safeTransferFrom(msg.sender, address(this), denomination);

        emit Deposit(denomination, commitment, leafIndex, _currentRoot(tree), block.timestamp);
    }

    function withdraw(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256 root,
        uint256 nullifierHash,
        address recipient,
        address relayer,
        uint256 fee,
        uint256 denomination
    ) external {
        require(denominationAllowed[denomination], "Pool: denomination not allowed");
        require(fee <= denomination, "Pool: fee exceeds denomination");
        require(!nullifierSpent[nullifierHash], "Pool: note already spent");
        require(nullifierHash < FIELD_SIZE, "Pool: nullifier not in field");

        Tree storage tree = trees[denomination];
        require(_isKnownRoot(tree, root), "Pool: unknown root");

        uint256[6] memory pubSignals = [
            root,
            nullifierHash,
            uint256(uint160(recipient)),
            uint256(uint160(relayer)),
            fee,
            denomination
        ];
        require(verifier.verifyProof(pA, pB, pC, pubSignals), "Pool: invalid proof");

        // Effects before interactions.
        nullifierSpent[nullifierHash] = true;

        if (fee > 0) {
            token.safeTransfer(relayer, fee);
        }
        token.safeTransfer(recipient, denomination - fee);

        emit Withdrawal(denomination, recipient, relayer, fee, nullifierHash);
    }

    function getAnonymitySet(uint256 denomination) external view returns (uint256 count, uint256 currentRoot) {
        count = leafCount[denomination];
        currentRoot = _currentRoot(trees[denomination]);
    }

    function isKnownRoot(uint256 denomination, uint256 root) external view returns (bool) {
        return _isKnownRoot(trees[denomination], root);
    }

    function getDenominations() external view returns (uint256[] memory) {
        return denominations;
    }
}
