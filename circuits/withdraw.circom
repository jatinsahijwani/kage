pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "./lib/merkleTree.circom";

// Proves knowledge of a (nullifier, secret, amount) commitment included in
// the Merkle tree at `root`, where `amount` is one of exactly two allowed
// denominations (D1, D2). `recipient`, `relayer` and `fee` are bound into
// the proof so a relayer cannot alter withdrawal parameters and still have
// the proof verify (Tornado Cash's anti-malleability pattern).
template Withdraw(levels, D1, D2) {
    signal input root;
    signal input nullifierHash;
    signal input recipient;
    signal input relayer;
    signal input fee;
    signal input amount;

    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // nullifier hash: one-way, reveals nothing about `nullifier`, used
    // on-chain to prevent double-spending this note.
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHasher.out === nullifierHash;

    // commitment binds the note to a specific fixed denomination.
    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;
    commitmentHasher.inputs[2] <== amount;

    component tree = MerkleTreeInclusionProof(levels);
    tree.leaf <== commitmentHasher.out;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    tree.root === root;

    // Fixed-denomination enforcement: amount must equal D1 or D2. There is
    // no way to satisfy this constraint, and therefore no way to produce a
    // valid proof, for any other amount.
    (amount - D1) * (amount - D2) === 0;

    // Relayer fee may not exceed the withdrawn amount.
    component feeCheck = LessEqThan(66);
    feeCheck.in[0] <== fee;
    feeCheck.in[1] <== amount;
    feeCheck.out === 1;

    // Force recipient/relayer to be genuinely constrained (not just
    // declared) public inputs so the proof cannot be replayed against
    // different withdrawal parameters.
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
    signal relayerSquare;
    relayerSquare <== relayer * relayer;
}

// 20 levels matches the on-chain tree depth (contracts/src/MerkleTreeWithHistory.sol).
// D1 = 1 unit, D2 = 10 units of an 18-decimal token (1e18, 10e18).
component main {public [root, nullifierHash, recipient, relayer, fee, amount]} =
    Withdraw(20, 1000000000000000000, 10000000000000000000);
